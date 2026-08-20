/**
 * Site-Inventar: vollständige Seitenliste einer Alt-Website ermitteln.
 * 1) sitemap.xml / robots.txt auswerten (falls vorhanden)
 * 2) Bounded BFS-Crawl ab Homepage (gleicher Host, Tiefe/Seitenzahl begrenzt)
 * 3) Jede Seite per AI klassifizieren (team-profile, practice-area, …)
 *
 * Ersetzt das Raten über hardcodierte Pfade in agent-scraper.js: Der Scraper
 * weiß damit VOR der Extraktion, welche Seiten existieren und was sie enthalten.
 * Netzwerkzugriff ist über `fetcher` injizierbar → Tests laufen ohne Netz.
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { callClaude } = require('./claude-cli');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_DEPTH = 4; // tief genug für /bereich/unterbereich/seite — maxPages begrenzt die Arbeit
const DEFAULT_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SITEMAPS = 10;          // max. Kind-Sitemaps aus einem <sitemapindex>
const MAX_LINK_TEXTS = 5;         // Linktexte je Zielseite (für Klassifizierung)
const CLASSIFY_CHUNK = 150;       // Seiten pro Haiku-Call

/** Gültige Seitentypen der Klassifizierung (Quelle der Wahrheit für Extraktion). */
const PAGE_TYPES = [
  'home', 'team-overview', 'team-profile', 'practice-area-overview', 'practice-area',
  'about', 'contact', 'legal-impressum', 'legal-datenschutz', 'news', 'service', 'other'
];

// Nicht-HTML-Ressourcen beim Crawl überspringen
const BINARY_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|zip|rar|7z|docx?|xlsx?|pptx?|mp[34]|m4[av]|avi|mov|webm|woff2?|ttf|otf|eot|json|txt|rss|atom)$/i;

// ── URL-Normalisierung ──────────────────────────────────────────────────────────

// Tracking-/Session-Parameter unterscheiden nie Seiten — fliegen aus Fetch-URL UND Dedup-Key.
const JUNK_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|pk_[a-z]+|piwik_[a-z]+|phpsessid|jsessionid|sessionid|sid|chash|no_cache)$/i;

/** Entfernt Junk-Parameter und sortiert die Query (stabiler Dedup-Schlüssel). Mutiert u. */
function cleanSearch(u) {
  if (!u.search) return;
  const params = [...u.searchParams.entries()].filter(([k]) => !JUNK_PARAMS.test(k));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
}

/**
 * Sieht die Query nach Seiten-Navigation aus (TYPO3 ?id=, CMS ?page=/?seite=) statt
 * nach Filter-/Kalender-Explosion? Konservativ: max. 2 kurze Parameter.
 */
function isPageQuery(u) {
  const entries = [...u.searchParams.entries()];
  return entries.length > 0 && entries.length <= 2 && entries.every(([, v]) => v.length <= 40);
}

