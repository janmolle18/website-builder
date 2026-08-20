/**
 * a11y.js — Accessibility-Readiness-Report (abo-frei, kein LLM).
 *
 * Inspiziert eine gebaute Site (index.html) deterministisch auf die häufigsten,
 * maschinell prüfbaren Barrierefreiheits-Mängel. Doppelter Nutzen wie geo.js:
 *   1. QA-Signal beim Bauen (Score in project.a11y).
 *   2. Qualitätsargument — barrierearme Seiten ranken besser und wirken seriöser.
 *
 * Prüft NUR, was messbar im HTML steht (nichts halluziniert). Kontrast wird bewusst
 * NICHT geraten (bräuchte gerendertes CSS) — dafür ist der Vision-QA-Pass zuständig.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Gewichtete Checks — Summe = 100. Reihenfolge = Wichtigkeit.
const CHECKS = [
  { key: 'lang',        weight: 12, label: '<html lang> gesetzt' },
  { key: 'title',       weight: 10, label: 'Seitentitel (<title>) vorhanden' },
  { key: 'single_h1',   weight: 14, label: 'Genau eine <h1>' },
  { key: 'heading_order', weight: 14, label: 'Überschriften ohne Ebenen-Sprung (h1→h2→h3)' },
  { key: 'img_alt',     weight: 20, label: 'Alle Bilder mit alt-Attribut' },
  { key: 'links_named', weight: 12, label: 'Links haben erkennbaren Text/Label' },
  { key: 'buttons_named', weight: 8, label: 'Buttons haben erkennbaren Text/Label' },
  { key: 'labels',      weight: 6,  label: 'Formularfelder mit Label/aria-label' },
  { key: 'viewport',    weight: 4,  label: 'Responsive Viewport-Meta' }
];

function readSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/** Accessible Name eines Elements (Text, aria-label, title). */
function hasAccessibleName($, el) {
  const $el = $(el);
  const text = $el.text().replace(/\s+/g, ' ').trim();
  if (text) return true;
  if (($el.attr('aria-label') || '').trim()) return true;
  if (($el.attr('title') || '').trim()) return true;
  // Icon-only mit verlinktem Label / aria-labelledby zählt ebenfalls als benannt.
  if (($el.attr('aria-labelledby') || '').trim()) return true;
  // Bild mit alt im Link/Button liefert den Namen.
  if ($el.find('img[alt]').filter((i, im) => ($(im).attr('alt') || '').trim()).length) return true;
  return false;
}

/**
 * Analysiert die A11y-Reife eines gebauten Projekts.
 * @param {string} projectDir absoluter Pfad zum Projektordner
 * @returns {{score:number, grade:string, checks:{key,label,weight,pass,detail}[], summary:string, issues:string[]}}
 */
function analyzeA11y(projectDir) {
  const html = readSafe(path.join(projectDir, 'index.html'));
  if (!html) {
    return { score: 0, grade: 'n/a', checks: [], summary: 'Keine index.html — Site noch nicht gebaut.', issues: ['Site bauen'] };
  }
  const $ = cheerio.load(html, { decodeEntities: false });

  const lang = ($('html').attr('lang') || '').trim();
  const title = $('title').first().text().trim();
  const h1Count = $('h1').length;

  // Heading-Order: keine übersprungene Ebene (z. B. h2 → h4).
  const levels = $('h1,h2,h3,h4,h5,h6').map((i, el) => parseInt(el.tagName.slice(1), 10)).get();
  let headingOrderOk = true;
  let prev = 0;
  for (const lvl of levels) {
    if (prev && lvl > prev + 1) { headingOrderOk = false; break; }
    prev = lvl;
  }

  const imgs = $('img').toArray();
  const imgsWithoutAlt = imgs.filter(im => $(im).attr('alt') === undefined).length;

  const links = $('a[href]').toArray();
  const linksUnnamed = links.filter(a => !hasAccessibleName($, a)).length;

  const buttons = $('button, [role="button"], input[type="submit"], input[type="button"]').toArray();
  const buttonsUnnamed = buttons.filter(b => {
    const $b = $(b);
    if ($b.is('input')) return !(($b.attr('value') || '').trim() || ($b.attr('aria-label') || '').trim());
    return !hasAccessibleName($, b);
  }).length;

  // Formularfelder brauchen ein Label (via for/id, umschließend, oder aria-label).
  const fields = $('input:not([type="submit"]):not([type="button"]):not([type="hidden"]), select, textarea').toArray();
  const fieldsUnlabeled = fields.filter(f => {
    const $f = $(f);
    if (($f.attr('aria-label') || '').trim() || ($f.attr('aria-labelledby') || '').trim()) return false;
    const id = $f.attr('id');
    if (id && $(`label[for="${id}"]`).length) return false;
    if ($f.closest('label').length) return false;
    if (($f.attr('placeholder') || '').trim()) return false; // Placeholder als schwaches, aber vorhandenes Signal
    return true;
  }).length;

  const viewport = $('meta[name="viewport"]').length > 0;

  const results = {
    lang:          { pass: !!lang, detail: lang ? `lang="${lang}"` : 'fehlt' },
    title:         { pass: !!title, detail: title ? `"${title.slice(0, 40)}"` : 'fehlt' },
    single_h1:     { pass: h1Count === 1, detail: `${h1Count} <h1>` },
    heading_order: { pass: headingOrderOk, detail: headingOrderOk ? 'ok' : 'Ebenen-Sprung gefunden' },
    img_alt:       { pass: imgsWithoutAlt === 0, detail: imgsWithoutAlt === 0 ? `${imgs.length} Bilder, alle mit alt` : `${imgsWithoutAlt}/${imgs.length} ohne alt` },
    links_named:   { pass: linksUnnamed === 0, detail: linksUnnamed === 0 ? `${links.length} Links benannt` : `${linksUnnamed} Links ohne Text/Label` },
    buttons_named: { pass: buttonsUnnamed === 0, detail: buttonsUnnamed === 0 ? `${buttons.length} Buttons benannt` : `${buttonsUnnamed} Buttons ohne Label` },
    labels:        { pass: fieldsUnlabeled === 0, detail: fieldsUnlabeled === 0 ? `${fields.length} Felder gelabelt` : `${fieldsUnlabeled} Felder ohne Label` },
    viewport:      { pass: viewport, detail: viewport ? 'vorhanden' : 'fehlt' }
  };

  let score = 0;
  const checks = CHECKS.map(c => {
    const r = results[c.key] || { pass: false, detail: '' };
    if (r.pass) score += c.weight;
    return { key: c.key, label: c.label, weight: c.weight, pass: r.pass, detail: r.detail };
  });

  const issues = checks.filter(c => !c.pass).map(c => `${c.label} — ${c.detail}`);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  const summary = score >= 90
    ? `Barrierearm (${score}/100, Note ${grade}).`
    : `A11y-Score ${score}/100 (Note ${grade}): ${issues.length} maschinell prüfbare(r) Mangel/Mängel.`;

  return { score, grade, checks, summary, issues };
}

module.exports = { analyzeA11y, CHECKS };
