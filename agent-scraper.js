/**
 * Agent: Auto-Scraper
 * URL eingeben → automatisch alle Infos + Fotos extrahieren
 * Funktioniert branchenübergreifend (Kanzlei, Praxis, Handwerk, Gastronomie, …).
 * Standard-Weg: komplettes Seiten-Inventar (site-inventory.js: Sitemap + BFS über
 * ALLE Unterseiten, charset-korrekt, Frames/Query-Navigation/Redirects inklusive)
 * → AI-Klassifizierung → gezielte Extraktion. Hardcodierte Pfade nur noch als Fallback.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const os = require('os');
const { callClaude, callClaudeVision } = require('./claude-cli');
const { buildInventory, classifyInventory, fetchPage } = require('./site-inventory');
const { buildScrapeReport, verifyTeamCompleteness } = require('./scrape-report');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

// Text-Caps (großzügig — Haiku-Kontext ist billig, verlorener Kunden-Content teuer)
const CAP_ABOUT = 6000;
const CAP_SPECIALTY = 4000;
const CAP_EXTRA_MAIN = 4000;
const CAP_EXTRA_SUB = 2500;
const CAP_PROFILE = 3500;
const MAX_EXTRA_SUBPAGES = 16;
const PROFILE_BATCH = 8;          // Personen je Haiku-Strukturierungs-Call

// ── Haupt-Funktion ────────────────────────────────────────────────────────────

async function scrapeRestaurant(url, opts = {}) {
  console.log(`🔍 Scrape: ${url}`);

  // Google Maps URL → Places API
  if (url.includes('maps.google') || url.includes('goo.gl/maps') || url.includes('maps.app.goo')) {
    return await scrapeGoogleMaps(url, opts);
  }

  // Normale Website
  return await scrapeWebsite(url);
}

// ── Website scrapen ───────────────────────────────────────────────────────────

async function scrapeWebsite(url) {
  let html = '';
  try {
    // Charset-korrekt laden (Latin-1-Sites!) und Redirects als neue Basis übernehmen
    // (http→https, www-Wechsel, Domain-Umzug) — sonst laufen alle Folge-Fetches
    // gegen die alte Adresse.
    const page = await fetchPage(url);
    html = page.html;
    if (page.finalUrl) url = page.finalUrl;
  } catch (e) {
    throw new Error(`Website nicht erreichbar: ${e.message}`);
  }

  let $ = cheerio.load(html);
  let raw = extractRaw($, html, url);

  // JS-gerenderte Sites (Wix/Jimdo/React) liefern statisch nur eine leere Hülle.
  // Dann mit echtem Browser nachrendern und neu extrahieren — kein Apify nötig.
  const bodyTextLen = $('body').text().replace(/\s+/g, ' ').trim().length;
  if (isThin(raw, bodyTextLen)) {
    try {
      console.log('🔁 Statisches HTML zu dünn — rendere mit Browser nach…');
      const rendered = await fetchRendered(url);
      const raw2 = extractRaw(cheerio.load(rendered), rendered, url);
      if (richness(raw2) > richness(raw)) {
        raw = raw2;
        console.log('   ✅ Render-Fallback lieferte mehr Daten.');
      }
    } catch (e) {
      console.warn('⚠️ Render-Fallback übersprungen:', e.message);
    }
  }

  // Claude analysiert und strukturiert die rohen Daten (mit Fallback ohne Claude)
  const structured = await claudeStructure(raw, url);

  // Deep-Scrape: komplettes Seiten-Inventar (Sitemap + BFS) → AI-Klassifizierung →
  // Extraktion ALLER relevanten Seiten → Coverage-Report. Ersetzt das Pfad-Raten.
  // SCRAPE_DEEP=0 als Notausschalter; bei JEDEM Fehler Fallback auf den alten Weg.
  let deepOk = false;
  if (process.env.SCRAPE_DEEP !== '0') {
    try {
      deepOk = await deepScrape(structured, html, url);
    } catch (e) {
      console.warn('⚠️ Deep-Scrape fehlgeschlagen — Fallback auf klassische Anreicherung:', e.message);
    }
  }

  // Klassischer Weg (hardcodierte Pfade) — nur noch als Fallback.
  if (!deepOk) {
    try {
      await enrichFromSubpages(structured, html, url);
    } catch (e) {
      console.warn('⚠️ Unterseiten-Anreicherung übersprungen:', e.message);
    }
  }

  // Bild-Speisekarten (Mobirise & Co.): blieb die Karte dünn, obwohl es eine
  // Speisekarten-Seite gibt, die Karte per Vision aus den Bildern strukturieren.
  if (menuItemCount(structured.menu) < 5) {
    try {
      await extractMenuViaVision(structured, url);
    } catch (e) {
      console.warn('⚠️ Vision-Speisekarte übersprungen:', e.message);
    }
  }
  return structured;
}

/** Zählt echte Positionen einer Menü-Struktur (Kategorien- oder Flach-Format). */
function menuItemCount(menu) {
  if (!Array.isArray(menu)) return 0;
  if (menu[0] && Array.isArray(menu[0].items)) return menu.reduce((s, c) => s + ((c && c.items) || []).length, 0);
  return menu.length;
}

