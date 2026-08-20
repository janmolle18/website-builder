/**
 * weak-images.js — Erkennung schwacher (niedrig aufgelöster) Scrape-Fotos (I5a, abo-frei, kein LLM).
 *
 * WARUM: Von fremden Sites gescrapte Fotos sind oft nur Thumbnails. Auf einer premium Kanzlei-
 * Site (Hero/Team großflächig, Retina-Displays) wirken sie unscharf — der sichtbarste Qualitäts-
 * mangel. Die Bild-Pipeline (I1/I2) skaliert bewusst NUR herunter, nie hoch; ein zu kleines Master
 * bleibt also zu klein. Dieses Modul misst die **intrinsische** Pixel-Auflösung jedes Master-Fotos
 * (synchron aus dem Datei-Header, ohne neue Dependency) und flaggt rollenbewusst zu schwache Bilder
 * für den Report — ehrlich: es erkennt/kennzeichnet, es zaubert nicht (Upscaling = separater Schritt).
 *
 * Rollenbewusst + false-positive-arm: bewusst kleine Thumbnails/Avatare (width-Attribut ≤ 200,
 * class avatar/logo/icon) werden ausgenommen; Hero-Bilder brauchen mehr Auflösung als Inline-Content.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');

const RASTER_RE = /\.(jpe?g|png)$/i;
const REMOTE_RE = /^(https?:)?\/\//i;

// An die Derivat-Leiter [480,768,1200,1920] aus images-build angelehnt: ein Content-Bild sollte
// mindestens die zweite Stufe (768) füllen können; ein großflächiges Hero die vierte (≥1200).
const THRESHOLDS = {
  content: { veryWeak: 480, weak: 768 },
  hero:    { veryWeak: 768, weak: 1200 },
};
const THUMB_MAX_ATTR = 200;                    // width-Attribut ≤ 200 → bewusst klein → ausnehmen
const EXEMPT_CLASS = /\b(avatar|logo|icon|thumb|thumbnail)\b/i;
const EXEMPT_SRC = /\b(logo|icon|favicon|sprite)\b/i; // Wortgrenzen: "iconic"/"logotype-foto" bleiben Fotos
const HERO_CLASS = /^(hero|banner|masthead)(-|$)/i;

const CHECKS = [
  { key: 'no_very_weak', weight: 60, label: 'Keine sehr niedrig aufgelösten Fotos (Content < 480px, Hero < 768px)' },
  { key: 'no_weak',      weight: 40, label: 'Keine grenzwertig aufgelösten Fotos (Content < 768px, Hero < 1200px)' },
];

function readSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

/** Löst einen Bild-URL relativ zur HTML-Datei auf einen Pfad im Projekt auf (oder null). */
function resolveInside(projectDir, htmlFile, url) {
  if (!url || REMOTE_RE.test(url) || url.startsWith('data:')) return null;
  const abs = path.resolve(path.dirname(htmlFile), url.split('?')[0]);
  const root = path.resolve(projectDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try { if (!fs.statSync(abs).isFile()) return null; } catch { return null; }
  return abs;
}

/** PNG: Breite/Höhe aus dem IHDR-Chunk (Big-Endian). orientation immer 1. */
function readPngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), orientation: 1 };
}

/** EXIF-Orientierung (Tag 0x0112) aus einem APP1-Segment; 1 wenn nicht ermittelbar. */
function parseExifOrientation(seg) {
  try {
    if (seg.length < 14 || seg.toString('ascii', 0, 4) !== 'Exif') return 1;
    const tiff = 6; // nach "Exif\0\0"
    const le = seg.toString('ascii', tiff, tiff + 2) === 'II';
    const u16 = (o) => le ? seg.readUInt16LE(o) : seg.readUInt16BE(o);
    const u32 = (o) => le ? seg.readUInt32LE(o) : seg.readUInt32BE(o);
    const ifd0 = tiff + u32(tiff + 4);
    const count = u16(ifd0);
    for (let i = 0; i < count; i++) {
      const e = ifd0 + 2 + i * 12;
      if (e + 12 > seg.length) break;
      if (u16(e) === 0x0112) return u16(e + 8) || 1;
    }
  } catch { /* fällt auf 1 zurück */ }
  return 1;
}

/** JPEG: Breite/Höhe aus dem SOF-Marker + Orientierung aus APP1. Header-only, synchron. */
function readJpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xFF) { offset++; continue; }
    const marker = buf[offset + 1];
    offset += 2;
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue; // ohne Länge
    if (offset + 2 > buf.length) break;
    const len = buf.readUInt16BE(offset);
    if (len < 2) break;
    if (marker === 0xE1) { // APP1 (EXIF)
      orientation = parseExifOrientation(buf.slice(offset + 2, offset + len));
    }
    // SOF0..SOF15 außer DHT(C4)/JPG(C8)/DAC(CC): enthält Bildmaße
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (offset + 7 <= buf.length) {
        return { height: buf.readUInt16BE(offset + 3), width: buf.readUInt16BE(offset + 5), orientation };
      }
      return null;
    }
    offset += len;
  }
  return null;
}

