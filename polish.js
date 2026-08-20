/**
 * polish.js — Deterministische Auslieferungs-Politur (idempotent, token-frei).
 *
 * Behebt querschnittliche A11y/Performance-Details, die weder vom LLM-Generator
 * noch von der SEO-Schicht garantiert werden — auf JEDER Seite (Start + Unterseiten):
 *   - favicon (Inline-SVG-Monogramm aus Markenfarben) → kein 404 mehr
 *   - Skip-Link + Haupt-Landmark (#hauptinhalt) für Tastatur/Screenreader
 *   - <nav> ohne aria-label nachrüsten
 *   - Hero-Hintergrundbild preloaden (LCP-Element bei CSS-Heroes)
 *   - <img> ohne Maße: width/height ergänzen (lokale Dateien exakt gemessen,
 *     sonst aus aspect-Klasse abgeleitet) → verhindert Layout-Shift (CLS)
 *   - CTA-Band-Button: lesbare Textfarbe erzwingen (kein Weiß-auf-Weiß)
 *
 * Wird vom Server-Build angewandt. Mehrfach-Aufrufe sind
 * unschädlich (alle Schritte prüfen erst, ob bereits vorhanden).
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ── Farb-Helfer (WCAG-Luminanz) ──────────────────────────────────────────────────

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative Luminanz nach WCAG (0 = schwarz, 1 = weiß). */
function relLum(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dunkelste „Tinten"-Farbe aus der Palette (für Text auf hellem Grund). */
function darkInk(palette) {
  const hexes = Object.values(palette || {})
    .filter(v => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v));
  const dark = hexes.map(h => [h, relLum(h)]).filter(x => x[1] < 0.25).sort((a, b) => a[1] - b[1]);
  return dark.length ? dark[0][0] : '#16202B';
}

// ── Bildmaße lokal lesen (JPEG/PNG, ohne Dependency) ──────────────────────────────

function readImageSize(file) {
  try {
    const buf = fs.readFileSync(file);
    // PNG: Maße stehen in der IHDR-Chunk (Offset 16/20).
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: SOFn-Marker durchlaufen.
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let o = 2;
      while (o < buf.length - 1) {
        if (buf[o] !== 0xFF) { o++; continue; }
        let marker = buf[o + 1];
        while (marker === 0xFF && o + 1 < buf.length) { o++; marker = buf[o + 1]; }
        if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
          o += 2; continue; // Marker ohne Längenfeld
        }
        const len = buf.readUInt16BE(o + 2);
        const isSOF = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
        if (isSOF) return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
        o += 2 + len;
      }
    }
  } catch { /* nicht lesbar → null */ }
  return null;
}

/**
 * Findet das Hero-<img> nach DERSELBEN Präzedenz wie assets.applyHeroPhoto:
 * 1. Der definitive Marker `[data-hero-photo]` (von applyHeroPhoto gesetzt), sonst
 * 2. der Generator-Marker `[data-hero-img]`, jeweils als <img> oder <img> darin, sonst
 * 3. konservativer Klassen-Fallback: token-verankert (`hero`/`banner`/`masthead` als
 *    ganzes Klassen-Token oder Prefix), damit Utility-Klassen wie `object-cover`/`bg-cover`
 *    NICHT fälschlich matchen. Kein „erstes <img>"-Fallback — das wäre auf Text-Hero-Seiten
 *    ein below-the-fold-Bild und würde fälschlich priorisiert.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {any|null} das Hero-<img>-Element oder null
 */
function findHeroImg($) {
  for (const sel of ['img[data-hero-photo]', 'img[data-hero-img]']) {
    const el = $(sel).first();
    if (el.length) return el[0];
  }
  const host = $('[data-hero-photo], [data-hero-img], [data-hero]').first();
  if (host.length) {
    const inner = host.find('img').first();
    if (inner.length) return inner[0];
  }
  const TOKEN = /^(hero|banner|masthead)(-|$)/i;
  const hit = (cls) => (cls || '').split(/\s+/).some(t => TOKEN.test(t));
  let hero = null;
  $('img').each((i, el) => {
    if (hero) return;
    const $i = $(el);
    if (hit($i.attr('class')) || $i.parents().toArray().some(p => hit($(p).attr('class')))) hero = el;
  });
  return hero;
}