/** Erstes JSON-Objekt aus einer LLM-Antwort ziehen (roh oder im ```json-Zaun). */
function parseJsonLoose(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

/**
 * Bild-Speisekarten per Vision strukturieren (Mobirise & Co. liefern die Karte nur
 * als PNG/JPG — Textextraktion findet dann „zu wenig Text"). Sucht Speisekarten-
 * Seiten (Scrape-Report + Standardpfade), lädt deren große Bilder und lässt Claude
 * die VOLLSTÄNDIGE Karte als JSON lesen: Kategorien, Größen-Preisspalten (sizes/
 * prices, z. B. Pizza 24/30/40/60), Einzelpreise, Hinweise (notes → menuNotes).
 * Übernimmt nur, wenn ≥ 5 echte Positionen lesbar waren. Nichts wird erfunden.
 */
async function extractMenuViaVision(result, baseUrl) {
  const MENU_PATH = /speisekarte|speisen|menu(?!e)|getraenke|getränke|karte/i;
  const candidates = [];
  const seen = new Set();
  const push = (u) => { if (u && !seen.has(u)) { seen.add(u); candidates.push(u); } };
  for (const e of [...(result.scrapeReport?.skipped || []), ...(result.scrapeReport?.used || [])]) {
    try { if (MENU_PATH.test(new URL(e.url).pathname)) push(e.url); } catch { /* kaputte URL egal */ }
  }
  for (const cand of ['speisekarte.html', 'speisekarte/', 'speisekarte.php', 'menu.html', 'menu/', 'karte.html']) {
    try { push(new URL(cand, baseUrl).href); } catch { /* egal */ }
  }
  if (!candidates.length) return false;

  // Bilder der ersten erreichbaren Speisekarten-Seite einsammeln (Icons raus, Dubletten raus)
  let imgUrls = [];
  for (const u of candidates.slice(0, 4)) {
    let html;
    try { html = (await fetchPage(u)).html; } catch { continue; }
    const $ = cheerio.load(html);
    const found = [];
    $('img').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy');
      if (!src) return;
      try { src = new URL(src, u).href; } catch { return; }
      if (!/\.(jpg|jpeg|png|webp)/i.test(src)) return;
      if (/logo|icon|favicon|sprite|badge|rate\.|button|pixel|placeholder/i.test(src)) return;
      if (!found.includes(src)) found.push(src);
    });
    if (found.length) { imgUrls = found.slice(0, 4); break; }
  }
  if (!imgUrls.length) return false;

  // Herunterladen (Mini-Grafiken < 40 KB sind keine Speisekarten)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-vision-'));
  const files = [];
  try {
    for (const [i, u] of imgUrls.entries()) {
      try {
        const res = await axios.get(u, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': UA } });
        if (!res.data || res.data.length < 40 * 1024) continue;
        const ext = (u.match(/\.(jpg|jpeg|png|webp)/i) || ['', 'png'])[1].toLowerCase();
        const p = path.join(tmpDir, `karte-${i + 1}.${ext}`);
        fs.writeFileSync(p, res.data);
        files.push(p);
      } catch { /* einzelnes Bild optional */ }
    }
    if (!files.length) return false;

    console.log(`   🍕 Bild-Speisekarte erkannt (${files.length} Bild${files.length > 1 ? 'er' : ''}) — Vision liest die Karte…`);
    const prompt = `Auf den Bildern ist die Speisekarte einer Gastronomie. Extrahiere die VOLLSTÄNDIGE Karte als JSON.

Regeln:
- NUR übernehmen, was lesbar dasteht — nichts erfinden, nichts ergänzen, Unlesbares weglassen.
- Preise exakt wie abgedruckt inkl. Währungszeichen (z. B. "8,50 €").
- Hat eine Kategorie Größen-Preisspalten (z. B. 24er/30er/40er/60er), setze in der Kategorie "sizes"
  (z. B. ["24 cm","30 cm","40 cm","60 cm"]) und je Gericht "prices" in derselben Reihenfolge — dann KEIN "price".
- Sonst je Gericht "price".
- "description" = Zutaten-/Beschreibungszeile, ohne Fußnoten-Ziffern (1,2,3 …) und ohne Zusatzstoff-Legende.
- Kategorien exakt wie abgedruckt (z. B. Pizza, Nudelgerichte, Salate, Paninis, Vorspeisen, Getränke).
- Allgemeine Hinweise (Lieferbedingungen, Mindestbestellwert, "alle Pizzen mit …", Öffnungszeiten NICHT) in "notes".

Antworte NUR mit JSON in exakt dieser Form:
{"menu":[{"category":"…","sizes":["…"],"items":[{"name":"…","description":"…","price":"…","prices":["…"]}]}],"notes":["…"]}`;

    // Sonnet statt Default: dichte Karten (100+ Positionen) brauchen schnellen
    // strukturierten Output — das Default-Modell lief hier in den 10-Min-Timeout.
    const answer = await callClaudeVision({ prompt, imagePaths: files, addDir: tmpDir, maxTurns: 10, model: 'sonnet', timeout: 900000 });
    const parsed = parseJsonLoose(answer);
    const count = menuItemCount(parsed && parsed.menu);
    if (count >= 5) {
      result.menu = parsed.menu;
      if (Array.isArray(parsed.notes) && parsed.notes.length) result.menuNotes = parsed.notes.filter(Boolean).map(String);
      console.log(`   🍕 Speisekarte per Vision: ${count} Positionen in ${parsed.menu.length} Kategorien`);
      return true;
    }
    console.warn(`   ⚠️ Vision-Speisekarte zu dünn (${count} Positionen) — verworfen.`);
    return false;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Tempdaten */ }
  }
}

/**
 * Inventar → Klassifizierung → Extraktion → Report. Liefert true bei Erfolg.
 * Hängt den Report an result.scrapeReport (server.js persistiert ihn als Datei).
 */
async function deepScrape(result, mainHtml, baseUrl) {
  const inventory = await buildInventory(baseUrl);
  if (inventory.length < 2) {
    console.log('   🔎 Inventar zu klein (One-Pager oder Crawl blockiert) — klassischer Weg.');
    return false;
  }
  console.log(`   🔎 Inventar: ${inventory.length} Seiten (${inventory.filter(e => e.source === 'sitemap').length} via Sitemap)`);

  const classified = await classifyInventory(inventory);
  const { extractionLog, teamOverviewText } = await enrichFromInventory(result, classified, mainHtml, baseUrl);

  const report = buildScrapeReport({ inventory, classified, result, extractionLog, sourceUrl: baseUrl });

  // Team-Vollständigkeit gegen die Übersichtsseite prüfen (optional, Haiku)
  if (teamOverviewText) {
    const check = await verifyTeamCompleteness(teamOverviewText, result.team || []);
    if (check) {
      report.team.onOverview = check.onOverview;
      report.team.missing = check.missing;
      if (check.missing.length) {
        report.warnings.push(`Auf der Team-Übersicht genannt, aber nicht übernommen: ${check.missing.join(', ')}`);
        report.flagged = true;
      }
    }
  }

  result.scrapeReport = report;
  const flag = report.flagged ? ' 🚩 GEFLAGGT' : '';
  console.log(`   📋 Scrape-Report: ${report.used.length}/${classified.length} Seiten übernommen, Content-Coverage ${report.coverage.contentPagesUsedPct}%${flag}`);
  for (const w of report.warnings) console.warn(`   ⚠️  ${w}`);
  return true;
}

// ── Rechts-Unterseiten (Impressum/Datenschutz/Kontakt) ──────────────────────────

/**
 * Findet auf der Hauptseite verlinkte Unterseiten und reichert das Ergebnis an:
 *   - result.legal.impressum / .datenschutz  → VERBATIM-Text (rechtssicher, kein LLM)
 *   - result.phone / result.email            → aus Kontaktseite, falls noch leer
 */
async function enrichFromSubpages(result, mainHtml, baseUrl) {
  const $ = cheerio.load(mainHtml);
  const found = {};
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href') || '';
    let abs;
    try { abs = new URL(href, baseUrl).href; } catch { return; }
    const l = href.toLowerCase();
    if (/impressum/.test(l)) found.impressum = found.impressum || abs;
    else if (/datenschutz|privacy/.test(l)) found.datenschutz = found.datenschutz || abs;
    else if (/kontakt|contact/.test(l)) found.kontakt = found.kontakt || abs;
  });

  const legal = {};
  if (found.impressum) { const t = await fetchLegalText(found.impressum); if (t) legal.impressum = t; }
  if (found.datenschutz) { const t = await fetchLegalText(found.datenschutz); if (t) legal.datenschutz = t; }
  if (Object.keys(legal).length) {
    result.legal = legal;
    console.log(`   ⚖️  Rechtstexte übernommen: ${Object.keys(legal).join(', ')}`);
    applyLegalNap(result, legal);
  }

  // Kontaktdaten aus kontakt.html nachziehen, falls Hauptseite/Strukturierung leer ließ.
  if (found.kontakt && (!result.phone || !result.email)) {
    try {
      const kh = (await fetchPage(found.kontakt)).html;
      const $$ = cheerio.load(kh);
      if (!result.phone) result.phone = extractPhone($$, kh) || result.phone;
      if (!result.email) result.email = extractEmail(kh) || result.email;
      if (result.phone || result.email) console.log(`   ☎️  Kontakt aus Unterseite: ${result.phone || ''} ${result.email || ''}`.trim());
    } catch { /* Kontaktseite optional */ }
  }

  // Über-uns-Text (für Startseite/Über-Sektion)
  for (const cand of ['kanzlei/', 'die-kanzlei/', 'ueber-uns/', 'die-kanzlei.html', 'kanzlei.html', 'ueber-uns.html', 'about.html']) {
    try {
      const u = new URL(cand, baseUrl).href;
      const t = htmlToReadableText((await fetchPage(u)).html);
      if (t && t.length > 80) { result.about = t.slice(0, CAP_ABOUT); break; }
    } catch { /* nächster Kandidat */ }
  }

  // Team-Profile (eigene Personenseiten): Foto + Bio + Schwerpunkte je Person.
  try {
    const profiles = await scrapeTeamProfiles(baseUrl);
    if (profiles.length) {
      result.team = profiles; // ersetzt die einfache Team-Liste durch volle Profile
      const withPhoto = profiles.filter(p => p.photo).length;
      console.log(`   👥 Profile übernommen: ${profiles.length} Personen (${withPhoto} mit Foto)`);
    }
  } catch (e) {
    console.warn('⚠️ Team-Profile übersprungen:', e.message);
  }

  // Rechtsgebiet-Detailtexte (eigene Seiten je Schwerpunkt) — sonst gehen echte Inhalte verloren.
  try {
    const details = await scrapeSpecialtyDetails(baseUrl);
    if (details.length) mergeSpecialtyDetails(result, details);
  } catch (e) {
    console.warn('⚠️ Rechtsgebiet-Texte übersprungen:', e.message);
  }

  // Weitere Bereiche (Notare, Über-uns, Service, Aktuelles) — generisch, sonst Info verloren.
  try {
    const extra = await scrapeExtraSections(baseUrl);
    if (extra.length) {
      result.extraPages = extra;
      console.log(`   📑 Weitere Bereiche: ${extra.map(e => `${e.key}(${e.subPages.length})`).join(', ')}`);
    }
  } catch (e) {
    console.warn('⚠️ Weitere Bereiche übersprungen:', e.message);
  }
}

