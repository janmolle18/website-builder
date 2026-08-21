/**
 * Scrape-Report: Abgleich "Was existiert auf der Alt-Site?" vs. "Was wurde übernommen?".
 * Deterministisch (kein LLM) — beantwortet nach jedem Scrape:
 *   - Welche Seiten wurden gefunden (Inventar), welche verwendet, welche übersprungen und warum?
 *   - Wurden alle Teammitglieder erfasst? (optionaler Haiku-Check gegen die Team-Übersicht)
 *   - Coverage in % + Warnungen. NUR Soft-Gate: unter SCRAPE_MIN_COVERAGE wird geflaggt,
 *     der Build läuft IMMER weiter (Hintergrund-Loops dürfen nicht brechen).
 */

require('dotenv').config();
const { callClaude } = require('./claude-cli');
// slug aus URL/Pfad: gemeinsamer Kern in lib/slugify (früher lokale Kopie wegen Import-Zyklus).
const { slugFromUrl: slugFromPath } = require('./lib/slugify');

const DEFAULT_MIN_COVERAGE = 60; // % — überschreibbar via env SCRAPE_MIN_COVERAGE

// Seitentypen, die inhaltlich auf der neuen Site landen sollten
const CONTENT_TYPES = ['team-overview', 'team-profile', 'practice-area-overview', 'practice-area', 'about', 'news', 'service'];

/** Namen für Vergleiche normalisieren: Titel/Anreden raus, Kleinbuchstaben, Umlaute vereinheitlicht. */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(dr|prof|dipl|ll\.?m|mag|jur|iur|med|rer|nat|h\.?c|rechtsanwalt|rechtsanwältin|notar|notarin|fachanwalt|fachanwältin)\.?\b/g, ' ')
    .replace(/[.,()]/g, ' ')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Vergleicht Namen von der Team-Übersicht mit dem extrahierten Team.
 * Ein Übersichts-Name gilt als erfasst, wenn ein extrahierter Name ihn (normalisiert)
 * enthält oder umgekehrt — robust gegen Titel ("Dr.") und Reihenfolge-Varianten.
 * @returns {{onOverview:string[], extracted:string[], missing:string[]}}
 */
function compareTeamNames(namesOnOverview, extractedTeam) {
  const extractedNames = (extractedTeam || []).map(t => (t && t.name) || '').filter(Boolean);
  const extractedNorm = extractedNames.map(normalizeName);
  const missing = [];
  for (const raw of namesOnOverview || []) {
    const n = normalizeName(raw);
    if (!n) continue;
    const hit = extractedNorm.some(e => e && (e.includes(n) || n.includes(e)));
    if (!hit) missing.push(raw);
  }
  return { onOverview: [...(namesOnOverview || [])], extracted: extractedNames, missing };
}

/**
 * Optionaler AI-Check: Welche Personen-Namen stehen auf der Team-Übersichtsseite —
 * und fehlen davon welche im extrahierten Team? Haiku-Call; bei Fehler null
 * (Report bleibt trotzdem vollständig, nur ohne diesen Abgleich).
 * @returns {Promise<{onOverview:string[], extracted:string[], missing:string[]}|null>}
 */
async function verifyTeamCompleteness(overviewText, extractedTeam) {
  if (!overviewText || overviewText.length < 40) return null;
  const prompt = `Hier ist der Text einer Team-Übersichtsseite (Kanzlei/Praxis). Liste ALLE Personen-Namen auf, die dort als Team-Mitglieder genannt werden (keine Mandanten/Zitate, keine Firmennamen).

${overviewText.slice(0, 6000)}

Antworte NUR mit einem JSON-Array von Namen (kein Markdown), z.B. ["Dr. Anna Muster", "Ben Beispiel"]. Leeres Array, wenn keine Namen erkennbar.`;
  try {
    const txt = await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' });
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const names = JSON.parse(m[0]).filter(n => typeof n === 'string' && n.trim());
    return compareTeamNames(names, extractedTeam);
  } catch (e) {
    console.warn('⚠️ Team-Vollständigkeitscheck übersprungen:', e.message);
    return null;
  }
}

