/**
 * images-build.js — Bild-Pipeline (I1 + I2): JPEG/PNG → responsive AVIF/WebP + <picture>.
 *
 * WARUM: Der Generator liefert Fotos als JPEG in voller Scrape-Auflösung. Das ist der
 * größte einzelne Byte-Posten jeder Seite und drückt LCP/Mobilgewicht. Dieses Modul
 * erzeugt aus jedem referenzierten Raster-Bild eine **responsive Leiter** moderner,
 * deutlich kleinerer AVIF- und WebP-Derivate (mehrere Breiten) und ersetzt das nackte
 * <img> durch ein <picture> mit `srcset`/`sizes` + Format-Fallback. Der Browser lädt so
 * genau die Auflösung, die er wirklich anzeigt (auf dem Handy ~480–768px statt 1740px).
 *
 * I2-Zusatz: explizite `width`/`height` aus den **echten Dateimaßen** (EXIF-orientiert) am
 * Fallback-<img> — reserviert den Platz korrekt und verhindert Layout-Shift durch Bilder.
 * (Die Rest-CLS der generierten Seiten stammt aus dem Font-Swap des Hero-Texts, nicht aus
 * Bildern — das ist Sache der Ladestrategie/I3, nicht dieses Moduls.)
 *
 * SICHERHEIT FÜRS KERN-ASSET (wie css-build/fonts-build): Erst werden alle Derivate
 * erzeugt; erst für Bilder, deren Konvertierung geklappt hat, wird das HTML angefasst.
 * Schlägt ein Bild fehl (korrupt, unlesbar), bleibt genau dessen <img> unverändert stehen
 * — der Rest wird trotzdem optimiert, der Build läuft weiter. Das Original-JPEG/PNG bleibt
 * immer als Master erhalten (Fallback-src im <img>).
 *
 * IDEMPOTENT: Ein <img>, das bereits in einem <picture> steckt, wird übersprungen; ein
 * zweiter Lauf ändert nichts. ABO-FREI: reine sharp-Konvertierung + HTML-Rewrite, kein LLM.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');

/** Obergrenze der Bildbreite — größere Scrape-Bilder werden herunterskaliert, nie hoch. */
const MAX_WIDTH = 1920;
/** Responsive Breiten-Leiter (aufsteigend, ≤ MAX_WIDTH). Pro Bild auf die native Breite gedeckelt. */
const DERIVATIVE_WIDTHS = [480, 768, 1200, 1920];
/**
 * Konservativer sizes-Default (Layout-agnostisch). Mit `w`-Deskriptoren ist eine leichte
 * Überschätzung ungefährlich (schlimmstenfalls minimal größerer Download, nie unscharf).
 */
const DEFAULT_SIZES = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw';

const RASTER_RE = /\.(jpe?g|png)$/i;
const REMOTE_RE = /^(https?:)?\/\//i;
const AVIF_OPTS = { quality: 55, effort: 4 };
const WEBP_OPTS = { quality: 72 };

/** Nur lokale JPEG/PNG dürfen konvertiert werden (kein SVG/GIF/remote/data-URI). */
function isConvertibleSrc(src) {
  if (!src) return false;
  if (REMOTE_RE.test(src)) return false;
  if (src.startsWith('data:')) return false;
  return RASTER_RE.test(src.split('?')[0]);
}

/** Trennt einen evtl. Query-String (`?v=2`) ab. */
function splitQuery(src) {
  const q = src.indexOf('?');
  return q === -1 ? [src, ''] : [src.slice(0, q), src.slice(q)];
}

/**
 * src → relativer Derivat-Verweis mit Breite + Endung (behält Prefix + Query).
 * Leerzeichen und Kommas werden prozent-kodiert: das Komma ist das Kandidaten-Trennzeichen
 * der `srcset`-Grammatik, ein roher Datei-Komma würde die Liste zerbrechen. (Aktuelle
 * Generator-Dateinamen sind Slugs ohne solche Zeichen — reine Härtung für fremde Quellen.)
 */