/**
 * Impressum ist die zuverlässigste NAP-Quelle: E-Mail + PLZ-Adresse nachziehen,
 * falls die Hauptseite sie nicht hergab. Wird von beiden Anreicherungswegen genutzt.
 */
function applyLegalNap(result, legal) {
  const impText = (legal && legal.impressum && legal.impressum.text) || '';
  if (!impText) return;
  if (!result.email) {
    const em = impText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (em) result.email = em[0];
  }
  if (result.address && !/\b\d{5}\b/.test(result.address)) {
    const m = impText.match(/\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß.\- ]{2,40})/);
    if (m) {
      const city = m[2].trim().split(/[\n,]/)[0].trim();
      result.address = result.address.includes(city)
        ? result.address.replace(city, `${m[1]} ${city}`)
        : `${result.address}, ${m[1]} ${city}`;
    }
  }
}

// ── Inventar-getriebene Anreicherung (Deep-Scrape) ──────────────────────────────

/** HTML einer Seite charset-korrekt laden (oder null). Kleiner Helfer für den Inventar-Pfad. */
async function fetchHtml(url) {
  try {
    return (await fetchPage(url)).html;
  } catch { return null; }
}

/** Slug → menschenlesbares Label ("services-downloads" → "Services Downloads"). */
function labelFromSlug(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const MAX_EXTRA_GROUPS = 6; // mehr Extra-Seiten würden die Navigation sprengen

/**
 * Extraktion auf Basis des klassifizierten Inventars — statt hardcodierter Pfade.
 * Jede Seite hat einen Typ (team-profile, practice-area, …) und wird gezielt in
 * das passende Ergebnis-Feld übernommen. Führt ein extractionLog für den Report.
 * @returns {Promise<{extractionLog:object[], teamOverviewText:string}>}
 */
async function enrichFromInventory(result, classified, mainHtml, baseUrl) {
  const extractionLog = [];
  const logUsed = (url, usedAs) => extractionLog.push({ url, usedAs });
  const logSkip = (url, reason) => extractionLog.push({ url, reason });
  const byType = t => classified.filter(p => p.type === t);

  // 1) Rechtstexte (VERBATIM) — aus dem Inventar, sonst wie bisher von der Hauptseite
  const legal = {};
  const impPage = byType('legal-impressum')[0];
  const dsPage = byType('legal-datenschutz')[0];
  if (impPage) { const t = await fetchLegalText(impPage.url); if (t) { legal.impressum = t; logUsed(impPage.url, 'legal:impressum'); } }
  if (dsPage) { const t = await fetchLegalText(dsPage.url); if (t) { legal.datenschutz = t; logUsed(dsPage.url, 'legal:datenschutz'); } }
  if (!legal.impressum || !legal.datenschutz) {
    const $m = cheerio.load(mainHtml);
    const found = {};
    $m('a[href]').each((i, el) => {
      const href = $m(el).attr('href') || '';
      let abs; try { abs = new URL(href, baseUrl).href; } catch { return; }
      const l = href.toLowerCase();
      if (/impressum/.test(l)) found.impressum = found.impressum || abs;
      else if (/datenschutz|privacy/.test(l)) found.datenschutz = found.datenschutz || abs;
    });
    if (!legal.impressum && found.impressum) { const t = await fetchLegalText(found.impressum); if (t) legal.impressum = t; }
    if (!legal.datenschutz && found.datenschutz) { const t = await fetchLegalText(found.datenschutz); if (t) legal.datenschutz = t; }
  }
  if (Object.keys(legal).length) {
    result.legal = legal;
    applyLegalNap(result, legal);
    console.log(`   ⚖️  Rechtstexte übernommen: ${Object.keys(legal).join(', ')}`);
  }

  // 2) Kontaktdaten nachziehen, falls noch leer
  const contactPage = byType('contact')[0];
  if (contactPage && (!result.phone || !result.email)) {
    const kh = await fetchHtml(contactPage.url);
    if (kh) {
      const $$ = cheerio.load(kh);
      if (!result.phone) result.phone = extractPhone($$, kh) || result.phone;
      if (!result.email) result.email = extractEmail(kh) || result.email;
      if (result.phone || result.email) logUsed(contactPage.url, 'kontakt');
    }
  }

  // 3) Über-uns: längsten About-Text übernehmen
  let bestAbout = { text: '', url: '' };
  for (const p of byType('about')) {
    const h = await fetchHtml(p.url);
    const t = h ? htmlToReadableText(h) : '';
    if (t.length > bestAbout.text.length) bestAbout = { text: t, url: p.url };
  }
  if (bestAbout.text.length > 80) {
    result.about = bestAbout.text.slice(0, CAP_ABOUT);
    logUsed(bestAbout.url, 'about');
  }

  // 4) Team: ALLE klassifizierten Profil-Seiten (kein Verzeichnis-Zwang mehr) +
  //    Sicherheitsnetz: Links auf den Übersichtsseiten (falls die Klassifizierung
  //    einzelne Profile verpasst oder das Inventar am maxPages-Limit hing).
  //    Team-Seiten = klassifizierte Übersichten PLUS Seiten, deren Titel/H1/Pfad
  //    nach Team aussieht (fängt Fälle wie /kanzlei/mitarbeiter/ ab, die die
  //    Klassifizierung als "about"/"other" einsortiert hat).
  const persons = new Map(); // slug → {slug, role, url, personName}
  for (const p of byType('team-profile')) {
    const slug = slugFromUrl(p.url);
    if (slug && !persons.has(slug)) persons.set(slug, { slug, role: 'Team', url: p.url, personName: p.personName || null });
  }
  const teamPages = classified.filter(p => p.type === 'team-overview' ||
    (['about', 'other', 'service', 'news'].includes(p.type) &&
      (RX_TEAM_HINT.test(p.h1 || '') || RX_TEAM_HINT.test(p.title || '') || RX_TEAM_HINT.test(p.path || ''))));
  let teamOverviewText = '';
  const inlinePersons = []; // Personen OHNE eigene Profilseite (Karten auf Übersichtsseiten)
  for (const ov of teamPages) {
    const html = await fetchHtml(ov.url);
    if (!html) continue;
    if (teamOverviewText.length < 15000) teamOverviewText += (teamOverviewText ? '\n\n' : '') + htmlToReadableText(html);
    for (const link of findProfileLinks(html, ov.url)) {
      if (!persons.has(link.slug)) persons.set(link.slug, { slug: link.slug, role: 'Team', url: link.url, personName: null });
    }
    inlinePersons.push(...extractInlineTeam(html, ov.url));
  }
  if (persons.size) {
    const list = [...persons.values()];
    for (const p of list) await fetchPersonProfile(p);
    // Kurzprofile NICHT mehr stillschweigend verwerfen: mit bekanntem Namen behalten.
    const usable = list.filter(p => (p.text && p.text.length > 40) || p.personName);
    for (const p of list) {
      if (usable.includes(p)) logUsed(p.url, `team:${p.slug}`);
      else logSkip(p.url, 'Profiltext zu kurz und kein Name erkannt');
    }
    if (usable.length) {
      const profiles = await structureProfiles(usable);
      if (profiles.length) {
        result.team = profiles;
        const withPhoto = profiles.filter(p => p.photo).length;
        console.log(`   👥 Profile übernommen: ${profiles.length} Personen (${withPhoto} mit Foto)`);
      }
    }
  }
  // Inline-Personen ergänzen: Wer nur als Karte auf der Übersicht steht (kein
  // eigener Profil-Link), darf trotzdem nicht fehlen. Dedupe per Namen.
  if (inlinePersons.length) {
    const team = Array.isArray(result.team) ? result.team : [];
    const have = new Map(team.map(p => [normalizePersonName(p.name), p]));
    let added = 0;
    for (const ip of inlinePersons) {
      const key = normalizePersonName(ip.name);
      if (!key) continue;
      const existing = have.get(key);
      if (existing) {
        if (!existing.photo && ip.photo) existing.photo = ip.photo; // Foto nachtragen
        continue;
      }
      const person = {
        slug: nameToSlug(ip.name), name: ip.name, role: ip.role || 'Team',
        bio: '', schwerpunkte: [], qualifikationen: [], photo: ip.photo || null
      };
      team.push(person);
      have.set(key, person);
      added++;
    }
    if (added) {
      result.team = team;
      console.log(`   👥 Zusätzlich von Übersichtsseiten: ${added} Personen ohne eigene Profilseite`);
    }
  }

  // 5) Rechtsgebiete/Leistungen: alle klassifizierten Detailseiten + Übersichts-Sicherheitsnetz
  const areaSeen = new Set();
  const details = [];
  const addArea = async (url, slugHint) => {
    const slug = slugHint || slugFromUrl(url);
    if (!slug || areaSeen.has(slug)) return;
    areaSeen.add(slug);
    const page = await fetchHtml(url);
    if (!page) { logSkip(url, 'nicht erreichbar'); return; }
    const $ = cheerio.load(page);
    const name = ($('h1').first().text() || '').trim() || labelFromSlug(slug);
    const text = htmlToReadableText(page);
    if (text && text.length > 60) {
      details.push({ name, slug, text: text.slice(0, CAP_SPECIALTY) });
      logUsed(url, `rechtsgebiet:${slug}`);
    } else {
      logSkip(url, 'zu wenig Text');
    }
  };
  for (const p of byType('practice-area')) await addArea(p.url);
  for (const ov of byType('practice-area-overview')) {
    const html = await fetchHtml(ov.url);
    if (!html) continue;
    for (const link of findProfileLinks(html, ov.url)) await addArea(link.url, link.slug);
  }
  if (details.length) mergeSpecialtyDetails(result, details);

  // 6) Übrige Content-Seiten (news/service/other) → Extra-Seiten, gruppiert nach
  //    erstem Pfadsegment. Begrenzt auf MAX_EXTRA_GROUPS (Navigation!), inhalts-
  //    reichste Gruppen zuerst.
  const usedUrls = new Set(extractionLog.filter(l => l.usedAs).map(l => l.url));
  const rest = classified.filter(p =>
    ['news', 'service', 'other'].includes(p.type) && !usedUrls.has(p.url));
  const groups = new Map(); // key → {key, pages:[]}
  for (const p of rest) {
    if ((p.textLength || 0) <= 200) { logSkip(p.url, 'zu wenig Text'); continue; }
    const segs = p.path.split('/').filter(Boolean);
    const key = (segs[0] || '').replace(/\.html?$/i, '').toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, pages: [] });
    groups.get(key).pages.push(p);
  }
  const ranked = [...groups.values()]
    .sort((a, b) => b.pages.reduce((s, p) => s + (p.textLength || 0), 0) - a.pages.reduce((s, p) => s + (p.textLength || 0), 0));
  const extra = [];
  for (const g of ranked) {
    if (extra.length >= MAX_EXTRA_GROUPS) {
      for (const p of g.pages) logSkip(p.url, 'Extra-Seiten-Limit erreicht');
      continue;
    }
    // Hauptseite der Gruppe = kürzester Pfad, Rest wird Unterseite
    const sorted = [...g.pages].sort((a, b) => a.path.length - b.path.length);
    const main = sorted[0];
    const mainHtmlPage = await fetchHtml(main.url);
    const mainText = mainHtmlPage ? htmlToReadableText(mainHtmlPage) : '';
    if (!mainText || mainText.length < 60) {
      for (const p of g.pages) logSkip(p.url, 'zu wenig Text');
      continue;
    }
    const $ = cheerio.load(mainHtmlPage);
    const title = ($('h1').first().text() || '').trim() || labelFromSlug(g.key);
    const subPages = [];
    for (const sub of sorted.slice(1, 1 + MAX_EXTRA_SUBPAGES)) {
      const sh = await fetchHtml(sub.url);
      const st = sh ? htmlToReadableText(sh) : '';
      if (st && st.length > 80) {
        const $$ = cheerio.load(sh);
        subPages.push({
          title: ($$('h1').first().text() || '').trim() || labelFromSlug(slugFromUrl(sub.url)),
          text: st.slice(0, CAP_EXTRA_SUB),
          sourceUrl: sub.url
        });
        logUsed(sub.url, `extra:${g.key}`);
      } else {
        logSkip(sub.url, 'zu wenig Text');
      }
    }
    extra.push({ key: g.key, label: labelFromSlug(g.key), title, text: mainText.slice(0, CAP_EXTRA_MAIN), subPages });
    logUsed(main.url, `extra:${g.key}`);
  }
  if (extra.length) {
    result.extraPages = extra;
    console.log(`   📑 Weitere Bereiche: ${extra.map(e => `${e.key}(${e.subPages.length})`).join(', ')}`);
  }

  return { extractionLog, teamOverviewText };
}