/** Host für die Erlaubnis-Prüfung (kleingeschrieben, www.-los). */
function hostOf(u) {
  try { return new URL(u).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Normalisiert eine URL für Dedup: Hash weg, index.html weg, Trailing-Slash
 * vereinheitlicht, Host kleingeschrieben und www.-los, Tracking-Params gestrippt.
 * Liefert null bei ungültigen/nicht-http-URLs. Seiten-Queries (?id=…) bleiben
 * erhalten — TYPO3-artige Sites unterscheiden Seiten NUR über die Query.
 * @returns {string|null}
 */
function normalizeUrl(href, base) {
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let p = u.pathname.replace(/\/index\.html?$/i, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  const host = u.host.toLowerCase().replace(/^www\./, '');
  cleanSearch(u);
  // Protokoll im SCHLÜSSEL fest auf https: Sites, die intern http- und https-Links
  // mischen, haben sonst jede Seite doppelt im Inventar. Gefetcht wird weiterhin
  // die Original-URL — der Schlüssel dient nur der Dedup.
  return `https://${host}${p}${u.search}`;
}

// ── Charset-korrektes Dekodieren ────────────────────────────────────────────────

/**
 * Antwort-Body charset-korrekt zu String dekodieren. Viele alte Praxis-/Kanzlei-
 * Sites liefern ISO-8859-1/Windows-1252 — als UTF-8 gelesen wird jeder Umlaut zu
 * Mojibake („Ã¼"), was Titel, Klassifizierung und alle Texte verdirbt.
 * Erkennung: Content-Type-Header → <meta charset>-Sniff → UTF-8-Default.
 * Strings (z. B. aus Test-Fetchern) passieren unverändert.
 */
function decodeBody(res) {
  const data = res && res.data;
  if (typeof data === 'string') return data;
  if (data == null) return '';
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const ct = String((res.headers && res.headers['content-type']) || '');
  let cs = (ct.match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = buf.slice(0, 2048).toString('latin1');
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(String(cs || 'utf-8').toLowerCase()).decode(buf); }
  catch { return buf.toString('utf8'); }
}

/** Gleicher Host (www-agnostisch)? */
function sameHost(a, b) {
  try {
    const ha = new URL(a).host.toLowerCase().replace(/^www\./, '');
    const hb = new URL(b).host.toLowerCase().replace(/^www\./, '');
    return ha === hb;
  } catch { return false; }
}

// ── Sitemap / robots.txt ────────────────────────────────────────────────────────

/** Extrahiert `Sitemap:`-Einträge aus robots.txt-Text. @returns {string[]} */
function parseRobotsSitemaps(txt) {
  const out = [];
  for (const m of String(txt || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)) out.push(m[1]);
  return out;
}

/**
 * Parst sitemap.xml — sowohl <urlset> (Seiten) als auch <sitemapindex> (Kind-Sitemaps).
 * @returns {{pages:string[], sitemaps:string[]}}
 */
function parseSitemapXml(xml) {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const pages = $('urlset > url > loc').map((i, el) => $(el).text().trim()).get().filter(Boolean);
  const sitemaps = $('sitemapindex > sitemap > loc').map((i, el) => $(el).text().trim()).get().filter(Boolean);
  return { pages, sitemaps };
}

/** robots.txt + sitemap.xml abklappern und alle gelisteten Seiten-URLs liefern. */
async function fetchSitemapUrls(baseUrl, fetcher) {
  const origin = new URL(baseUrl).origin;
  const candidates = [];
  try {
    const res = await fetcher(`${origin}/robots.txt`);
    candidates.push(...parseRobotsSitemaps(decodeBody(res)));
  } catch { /* robots.txt optional */ }
  if (!candidates.length) candidates.push(`${origin}/sitemap.xml`);

  const pages = [];
  const queue = candidates.slice(0, MAX_SITEMAPS);
  const seen = new Set();
  while (queue.length) {
    const smUrl = queue.shift();
    if (seen.has(smUrl) || seen.size >= MAX_SITEMAPS) continue;
    seen.add(smUrl);
    try {
      const res = await fetcher(smUrl);
      const parsed = parseSitemapXml(decodeBody(res));
      pages.push(...parsed.pages);
      queue.push(...parsed.sitemaps.slice(0, MAX_SITEMAPS)); // eine Index-Ebene reicht
    } catch { /* einzelne Sitemap optional */ }
  }
  return pages.filter(u => sameHost(u, baseUrl));
}

// ── BFS-Crawl ───────────────────────────────────────────────────────────────────

/**
 * Default-Fetcher (axios). Tests injizieren stattdessen einen Fake.
 * arraybuffer statt String: das Charset dekodiert decodeBody selbst (Latin-1-Sites!).
 * finalUrl = tatsächliche URL nach Redirects — Basis für Link-Auflösung und Rebase.
 */
async function defaultFetcher(url) {
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'arraybuffer',
    headers: { 'User-Agent': UA },
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400
  });
  const finalUrl = (res.request && res.request.res && res.request.res.responseUrl) || url;
  return { status: res.status, headers: res.headers || {}, data: res.data, finalUrl };
}

/**
 * Eine Seite charset-korrekt laden (für agent-scraper & Co.).
 * @returns {Promise<{html:string, finalUrl:string}>}
 */
async function fetchPage(url) {
  const res = await defaultFetcher(url);
  return { html: decodeBody(res), finalUrl: res.finalUrl || url };
}

/**
 * Baut das vollständige Seiten-Inventar: Sitemap-URLs + BFS ab Homepage.
 * @param {string} baseUrl Startseite der Alt-Website
 * @param {{maxPages?:number, maxDepth?:number, concurrency?:number, fetcher?:Function}} opts
 * @returns {Promise<{url:string,path:string,title:string,h1:string,linkTexts:string[],depth:number,source:string,status:number,textLength:number}[]>}
 */
async function buildInventory(baseUrl, opts = {}) {
  const maxPages = opts.maxPages || DEFAULT_MAX_PAGES;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const concurrency = opts.concurrency || DEFAULT_CONCURRENCY;
  const fetcher = opts.fetcher || defaultFetcher;

  const entries = new Map();      // normKey → Entry
  const enqueued = new Set();     // normKey (auch noch nicht gefetchte)
  const linkTexts = new Map();    // normKey → Set<string> (Ankertexte, die auf die Seite zeigen)
  const queue = [];               // {url, depth, source}

  // Erlaubte Hosts (www-agnostisch). Startet mit der Eingabe-Domain; leitet die
  // Startseite auf eine andere Domain um (alte-domain.de → neue-domain.de), wird
  // der Ziel-Host freigeschaltet — sonst fiele JEDER Link durch den Host-Filter.
  const allowedHosts = new Set([hostOf(baseUrl)]);
  // Startseiten-Schlüssel: Schutz gegen fehlkonfigurierte Sites, deren canonical
  // auf JEDER Seite auf die Homepage zeigt — solche canonicals werden ignoriert.
  const seedKeys = new Set([normalizeUrl(baseUrl, baseUrl)].filter(Boolean));

  const enqueue = (url, depth, source) => {
    const key = normalizeUrl(url, baseUrl);
    if (!key || enqueued.has(key)) return;
    let u;
    try { u = new URL(url, baseUrl); } catch { return; }
    if (!allowedHosts.has(hostOf(u.href))) return;
    cleanSearch(u);
    // Seiten-Queries (TYPO3 ?id=…) mitnehmen, Filter-/Kalender-Explosionen nicht.
    if (u.search && !isPageQuery(u)) return;
    if (BINARY_EXT.test(u.pathname)) return;
    if (depth > maxDepth) return;
    enqueued.add(key);
    queue.push({ url: u.href, depth, source, key });
  };

  const noteLinkText = (targetUrl, text) => {
    const key = normalizeUrl(targetUrl, baseUrl);
    if (!key || !text) return;
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!t) return;
    if (!linkTexts.has(key)) linkTexts.set(key, new Set());
    const set = linkTexts.get(key);
    if (set.size < MAX_LINK_TEXTS) set.add(t);
  };

  // Seeds: Homepage + Sitemap-Seiten
  enqueue(baseUrl, 0, 'home');
  try {
    for (const u of await fetchSitemapUrls(baseUrl, fetcher)) enqueue(u, 1, 'sitemap');
  } catch { /* Sitemap optional */ }

  // Worker dürfen bei momentan leerer Queue nicht aussteigen, solange ein anderer
  // Worker noch fetcht (der liefert gleich neue Links) — sonst degradiert der
  // Crawl nach der ersten Seite auf Concurrency 1.
  let active = 0;
  const worker = async () => {
    while (entries.size < maxPages) {
      const job = queue.shift();
      if (!job) {
        if (active === 0) return;
        await new Promise(r => setTimeout(r, 25));
        continue;
      }
      if (entries.has(job.key)) continue;
      const keyUrl = new URL(job.key);
      let entry = {
        url: job.url,
        // normalisiert (ohne Trailing-Slash/index.html); Query bleibt Teil des Pfads,
        // sonst kollabieren TYPO3-Seiten (/index.php?id=2 und ?id=3) zu einem Eintrag.
        path: keyUrl.pathname + keyUrl.search,
        title: '', h1: '', linkTexts: [],
        depth: job.depth, source: job.source, status: 0, textLength: 0
      };
      entries.set(job.key, entry);
      active++;
      try {
        const res = await fetcher(job.url);
        entry.status = res.status || 200;
        const ct = String((res.headers && res.headers['content-type']) || '');
        if (ct && !/html/i.test(ct)) continue;       // nur HTML-Seiten inventarisieren
        const finalUrl = res.finalUrl || job.url;
        // Seed-Redirect auf anderen Host: freischalten + Sitemap des Ziels nachziehen.
        if (job.depth === 0) {
          const fk = normalizeUrl(finalUrl, baseUrl);
          if (fk) seedKeys.add(fk);
          if (hostOf(finalUrl) && !allowedHosts.has(hostOf(finalUrl))) {
            allowedHosts.add(hostOf(finalUrl));
            try {
              for (const u of await fetchSitemapUrls(finalUrl, fetcher)) enqueue(u, 1, 'sitemap');
            } catch { /* Sitemap optional */ }
          }
        }
        const $ = cheerio.load(decodeBody(res));
        entry.title = ($('title').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        entry.h1 = ($('h1').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        $('script, style, noscript').remove();
        entry.textLength = $('body').text().replace(/\s+/g, ' ').trim().length;
        // Link-Basis: <base href> schlägt finale URL schlägt Anfrage-URL.
        let linkBase = finalUrl;
        const baseTag = $('base[href]').attr('href');
        if (baseTag) { try { linkBase = new URL(baseTag, finalUrl).href; } catch { /* base kaputt → finalUrl */ } }
        // Canonical-Dubletten (z. B. TYPO3: /index.php?it=… UND /team/anna für dieselbe
        // Seite): zeigt rel=canonical auf eine ANDERE Site-URL, ist DIESER Eintrag nur
        // die Zweit-URL — verwerfen, kanonisches Ziel crawlen. Canonicals auf die
        // Startseite werden ignoriert (häufige Fehlkonfiguration, würde alles löschen).
        const canonHref = ($('link[rel="canonical"]').attr('href') || '').trim();
        if (canonHref) {
          const canonKey = normalizeUrl(canonHref, linkBase);
          if (canonKey && canonKey !== job.key && !seedKeys.has(canonKey) && allowedHosts.has(hostOf(canonKey))) {
            entry.duplicateOf = canonKey;
            enqueue(canonHref, job.depth, job.source);
            continue; // Links stehen identisch auf der kanonischen Seite
          }
        }
        $('a[href], area[href]').each((i, el) => {
          const href = ($(el).attr('href') || '').trim();
          if (!href || /^(mailto:|tel:|#|javascript:)/i.test(href)) return;
          let abs;
          try { abs = new URL(href, linkBase).href; } catch { return; }
          noteLinkText(abs, $(el).text());
          enqueue(abs, job.depth + 1, 'crawl');
        });
        // Frameset-/iframe-Sites (alte Praxen!): die eigentlichen Seiten stecken in src.
        $('frame[src], iframe[src]').each((i, el) => {
          const src = ($(el).attr('src') || '').trim();
          if (!src || /^(about:|javascript:|data:)/i.test(src)) return;
          let abs;
          try { abs = new URL(src, linkBase).href; } catch { return; }
          enqueue(abs, job.depth + 1, 'crawl');
        });
      } catch (e) {
        entry.status = (e.response && e.response.status) || 0;
      } finally {
        active--;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Linktexte zurückmappen und nur erreichbare Nicht-Dubletten liefern
  const out = [];
  for (const [key, entry] of entries) {
    entry.linkTexts = [...(linkTexts.get(key) || [])];
    if (entry.status >= 200 && entry.status < 400 && !entry.duplicateOf) out.push(entry);
  }

  // Inhalts-Dedup NUR für Query-Zweit-URLs: TYPO3 & Co. liefern dieselbe Seite unter
  // sauberem Pfad UND /index.php?id=… — trägt die Query-Variante kein brauchbares
  // canonical (häufig: kaputt auf die Homepage), erkennt der Fingerprint die Dublette.
  // Eng gefasst (Query- gegen Nicht-Query-Pfad), damit echte, zufällig ähnliche
  // Seiten niemals kollabieren.
  const fp = (e) => `${e.title}|${e.h1}|${e.textLength}`;
  const cleanByFp = new Map();
  for (const e of out) if (!e.path.includes('?')) {
    if (!cleanByFp.has(fp(e))) cleanByFp.set(fp(e), e);
  }
  return out.filter(e => !(e.path.includes('?') && cleanByFp.has(fp(e))));
}

// ── Klassifizierung ─────────────────────────────────────────────────────────────

const RX_TEAM_DIR = /(rechtsanwaelte|rechtsanwälte|anwaelte|anwälte|team|unser-team|mitarbeiter|sekretariat|aerzte|ärzte|berater|partner|attorneys|staff|people|ueber-uns\/team)/i;
const RX_AREA_DIR = /(rechtsgebiete|leistungen|taetigkeitsgebiete|tätigkeitsgebiete|kompetenzen|fachgebiete|schwerpunkte|behandlungen|services|practice-areas)/i;

/**
 * Regelbasierte Klassifizierung — Fallback ohne Claude und Vorab-Filter für
 * eindeutige Typen. Gibt {type, personName:null} zurück.
 */
function heuristicClassify(entry) {
  const p = (entry.path || '/').toLowerCase();
  const segs = p.split('/').filter(Boolean);
  const last = (segs[segs.length - 1] || '').replace(/\.html?$/, '');

  if (!segs.length) return { type: 'home', personName: null };
  if (/impressum|imprint/.test(p)) return { type: 'legal-impressum', personName: null };
  if (/datenschutz|privacy/.test(p)) return { type: 'legal-datenschutz', personName: null };
  if (/kontakt|contact|anfahrt/.test(p)) return { type: 'contact', personName: null };
  if (RX_TEAM_DIR.test(p)) {
    // Übersicht, wenn das LETZTE Segment selbst das Team-Verzeichnis ist — sonst Profil.
    return RX_TEAM_DIR.test(last)
      ? { type: 'team-overview', personName: null }
      : { type: 'team-profile', personName: null };
  }
  if (RX_AREA_DIR.test(p)) {
    return RX_AREA_DIR.test(last)
      ? { type: 'practice-area-overview', personName: null }
      : { type: 'practice-area', personName: null };
  }
  if (/kanzlei|ueber-uns|über-uns|about|profil|philosophie|geschichte/.test(p)) return { type: 'about', personName: null };
  if (/aktuelles|news|blog|presse/.test(p)) return { type: 'news', personName: null };
  if (/service|download|formulare|links/.test(p)) return { type: 'service', personName: null };
  return { type: 'other', personName: null };
}

/**
 * Klassifiziert das komplette Inventar: eindeutige Typen per Regex, der Rest in
 * einem (gechunkten) Haiku-Call. Fällt bei Claude-Fehlern auf heuristicClassify
 * zurück — es gibt IMMER ein Ergebnis. Mutiert nicht; liefert neue Objekte.
 * @param {object[]} inventory Ergebnis von buildInventory
 * @param {{useClaude?:boolean}} opts
 * @returns {Promise<(object & {type:string, personName:string|null})[]>}
 */
async function classifyInventory(inventory, opts = {}) {
  const useClaude = opts.useClaude !== false;
  const classified = inventory.map(e => ({ ...e, ...heuristicClassify(e) }));

  // Nur unsichere Typen zu Claude — Regex-eindeutige (home/legal/contact) bleiben.
  const CERTAIN = new Set(['home', 'legal-impressum', 'legal-datenschutz', 'contact']);
  const uncertain = classified.filter(e => !CERTAIN.has(e.type));
  if (!useClaude || !uncertain.length) return classified;

  for (let i = 0; i < uncertain.length; i += CLASSIFY_CHUNK) {
    const chunk = uncertain.slice(i, i + CLASSIFY_CHUNK);
    const lines = chunk.map(e =>
      `${e.path} | ${e.title || ''} | ${(e.linkTexts || []).join(', ')}`).join('\n');
    const prompt = `Du klassifizierst Seiten einer Unternehmens-Website (Kanzlei/Praxis/Handwerk/…). Pro Zeile: Pfad | Seitentitel | Linktexte, die auf die Seite zeigen.

${lines}

Typen (genau einen wählen):
- team-overview: Übersichtsseite über das Team/die Anwälte/Ärzte/Mitarbeiter
- team-profile: Seite EINER einzelnen Person (Profil/Lebenslauf)
- practice-area-overview: Übersicht der Rechtsgebiete/Leistungen/Behandlungen
- practice-area: Detailseite EINES Rechtsgebiets / EINER Leistung
- about: Über-uns/Kanzlei/Philosophie/Geschichte
- news: Aktuelles/Blog/Presse
- service: Service/Downloads/Formulare
- home, contact, legal-impressum, legal-datenschutz: falls doch zutreffend
- other: alles andere

Achtung: Standort-/Amtssitz-/Anfahrts-Seiten sind contact oder other, NICHT practice-area. Download-/Formular-Seiten sind service.

Antworte NUR mit einem JSON-Array (kein Markdown), ein Objekt pro Eingabezeile, gleiche Reihenfolge:
[{"path":"...","type":"...","personName":"Vor- und Nachname bei team-profile, sonst null"}]`;

    try {
      const txt = await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' });
      const m = txt.match(/\[[\s\S]*\]/);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      for (const row of Array.isArray(parsed) ? parsed : []) {
        if (!row || !PAGE_TYPES.includes(row.type)) continue;
        const target = chunk.find(e => e.path === row.path);
        if (!target) continue;
        target.type = row.type;
        target.personName = (typeof row.personName === 'string' && row.personName.trim()) || null;
      }
    } catch (e) {
      console.warn('⚠️ AI-Klassifizierung übersprungen (Heuristik bleibt):', e.message);
    }
  }
  return classified;
}

module.exports = {
  buildInventory, classifyInventory, heuristicClassify,
  normalizeUrl, sameHost, parseSitemapXml, parseRobotsSitemaps, fetchSitemapUrls,
  fetchPage, decodeBody,
  PAGE_TYPES
};