function derivRef(src, width, ext) {
  const [p, q] = splitQuery(src);
  const ref = `${p.replace(RASTER_RE, '')}-${width}${ext}${q}`;
  return ref.replace(/ /g, '%20').replace(/,/g, '%2C');
}

/** masterPath → physischer Derivat-Pfad mit Breite + Endung. */
function derivFile(masterPath, width, ext) {
  return `${masterPath.replace(RASTER_RE, '')}-${width}${ext}`;
}

/**
 * Löst den <img>-src auf einen physischen Pfad INNERHALB des Projekts auf.
 * Gibt null zurück, wenn die Datei außerhalb liegt (Path-Traversal-Schutz) oder fehlt.
 */
function resolveInside(projectDir, htmlFile, src) {
  const abs = path.resolve(path.dirname(htmlFile), splitQuery(src)[0]);
  const root = path.resolve(projectDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // Traversal raus
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

/** Angezeigte (EXIF-orientierte) Maße: bei 90°-Orientierungen sind Breite/Höhe getauscht. */
function orientedDims(meta) {
  const swap = meta.orientation && meta.orientation >= 5;
  return { w: swap ? meta.height : meta.width, h: swap ? meta.width : meta.height };
}

/**
 * Erzeugt die responsive AVIF/WebP-Leiter neben dem Master (idempotent). Wirft NICHT —
 * bei Fehler werden die in DIESEM Lauf angefangenen Derivate entfernt (bereits gültige
 * aus früheren Läufen bleiben) und { ok:false } zurückgegeben.
 * @returns {Promise<{ok:boolean, widths?:number[], displayW?:number, displayH?:number, saved?:number}>}
 */
async function convertOne(masterPath) {
  const srcMtime = fs.statSync(masterPath).mtimeMs;
  const fresh = (p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= srcMtime;
  const written = [];
  try {
    const meta = await sharp(masterPath).metadata(); // wirft bei korruptem Bild
    const { w: ow, h: oh } = orientedDims(meta);
    if (!ow || !oh) throw new Error('keine Bildmaße lesbar');

    const cap = Math.min(ow, MAX_WIDTH);
    const widths = [...new Set([...DERIVATIVE_WIDTHS.filter(w => w < cap), cap])].sort((a, b) => a - b);

    for (const w of widths) {
      const avifOut = derivFile(masterPath, w, '.avif');
      const webpOut = derivFile(masterPath, w, '.webp');
      if (!(fresh(avifOut) && fresh(webpOut))) {
        await sharp(masterPath).rotate().resize({ width: w, withoutEnlargement: true }).avif(AVIF_OPTS).toFile(avifOut);
        written.push(avifOut);
        await sharp(masterPath).rotate().resize({ width: w, withoutEnlargement: true }).webp(WEBP_OPTS).toFile(webpOut);
        written.push(webpOut);
      }
    }

    const master = fs.statSync(masterPath).size;
    const largestAvif = fs.statSync(derivFile(masterPath, cap, '.avif')).size;
    return {
      ok: true, widths,
      displayW: cap,
      displayH: Math.round(cap * oh / ow),
      saved: Math.max(0, master - largestAvif),
    };
  } catch (e) {
    for (const p of written) { try { fs.rmSync(p, { force: true }); } catch { /* Best-Effort-Aufräumen — Fehler hier bewusst ignorieren */ } }
    console.warn(`⚠️ Bild-Konvertierung übersprungen (${path.basename(masterPath)}): ${e.message}`);
    return { ok: false };
  }
}

/**
 * Optimiert alle referenzierten Raster-Bilder eines Projekts (responsive AVIF/WebP + <picture>).
 * @param {string} projectDir absoluter Pfad zum Projektordner (enthält index.html)
 * @returns {Promise<{built:boolean, skipped?:boolean, reason?:string, images?:number, files?:number, savedBytes?:number}>}
 */
async function buildImages(projectDir) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { built: false, skipped: true, reason: 'kein index.html' };
  }

  const htmlFiles = findHtmlFiles(projectDir);

  // 1) Alle konvertierbaren <img> einsammeln (die noch NICHT in einem <picture> stecken).
  //    masterPath dedupliziert (mehrere Seiten teilen sich dieselbe Datei).
  const targets = new Map(); // masterPath -> Ergebnis von convertOne
  const perFile = new Map(); // htmlFile -> [{ src, masterPath }]
  for (const file of htmlFiles) {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'), { decodeEntities: false });
    const hits = [];
    $('img').each((i, el) => {
      // Bereits gewrappt → überspringen. ANNAHME: Der volle `generate` erzeugt das HTML
      // frisch (plain <img>), also läuft die Pipeline pro Build von vorn. Würde ein Master
      // unter gleichem Namen ersetzt, OHNE dass das HTML neu gebaut wird (heute kein Flow),
      // blieben alte Derivate/Maße stehen. Falls das
      // je nötig wird: hier zusätzlich Master-mtime vs. Derivat-mtime prüfen und neu wrappen.
      if ($(el).parent().is('picture')) return;
      const src = $(el).attr('src');
      if (!isConvertibleSrc(src)) return;
      const master = resolveInside(projectDir, file, src);
      if (!master) return;
      hits.push({ src, masterPath: master });
      if (!targets.has(master)) targets.set(master, null);
    });
    if (hits.length) perFile.set(file, hits);
  }

  if (!targets.size) return { built: false, skipped: true, reason: 'keine konvertierbaren Bilder' };

  // 2) Derivate erzeugen — VOR jeder HTML-Änderung. Fehlschläge markieren, nicht abbrechen.
  let savedBytes = 0;
  for (const master of targets.keys()) {
    const res = await convertOne(master);
    targets.set(master, res);
    if (res.ok) savedBytes += res.saved || 0;
  }

  // 3) HTML umschreiben — nur für Bilder, deren Konvertierung geklappt hat.
  let images = 0;
  let filesChanged = 0;
  for (const [file, hits] of perFile) {
    const ok = hits.filter(h => targets.get(h.masterPath)?.ok);
    if (!ok.length) continue;
    const okSrcs = new Set(ok.map(h => h.src));
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'), { decodeEntities: false });
    let changed = 0;
    $('img').each((i, el) => {
      if ($(el).parent().is('picture')) return;
      const src = $(el).attr('src');
      if (!okSrcs.has(src)) return;
      const t = targets.get(resolveInside(projectDir, file, src));
      if (!t || !t.ok) return;

      const avifSet = t.widths.map(w => `${derivRef(src, w, '.avif')} ${w}w`).join(', ');
      const webpSet = t.widths.map(w => `${derivRef(src, w, '.webp')} ${w}w`).join(', ');
      const $pic = cheerio.load('<picture></picture>', { decodeEntities: false })('picture');
      $(el).before($pic);
      $pic.append(`<source type="image/avif" srcset="${avifSet}" sizes="${DEFAULT_SIZES}">`);
      $pic.append(`<source type="image/webp" srcset="${webpSet}" sizes="${DEFAULT_SIZES}">`);
      // Explizite, echte Maße (verhindert Layout-Shift; korrigiert falsche Generator-Werte).
      $(el).attr('width', String(t.displayW));
      $(el).attr('height', String(t.displayH));
      $pic.append($(el)); // verschiebt das <img> (mit allen Attributen) ins <picture>
      changed++;
    });
    if (changed) {
      fs.writeFileSync(file, $.html());
      images += changed;
      filesChanged++;
    }
  }

  if (!images) return { built: false, skipped: true, reason: 'keine Bilder konvertierbar (alle fehlgeschlagen)' };
  return { built: true, images, files: filesChanged, savedBytes };
}

module.exports = { buildImages, isConvertibleSrc, MAX_WIDTH, DERIVATIVE_WIDTHS };
