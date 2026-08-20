/**
 * seo.js — Deterministische SEO-Schicht
 *
 * Läuft NACH dem Generator (generator.js), VOR dem QA-Gate. Statt darauf zu hoffen,
 * dass das Modell SEO im Pass-3-Prompt jedes Mal vollständig und konsistent baut,
 * injiziert dieses Modul SEO garantiert korrekt aus den echten project.json-Daten:
 *
 *   - <html lang="de">, robots, canonical, theme-color
 *   - Open Graph + Twitter Card (konsistent, aus denselben Daten)
 *   - JSON-LD Structured Data (LocalBusiness/Restaurant/HairSalon …) mit
 *     NAP, openingHoursSpecification, priceRange, servesCuisine, hasMenu, sameAs
 *   - sitemap.xml + robots.txt im Projektordner
 *
 * Das ist der Ranking-Hebel für lokale Businesses: korrekte NAP-Konsistenz +
 * Structured Data → Google Rich Results, Maps-Verknüpfung, lokale Sichtbarkeit.
 *
 * Bewusst deterministisch (kein LLM): NAP-Daten dürfen NICHT halluziniert werden.
 * Doku: docs/SEO.md.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// ── Branche → schema.org @type ──────────────────────────────────────────────────
const SCHEMA_TYPE = {
  restaurant: 'Restaurant',
  cafe: 'CafeOrCoffeeShop',
  bar: 'BarOrPub',
  'fine-dining': 'Restaurant',
  bakery: 'Bakery',
  foodtruck: 'FoodEstablishment',
  friseur: 'HairSalon',
  beauty: 'BeautySalon',
  zahnarzt: 'Dentist',
  arzt: 'MedicalClinic',
  fitness: 'ExerciseGym',
  handwerk: 'HomeAndConstructionBusiness',
  anwalt: 'Attorney'
};

const FOOD_TYPES = new Set(['Restaurant', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'FoodEstablishment']);
const PRICE_RANGE = { 'günstig': '€', guenstig: '€', mittel: '€€', gehoben: '€€€', premium: '€€€€' };

// Wochentage in Reihenfolge (für Bereichs-Expansion "Di–Fr")
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ALIAS = {
  mo: 'Monday', montag: 'Monday', mon: 'Monday',
  di: 'Tuesday', dienstag: 'Tuesday', tue: 'Tuesday', die: 'Tuesday',
  mi: 'Wednesday', mittwoch: 'Wednesday', wed: 'Wednesday',
  do: 'Thursday', donnerstag: 'Thursday', thu: 'Thursday', don: 'Thursday',
  fr: 'Friday', freitag: 'Friday', fri: 'Friday',
  sa: 'Saturday', samstag: 'Saturday', sat: 'Saturday', sonnabend: 'Saturday',
  so: 'Sunday', sonntag: 'Sunday', sun: 'Sunday'
};

// Freitext-Kategorie ("Rechtsanwaltskanzlei", "Zahnarztpraxis", …) per Keyword auf den
// passenden schema.org-Typ mappen — der Scraper liefert echte Branchen, keine festen Keys.
const SCHEMA_KEYWORDS = [
  [/anwalt|kanzlei|rechtsanwa|jurist|notar|legal/i, 'LegalService'],
  [/steuerberat|wirtschaftsprüf/i, 'AccountingService'],
  [/versicherung|makler/i, 'InsuranceAgency'],
  [/immobilien/i, 'RealEstateAgent'],
  [/zahn/i, 'Dentist'],
  [/arzt|ärzt|praxis|medizin|doctor|clinic|klinik/i, 'MedicalClinic'],
  [/physio|therapie|heilpraktik/i, 'MedicalBusiness'],
  [/friseur|salon|barber|hair/i, 'HairSalon'],
  [/kosmetik|beauty|nagel/i, 'BeautySalon'],
  [/fitness|gym|yoga|sport|crossfit/i, 'ExerciseGym'],
  [/handwerk|bau|elektro|sanitär|maler|dach|tischler|garten|kfz|werkstatt/i, 'HomeAndConstructionBusiness'],
  [/restaurant|gastro/i, 'Restaurant'],
  [/café|cafe|coffee/i, 'CafeOrCoffeeShop'],
  [/bäcker|bakery|konditorei/i, 'Bakery'],
  [/bar|pub|lounge|cocktail/i, 'BarOrPub']
];

const LEGAL_TYPES = new Set(['LegalService', 'Attorney']);

function schemaType(category = '') {
  const c = String(category).toLowerCase().trim();
  if (SCHEMA_TYPE[c]) return SCHEMA_TYPE[c];
  for (const [re, t] of SCHEMA_KEYWORDS) if (re.test(c)) return t;
  return 'LocalBusiness';
}

// ── Adresse parsen: "Westernstraße 12, 33098 Paderborn" → PostalAddress ──────────
function parseAddress(addr = '') {
  const out = { '@type': 'PostalAddress', streetAddress: '', postalCode: '', addressLocality: '', addressCountry: 'DE' };
  const s = String(addr || '').trim();
  if (!s) return null;
  const m = s.match(/^(.*?),?\s*(\d{5})\s+(.+?)$/);
  if (m) {
    out.streetAddress = m[1].replace(/[,\s]+$/, '').trim();
    out.postalCode = m[2];
    out.addressLocality = m[3].trim();
  } else {
    out.streetAddress = s; // Best effort: ganze Zeile als Straße
  }
  return out;
}

/** Stadt aus Adresse für Title/OG ("… in Paderborn"). */
function localityFromAddress(addr = '') {
  const a = parseAddress(addr);
  return a && a.addressLocality ? a.addressLocality : '';
}

