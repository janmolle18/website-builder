/**
 * prospect-audit.js — Lead-Qualifizierung: Braucht dieser Interessent WIRKLICH eine neue Website?
 *
 * Grundregel: Nur ansprechen, wenn die Ist-Website objektiv schlecht/veraltet
 * ist ODER fehlt. Sonst ist die Ansprache unehrlich und konvertiert nicht. Dieses Modul
 * bewertet die bestehende Seite eines Interessenten DETERMINISTISCH und KONSERVATIV
 * (lieber „passt schon / nicht ansprechen" als Fehlalarm) und liefert konkrete Belege,
 * die man im Erstkontakt ehrlich nennen kann.
 *
 * Abo-frei (kein LLM). Kein Ranking von „gut aussehen" — nur harte, prüfbare Mängel.
 */

const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

// Gewichte je Mangel (kein fester 100-Deckel; „kein Erreichen/Baustelle" qualifiziert direkt).
const SIGNALS = {
  noMobile:        { w: 22, label: 'Nicht mobil-optimiert (kein Responsive-Viewport)' },
  legacyTech:      { w: 18, label: 'Veraltete Technik (Tabellen-Layout / <font> / Frames / Flash / Marquee)' },
  noHttps:         { w: 14, label: 'Kein HTTPS (unsicher, Browser warnt)' },
  outdated:        { w: 12, label: 'Veralteter Stand (altes Copyright-Jahr)' },
  noMetaDesc:      { w: 8,  label: 'Keine Meta-Description (SEO-Grundlage fehlt)' },
  noSchema:        { w: 8,  label: 'Keine strukturierten Daten (schema.org) — unsichtbar für KI-Suchen (GEO)' },
  noOg:            { w: 6,  label: 'Keine Open-Graph-Tags (kaputte Vorschau beim Teilen)' },
  tinyContent:     { w: 10, label: 'Sehr wenig Inhalt (dünne oder unfertige Seite)' }
};
const QUALIFY = 45;      // ab hier: ansprechen lohnt sich
const BORDERLINE = 25;   // 25–44: grenzwertig, nur mit weiterem Grund
const CURRENT_YEAR = new Date().getFullYear();

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    let mod, u;
    try { u = new URL(url); } catch { return resolve({ ok: false, reason: 'ungültige URL' }); }
    if (!['http:', 'https:'].includes(u.protocol)) return resolve({ ok: false, reason: 'kein http(s)' });
    mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 ProspectAudit' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(fetchUrl(next, redirects + 1).then(r => ({ ...r, finalUrl: r.finalUrl || next })));
      }
      if (res.statusCode >= 400) { res.resume(); return resolve({ ok: false, reason: `HTTP ${res.statusCode}`, status: res.statusCode }); }
      let body = ''; let bytes = 0;
      res.on('data', c => { bytes += c.length; if (bytes < 800_000) body += c; });
      res.on('end', () => resolve({ ok: true, html: body, finalUrl: url, status: res.statusCode }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'Timeout (>12s, sehr langsam)' }); });
    req.on('error', e => resolve({ ok: false, reason: e.code || e.message }));
  });
}