/** Intrinsische, EXIF-orientierte Anzeige-Maße eines Master-Bildes (oder null bei unlesbar). */
function intrinsicDims(absPath) {
  let buf;
  try { buf = fs.readFileSync(absPath); } catch { return null; }
  const size = /\.png$/i.test(absPath) ? readPngSize(buf) : readJpegSize(buf);
  if (!size || !size.width || !size.height) return null;
  const swap = size.orientation && size.orientation >= 5; // 90°-Drehung → Breite/Höhe getauscht
  return { width: swap ? size.height : size.width, height: swap ? size.width : size.height };
}

function attr($el, name) { return ($el.attr(name) || '').trim(); }

/** Ist dieses <img> ein Hero (großflächig)? Über echte Marker + Klassen-Token. */
function isHeroImg($el) {
  if ($el.is('[data-hero-photo], [data-hero-img]')) return true;
  const cls = attr($el, 'class');
  return cls.split(/\s+/).some(t => HERO_CLASS.test(t));
}

/** Bewusst klein / kein Foto → aus der Bewertung nehmen. */
function isExempt($el, src) {
  const w = parseInt(attr($el, 'width'), 10);
  if (Number.isFinite(w) && w > 0 && w <= THUMB_MAX_ATTR) return true;
  if (EXEMPT_CLASS.test(attr($el, 'class'))) return true;
  if (EXEMPT_SRC.test(src)) return true;
  return false;
}

function classify(width, isHero) {
  const bar = isHero ? THRESHOLDS.hero : THRESHOLDS.content;
  if (width < bar.veryWeak) return 'very-weak';
  if (width < bar.weak) return 'weak';
  return 'ok';
}

/**
 * Analysiert die Foto-Auflösung einer gebauten Site und flaggt zu schwache Master-Fotos.
 * @param {string} projectDir
 * @returns {{score:number, grade:string, checks:object[], summary:string, issues:string[], images:object[], stats:object}}
 */
function analyzeWeakImages(projectDir) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { score: 0, grade: 'n/a', checks: [], summary: 'Keine index.html — Site noch nicht gebaut.', issues: ['Site bauen'], images: [], stats: {} };
  }

  const seen = new Set();
  const images = [];
  let weak = 0, veryWeak = 0, exempt = 0, unreadable = 0, assessed = 0;

  for (const file of findHtmlFiles(projectDir)) {
    const $ = cheerio.load(readSafe(file), { decodeEntities: false });
    $('img[src]').each((i, el) => {
      const $el = $(el);
      const src = attr($el, 'src');
      if (!RASTER_RE.test(src.split('?')[0])) return;       // nur JPEG/PNG-Master
      const abs = resolveInside(projectDir, file, src);
      if (!abs) return;                                      // remote/data/außerhalb/fehlt
      if (seen.has(abs)) return;
      seen.add(abs);

      if (isExempt($el, src)) { exempt++; images.push({ src, level: 'exempt' }); return; }

      const dims = intrinsicDims(abs);
      if (!dims) { unreadable++; images.push({ src, level: 'unreadable' }); return; }

      const hero = isHeroImg($el);
      const level = classify(dims.width, hero);
      assessed++;
      if (level === 'very-weak') veryWeak++;
      else if (level === 'weak') weak++;
      images.push({ src, width: dims.width, height: dims.height, role: hero ? 'hero' : 'content', level });
    });
  }

  const results = {
    no_very_weak: { pass: veryWeak === 0, detail: veryWeak ? `${veryWeak} Foto(s) deutlich zu klein` : 'keine sehr schwachen Fotos' },
    no_weak:      { pass: weak === 0,     detail: weak ? `${weak} Foto(s) grenzwertig` : 'keine grenzwertigen Fotos' },
  };

  let score = 0;
  const checks = CHECKS.map(c => {
    const pass = assessed === 0 ? true : results[c.key].pass; // keine bewertbaren Fotos → n/a → pass
    if (pass) score += c.weight;
    return { key: c.key, label: c.label, weight: c.weight, pass, detail: results[c.key].detail };
  });

  const flaggable = images.filter(im => im.level === 'very-weak' || im.level === 'weak');
  const issues = flaggable.map(im => `${im.role === 'hero' ? 'Hero' : 'Foto'} zu niedrig aufgelöst: ${im.src} (${im.width}px breit, ${im.level === 'very-weak' ? 'deutlich' : 'knapp'} unter Zielauflösung)`);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  const summary = flaggable.length === 0
    ? `Foto-Auflösung ausreichend (${assessed} bewertet, ${exempt} Thumbnails ausgenommen).`
    : `${flaggable.length} schwache(s) Foto(s) erkannt (${veryWeak} sehr, ${weak} grenzwertig) — Upscaling/Ersatz empfohlen.`;

  return { score, grade, checks, summary, issues, images, stats: { assessed, weak, veryWeak, exempt, unreadable } };
}

module.exports = { analyzeWeakImages, THRESHOLDS, CHECKS, intrinsicDims };