// ── Öffnungszeiten → openingHoursSpecification (defensiv) ────────────────────────
// Akzeptiert zwei reale Quellen:
//   a) Google-Places weekday_text:  "Montag: 11:00–14:00, 17:00–22:00" / "Montag: Geschlossen"
//   b) manueller Freitext:          "Di–Fr 9–18 Uhr" / "Sa 9–14 Uhr"
// Nicht parsebare Zeilen werden ÜBERSPRUNGEN (lieber keine Angabe als falsche Zeiten).
function parseOpeningHours(hoursText = '') {
  const text = String(hoursText || '').trim();
  if (!text) return [];
  const specs = [];

  for (const rawLine of text.split(/[\n;]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/geschlossen|closed|ruhetag/i.test(line)) continue;

    // Tag(e) am Zeilenanfang isolieren: "Di–Fr 9–18" oder "Montag: 11:00–14:00, 17:00–22:00"
    const dayPart = line.match(/^([A-Za-zÄÖÜäöü.\-–—\s\/]+?)[:\s]/);
    if (!dayPart) continue;
    const days = expandDays(dayPart[1]);
    if (!days.length) continue;

    // Alle Zeitspannen der Zeile: "9–18", "11:00-14:00", "17.00–22.00"
    const ranges = [...line.matchAll(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:[-–—]|bis)\s*(\d{1,2})(?:[:.](\d{2}))?/g)];
    if (!ranges.length) continue;

    for (const r of ranges) {
      const opens = normTime(r[1], r[2]);
      const closes = normTime(r[3], r[4]);
      if (!opens || !closes) continue;
      specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens, closes });
    }
  }
  return specs;
}

function expandDays(token = '') {
  // "Di–Fr" → [Tue..Fri];  "Mo, Mi" → [Mon, Wed];  "Samstag" → [Sat]
  const cleaned = token.replace(/\./g, '').trim();
  const result = new Set();

  for (const part of cleaned.split(',')) {
    const range = part.split(/[-–—]|bis/);
    if (range.length === 2) {
      const a = DAY_ALIAS[range[0].trim().toLowerCase()];
      const b = DAY_ALIAS[range[1].trim().toLowerCase()];
      if (a && b) {
        let i = WEEK.indexOf(a);
        const end = WEEK.indexOf(b);
        if (i !== -1 && end !== -1) {
          // zyklisch (z. B. Sa–Mo), aber Obergrenze 7 Schritte
          for (let n = 0; n < 7; n++) {
            result.add(WEEK[i]);
            if (i === end) break;
            i = (i + 1) % 7;
          }
          continue;
        }
      }
    }
    const single = DAY_ALIAS[part.trim().toLowerCase()];
    if (single) result.add(single);
  }
  return [...result];
}

