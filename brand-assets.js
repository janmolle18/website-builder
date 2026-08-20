/**
 * brand-assets.js — OG-Image + Favicon-Set pro Projekt (I6, abo-frei, kein LLM).
 *
 * WARUM: Ein gebrandetes Social-Preview-Bild (1200×630, Name + Claim im Design-DNA-Stil) und ein
 * echtes Favicon-Set sind Standard für eine professionelle Site — sie wirken beim Teilen (WhatsApp,
 * LinkedIn, Google-Snippet) und zahlen auf Sichtbarkeit/GEO ein. Bisher zog `seo.js` als og:image
 * bestenfalls ein zufälliges Scrape-Foto (falsches Seitenverhältnis, evtl. schwach); polish.js setzte
 * nur ein Inline-SVG-Favicon. Dieses Modul erzeugt deterministisch echte Dateien via sharp + SVG und
 * verdrahtet die Meta-/Favicon-Tags in den <head> ALLER Seiten.
 *
 * Muster wie images-build.js: erst Assets erzeugen, DANN HTML umschreiben (bei Fehler bleibt die Site
 * unverändert); idempotent (Marker); tiefenrichtige relative Favicon-Pfade, absolute og:image-URL.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const sharp = require('sharp');
const { findHtmlFiles } = require('./css-build');
const { selectDNA } = require('./design-dna');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const FAVICON_SIZES = [16, 32];
const APPLE_TOUCH = 180;
const MARKER = 'brand-assets'; // <meta name="brand-assets"> → Idempotenz-Wächter

const DEFAULT_PALETTE = { bg: '#0E1116', surface: '#161B22', text: '#ECECEA', muted: '#9BA4AF', accent: '#C9A24B' };

function xmlEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Kürzt einen Text hart auf max Zeichen (mit …), wortweise wenn möglich. */
function clamp(str, max) {
  const s = String(str || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

/** Anfangsbuchstaben (Monogramm) aus dem Namen — Titel/&/Und werden übersprungen. */
function monogram(name) {
  const stop = /^(dr|prof|dipl|ll|mag|jur|iur|med|und|partgmbb|partg|mbb|gmbh|part|rechtsanwälte|rechtsanwaelte|kanzlei|praxis|the|die|der|das)$/i;
  const words = String(name || '').replace(/[.&,]/g, ' ').split(/\s+/).filter(w => w && !stop.test(w) && /[a-zA-ZÄÖÜäöü]/.test(w));
  const letters = words.slice(0, 2).map(w => w[0].toUpperCase());
  return (letters.join('') || (String(name || '').trim()[0] || 'W').toUpperCase()).slice(0, 2);
}

/** Claim: aus description ableiten, sonst Kategorie — für die zweite OG-Zeile. */
function deriveClaim(project) {
  const d = String(project.description || '').trim();
  if (d) return clamp(d, 84);
  const cat = String(project.category || '').trim();
  return cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
}

/** Namen für die OG-Headline in max. zwei Zeilen umbrechen. */
function wrapName(name, maxPerLine) {
  const words = String(name || 'Website').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxPerLine) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
    if (lines.length === 1 && cur.length > maxPerLine) break; // max 2 Zeilen
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2).map(l => clamp(l, maxPerLine + 4));
}

/** SVG des OG-Bildes im Design-DNA-Stil (systemsichere Fonts, damit Text headless zuverlässig rendert). */
function ogSvg(project, palette) {
  const nameLines = wrapName(project.name, 22);
  const claim = deriveClaim(project);
  const startY = nameLines.length > 1 ? 250 : 300;
  const nameTspans = nameLines
    .map((l, i) => `<text x="90" y="${startY + i * 82}" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="600" fill="${palette.text}">${xmlEsc(l)}</text>`)
    .join('');
  const claimY = startY + nameLines.length * 82 + 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${palette.bg}"/>
  <rect x="90" y="118" width="88" height="4" fill="${palette.accent}"/>
  ${nameTspans}
  ${claim ? `<text x="90" y="${claimY}" font-family="Helvetica Neue, Arial, sans-serif" font-size="30" fill="${palette.muted}">${xmlEsc(claim)}</text>` : ''}
  <rect x="0" y="${OG_HEIGHT - 10}" width="${OG_WIDTH}" height="10" fill="${palette.accent}"/>
</svg>`;
}

/** SVG des Favicon-Monogramms (Initialen in Akzentfarbe auf dunklem Grund). */
function faviconSvg(project, palette, size) {
  const mono = monogram(project.name);
  const fs2 = mono.length > 1 ? Math.round(size * 0.5) : Math.round(size * 0.62);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="${palette.bg}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif" font-size="${fs2}" font-weight="600" fill="${palette.accent}">${xmlEsc(mono)}</text>
</svg>`;
}

/** Tiefenrichtiger relativer Pfad von einer HTML-Datei zu einer Asset-Datei im Projekt-Root. */
function relHref(projectDir, htmlFile, assetRel) {
  const rel = path.relative(path.dirname(htmlFile), projectDir).split(path.sep).join('/');
  return (rel ? rel + '/' : '') + assetRel;
}

/** Meta-Tag mit gegebenem property/name upserten (ersetzt Inhalt, sonst neu nach viewport/prepend). */
function upsertMeta($, head, sel, tagHtml) {
  const existing = head.find(sel);
  if (existing.length) { existing.first().replaceWith(tagHtml); existing.slice(1).remove(); return; }
  const anchor = head.find('meta[name="viewport"]').first();
  if (anchor.length) anchor.after('\n' + tagHtml);
  else head.prepend(tagHtml + '\n');
}

