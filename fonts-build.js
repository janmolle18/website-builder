/**
 * fonts-build.js — Google Fonts self-hosten (A3).
 *
 * WARUM: Der Generator bindet Schriften über fonts.googleapis.com/fonts.gstatic.com ein.
 * Genau das ist der Kern der deutschen Google-Fonts-Abmahnwelle (Besucher-IP geht an
 * Google) — ein DSGVO-No-Go gerade für Kanzleien/Praxen. Dieses Modul lädt die WOFF2
 * der genutzten Familien/Gewichte lokal, erzeugt @font-face (mit font-display:swap) und
 * ersetzt die Google-Fonts-Links durch ein lokales Stylesheet.
 *
 * Quelle: google-webfonts-helper (gwfh) — liefert die offiziellen WOFF2 + Metadaten.
 * Cache: einmal geholte Dateien liegen unter vendor/fonts/ → weitere Builds sind offline.
 *
 * SICHERHEIT FÜRS KERN-ASSET: Erst werden Fonts + fonts.css erzeugt; erst wenn das klappt,
 * wird das HTML angefasst. Bei jedem Fehler wirft die Funktion → die Pipeline fängt das
 * und lässt die (funktionierende) Google-Fonts-Einbindung stehen.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');

const CACHE_DIR = path.join(__dirname, 'vendor', 'fonts');
const GWFH = 'https://gwfh.mranftl.com/api/fonts';
const GGL_RE = /fonts\.(googleapis|gstatic)\.com/i;

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} für ${url}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}
async function fetchJson(url) { return JSON.parse((await fetchBuffer(url)).toString('utf8')); }

/** Familienname → gwfh-ID ("Cormorant Garamond" → "cormorant-garamond"). */
function gwfhId(family) {
  return String(family).trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Parst den Google-Fonts-css2-Link → [{ family, weights:[...] }].
 * Beispiel: family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500
 */
function parseGoogleFontsLink(href) {
  const q = href.split('?')[1] || '';
  const out = [];
  for (const part of q.split('&')) {
    const dec = decodeURIComponent(part.replace(/\+/g, ' '));
    if (!dec.startsWith('family=')) continue;
    const spec = dec.slice('family='.length);
    const [nameRaw, axes] = spec.split(':');
    const family = nameRaw.trim();
    const weights = new Set();
    if (axes) {
      const at = axes.split('@')[1] || '';
      for (const tuple of at.split(';')) {
        const nums = tuple.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
        if (nums.length) weights.add(nums[nums.length - 1]); // letzte Zahl = Gewicht
      }
    }
    if (!weights.size) weights.add('400');
    out.push({ family, weights: [...weights].sort() });
  }
  return out;
}

/** Holt (gecacht) die WOFF2 einer Familie/Gewichte und liefert @font-face-Regeln + Dateien. */
async function resolveFamily(family, weights, assetsFontsDir) {
  const id = gwfhId(family);
  const meta = await fetchJson(`${GWFH}/${id}?subsets=latin,latin-ext`);
  const faces = [];
  const copied = [];
  fs.mkdirSync(path.join(CACHE_DIR, id), { recursive: true });

  for (const w of weights) {
    const variant = (meta.variants || []).find(v => v.fontStyle === 'normal' && String(v.fontWeight) === String(w))
      || (meta.variants || []).find(v => v.fontStyle === 'normal'); // Fallback: nächstbeste
    if (!variant || !variant.woff2) continue;
    const base = variant.woff2.split('/').pop().split('?')[0].replace(/[^a-z0-9.]/gi, '') + '.woff2';
    const cachePath = path.join(CACHE_DIR, id, base);
    if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, await fetchBuffer(variant.woff2));
    const outName = `${id}-${base}`;
    fs.copyFileSync(cachePath, path.join(assetsFontsDir, outName));
    copied.push(outName);
    faces.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url('fonts/${outName}') format('woff2')}`);
  }
  if (!faces.length) throw new Error(`Keine WOFF2 für ${family} (${weights.join(',')})`);
  return { faces, copied };
}

/**
 * Ersetzt Google Fonts durch lokal gehostete WOFF2 + @font-face.
 * @param {string} projectDir absoluter Pfad zum Projektordner
 * @returns {Promise<{built:boolean, skipped?:boolean, reason?:string, families?:string[], files?:number}>}
 */
async function buildFonts(projectDir) {
  const indexPath = path.join(projectDir, 'index.html');
  if (!fs.existsSync(indexPath)) return { built: false, skipped: true, reason: 'kein index.html' };
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  if (!GGL_RE.test(indexHtml)) return { built: false, skipped: true, reason: 'keine Google Fonts (bereits self-hosted)' };

  // Google-Fonts-css2-Link finden (der mit family=...).
  const $idx = cheerio.load(indexHtml, { decodeEntities: false });
  let cssHref = null;
  $idx('link[href*="fonts.googleapis.com/css"]').each((i, el) => { cssHref = cssHref || $idx(el).attr('href'); });
  if (!cssHref) return { built: false, skipped: true, reason: 'kein css2-Link gefunden' };

  const families = parseGoogleFontsLink(cssHref);
  if (!families.length) return { built: false, skipped: true, reason: 'keine Familien geparst' };

  // 1) Fonts holen + fonts.css bauen (VOR jeder HTML-Änderung).
  const assetsFontsDir = path.join(projectDir, 'assets', 'fonts');
  fs.mkdirSync(assetsFontsDir, { recursive: true });
  const allFaces = [];
  for (const f of families) {
    const { faces } = await resolveFamily(f.family, f.weights, assetsFontsDir);
    allFaces.push(...faces);
  }
  fs.writeFileSync(path.join(projectDir, 'assets', 'fonts.css'), allFaces.join('\n') + '\n');

  // 2) In allen HTML-Dateien: Google-Fonts-Links (preconnect + css) raus, lokales <link> rein.
  const htmlFiles = findHtmlFiles(projectDir);
  for (const file of htmlFiles) {
    const rel = path.relative(projectDir, path.dirname(file));
    const prefix = rel ? rel.split(path.sep).map(() => '..').join('/') + '/' : '';
    rewriteFontLinks(file, `${prefix}assets/fonts.css`);
  }
  return { built: true, families: families.map(f => f.family), files: htmlFiles.length };
}

/** Entfernt Google-Fonts-Links (googleapis/gstatic) und setzt das lokale Font-Stylesheet. */
function rewriteFontLinks(file, href) {
  const $ = cheerio.load(fs.readFileSync(file, 'utf8'), { decodeEntities: false });
  let hadGoogle = false;
  $('link').each((i, el) => {
    const h = $(el).attr('href') || '';
    if (GGL_RE.test(h)) { $(el).remove(); hadGoogle = true; }
  });
  if (hadGoogle && !$(`link[href="${href}"]`).length) {
    const link = `<link rel="stylesheet" href="${href}">`;
    if ($('head').length) $('head').prepend(link);
    else $.root().prepend(link);
  }
  fs.writeFileSync(file, $.html());
}

module.exports = { buildFonts, parseGoogleFontsLink, gwfhId };