/** Prüft das HTML auf harte, veraltete/schlechte Merkmale → Belegliste. */
function inspectHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const hits = {};
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  // Baustelle/Parkseite → sofort qualifizieren.
  const placeholder = /under construction|im aufbau|coming soon|demn(ä|ae)chst|baustelle|parked|domain.*(kaufen|for sale)|diese domain/i.test(text) && text.length < 1500;

  if (!$('meta[name="viewport"]').length) hits.noMobile = true;
  const htmlLower = html.toLowerCase();
  if (/<table[^>]*(role=)?/.test(htmlLower) && $('table').toArray().some(t => $(t).find('td').length > 6 && !$(t).closest('article,main').length)
      || /<font\b/.test(htmlLower) || /<frameset|<frame\b/.test(htmlLower) || /shockwave-flash|\.swf\b/.test(htmlLower) || /<marquee/.test(htmlLower)) {
    hits.legacyTech = true;
  }
  // HTTPS-Check erfolgt über finalUrl im Aufrufer (hier nur Platzhalter).
  const copyMatch = [...text.matchAll(/(?:©|copyright|&copy;)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(m => parseInt(m[1], 10)).filter(y => y > 1998 && y <= CURRENT_YEAR);
  if (copyMatch.length && Math.max(...copyMatch) <= CURRENT_YEAR - 3) hits.outdated = { year: Math.max(...copyMatch) };
  if (!$('meta[name="description"]').attr('content')) hits.noMetaDesc = true;
  if (!$('script[type="application/ld+json"]').length) hits.noSchema = true;
  if (!$('meta[property^="og:"]').length) hits.noOg = true;
  if (text.length < 600) hits.tinyContent = { chars: text.length };

  return { hits, placeholder, textLen: text.length };
}

/**
 * Bewertet die Ist-Website eines Interessenten.
 * @param {{url?:string, name?:string}} lead
 * @returns {Promise<{name?:string, url:string|null, reachable:boolean, needScore:number, verdict:'qualified'|'borderline'|'skip', evidence:string[], pitchHook:string}>}
 */
async function auditProspect(lead = {}) {
  const name = lead.name || '';
  const url = (lead.url || lead.website || '').trim();

  // 1) Keine Website laut OSM → NICHT mehr blind qualifizieren: unverified-Flag,
  //    lead-scoring/Places müssen bestätigen, ob wirklich keine Website existiert.
  if (!url) {
    return { name, url: null, reachable: false, needScore: 100, verdict: 'qualified',
      evidence: ['Keine eigene Website gefunden — nur Verzeichnis/Social oder gar keine Online-Präsenz'],
      pitchHook: 'hat keine eigene Website', unverified: true };
  }

  const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  let res = await fetchUrl(target);
  if (!res.ok) {
    // Ein Retry nach kurzer Pause — transiente Timeouts sollen keinen Bedarf vortäuschen.
    await new Promise(r => setTimeout(r, 2000));
    res = await fetchUrl(target);
  }
  if (!res.ok) {
    // Nicht erreichbar/HTTP-Fehler/Timeout → Bedarf möglich, aber unverifiziert.
    return { name, url, reachable: false, needScore: 90, verdict: 'qualified',
      evidence: [`Website nicht sauber erreichbar (${res.reason})`],
      pitchHook: 'Website ist aktuell nicht erreichbar', unverified: true };
  }

  const { hits, placeholder } = inspectHtml(res.html);
  const evidence = [];
  let score = 0;

  if (placeholder) {
    return { name, url, reachable: true, needScore: 100, verdict: 'qualified',
      evidence: ['Nur Platzhalter-/Baustellen-Seite (kein echter Inhalt)'], pitchHook: 'hat nur eine Platzhalter-Seite' };
  }

  // HTTPS: über die finale URL bestimmen.
  const finalHttps = /^https:/i.test(res.finalUrl || url);
  if (!finalHttps) { score += SIGNALS.noHttps.w; evidence.push(SIGNALS.noHttps.label); }

  for (const key of Object.keys(SIGNALS)) {
    if (key === 'noHttps') continue;
    if (hits[key]) {
      score += SIGNALS[key].w;
      let label = SIGNALS[key].label;
      if (key === 'outdated' && hits.outdated.year) label += ` (© ${hits.outdated.year})`;
      if (key === 'tinyContent' && hits.tinyContent.chars != null) label += ` (${hits.tinyContent.chars} Zeichen)`;
      evidence.push(label);
    }
  }

  const verdict = score >= QUALIFY ? 'qualified' : score >= BORDERLINE ? 'borderline' : 'skip';
  const pitchHook = !hits.noMobile ? (evidence[0] || 'solide Website')
    : 'Website ist nicht mobil-optimiert';

  return { name, url: res.finalUrl || url, reachable: true, needScore: Math.min(score, 100), verdict, evidence,
    pitchHook: verdict === 'skip' ? 'Website ist bereits solide — NICHT ansprechen' : pitchHook };
}

module.exports = { auditProspect, inspectHtml, SIGNALS, QUALIFY, BORDERLINE };