// ── Rechtsgebiet-Detailtexte (eigene Seiten je Schwerpunkt) ─────────────────────
/** Holt je Rechtsgebiet/Leistung die Detailseite + Fließtext. @returns {{name:string,slug:string,text:string}[]} */
async function scrapeSpecialtyDetails(baseUrl) {
  let ovUrl, html;
  for (const p of ['rechtsgebiete/', 'rechtsgebiete.html', 'leistungen/', 'leistungen.html']) {
    try {
      const u = new URL(p, baseUrl).href;
      const res = await fetchPage(u);
      ovUrl = u; html = res.html; break;
    } catch { /* nächster Kandidat */ }
  }
  if (!html) return [];
  const out = [];
  for (const link of findProfileLinks(html, ovUrl).slice(0, 24)) {
    try {
      const page = (await fetchPage(link.url)).html;
      const $ = cheerio.load(page);
      const name = ($('h1').first().text() || '').trim()
        || link.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const text = htmlToReadableText(page);
      if (text && text.length > 60) out.push({ name, slug: link.slug, text: text.slice(0, CAP_SPECIALTY) });
    } catch { /* einzelne Seite optional */ }
  }
  return out;
}

/**
 * Gescrapte Detail-Texte ins Ergebnis mergen. ALLE gescrapten Gebiete in
 * specialties spiegeln: Dieses Feld steuert die deterministische Schicht
 * (pages.js: Karten, Unterseiten, Formular) UND das SEO-Schema (seo.js:
 * knowsAbout/serviceType). Ohne Spiegeln surfacen nur die 2-3 Gebiete aus der
 * LLM-Strukturierung — die tief gescrapten Texte der übrigen (manche Kanzleien
 * haben 7) verwaisen. Reihenfolge: gescrapte zuerst, dann nicht abgedeckte
 * Alt-Einträge (case-insensitiv dedupliziert).
 */