function normTime(h, m) {
  if (h == null) return null;
  const hh = parseInt(h, 10);
  if (isNaN(hh) || hh < 0 || hh > 24) return null;
  const mm = m != null ? parseInt(m, 10) : 0;
  if (isNaN(mm) || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function absUrl(src, baseUrl) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  return baseUrl.replace(/\/$/, '/') + String(src).replace(/^\.?\//, '');
}

function clamp(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/[\s,;.\-–—]+\S*$/, '').trim() + '…';
}

/** Erstes Zeichen groß (lässt den Rest unberührt). */
function titleCase1(s) {
  const t = String(s || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Entfernt Rechtsform-Rauschen (PartGmbB, GmbH, …) für kompakte, lesbare Titel. */
function shortBrand(name) {
  return String(name || '')
    .replace(/\b(Part\s?G?mbB|PartG|GmbH\s*&\s*Co\.?\s*KG|gGmbH|GmbH|mbH|mbB|UG(?:\s*\(haftungsbeschränkt\))?|GbR|e\.?\s?V\.?|e\.?\s?K\.?|AG|KG|OHG)\b\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s–—-]+$/g, '')
    .trim();
}

/**
 * Baut einen SEO-Title, der nie mitten im Wort abschneidet und die Kategorie
 * großschreibt. Bevorzugt Keyword-First (Kategorie + Ort), fällt sauber zurück.
 */
function buildTitle(name, category, locality, max = 60) {
  const cat = titleCase1(category || '');
  const short = shortBrand(name) || name;
  const candidates = [];
  if (cat && locality) {
    candidates.push(`${cat} ${locality} – ${short}`);
    candidates.push(`${short} – ${cat} ${locality}`);
    candidates.push(`${name} – ${cat} ${locality}`);
  } else if (locality) {
    candidates.push(`${short} – ${locality}`, `${name} – ${locality}`);
  }
  candidates.push(short, name);
  const fit = candidates.find(t => t && t.length <= max);
  return fit || clamp(short || name, max);
}

/**
 * baseUrl (Canonical/OG/Sitemap-Basis). Reihenfolge:
 *   1. explizite project.siteUrl
 *   2. SITE_BASE_URL-Env (Vorschau-Host) + /projects/<id>/
 *   3. die ECHTE Kundendomain (sourceUrl/oldSiteUrl) — dort wird ausgeliefert
 *   4. localhost (nur lokale Vorschau, NIE in Auslieferung)
 * So entstehen niemals localhost-Canonicals in produktiven Dateien.
 */
function resolveBaseUrl(project, port = process.env.PORT || 3000) {
  const explicit = (project.siteUrl || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '') + '/';
  if (process.env.SITE_BASE_URL) {
    return `${process.env.SITE_BASE_URL.replace(/\/$/, '')}/projects/${project.id}/`;
  }
  const real = [project.sourceUrl, project.oldSiteUrl]
    .find(u => u && /^https?:\/\//i.test(u));
  if (real) return real.replace(/\/+$/, '') + '/';
  return `http://localhost:${port}/projects/${project.id}/`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Serialisiert ein JSON-LD-Objekt sicher für die Einbettung in ein <script>-Tag.
 * Escaped `< > &` als \uXXXX, damit ein `</script>` in dynamischen Werten (z. B. gescrapter
 * project.name/Adresse/Beschreibung) das Script-Tag NICHT vorzeitig schließen kann (XSS-Schutz).
 * Gleiche Technik wie in subpage-schema.js.
 */
function jsonLdSafe(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function sameAs(links = {}) {
  const keys = ['instagram', 'facebook', 'tiktok', 'youtube', 'maps'];
  return keys.map(k => links[k]).filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
}

// ── JSON-LD bauen ───────────────────────────────────────────────────────────────
/**
 * Baut den schema.org-Knoten/Graphen aus echten project.json-Daten (deterministisch,
 * nie halluziniert). Enthält neben dem LocalBusiness-Knoten GEO-Signale:
 * datePublished/dateModified (Aktualität), eine Organization/publisher-Entität
 * (stärkere Entity-Signale) und einen BreadcrumbList (Seitenhierarchie), damit
 * AI-Antwort-Engines (ChatGPT, Perplexity, Gemini) Struktur und Frische erkennen.
 * @param {object} project @param {string} baseUrl @param {{description:string,image?:string}} meta
 * @returns {object} JSON-LD-Objekt (Business-Knoten ODER {@context,@graph:[...]})
 */
function buildJsonLd(project, baseUrl, meta) {
  const type = schemaType(project.category);
  const contact = project.contact || {};
  const address = parseAddress(contact.address);
  const hours = parseOpeningHours(contact.hours);
  const image = meta.image;
  const buildDate = new Date().toISOString();
  const root = baseUrl.replace(/\/$/, '/');
  const orgId = root + '#org';

  const node = {
    '@type': type,
    '@id': root + '#business',
    name: project.name,
    description: meta.description,
    url: baseUrl,
    datePublished: buildDate,
    dateModified: buildDate,
    publisher: { '@id': orgId },
    mainEntityOfPage: baseUrl,
    ...(image ? { image } : {}),
    ...(contact.phone ? { telephone: String(contact.phone).replace(/\s+/g, ' ').trim() } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(PRICE_RANGE[String(project.priceLevel || '').toLowerCase()] ? { priceRange: PRICE_RANGE[String(project.priceLevel).toLowerCase()] } : {}),
    ...(address ? { address } : {}),
    ...(hours.length ? { openingHoursSpecification: hours } : {})
  };

  if (FOOD_TYPES.has(type)) {
    if (project.cuisine) node.servesCuisine = project.cuisine;
    if (Array.isArray(project.menu) && project.menu.length) node.hasMenu = baseUrl.replace(/\/$/, '/') + '#menu';
    if (type !== 'Restaurant') node.servesCuisine = node.servesCuisine; // no-op, Klarheit
  }

  // Dienstleister-Felder (branchenübergreifend) — wichtig für Kanzlei/Praxis/Handwerk:
  // Schwerpunkte (Rechtsgebiete) → knowsAbout/serviceType, Einzugsgebiet, Team → employee.
  if (Array.isArray(project.specialties) && project.specialties.length) {
    node.knowsAbout = project.specialties;
    if (LEGAL_TYPES.has(type)) node.serviceType = project.specialties; // Rechtsgebiete
  }
  if (address && address.addressLocality) {
    node.areaServed = { '@type': 'City', name: address.addressLocality };
  }
  if (Array.isArray(project.team) && project.team.length) {
    const staff = project.team.slice(0, 12).filter(t => t && t.name)
      .map(t => ({ '@type': 'Person', name: t.name, ...(t.role ? { jobTitle: t.role } : {}) }));
    if (staff.length) node.employee = staff;
  }

  const sa = sameAs(project.links);
  if (sa.length) node.sameAs = sa;

  // aggregateRating BEWUSST nur, wenn explizit gesetzt — keine Auto-Übernahme der
  // Google-Bewertung des Alt-Business (Risiko: Google-Manual-Action wegen self-serving).
  if (project.rating && project.reviewCount) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(project.rating),
      reviewCount: String(project.reviewCount)
    };
  }

  // Organization/publisher-Entität (GEO): eigenständiger Knoten mit stabiler @id,
  // den der Business-Knoten via publisher referenziert. Stärkt Entity-Signale für
  // AI-Antwort-Engines. Nur echte Daten — fehlende Felder werden ausgelassen.
  const logo = absUrl(project.logo || project.logoUrl, baseUrl);
  const orgNode = {
    '@type': 'Organization',
    '@id': orgId,
    name: project.name,
    url: baseUrl,
    ...(image ? { image } : {}),
    ...(logo ? { logo } : {}),
    ...(sa.length ? { sameAs: sa } : {})
  };

  // BreadcrumbList (GEO): Seitenhierarchie Start → aktuelle Seite. Hilft Engines,
  // die Position der Seite im Kontext zu verstehen. Rein additiv, deterministisch.
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Start', item: baseUrl }
    ]
  };

  // @graph verknüpft Business-Knoten + Organization + Breadcrumb zu einem
  // konsistenten Dokument, ohne die bestehenden Business-Felder zu verlieren.
  return { '@context': 'https://schema.org', '@graph': [node, orgNode, breadcrumb] };
}

// ── SEO-Head-Block (deterministisch) ────────────────────────────────────────────
function buildMeta(project, baseUrl) {
  const contact = project.contact || {};
  const locality = localityFromAddress(contact.address);
  const name = project.name || 'Website';

  // Title: Modell-Title wird in applySEO bevorzugt, wenn brauchbar — hier der Fallback.
  // buildTitle vermeidet abgeschnittene „…in…"-Titel und schreibt die Kategorie groß.
  const title = buildTitle(name, project.category, locality, 60);

  const descBase = project.description ||
    [name, locality && `in ${locality}`, project.cuisine].filter(Boolean).join(' ');
  const description = clamp(descBase, 160);

  const image = absUrl(
    (project.heroVisual && project.heroVisual.src) ||
    (Array.isArray(project.photos) && project.photos[0]) ||
    project.ogImage,
    baseUrl
  );

  return { title, description, image, siteName: name };
}

/**
 * Injiziert die deterministische SEO-Schicht in das generierte HTML.
 * @returns {{ html: string, audit: object }}
 */
function applySEO(html, project, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  let head = $('head');
  if (!head.length) { $('html').prepend('<head></head>'); head = $('head'); }

  $('html').attr('lang', 'de');

  const meta = buildMeta(project, baseUrl);

  // Modell-Title behalten, wenn brauchbar (kreativ + lokalisiert), sonst Fallback.
  // Abgeschnittene Titel (enden auf „…" oder „in…") werden verworfen.
  const modelTitle = ($('title').first().text() || '').trim();
  const modelTitleOk = modelTitle.length >= 10 && modelTitle.length <= 65
    && !/[…]\s*$/.test(modelTitle) && !/\b(in|am|an|bei)\s*…?\s*$/i.test(modelTitle);
  const title = modelTitleOk ? modelTitle : meta.title;

  // Modell-Description behalten, wenn brauchbar, sonst Fallback.
  const modelDesc = ($('meta[name="description"]').attr('content') || '').trim();
  const description = (modelDesc.length >= 50 && modelDesc.length <= 165) ? modelDesc : meta.description;

  // Konkurrierende/inkonsistente Tags entfernen — wir setzen alles deterministisch neu.
  $('title').remove();
  $('meta[name="description"]').remove();
  $('link[rel="canonical"]').remove();
  $('meta[name="robots"]').remove();
  $('meta[property^="og:"]').remove();
  $('meta[name^="twitter:"]').remove();
  $('script[type="application/ld+json"]').remove();

  const jsonLd = buildJsonLd(project, baseUrl, { description, image: meta.image });

  const block = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(baseUrl)}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    ``,
    `<meta property="og:type" content="${FOOD_TYPES.has(schemaType(project.category)) ? 'restaurant.restaurant' : 'business.business'}">`,
    `<meta property="og:site_name" content="${esc(meta.siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(baseUrl)}">`,
    `<meta property="og:locale" content="de_DE">`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}">` : '',
    ``,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    meta.image ? `<meta name="twitter:image" content="${esc(meta.image)}">` : '',
    ``,
    `<script type="application/ld+json">\n${jsonLdSafe(jsonLd)}\n</script>`
  ].filter(Boolean).join('\n');

  // Direkt nach <meta charset>/<meta viewport> einsetzen (oben im Head).
  const anchor = head.find('meta[name="viewport"]').first();
  if (anchor.length) anchor.after('\n' + block + '\n');
  else head.prepend(block + '\n');

  return { html: $.html(), audit: auditFromData(jsonLd, { title, description, image: meta.image }) };
}

