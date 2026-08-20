/**
 * self-hosting.js — Self-Hosting-Guard (I3c, abo-frei, kein LLM).
 *
 * WARUM: Ein self-hostetes Site (A1/A2/A3) lädt 0 Fremd-Requests → schneller (besserer
 * LCP/CLS) UND DSGVO-konform (keine Besucher-IP an Google & Co — der Abmahn-Kern). Fällt
 * `buildFonts`/`buildCss`/`vendorBuild` bei einem Build aus (Quelle nicht erreichbar), bleibt
 * still die CDN-Einbindung stehen → CLS-Regression (siehe I3b) + Abmahn-Risiko, ohne Warnung.
 * Dieses Modul scannt die GEBAUTE Site auf externe Font-/Script-/CDN-/Tracker-Hosts und macht
 * das sichtbar (Score + Issues), damit so ein Build nicht unbemerkt ausgeliefert wird.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');

// Host-Muster → Kategorie + Punktabzug. Reihenfolge = Schwere.
const PATTERNS = [
  { re: /fonts\.(googleapis|gstatic)\.com/i, category: 'fonts',   penalty: 40, label: 'Google Fonts (CDN)' },
  { re: /(googletagmanager|google-analytics)\.com|connect\.facebook\.net|hotjar\.com/i, category: 'tracker', penalty: 40, label: 'US-Tracker' },
  { re: /cdn\.tailwindcss\.com/i,            category: 'cdn',     penalty: 30, label: 'Tailwind Play-CDN' },
  { re: /(jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)/i, category: 'cdn', penalty: 20, label: 'JS/CSS-CDN' },
];

function readSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/**
 * Zieht den Hostnamen aus einer Ressourcen-URL — robust gegen fehlendes Protokoll.
 * Deckt `https://host/…`, `//host/…` UND protokoll-lose/root-relative `host/…` bzw.
 * `/host/…` ab (Letzteres entsteht, wenn ein Font-/CDN-Fallback kaputt hinterlassen
 * wird — genau der Fehlerfall, den dieses Modul erkennen soll). Gibt NIE das Label als
 * Schlüssel zurück, damit verschiedene Hosts derselben Kategorie nicht kollidieren.
 * @param {string} raw
 * @returns {string} Hostname ohne `www.`, oder '' wenn keiner extrahierbar ist
 */
function extractHost(raw) {
  const stripped = String(raw || '')
    .trim()
    .replace(/^(?:https?:)?\/\//i, '') // Protokoll + führende Slashes
    .replace(/^\/+/, '');              // root-relative Slashes
  const host = stripped.split(/[/?#]/)[0];
  return host ? host.replace(/^www\./i, '') : '';
}

function classify(url) {
  for (const p of PATTERNS) if (p.re.test(url)) return p;
  return null;
}

/**
 * Analysiert, ob eine gebaute Site vollständig self-hostet (0 kritische Fremd-Requests).
 * @param {string} projectDir absoluter Pfad zum Projektordner
 * @returns {{selfHosted:boolean, score:number, grade:string, hosts:{host,category,label,count}[], summary:string, issues:string[]}}
 */
function analyzeSelfHosting(projectDir) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { selfHosted: false, score: 0, grade: 'n/a', hosts: [], summary: 'Keine index.html — Site noch nicht gebaut.', issues: ['Site bauen'] };
  }

  const found = new Map(); // host -> { host, category, label, count }
  for (const file of findHtmlFiles(projectDir)) {
    const $ = cheerio.load(readSafe(file), { decodeEntities: false });
    // Alle link[href]/script[src] einsammeln (deckt stylesheet, preconnect, preload, script ab).
    // Es wird NICHT nach rel gefiltert — die Treffer werden allein durch die eng gefassten
    // PATTERNS bestimmt, sodass render-neutrale rel-Typen (icon/canonical) faktisch nie matchen.
    const urls = [];
    $('link[href]').each((i, el) => urls.push($(el).attr('href')));
    $('script[src]').each((i, el) => urls.push($(el).attr('src')));
    for (const raw of urls) {
      const p = classify(raw || '');
      if (!p) continue;
      // Echter Host als Schlüssel; nur wenn wirklich keiner extrahierbar ist, das Label als
      // letzter Ausweg (verhindert Absturz, ist aber praktisch nie nötig).
      const host = extractHost(raw) || p.label;
      const prev = found.get(host);
      if (prev) prev.count += 1;
      else found.set(host, { host, category: p.category, label: p.label, count: 1, penalty: p.penalty });
    }
  }

  const hosts = [...found.values()].sort((a, b) => b.penalty - a.penalty);
  // Score: 100 minus Abzug je einzigartiger Kategorie (nicht je Vorkommen — sonst übermäßig).
  const seenCat = new Map();
  for (const h of hosts) if (!seenCat.has(h.category) || seenCat.get(h.category) < h.penalty) seenCat.set(h.category, h.penalty);
  const score = Math.max(0, 100 - [...seenCat.values()].reduce((s, p) => s + p, 0));
  const selfHosted = hosts.length === 0;

  const issues = hosts.map(h => `${h.label} extern geladen (${h.host}, ${h.count}×) — CLS-/DSGVO-Risiko`);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  const summary = selfHosted
    ? 'Voll self-hosted — 0 kritische Fremd-Requests (schnell + DSGVO-konform).'
    : `${hosts.length} externe(r) Host(s) — Self-Hosting unvollständig (Score ${score}/100).`;

  // penalty nicht nach außen leaken.
  const cleanHosts = hosts.map(({ host, category, label, count }) => ({ host, category, label, count }));
  return { selfHosted, score, grade, hosts: cleanHosts, summary, issues };
}

module.exports = { analyzeSelfHosting, PATTERNS };
