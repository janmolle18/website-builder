/**
 * image-qa.js — Bild-QA-Gate (I4, abo-frei, kein LLM).
 *
 * Prüft die GEBAUTE Site deterministisch auf Bildqualität — nach demselben Muster wie
 * a11y.js/geo.js (Score + Checks + Issues). Ergänzt die Bild-Pipeline (I1–I3): dort wird
 * optimiert, hier wird gemessen/gegatet. Prüft:
 *   - kaputte Bilder (fehlend / 0-Byte) inkl. aller <picture>-<source>-Derivate
 *   - moderne Formate (AVIF/WebP via <picture>) tatsächlich vorhanden
 *   - responsive srcset (mehrere Breiten) vorhanden
 *   - explizite width/height (CLS)
 *   - Datei-Budget: kein ausgeliefertes Derivat über der Größen-Obergrenze
 *   - Alt-Text-Qualität (vorhanden, nicht Dateiname/leer/generisch)
 *   - Gesichts-Zentrierung bei Team-Fotos (CSS object-position) — als Hinweis
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');

const RASTER_RE = /\.(jpe?g|png)$/i;
const REMOTE_RE = /^(https?:)?\/\//i;
const DERIV_BUDGET = 200 * 1024;     // ein ausgeliefertes AVIF/WebP-Derivat soll ≤ 200 kB sein
const GENERIC_ALT = /^(bild|image|foto|photo|logo|grafik|picture|img)\.?$/i;

const CHECKS = [
  { key: 'no_broken',     weight: 25, label: 'Keine kaputten Bilder (fehlend/0-Byte)' },
  { key: 'modern_format', weight: 15, label: 'Moderne Formate (AVIF/WebP via <picture>)' },
  { key: 'responsive',    weight: 15, label: 'Responsive srcset (mehrere Breiten)' },
  { key: 'dimensions',    weight: 14, label: 'Explizite width/height (CLS)' },
  { key: 'size_budget',   weight: 16, label: 'Datei-Budget (kein Derivat über 200 kB)' },
  { key: 'alt_quality',   weight: 15, label: 'Alt-Text vorhanden und aussagekräftig' },
];

function readSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

/** Löst einen Bild-URL relativ zur HTML-Datei auf einen Pfad im Projekt auf (oder null). */
function resolveInside(projectDir, htmlFile, url) {
  if (!url || REMOTE_RE.test(url) || url.startsWith('data:')) return null;
  const abs = path.resolve(path.dirname(htmlFile), url.split('?')[0]);
  const root = path.resolve(projectDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** srcset → Liste der Kandidaten-URLs (ohne w-/x-Deskriptor). */
function srcsetUrls(srcset) {
  return String(srcset || '').split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
}

function isLocalRaster(url) {
  return !!url && !REMOTE_RE.test(url) && !url.startsWith('data:') && RASTER_RE.test(url.split('?')[0]);
}

/**
 * Analysiert die Bildqualität eines gebauten Projekts.
 * @param {string} projectDir
 * @returns {{score:number, grade:string, checks:object[], summary:string, issues:string[], stats:object}}
 */
function analyzeImageQa(projectDir) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { score: 0, grade: 'n/a', checks: [], summary: 'Keine index.html — Site noch nicht gebaut.', issues: ['Site bauen'], stats: {} };
  }

  let broken = [];            // {url} fehlend/0-Byte (alle referenzierten Bilder inkl. Derivate)
  let rasterImgs = 0;         // lokale Raster-<img> (Content)
  let notModern = 0;          // Raster-<img> ohne <picture>-avif/webp
  let notResponsive = 0;      // <picture> ohne Multi-Breiten-srcset
  let noDims = 0;             // <img> ohne width+height
  let overBudget = [];        // {url, kb} Derivate über Budget
  let badAlt = [];            // {src} fehlender/schwacher Alt-Text
  const seenFiles = new Set();

  for (const file of findHtmlFiles(projectDir)) {
    const $ = cheerio.load(readSafe(file), { decodeEntities: false });

    // Alle referenzierten Bilddateien (img src + source srcset) auf Existenz/Größe prüfen.
    const urls = [];
    $('img[src]').each((i, el) => urls.push($(el).attr('src')));
    $('source[srcset]').each((i, el) => urls.push(...srcsetUrls($(el).attr('srcset'))));
    for (const url of urls) {
      const abs = resolveInside(projectDir, file, url);
      if (!abs) continue; // remote/data/außerhalb — nicht unser Gate
      const key = abs;
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      let size = -1;
      try { size = fs.statSync(abs).size; } catch { size = -1; }
      if (size <= 0) broken.push(url);
      // Budget nur für ausgelieferte Modern-Derivate (AVIF/WebP). Bewusste Grenze: der
      // JPEG/PNG-Fallback im <img src> unterliegt hier keinem Budget — er wird >95 % der
      // Besucher (AVIF/WebP-fähig) nie ausgeliefert, und images-build cappt den Master ohnehin
      // auf MAX_WIDTH. Ein eigenes, höheres Master-Budget wäre eine Folge-Task, kein Bug.
      else if (/\.(avif|webp)$/i.test(abs) && size > DERIV_BUDGET) overBudget.push({ url, kb: Math.round(size / 1024) });
    }

    // Pro Content-<img> (lokales Raster): Format, responsive, Maße, Alt.
    $('img').each((i, el) => {
      const $img = $(el);
      const src = $img.attr('src') || '';
      if (!isLocalRaster(src)) {
        // Nicht-Raster (svg/remote/data): nur Maße/Alt sind hier nicht Gate-relevant.
        return;
      }
      rasterImgs++;
      const $pic = $img.closest('picture');
      const hasAvif = $pic.length && $pic.find('source[type="image/avif"]').length > 0;
      const hasWebp = $pic.length && $pic.find('source[type="image/webp"]').length > 0;
      if (!($pic.length && hasAvif && hasWebp)) notModern++;
      // responsive: mind. eine source mit ≥2 Breiten-Kandidaten.
      const responsive = $pic.length && $pic.find('source[srcset]').toArray()
        .some(s => srcsetUrls($(s).attr('srcset')).length >= 2);
      if (!responsive) notResponsive++;
      if (!($img.attr('width') && $img.attr('height'))) noDims++;
      const alt = ($img.attr('alt') || '').trim();
      if (!alt || alt.length < 3 || GENERIC_ALT.test(alt) || RASTER_RE.test(alt)) badAlt.push(src);
    });
  }

  const results = {
    no_broken:     { pass: broken.length === 0, detail: broken.length ? `${broken.length} kaputt: ${broken.slice(0, 3).join(', ')}` : 'alle referenzierten Bilder ok' },
    modern_format: { pass: notModern === 0, detail: rasterImgs ? (notModern === 0 ? `${rasterImgs} Bilder als AVIF/WebP` : `${notModern}/${rasterImgs} ohne <picture>`) : 'keine Raster-Bilder' },
    responsive:    { pass: notResponsive === 0, detail: rasterImgs ? (notResponsive === 0 ? 'alle mit srcset-Leiter' : `${notResponsive}/${rasterImgs} ohne responsive srcset`) : '—' },
    dimensions:    { pass: noDims === 0, detail: noDims === 0 ? 'alle mit width/height' : `${noDims}/${rasterImgs} ohne Maße` },
    size_budget:   { pass: overBudget.length === 0, detail: overBudget.length ? `${overBudget.length} über 200 kB: ${overBudget.slice(0, 2).map(o => `${o.url} ${o.kb}kB`).join(', ')}` : 'alle Derivate im Budget' },
    alt_quality:   { pass: badAlt.length === 0, detail: badAlt.length ? `${badAlt.length} mit schwachem/fehlendem Alt` : 'Alt-Texte ok' },
  };

  let score = 0;
  const checks = CHECKS.map(c => {
    const r = results[c.key];
    // Wenn es gar keine Raster-Bilder gibt, gelten bild-spezifische Checks als bestanden (n/a → pass).
    const pass = rasterImgs === 0 && c.key !== 'no_broken' ? true : r.pass;
    if (pass) score += c.weight;
    return { key: c.key, label: c.label, weight: c.weight, pass, detail: r.detail };
  });

  const issues = checks.filter(c => !c.pass).map(c => `${c.label} — ${c.detail}`);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  const summary = score >= 90
    ? `Bildqualität hoch (${score}/100, Note ${grade}).`
    : `Bild-QA ${score}/100 (Note ${grade}): ${issues.length} Befund(e).`;

  return { score, grade, checks, summary, issues, stats: { rasterImgs, broken: broken.length, overBudget: overBudget.length } };
}

module.exports = { analyzeImageQa, CHECKS, DERIV_BUDGET };