function mergeSpecialtyDetails(result, details) {
  result.specialtyDetails = details;
  const existing = Array.isArray(result.specialties) ? result.specialties : [];
  // Auch die Details untereinander deduplizieren — verschiedene Seiten können
  // dieselbe H1 tragen (z.B. "Notare" auf /notare/ und /notariat/).
  const merged = [];
  for (const name of details.map(d => d.name).filter(Boolean)) {
    if (!merged.some(m => m.toLowerCase() === name.toLowerCase())) merged.push(name);
  }
  for (const s of existing) {
    if (s && !merged.some(m => m.toLowerCase() === String(s).toLowerCase())) merged.push(s);
  }
  result.specialties = merged;

  // Generator-Homepage (inhaltsgesteuertes Bento) bekommt die tiefen Fachtexte als
  // gewichtbare Kategorien (buildMenuStructure liest cat.fullText). Nur bei
  // Rechtsgebiet-/Leistungs-Sites gefüllt — für Gastro bleibt details leer.
  result.menu = details.map(d => ({ category: d.name, fullText: d.text }));

  console.log(`   ⚖️  Rechtsgebiet-Texte: ${details.length} Detailseiten → ${merged.length} Schwerpunkte gesamt`);
}

// ── Weitere Bereiche (Notare, Über-uns, Service, Aktuelles) — generisch ─────────
const EXTRA_SECTIONS = [
  { key: 'notare', label: 'Notare', paths: ['notare/', 'notariat/', 'notar/', 'notare.html'] },
  { key: 'ueber-uns', label: 'Über uns', paths: ['kanzlei/', 'die-kanzlei/', 'ueber-uns/', 'ueber-uns.html', 'kanzlei.html'] },
  { key: 'service', label: 'Service', paths: ['services-downloads/', 'service/', 'leistungen-downloads/', 'downloads/', 'service.html'] },
  { key: 'aktuelles', label: 'Aktuelles', paths: ['aktuelles/', 'news/', 'aktuelles.html'] }
];

/** Holt generische Zusatz-Bereiche (Titel + Fließtext + Unterseiten-Texte). @returns {object[]} */
async function scrapeExtraSections(baseUrl) {
  const out = [];
  for (const sec of EXTRA_SECTIONS) {
    let url, html;
    for (const p of sec.paths) {
      try {
        const u = new URL(p, baseUrl).href;
        const res = await fetchPage(u);
        url = u; html = res.html; break;
      } catch { /* nächster Kandidat */ }
    }
    if (!html) continue;
    const text = htmlToReadableText(html);
    if (!text || text.length < 60) continue;
    const $ = cheerio.load(html);
    const title = ($('h1').first().text() || '').trim() || sec.label;
    const subPages = [];
    for (const l of findProfileLinks(html, url).slice(0, MAX_EXTRA_SUBPAGES)) {
      try {
        const subHtml = (await fetchPage(l.url)).html;
        const $$ = cheerio.load(subHtml);
        const st = htmlToReadableText(subHtml);
        if (st && st.length > 80) {
          subPages.push({
            title: ($$('h1').first().text() || '').trim() || l.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            text: st.slice(0, CAP_EXTRA_SUB)
          });
        }
      } catch { /* einzelne Unterseite optional */ }
    }
    out.push({ key: sec.key, label: sec.label, title, text: text.slice(0, CAP_EXTRA_MAIN), subPages });
  }
  return out;
}

// ── Team-Profile (eigene Personenseiten) ────────────────────────────────────────

const PERSON_NAV = /^(index|die-kanzlei|kanzlei|rechtsanwaelte|rechtsgebiete|sekretariat|kontakt|impressum|datenschutz|home|ueber-uns|about|news|aktuelles|links)\b/i;

/** slug aus URL: letztes nicht-leeres Pfadsegment ohne .html (für /pfad/<slug>/ UND <slug>.html). */
function slugFromUrl(u) {
  try {
    const segs = new URL(u).pathname.split('/').filter(Boolean);
    return (segs.pop() || '').replace(/\.html?$/i, '').toLowerCase();
  } catch { return ''; }
}

/**
 * Findet Personen-Profil-Links auf einer Übersichtsseite — verzeichnis- (/bereich/<slug>/)
 * ODER .html-Stil (<slug>.html). Nur echte Unterseiten desselben Bereichs, ohne Container/Nav.
 * @returns {{slug:string,url:string}[]}
 */