// AI-Antwort-Engines explizit erlauben (GEO). Wir WOLLEN, dass diese Bots crawlen
// und unsere Seiten zitieren — daher Allow statt Disallow.
const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'PerplexityBot', 'Perplexity-User',
  'ClaudeBot', 'anthropic-ai',
  'Google-Extended'
];

/** Baut den robots.txt-Inhalt: generischer Block + explizite AI-Crawler + Sitemap. */
function buildRobots(sitemapUrl) {
  const aiBlocks = AI_CRAWLERS
    .map(ua => `User-agent: ${ua}\nAllow: /`)
    .join('\n\n');
  return `User-agent: *
Allow: /

${aiBlocks}

Sitemap: ${sitemapUrl}
`;
}

/** Sammelt alle echten Seiten-URLs (Startseite + Rechtsseiten + Subpages) ohne Dubletten. */
function collectPageUrls(project, baseUrl) {
  const root = baseUrl.replace(/\/$/, '/');
  const seen = new Set();
  const urls = [];
  const add = (rel) => {
    const clean = String(rel || '').replace(/^\.?\//, '').trim();
    const loc = clean ? root + clean : root;
    if (seen.has(loc)) return;
    seen.add(loc);
    urls.push(loc);
  };
  add(''); // Startseite
  for (const file of Object.values(project.legalPages || {})) add(file);
  for (const file of project.subpages || []) add(file);
  return urls;
}

/** Baut den sitemap.xml-Inhalt aus einer URL-Liste (Startseite priorisiert). */
function buildSitemap(urls, lastmod) {
  const entries = urls.map((loc, i) => `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${i === 0 ? '1.0' : '0.7'}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

/**
 * Baut den llms.txt-Inhalt (Markdown) für AI-Crawler-Discovery. Reine Fakten aus
 * project.json — fehlende Daten werden zeilenweise übersprungen (lieber nichts als falsch).
 * @param {object} project @param {string} baseUrl @returns {string}
 */
function buildLlmsTxt(project, baseUrl) {
  const root = baseUrl.replace(/\/$/, '/');
  const contact = project.contact || {};
  const locality = localityFromAddress(contact.address);
  const lines = [];

  lines.push(`# ${(project.name || 'Website').trim()}`);
  lines.push('');

  const desc = project.description ||
    [project.name, locality && `in ${locality}`, project.category].filter(Boolean).join(' ');
  if (desc && desc.trim()) lines.push(`> ${clamp(desc, 200)}`);
  if (contact.address && String(contact.address).trim()) lines.push(`- Adresse: ${String(contact.address).replace(/\s+/g, ' ').trim()}`);
  if (contact.phone && String(contact.phone).trim()) lines.push(`- Telefon: ${String(contact.phone).replace(/\s+/g, ' ').trim()}`);
  if (contact.email && String(contact.email).trim()) lines.push(`- E-Mail: ${String(contact.email).trim()}`);
  lines.push('');

  // Leistungen/Schwerpunkte (Rechtsgebiete, Behandlungen, Gewerke …) — stark zitierfähig
  // für AI-Suchen wie "welche Kanzlei in Paderborn macht Verkehrsrecht?".
  const services = (project.specialties || []).map(s => String(s).trim()).filter(Boolean);
  if (services.length) {
    lines.push('## Leistungen');
    for (const s of services) lines.push(`- ${s}`);
    lines.push('');
  }

  // Häufige Fragen (Answer-First) — der stärkste GEO-Hebel: AI-Suchen zitieren
  // strukturierte, direkt beantwortete Fragen bevorzugt. Nur echte, generierte FAQs.
  const faq = Array.isArray(project.faq) ? project.faq.filter(x => x && x.q && x.a) : [];
  if (faq.length) {
    lines.push('## Häufige Fragen');
    for (const x of faq.slice(0, 14)) {
      lines.push(`### ${String(x.q).replace(/\s+/g, ' ').trim()}`);
      lines.push(String(x.a).replace(/\s+/g, ' ').trim());
      lines.push('');
    }
  }

  // Kernseiten als Markdown-Liste verlinken.
  lines.push('## Seiten');
  lines.push(`- [Startseite](${root})`);
  const legalLabels = { impressum: 'Impressum', datenschutz: 'Datenschutz' };
  for (const [key, file] of Object.entries(project.legalPages || {})) {
    if (!file) continue;
    const label = legalLabels[key] || key;
    lines.push(`- [${label}](${root}${String(file).replace(/^\.?\//, '')})`);
  }
  for (const file of project.subpages || []) {
    if (!file) continue;
    const clean = String(file).replace(/^\.?\//, '');
    const label = subpageLabel(clean);
    lines.push(`- [${label}](${root}${clean})`);
  }
  lines.push('');

  return lines.join('\n');
}

/** Leitet ein menschenlesbares Label aus einem Subpage-Dateinamen ab. */
function subpageLabel(file) {
  const base = file.replace(/\.html$/i, '').split('/').pop() || file;
  const known = { rechtsgebiete: 'Rechtsgebiete', anwaelte: 'Anwälte & Team', kontakt: 'Kontakt' };
  if (known[base.toLowerCase()]) return known[base.toLowerCase()];
  // Slugs (z. B. Profil-Seiten "max-mustermann") in Titel verwandeln.
  return base.split(/[-_]/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || base;
}

/**
 * Schreibt die Basis-SEO-Discovery-Dateien (Startseiten-Sitemap + AI-freundliche robots.txt).
 * Wird FRÜH aufgerufen; writeDiscoveryFiles überschreibt die Sitemap später vollständig.
 * @param {string} projectDir @param {object} project @param {string} baseUrl
 * @returns {{sitemap:string}}
 */
function writeSeoFiles(projectDir, project, baseUrl) {
  const lastmod = new Date().toISOString().slice(0, 10);
  const sitemapUrl = baseUrl.replace(/\/$/, '/') + 'sitemap.xml';
  const sitemap = buildSitemap([baseUrl.replace(/\/$/, '/')], lastmod);
  fs.writeFileSync(path.join(projectDir, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(projectDir, 'robots.txt'), buildRobots(sitemapUrl));
  return { sitemap: sitemapUrl };
}

/**
 * GEO-Finalizer: (re)schreibt die vollständige sitemap.xml (Startseite + Rechtsseiten +
 * Subpages, je mit lastmod), aktualisiert robots.txt und erzeugt llms.txt. MUSS aufgerufen
 * werden, NACHDEM project.legalPages und project.subpages befüllt sind. Idempotent,
 * deterministisch, wirft nicht für fehlende Daten (lieber nichts als falsch).
 * @param {string} projectDir @param {object} project @param {string} baseUrl
 * @returns {{sitemap:string, urls:string[], llmsTxt:string}}
 */
function writeDiscoveryFiles(projectDir, project, baseUrl) {
  const lastmod = new Date().toISOString().slice(0, 10);
  const sitemapUrl = baseUrl.replace(/\/$/, '/') + 'sitemap.xml';
  const urls = collectPageUrls(project, baseUrl);

  fs.writeFileSync(path.join(projectDir, 'sitemap.xml'), buildSitemap(urls, lastmod));
  fs.writeFileSync(path.join(projectDir, 'robots.txt'), buildRobots(sitemapUrl));
  const llmsTxt = buildLlmsTxt(project, baseUrl);
  fs.writeFileSync(path.join(projectDir, 'llms.txt'), llmsTxt);

  return { sitemap: sitemapUrl, urls, llmsTxt };
}

/** Holt den eigentlichen Business-Knoten — egal ob direkt oder im @graph verpackt. */
function businessNode(jsonLd) {
  if (jsonLd && Array.isArray(jsonLd['@graph'])) {
    return jsonLd['@graph'].find(n => n && n['@id'] && /#business$/.test(n['@id'])) || jsonLd['@graph'][0] || {};
  }
  return jsonLd || {};
}

// ── Audit (leichter Determinismus-Check, kein LLM) ──────────────────────────────
function auditFromData(jsonLd, meta) {
  const node = businessNode(jsonLd);
  const warnings = [];
  if (!node.address) warnings.push('Keine Adresse → kein vollständiges LocalBusiness-Schema (NAP unvollständig)');
  if (!node.telephone) warnings.push('Keine Telefonnummer im Schema');
  if (!node.openingHoursSpecification) warnings.push('Öffnungszeiten nicht maschinenlesbar geparst');
  if (!meta.image) warnings.push('Kein og:image (Vorschaubild fehlt → schwächeres Teilen/Snippet)');
  if (meta.title && meta.title.length > 60) warnings.push(`Title ${meta.title.length} Zeichen (>60, Google kürzt ggf.)`);
  if (meta.description && meta.description.length > 160) warnings.push(`Description ${meta.description.length} Zeichen (>160)`);
  return {
    jsonLd: true,
    schemaType: node['@type'],
    hasAddress: !!node.address,
    hasOpeningHours: !!node.openingHoursSpecification,
    hasImage: !!meta.image,
    titleLength: meta.title ? meta.title.length : 0,
    descriptionLength: meta.description ? meta.description.length : 0,
    warnings
  };
}

module.exports = {
  applySEO, writeSeoFiles, writeDiscoveryFiles, buildJsonLd, resolveBaseUrl,
  buildTitle, shortBrand, parseOpeningHours, parseAddress, schemaType, jsonLdSafe
};
