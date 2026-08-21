/**
 * scraper/extractors.js — Low-Level-Extraktion aus HTML.
 *
 * Enthält alles, was aus rohem HTML (bzw. einem geladenen cheerio-Dokument)
 * einzelne Daten zieht, ohne Wissen über den Scrape-Ablauf:
 *   - Seiten laden: fetchHtml, fetchLegalText, fetchRendered (echter Browser)
 *   - Text: htmlToReadableText / extractReadableText (Chrome-Entfernung)
 *   - Rohprofil: extractRaw + isThin/richness (statisch vs. gerendert)
 *   - Einzelfelder: Telefon, E-Mail, Adresse, Öffnungszeiten, Bilder, Menü, Social
 *   - Kleine Helfer: menuItemCount, parseJsonLoose
 *
 * Importiert nur cheerio + site-inventory (fetchPage) — nie die Fassade
 * agent-scraper.js, damit keine Zyklen entstehen.
 */

const cheerio = require('cheerio');
const { fetchPage } = require('../site-inventory');

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

/** HTML einer Seite charset-korrekt laden (oder null). Kleiner Helfer für den Inventar-Pfad. */
async function fetchHtml(url) {
  try {
    return (await fetchPage(url)).html;
  } catch { return null; }
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
    .replace(/[ \t\u00A0]+/g, ' ')
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
  const { launchBrowser } = require('../browser');
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

// ── Extraktions-Hilfsfunktionen ───────────────────────────────────────────────

function extractPhone($, html) {
  // tel: Links
  const telLink = $('a[href^="tel:"]').first().attr('href');
  if (telLink) return telLink.replace('tel:', '').trim();
  // Regex in HTML
  const match = html.match(/(\+49|0\d{2,5})[\s\-/]?\d{3,5}[\s\-/]?\d{3,8}/);
  return match ? match[0].trim() : '';
}

function extractEmail(html) {
  const match = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : '';
}

function extractAddress($, html) {
  // Schema.org
  const schema = $('[itemprop="streetAddress"]').text() ||
    $('[itemprop="address"]').text();
  if (schema) return schema.trim();
  // Regex für deutsche Adressen
  const match = html.match(/[A-ZÄÖÜ][a-zäöüß\s-]+(?:straße|str\.|gasse|weg|allee|platz|ring)\s+\d+[a-z]?,?\s*\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+/i);
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
  // Preise finden
  const priceMatches = html.match(/([A-ZÄÖÜ][a-zäöüß\s]+)\s*[|–-]\s*(\d+[,.]\d{2})\s*€/g);
  if (priceMatches && priceMatches.length > 3) {
    return priceMatches.slice(0, 20).map(m => {
      const parts = m.split(/[|–-]/);
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

module.exports = {
  menuItemCount,
  parseJsonLoose,
  fetchHtml,
  fetchLegalText,
  htmlToReadableText,
  extractReadableText,
  extractRaw,
  isThin,
  richness,
  fetchRendered,
  extractPhone,
  extractEmail,
  extractAddress,
  extractHours,
  extractImages,
  extractMenu,
  extractSocialLinks
};