function findProfileLinks(html, ovUrl) {
  const $ = cheerio.load(html);
  const ovSlug = slugFromUrl(ovUrl);
  let ovPath = '/';
  try { ovPath = new URL(ovUrl).pathname.replace(/\/?$/, '/'); } catch { /* default */ }
  const out = [];
  const seen = new Set();
  $('a[href]').each((i, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || /^(mailto:|tel:|#|javascript:)/i.test(href)) return;
    let abs, path;
    try { abs = new URL(href, ovUrl).href; path = new URL(abs).pathname; } catch { return; }
    if (!path.startsWith(ovPath)) return;            // nur Unterseiten DIESES Bereichs
    const slug = slugFromUrl(abs);
    if (!slug || slug === ovSlug || PERSON_NAV.test(slug) || seen.has(slug)) return;
    seen.add(slug);
    out.push({ slug, url: abs });
  });
  return out;
}

/** Findet Personenseiten (Anwälte + Assistenzen), zieht Foto+Text, strukturiert via Haiku. */
async function scrapeTeamProfiles(baseUrl) {
  // Übersichten: mehrere Kandidat-Pfade je Bereich (Verzeichnis- UND .html-Stil).
  const overviews = [
    { paths: ['rechtsanwaelte/', 'rechtsanwaelte.html', 'anwaelte/', 'team/'], role: 'Rechtsanwalt/-anwältin' },
    { paths: ['sekretariat/', 'sekretariat.html', 'mitarbeiter/'], role: 'Sekretariat / Assistenz' }
  ];
  const persons = [];
  const seen = new Set();

  for (const ov of overviews) {
    let ovUrl, html;
    for (const p of ov.paths) {
      try {
        const u = new URL(p, baseUrl).href;
        const res = await fetchPage(u);
        ovUrl = u; html = res.html; break;
      } catch { /* nächsten Kandidaten probieren */ }
    }
    if (!html) continue;
    for (const link of findProfileLinks(html, ovUrl)) {
      if (seen.has(link.slug)) continue;
      seen.add(link.slug);
      persons.push({ slug: link.slug, role: ov.role, url: link.url });
    }
  }
  if (!persons.length) return [];

  // Foto + Text je Person laden
  for (const p of persons) await fetchPersonProfile(p);
  const usable = persons.filter(p => p.text && p.text.length > 40);
  if (!usable.length) return [];

  return await structureProfiles(usable);
}

/** Seiten, die nach Team-Übersicht aussehen — auch wenn die Klassifizierung anders entschied. */
const RX_TEAM_HINT = /(mitarbeiter|unser[- ]team|\bteam\b|ansprechpartner|kollegium|praxisteam|sekretariat)/i;

/** Muster für Personennamen in Foto-alt-Texten: 2–5 großgeschriebene Wörter, optional Titel. */
const RX_PERSON_ALT = /^(?:(?:[Dd]r|[Pp]rof|[Mm]ed|[Dd]ipl|[Mm]ag)\.?\s+)*[A-ZÄÖÜÀ-Þ][a-zäöüßà-ÿ]+(?:[- ](?:[A-ZÄÖÜÀ-Þ][a-zäöüßà-ÿ]+|v(?:on|an)|de|zu|[Dd]r\.?|[A-ZÄÖÜÀ-Þ]\.)){1,4}$/;

/** Nicht-Personen-Bilder anhand von alt/src aussortieren. */
const RX_NOT_PERSON = /logo|icon|spacer|pixel|karte|map|geb(ä|ae)ude|building|slide|banner|hero|kanzlei(?!\S)|praxis(?!\S)/i;

/** Rollen-Präfix im alt-Text („Notarin Christine P.") vom Namen trennen. */
const RX_ROLE_PREFIX = /^(rechtsanw(alt|ältin)|notar(in)?|fachanw(alt|ältin)|steuerberater(in)?|anw(alt|ältin)|zahnarzt|zahnärztin|arzt|ärztin)\s+/i;

/** Namen für Dedupe normalisieren (Titel raus, Kleinschreibung, nur Buchstaben). */
function normalizePersonName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(dr|prof|med|dipl|mag|jur|iur|ll\.?m|mba)\.?/g, '')
    .replace(/[^a-zäöüßéèáà ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Personenname → URL-tauglicher Slug (für team[]-Einträge ohne eigene Seite). */
function nameToSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Personen, die NUR als Karte auf einer Übersichtsseite stehen (ohne eigene
 * Profilseite), direkt aus dem Übersichts-HTML ziehen: Foto-alt = Name,
 * kleinster umgebender Container mit Text = Name + Funktion.
 * @returns {{name:string, role:string, photo:string|null}[]}
 */
function extractInlineTeam(html, pageUrl) {
  const out = [];
  const seen = new Set();
  try {
    const $ = cheerio.load(html);
    $('img[alt]').each((i, el) => {
      const img = $(el);
      const alt = (img.attr('alt') || '').trim();
      const src = img.attr('src') || '';
      if (!alt || alt.length < 5 || alt.length > 60) return;
      // Rollen-Präfix („Notarin Christine P.") abtrennen, damit der Name sauber bleibt.
      let name = alt, rolePrefix = '';
      const pm = alt.match(RX_ROLE_PREFIX);
      if (pm) { rolePrefix = pm[0].trim(); name = alt.slice(pm[0].length).trim(); }
      if (!RX_PERSON_ALT.test(name) || RX_NOT_PERSON.test(alt) || RX_NOT_PERSON.test(src)) return;
      const key = normalizePersonName(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      // Rolle: kleinster Vorfahr, dessen Text den Namen enthält und kompakt bleibt.
      let role = '';
      let node = img.parent();
      for (let depth = 0; depth < 5 && node.length; depth++) {
        const text = node.text().replace(/\s+/g, ' ').trim();
        if (text.includes(name) && text.length > name.length && text.length <= 260) {
          role = text.replace(alt, '').replace(name, '').replace(/\s+/g, ' ').replace(/^[\s,–—|-]+|[\s,–—|-]+$/g, '').trim();
          break;
        }
        node = node.parent();
      }
      if (!role && rolePrefix) role = rolePrefix;
      let photo = null;
      try { photo = src ? new URL(src, pageUrl).href : null; } catch { /* relative kaputt → ohne Foto */ }
      out.push({ name, role, photo });
    });
  } catch { /* Übersicht optional — Personen von Profilseiten bleiben unberührt */ }
  return out;
}

/** Lädt Foto-URL + lesbaren Text einer Personenseite in das übergebene Objekt (mutiert p). */
async function fetchPersonProfile(p) {
  try {
    const ph = (await fetchPage(p.url)).html;
    const $ = cheerio.load(ph);
    const img = $('img').map((i, e) => $(e).attr('src')).get()
      .find(s => s && /\.(jpg|jpeg|png)$/i.test(s) && !/logo|icon|spacer|pixel|__/i.test(s));
    p.photo = img ? new URL(img, p.url).href : null;
    p.text = htmlToReadableText(ph);
  } catch { /* Person optional */ }
  return p;
}

/**
 * Profiltexte (DE+EN) per Haiku zu sauberen deutschen Profilen strukturieren.
 * In Batches (PROFILE_BATCH), damit auch große Teams (15+ Personen) vollständig
 * strukturiert werden statt am Antwort-Limit eines einzelnen Calls zu scheitern.
 */
async function structureProfiles(persons) {
  let structured = [];
  for (let i = 0; i < persons.length; i += PROFILE_BATCH) {
    const batch = persons.slice(i, i + PROFILE_BATCH);
    const prompt = `Hier sind Profiltexte von Kanzlei-Mitarbeitenden (oft DE und EN gemischt). Extrahiere pro Person sauber strukturierte Daten — NUR Deutsch, erfinde nichts.

${batch.map((p, j) => `### Person ${j + 1} — slug: ${p.slug} — Rolle-Hinweis: ${p.role}\n${(p.text || '').slice(0, CAP_PROFILE)}`).join('\n\n')}

Antworte NUR mit einem JSON-Array (kein Markdown), gleiche Reihenfolge/slugs:
[{"slug":"...","name":"Vor- und Nachname","role":"Funktion (z.B. Rechtsanwalt, Fachanwältin für X, Sekretariat)","bio":"2-4 Sätze Werdegang/Profil auf Deutsch","schwerpunkte":["Rechtsgebiet/Tätigkeit", "..."],"qualifikationen":["Studium/Zulassung/Sprachen/Mitgliedschaften", "..."]}]`;

    try {
      const txt = await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' });
      const m = txt.match(/\[[\s\S]*\]/);
      if (m) structured.push(...JSON.parse(m[0]));
    } catch (e) {
      console.warn('   ⚠️ Profil-Strukturierung fehlgeschlagen:', e.message);
    }
  }

  // Foto je slug zurückmappen; fehlende Strukturierung mit Rohdaten auffüllen.
  // p.personName (aus der AI-Klassifizierung) schlägt den Slug-Ratenamen.
  return persons.map(p => {
    const s = structured.find(x => x && x.slug === p.slug) || {};
    return {
      slug: p.slug,
      name: s.name || p.personName || p.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      role: s.role || p.role,
      bio: s.bio || '',
      schwerpunkte: Array.isArray(s.schwerpunkte) ? s.schwerpunkte : [],
      qualifikationen: Array.isArray(s.qualifikationen) ? s.qualifikationen : [],
      photo: p.photo || null
    };
  });
}

/** Eine Rechts-Unterseite laden und lesbaren VERBATIM-Text zurückgeben. */
async function fetchLegalText(url) {
  try {
    const html = (await fetchPage(url)).html;
    const text = htmlToReadableText(html);
    return text && text.length > 40 ? { url, text } : null;
  } catch {
    return null;
  }
}

/** HTML → lesbarer Klartext mit erhaltenen Absätzen (Block-Elemente → Zeilenumbruch). */
function htmlToReadableText(html) {
  const text = extractReadableText(html, true);
  // Sicherheitsnetz: Frisst die Chrome-Heuristik den ganzen Inhalt (Theme-Wrapper
  // mit nav-/header-Klasse um alles), lieber mit Menü extrahieren als Seite verlieren.
  return text.length >= 60 ? text : extractReadableText(html, false);
}

function extractReadableText(html, dropChrome) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  // Navigation/Kopf/Fuß entfernen — der Rechtstext soll ohne Menü übernommen werden.
  // Wurzelelemente ausnehmen: WordPress-Themes tragen Layout-Klassen direkt auf
  // <body> (Astra: "ast-hfb-header") — sonst löscht der Wildcard die ganze Seite.
  if (dropChrome) {
    $('nav, header, footer, [class*="menu" i], [id*="menu" i], [class*="nav" i], [id*="nav" i], [class*="header" i], [class*="footer" i], [class*="sidebar" i]')
      .not('body, html').remove();
  }
  // Inhaltscontainer bevorzugen, falls erkennbar (z. B. .bgcontent / main / article).
  const container = $('main, article, [class*="content" i], [id*="content" i]').first();
  const scope = container.length ? container : $('body');
  scope.find('br').replaceWith('\n');
  scope.find('p, div, tr, li, h1, h2, h3, h4, h5, h6').each((i, el) => $(el).append('\n'));
  return scope.text()
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000);
}

/** Rohdaten aus geladenem cheerio-Dokument extrahieren (statisch ODER gerendert). */
function extractRaw($, html, url) {
  // Sichtbaren Fließtext einsammeln (Skripte/Styles raus) — hier stehen bei vielen
  // Branchen die eigentlichen Inhalte (Leistungen, Team, Über-uns), nicht nur in Metas.
  $('script, style, noscript').remove();
  const headings = $('h1, h2, h3').map((i, el) => $(el).text().trim()).get()
    .filter(Boolean).slice(0, 60).join(' | ');
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 10000);

  return {
    title: $('title').text().trim() || $('h1').first().text().trim(),
    description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
    keywords: $('meta[name="keywords"]').attr('content') || '',
    headings,
    bodyText,
    phone: extractPhone($, html),
    address: extractAddress($, html),
    email: extractEmail(html),
    hours: extractHours($, html),
    images: extractImages($, url),
    menu: extractMenu($, html),
    social: extractSocialLinks($),
    ogImage: $('meta[property="og:image"]').attr('content') || null,
    baseUrl: url
  };
}

/** Heuristik: sieht das Ergebnis nach einer leeren JS-Hülle aus? */
function isThin(raw, bodyTextLen) {
  const gotLittle = !raw.title && !raw.description && !raw.phone && !raw.address && (raw.images || []).length === 0;
  return bodyTextLen < 600 || gotLittle;
}

/** Wie reichhaltig ist ein Roh-Ergebnis? (zum Vergleich statisch vs. gerendert) */
function richness(r) {
  return (r.title ? 1 : 0) + (r.description ? 1 : 0) + (r.phone ? 1 : 0) +
    (r.address ? 1 : 0) + (r.hours ? 1 : 0) + (r.images ? r.images.length : 0);
}

/** Seite mit echtem Browser rendern und finales HTML zurückgeben. */
async function fetchRendered(url) {
  const { launchBrowser } = require('./browser');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      .catch(() => page.goto(url, { waitUntil: 'load', timeout: 30000 }));
    await page.waitForTimeout(2000);
    return await page.content();
  } finally {
    await browser.close();
  }
}

// ── Google Maps scrapen via Places API ───────────────────────────────────────

/**
 * Places-Fotos materialisieren, OHNE dass der API-Key in einer zurückgegebenen
 * URL landet (der würde sonst via project.json/HTML öffentlich).
 * - Mit projectDir: Fotos nach assets/scraped/ laden, relative Pfade zurück
 *   (gleiches Muster wie downloadTeamPhotos in pages.js).
 * - Ohne projectDir (z.B. /api/scrape): Redirect auflösen und die key-lose
 *   googleusercontent-URL zurückgeben.
 * Einzelne Foto-Fehler werden übersprungen — Fotos sind optional.
 */
async function materializePlacePhotos(photos, apiKey, projectDir) {
  const images = [];
  const list = (photos || []).filter(p => p && p.photo_reference).slice(0, 8);
  for (const [i, p] of list.entries()) {
    const keyedUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${apiKey}`;
    try {
      if (projectDir) {
        const dir = path.join(projectDir, 'assets', 'scraped');
        fs.mkdirSync(dir, { recursive: true });
        const res = await axios.get(keyedUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const ext = /png/i.test(res.headers?.['content-type'] || '') ? 'png' : 'jpg';
        const rel = `assets/scraped/maps-${i + 1}.${ext}`;
        fs.writeFileSync(path.join(projectDir, rel), res.data);
        images.push(rel);
      } else {
        const res = await axios.get(keyedUrl, {
          maxRedirects: 0,
          validateStatus: (s) => s >= 200 && s < 400
        });
        if (res.headers?.location) images.push(res.headers.location);
      }
    } catch (e) {
      console.warn(`⚠️ Maps-Foto ${i + 1} übersprungen:`, e.message);
    }
  }
  return images;
}

async function scrapeGoogleMaps(mapsUrl, opts = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // Place ID aus URL extrahieren
  let placeId = null;
  const cidMatch = mapsUrl.match(/[?&]cid=(\d+)/);
  const placeMatch = mapsUrl.match(/place\/[^/]+\/([^/?\s]+)/);

  if (!apiKey) {
    // Ohne API Key: Claude analysiert die URL und gibt Basis-Infos zurück
    return await claudeAnalyzeMapsUrl(mapsUrl);
  }

  // Mit API Key: echte Daten holen
  if (cidMatch) {
    // CID zu Place ID konvertieren
    const findRes = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
      params: { input: mapsUrl, inputtype: 'textquery', key: apiKey }
    });
    placeId = findRes.data.candidates?.[0]?.place_id;
  }

  if (!placeId) throw new Error('Konnte Place ID nicht extrahieren');

  const res = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
    params: {
      place_id: placeId,
      fields: 'name,formatted_address,formatted_phone_number,website,opening_hours,photos,rating,user_ratings_total,types',
      key: apiKey, language: 'de'
    }
  });

  const d = res.data.result;
  const photoUrls = await materializePlacePhotos(d.photos, apiKey, opts.projectDir);

  return {
    name: d.name,
    description: `${d.name} – ${d.rating}/5 Sterne (${d.user_ratings_total} Bewertungen)`,
    address: d.formatted_address,
    phone: d.formatted_phone_number,
    hours: d.opening_hours?.weekday_text?.join('\n') || '',
    images: photoUrls,
    website: d.website,
    category: guessCategory(d.types),
    social: { maps: mapsUrl },
    menu: null,
    source: 'google_maps'
  };
}