/** Wurde eine klassifizierte Seite laut Ergebnis verwendet? Deterministischer Fallback ohne Log. */
function deterministicUsage(page, result) {
  const slug = slugFromPath(page.url);
  switch (page.type) {
    case 'home': return { usedAs: 'homepage' };
    case 'legal-impressum': return result.legal && result.legal.impressum ? { usedAs: 'legal:impressum' } : null;
    case 'legal-datenschutz': return result.legal && result.legal.datenschutz ? { usedAs: 'legal:datenschutz' } : null;
    case 'contact': return (result.phone || result.email || result.address) ? { usedAs: 'kontakt' } : null;
    case 'about': return result.about ? { usedAs: 'about' } : null;
    case 'team-overview': return (result.team || []).length ? { usedAs: 'team-uebersicht' } : null;
    case 'team-profile':
      return (result.team || []).some(t => t && t.slug === slug) ? { usedAs: `team:${slug}` } : null;
    case 'practice-area-overview': return (result.specialtyDetails || []).length ? { usedAs: 'rechtsgebiete-uebersicht' } : null;
    case 'practice-area':
      return (result.specialtyDetails || []).some(d => d && d.slug === slug) ? { usedAs: `rechtsgebiet:${slug}` } : null;
    default: {
      // news/service/other: verwendet, wenn eine Extra-Seite (Haupt oder Unterseite) den slug trägt
      const inExtra = (result.extraPages || []).some(p => p && (p.key === slug ||
        (p.subPages || []).some(s => s && slugFromPath(s.sourceUrl || '') === slug)));
      return inExtra ? { usedAs: `extra:${slug}` } : null;
    }
  }
}

/**
 * Baut den Coverage-Report. extractionLog (optional) hat Vorrang vor der
 * deterministischen Zuordnung: [{url, usedAs}] bzw. [{url, reason}] für Skips.
 * @returns {object} Report inkl. coverage, warnings[], flagged
 */
function buildScrapeReport({ inventory = [], classified = [], result = {}, extractionLog = [], sourceUrl = '' }) {
  const minCoverage = Number(process.env.SCRAPE_MIN_COVERAGE || DEFAULT_MIN_COVERAGE);
  const logByUrl = new Map((extractionLog || []).filter(l => l && l.url).map(l => [l.url, l]));

  const used = [];
  const skipped = [];
  for (const page of classified) {
    const log = logByUrl.get(page.url);
    if (log && log.usedAs) { used.push({ url: page.url, type: page.type, usedAs: log.usedAs }); continue; }
    if (log && log.reason) { skipped.push({ url: page.url, type: page.type, reason: log.reason }); continue; }
    const det = deterministicUsage(page, result);
    if (det) used.push({ url: page.url, type: page.type, usedAs: det.usedAs });
    else skipped.push({ url: page.url, type: page.type, reason: page.type === 'other' ? 'kein passender Zielort' : 'nicht extrahiert' });
  }

  const bySource = {};
  for (const e of inventory) bySource[e.source] = (bySource[e.source] || 0) + 1;
  const byType = {};
  for (const e of classified) byType[e.type] = (byType[e.type] || 0) + 1;

  const contentPages = classified.filter(p => CONTENT_TYPES.includes(p.type));
  const usedContent = used.filter(u => CONTENT_TYPES.includes(u.type));
  const pct = (part, whole) => whole ? Math.round((part / whole) * 100) : 100;
  const coverage = {
    pagesUsedPct: pct(used.length, classified.length),
    contentPagesUsedPct: pct(usedContent.length, contentPages.length)
  };

  // Team-Zähler: Profil-Seiten im Inventar vs. tatsächlich extrahierte Personen
  const profilePages = classified.filter(p => p.type === 'team-profile');
  const team = {
    profilePagesFound: profilePages.length,
    extracted: (result.team || []).map(t => (t && t.name) || '').filter(Boolean),
    missing: [] // wird ggf. von verifyTeamCompleteness gefüllt
  };

  const warnings = [];
  if (profilePages.length > team.extracted.length) {
    warnings.push(`${profilePages.length} Profil-Seiten gefunden, aber nur ${team.extracted.length} Personen extrahiert.`);
  }
  const skippedContent = skipped.filter(s => CONTENT_TYPES.includes(s.type));
  if (skippedContent.length) {
    warnings.push(`${skippedContent.length} Inhaltsseiten nicht übernommen: ${skippedContent.slice(0, 5).map(s => s.url).join(', ')}${skippedContent.length > 5 ? ', …' : ''}`);
  }
  const flagged = coverage.contentPagesUsedPct < minCoverage;
  if (flagged) {
    warnings.push(`Content-Coverage ${coverage.contentPagesUsedPct}% liegt unter Schwelle ${minCoverage}% — Ergebnis prüfen!`);
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceUrl,
    inventory: { total: inventory.length, bySource, byType },
    used, skipped, team, coverage, warnings, flagged
  };
}

module.exports = { buildScrapeReport, verifyTeamCompleteness, compareTeamNames, normalizeName, CONTENT_TYPES };