/**
 * Erzeugt OG-Image + Favicon-Set und verdrahtet die Tags in allen Seiten.
 * @param {string} projectDir  Pfad zum gebauten Projekt
 * @param {object} project     Projektdaten (für DNA/Name/Claim)
 * @param {{baseUrl?:string}} [opts]  baseUrl für absolute og:image-URL
 * @returns {Promise<{built:boolean, reason?:string, ogImage?:object, favicons?:string[], pagesUpdated?:number}>}
 */
async function buildBrandAssets(projectDir, project = {}, opts = {}) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { built: false, reason: 'keine index.html' };
  }

  let palette = DEFAULT_PALETTE;
  try { const dna = selectDNA(project); if (dna && dna.palette) palette = dna.palette; } catch { /* Default-Palette */ }

  const assetsDir = path.join(projectDir, 'assets');
  try { fs.mkdirSync(assetsDir, { recursive: true }); } catch { /* existiert */ }

  // 1) Assets ZUERST erzeugen — schlägt das fehl, wird KEIN HTML angefasst (Site bleibt intakt).
  const favicons = [];
  try {
    await sharp(Buffer.from(ogSvg(project, palette))).png({ compressionLevel: 9 }).toFile(path.join(assetsDir, 'og-image.png'));
    for (const s of FAVICON_SIZES) {
      const f = `favicon-${s}.png`;
      await sharp(Buffer.from(faviconSvg(project, palette, s))).png().toFile(path.join(assetsDir, f));
      favicons.push(f);
    }
    await sharp(Buffer.from(faviconSvg(project, palette, APPLE_TOUCH))).png().toFile(path.join(assetsDir, 'apple-touch-icon.png'));
    favicons.push('apple-touch-icon.png');
  } catch (e) {
    return { built: false, reason: `Asset-Erzeugung fehlgeschlagen: ${e.message}` };
  }

  // 2) HTML umschreiben — je Seite tiefenrichtige Favicon-Hrefs + absolute og:image-URL.
  const ogUrl = opts.baseUrl
    ? opts.baseUrl.replace(/\/+$/, '') + '/assets/og-image.png'
    : '/assets/og-image.png';
  let pagesUpdated = 0;

  for (const file of findHtmlFiles(projectDir)) {
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const $ = cheerio.load(html, { decodeEntities: false });
    const head = $('head');
    if (!head.length) continue;

    const fav32 = relHref(projectDir, file, 'assets/favicon-32.png');
    const fav16 = relHref(projectDir, file, 'assets/favicon-16.png');
    const apple = relHref(projectDir, file, 'assets/apple-touch-icon.png');

    upsertMeta($, head, 'link[rel="apple-touch-icon"]', `<link rel="apple-touch-icon" sizes="180x180" href="${apple}">`);
    upsertMeta($, head, 'link[rel="icon"][sizes="32x32"]', `<link rel="icon" type="image/png" sizes="32x32" href="${fav32}">`);
    upsertMeta($, head, 'link[rel="icon"][sizes="16x16"]', `<link rel="icon" type="image/png" sizes="16x16" href="${fav16}">`);
    upsertMeta($, head, 'meta[property="og:image"]', `<meta property="og:image" content="${xmlEsc(ogUrl)}">`);
    upsertMeta($, head, 'meta[name="twitter:image"]', `<meta name="twitter:image" content="${xmlEsc(ogUrl)}">`);
    upsertMeta($, head, 'meta[name="twitter:card"]', `<meta name="twitter:card" content="summary_large_image">`);

    if (!head.find(`meta[name="${MARKER}"]`).length) head.append(`<meta name="${MARKER}" content="1">`);

    try { fs.writeFileSync(file, $.html()); pagesUpdated++; } catch { /* Seite überspringen */ }
  }

  const ogBytes = (() => { try { return fs.statSync(path.join(assetsDir, 'og-image.png')).size; } catch { return 0; } })();
  return { built: true, ogImage: { path: 'assets/og-image.png', bytes: ogBytes }, favicons, pagesUpdated };
}

/**
 * Validiert die erzeugten Brand-Assets (Maße, Vorhandensein, Tags in allen Seiten).
 * @returns {Promise<{ok:boolean, checks:object, issues:string[]}>}
 */
async function validateBrandAssets(projectDir) {
  const issues = [];
  const assetsDir = path.join(projectDir, 'assets');
  let ogDims = false;
  try {
    const m = await sharp(path.join(assetsDir, 'og-image.png')).metadata();
    ogDims = m.width === OG_WIDTH && m.height === OG_HEIGHT;
  } catch { /* fehlt */ }
  if (!ogDims) issues.push(`og-image fehlt oder ist nicht ${OG_WIDTH}×${OG_HEIGHT}`);

  const faviconsPresent = ['favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png']
    .every(f => fs.existsSync(path.join(assetsDir, f)));
  if (!faviconsPresent) issues.push('Favicon-Set unvollständig');

  let tagsOk = true;
  for (const file of findHtmlFiles(projectDir)) {
    let html = ''; try { html = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!/property="og:image"/.test(html) || !/rel="apple-touch-icon"/.test(html)) { tagsOk = false; break; }
  }
  if (!tagsOk) issues.push('Nicht alle Seiten haben og:image/apple-touch-icon');

  const checks = { og_dimensions: ogDims, favicons_present: faviconsPresent, tags_on_all_pages: tagsOk };
  return { ok: issues.length === 0, checks, issues };
}

module.exports = { buildBrandAssets, validateBrandAssets, OG_WIDTH, OG_HEIGHT, monogram, deriveClaim };