// ── Claude strukturiert rohe Daten ────────────────────────────────────────────

/**
 * Fallback, wenn Claude nicht verfügbar ist (kein Key / API-Fehler / kein Guthaben):
 * trotzdem nutzbare Daten liefern. KRITISCH: `title` → `name` mappen — sonst füllt
 * das Frontend (prüft `data.name`) nichts, obwohl der Scraper Inhalte hat.
 */
function fallbackStructure(raw) {
  return {
    name: raw.title || '',
    description: raw.description || '',
    category: '',
    address: raw.address || '',
    phone: raw.phone || '',
    email: raw.email || '',
    hours: raw.hours || '',
    cuisine: '',
    priceLevel: '',
    atmosphere: '',
    specialties: [],
    menu: raw.menu || null,
    images: raw.images || [],
    ogImage: raw.ogImage || null,
    social: raw.social || {},
    baseUrl: raw.baseUrl,
    source: 'website',
    degraded: true // Hinweis: ohne Claude strukturiert — Felder ggf. unvollständig
  };
}

async function claudeStructure(raw, url) {
  // Branchenübergreifend (Entscheidung 2026-06-10, analog zur Design-DNA): KEIN
  // Restaurant-Zwang. Wir extrahieren ein generisches Profil für lokale Unternehmen
  // jeder Branche (Kanzlei, Praxis, Handwerk, Friseur, Restaurant, …) und nutzen
  // dafür Title, Meta-Description, Keywords, Überschriften UND den Fließtext.
  const prompt = `Du extrahierst strukturierte Daten aus einer Unternehmens-Website (beliebige Branche — Kanzlei, Praxis, Handwerk, Gastronomie, Dienstleistung, …). Erfinde NICHTS; nutze nur, was in den Daten steht.

URL: ${url}
Titel: ${raw.title || ''}
Meta-Beschreibung: ${raw.description || ''}
Keywords: ${raw.keywords || ''}
Überschriften: ${raw.headings || ''}
Kontakt-Treffer: ${raw.address || ''} | ${raw.phone || ''} | ${raw.email || ''}
Öffnungszeiten-Hinweise: ${raw.hours || ''}
Sichtbarer Seitentext (Auszug):
${(raw.bodyText || '').slice(0, 10000)}

Antworte NUR mit einem JSON-Objekt (kein Markdown):
{
  "name": "Firmen-/Kanzlei-/Geschäftsname",
  "description": "prägnante, ansprechende Kurzbeschreibung (1-2 Sätze) auf Deutsch",
  "category": "tatsächlicher Geschäftstyp in eigenen Worten, z.B. 'Rechtsanwaltskanzlei', 'Zahnarztpraxis', 'Friseursalon', 'Restaurant'",
  "address": "vollständige Adresse",
  "phone": "Telefonnummer",
  "email": "E-Mail",
  "hours": "Öffnungs-/Sprechzeiten als Text (falls vorhanden)",
  "specialties": ["zentrale Leistung/Schwerpunkt 1", "2", "..."],
  "team": [{"name": "Vor- und Nachname", "role": "Funktion/Titel/Schwerpunkt (falls genannt)"}],
  "offerings": [{"category": "Leistungsbereich", "items": [{"name": "Leistung", "description": "kurz, falls bekannt"}]}]
}

Wenn ein Feld nicht ermittelbar ist: leeren String bzw. leeres Array verwenden. "specialties" ist wichtig — bei einer Kanzlei z.B. die Rechtsgebiete, bei einer Praxis die Behandlungen, bei Handwerk die Gewerke.`;

  try {
    const text = (await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' })).trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const s = JSON.parse(jsonMatch[0]);
      // "offerings" → generisches "menu" mappen (der Generator liest dieses Feld als
      // "Speisekarte / Leistungen" — bei Nicht-Gastro werden daraus Leistungs-Sektionen).
      const menu = Array.isArray(s.offerings) && s.offerings.length ? s.offerings : (raw.menu || null);
      return {
        name: s.name || raw.title || '',
        description: s.description || raw.description || '',
        category: s.category || '',
        address: s.address || raw.address || '',
        phone: s.phone || raw.phone || '',
        email: s.email || raw.email || '',
        hours: s.hours || raw.hours || '',
        specialties: Array.isArray(s.specialties) ? s.specialties : [],
        team: Array.isArray(s.team) ? s.team.filter(t => t && t.name) : [],
        menu,
        images: raw.images, ogImage: raw.ogImage, social: raw.social, baseUrl: raw.baseUrl, source: 'website'
      };
    }
  } catch (e) {
    console.error('Claude Strukturierung fehlgeschlagen:', e.message,
      '— Scrape-Daten werden ungestrukturiert übernommen (Fallback).');
  }

  return fallbackStructure(raw);
}