/** Seitenverhältnis aus Tailwind-Klassen (aspect-[4/3], aspect-square, aspect-video). */
function ratioFromClass(cls = '') {
  if (/\baspect-square\b/.test(cls)) return 1;
  if (/\baspect-video\b/.test(cls)) return 16 / 9;
  const m = cls.match(/aspect-\[(\d+)\/(\d+)\]/);
  if (m) return Number(m[1]) / Number(m[2]);
  return null;
}

// ── Politur-Pass ──────────────────────────────────────────────────────────────────

/**
 * @param {string} html  Vollständiges HTML-Dokument.
 * @param {{ project?:object, dna?:object, projectDir?:string }} ctx
 * @returns {{ html:string, steps:string[] }}
 */
function applyPolish(html, ctx = {}) {
  const { project = {}, dna = {}, projectDir } = ctx;
  const palette = (dna && dna.palette) || {};
  const accent = palette.accent || '#C9A24B';
  const ink = darkInk(palette);
  const steps = [];

  const $ = cheerio.load(html, { decodeEntities: false });
  let head = $('head');
  if (!head.length) { $('html').prepend('<head></head>'); head = $('head'); }
  const body = $('body');

  // 1) favicon — Inline-SVG-Monogramm, falls keins gesetzt ist.
  if (!$('link[rel~="icon"], link[rel="shortcut icon"]').length) {
    const letter = (String(project.name || 'W').trim().charAt(0) || 'W').toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>`
      + `<rect width='64' height='64' rx='12' fill='${ink}'/>`
      + `<text x='32' y='45' font-family='Georgia,serif' font-size='38' font-weight='600' text-anchor='middle' fill='${accent}'>${letter}</text></svg>`;
    head.append(`<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`);
    steps.push('favicon');
  }

  // 2) <nav> ohne aria-label nachrüsten.
  $('nav').each((i, el) => {
    const $n = $(el);
    if (!$n.attr('aria-label') && !$n.attr('aria-labelledby')) {
      $n.attr('aria-label', 'Hauptnavigation');
      if (!steps.includes('nav-aria')) steps.push('nav-aria');
    }
  });

  // 3) Skip-Link + Haupt-Landmark.
  if (body.length && !$('a.skip-link').length) {
    let target = $('main').first();
    if (!target.length) target = body.children('section').first();
    let id = target.attr('id');
    if (target.length && !id) { id = 'hauptinhalt'; target.attr('id', id); }
    if (id) {
      body.prepend(`<a class="skip-link" href="#${id}">Zum Inhalt springen</a>`);
      if (!$('#polish-a11y').length) {
        head.append(`<style id="polish-a11y">.skip-link{position:absolute;left:-9999px;top:0;z-index:1000;`
          + `background:${ink};color:#fff;padding:.7rem 1.1rem;border-radius:0 0 8px 0;text-decoration:none;font:600 .9rem/1 system-ui,sans-serif}`
          + `.skip-link:focus{left:0}</style>`);
      }
      steps.push('skip-link');
    }
  }

  // 4) Hero-Hintergrundbild preloaden (LCP).
  let heroUrl = null;
  $('style').each((i, el) => {
    if (heroUrl) return;
    const css = $(el).text();
    const m = css.match(/\.hero-bg[^}]*background-image:\s*url\((['"]?)([^'")]+)\1/i);
    if (m) heroUrl = m[2];
  });
  if (!heroUrl) {
    const ds = $('[data-hero-img]').attr('style') || '';
    const m = ds.match(/url\((['"]?)([^'")]+)\1/i);
    if (m) heroUrl = m[2];
  }
  if (heroUrl && !$(`link[rel="preload"][href="${heroUrl}"]`).length) {
    const anchor = head.find('meta[name="viewport"]').first();
    const tag = `<link rel="preload" as="image" href="${heroUrl}" fetchpriority="high">`;
    if (anchor.length) anchor.after('\n' + tag); else head.prepend(tag);
    steps.push('hero-preload');
  }

  // 5) Bildmaße ergänzen (CLS) — nur wenn weder width noch height gesetzt.
  let dimsAdded = 0;
  $('img').each((i, el) => {
    const $img = $(el);
    if ($img.attr('width') || $img.attr('height')) return;
    const src = $img.attr('src') || '';
    let size = null;
    const isRemote = /^https?:\/\//i.test(src) || src.startsWith('//') || src.startsWith('data:');
    if (!isRemote && projectDir && src) {
      size = readImageSize(path.join(projectDir, src.replace(/^\.?\//, '')));
    }
    if (!size) {
      const ratio = ratioFromClass($img.attr('class') || '');
      if (ratio) size = { width: 1200, height: Math.round(1200 / ratio) };
    }
    if (size && size.width && size.height) {
      $img.attr('width', String(size.width));
      $img.attr('height', String(size.height));
      dimsAdded++;
    }
  });
  if (dimsAdded) steps.push(`img-dims:${dimsAdded}`);

  // 5b) Ladestrategie (I3) — deterministisch, kein LLM: Hero-<img> eager + priorisiert,
  //     Above-Fold-Logos (header/nav) eager, alle übrigen Content-Bilder lazy. Ersetzt
  //     das lückenhafte LLM-„loading" durch eine Garantie. KEIN preload-<link> fürs
  //     Hero-<img>: images-build wrappt es später in ein AVIF-<picture> — ein preload aufs
  //     JPEG würde einen Doppel-Download auslösen. (CSS-bg-Heroes: preload siehe Schritt 4.)
  const heroImg = findHeroImg($);
  let loadingSet = 0;
  $('img').each((i, el) => {
    const $i = $(el);
    if (el === heroImg) {
      if ($i.attr('loading') !== 'eager') { $i.attr('loading', 'eager'); loadingSet++; }
      if (!$i.attr('fetchpriority')) $i.attr('fetchpriority', 'high');
      return;
    }
    const aboveFold = $i.closest('header, nav').length > 0;
    if (aboveFold) {
      if (!$i.attr('loading')) { $i.attr('loading', 'eager'); loadingSet++; }
      return;
    }
    if (!$i.attr('loading')) { $i.attr('loading', 'lazy'); loadingSet++; }
  });
  if (loadingSet) steps.push(`loading:${loadingSet}`);

  // 6) CTA-Band-Button: lesbare Textfarbe auf weißem Grund erzwingen.
  $('[data-block="cta-band"] a').each((i, el) => {
    const $a = $(el);
    let st = $a.attr('style') || '';
    if (/background:\s*#fff\b/i.test(st)) {
      st = /color:/i.test(st) ? st.replace(/color:\s*[^;]+/i, `color:${ink}`) : `${st};color:${ink}`;
      $a.attr('style', st);
      if (!steps.includes('cta-contrast')) steps.push('cta-contrast');
    }
  });
  // CTA-Überschrift: kleingeschriebene Kategorie nach „Jetzt " groß.
  $('[data-block="cta-band"] h2').each((i, el) => {
    const $h = $(el);
    const t = $h.text();
    const fixed = t.replace(/^(\s*Jetzt\s+)(\p{Ll})/u, (m, p1, p2) => p1 + p2.toUpperCase());
    if (fixed !== t) { $h.text(fixed); if (!steps.includes('cta-label')) steps.push('cta-label'); }
  });

  return { html: $.html(), steps };
}

module.exports = { applyPolish, readImageSize, darkInk, relLum, findHeroImg };