async function claudeAnalyzeMapsUrl(url) {
  return { name: '', description: '', address: '', phone: '', hours: '', images: [], social: { maps: url }, menu: null, source: 'manual' };
}

// ── Extraktions-Hilfsfunktionen ───────────────────────────────────────────────

function extractPhone($, html) {
  // tel: Links
  const telLink = $('a[href^="tel:"]').first().attr('href');
  if (telLink) return telLink.replace('tel:', '').trim();
  // Regex in HTML
  const match = html.match(/(\+49|0\d{2,5})[\s\-\/]?\d{3,5}[\s\-\/]?\d{3,8}/);
  return match ? match[0].trim() : '';
}

function extractEmail(html) {
  const match = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : '';
}

function extractAddress($, html) {
  // Schema.org
  const schema = $('[itemprop="streetAddress"]').text() ||
    $('[itemprop="address"]').text();
  if (schema) return schema.trim();
  // Regex für deutsche Adressen
  const match = html.match(/[A-ZÄÖÜ][a-zäöüß\s\-]+(?:straße|str\.|gasse|weg|allee|platz|ring)\s+\d+[a-z]?,?\s*\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+/i);
  return match ? match[0].trim() : '';
}

function extractHours($, html) {
  const hours = $('[itemprop="openingHours"]').map((i, el) => $(el).text()).get().join('\n');
  if (hours) return hours;
  const match = html.match(/(Mo|Di|Mi|Do|Fr|Sa|So|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n<]{5,50}/gi);
  return match ? [...new Set(match)].slice(0, 7).join('\n') : '';
}

function extractImages($, baseUrl) {
  const images = [];
  const base = new URL(baseUrl);

  $('img').each((i, el) => {
    if (images.length >= 20) return;
    let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy');
    if (!src) return;
    // Relative URLs korrekt gegen das Seitenverzeichnis auflösen
    // (new URL berücksichtigt den Pfad, statt "…/index.html" + "pics/x.jpg" zu kleben).
    try {
      if (src.startsWith('//')) src = base.protocol + src;
      else src = new URL(src, base).href;
    } catch { return; }
    // Nur echte Fotos (keine Icons/Logos/Badges wie rate.png, keine Dubletten —
    // Mobirise & Co. wiederholen dasselbe Bild in Slidern mehrfach).
    if (src.match(/\.(jpg|jpeg|png|webp)/i) && !src.match(/logo|icon|favicon|sprite|badge|rate\.|button|pixel|placeholder/i)
      && !images.includes(src)) {
      images.push(src);
    }
  });

  return images;
}

function extractMenu($, html) {
  const menuItems = [];
  // Preise finden
  const priceMatches = html.match(/([A-ZÄÖÜ][a-zäöüß\s]+)\s*[\|–\-]\s*(\d+[,\.]\d{2})\s*€/g);
  if (priceMatches && priceMatches.length > 3) {
    return priceMatches.slice(0, 20).map(m => {
      const parts = m.split(/[\|–\-]/);
      return { name: parts[0]?.trim(), price: parts[1]?.trim() };
    });
  }
  return null;
}

function extractSocialLinks($) {
  const social = {};
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('instagram.com')) social.instagram = href;
    else if (href.includes('facebook.com')) social.facebook = href;
    else if (href.includes('tiktok.com')) social.tiktok = href;
    else if (href.includes('lieferando')) social.delivery = href;
    else if (href.includes('wolt.com')) social.delivery = social.delivery || href;
  });
  return social;
}

function guessCategory(types = []) {
  if (types.includes('cafe')) return 'cafe';
  if (types.includes('bar')) return 'bar';
  if (types.includes('bakery')) return 'bakery';
  if (types.includes('meal_delivery')) return 'foodtruck';
  return 'restaurant';
}

module.exports = { scrapeRestaurant, slugFromUrl, findProfileLinks, materializePlacePhotos, enrichFromInventory, extractInlineTeam, normalizePersonName, nameToSlug, htmlToReadableText, menuItemCount, parseJsonLoose };
