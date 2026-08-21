/**
 * lib/slugify.js — gemeinsamer Transliterations-Kern.
 *
 * Vorher gab es vier gedriftete Kopien (agent-scraper, lead-scoring, server,
 * pages) — ein Kern, zwei Ausprägungen:
 *   - slugify():           URL-tauglicher Slug, Trenner "-" (Dateinamen/Links)
 *   - normalizeForMatch(): Vergleichsform, Trenner " " (Namens-Matching)
 * Beide teilen dieselbe Transliteration: Kleinschreibung, deutsche Umlaute
 * (ä→ae, ö→oe, ü→ue, ß→ss), NFD-Normalisierung + Strip kombinierender
 * Zeichen (é→e, è→e, …).
 *
 * Pur (kein fs/Netz, keine Projekt-Imports) — darf von überall importiert
 * werden, ohne Import-Zyklen zu erzeugen.
 */

/** Kern: Kleinbuchstaben, Umlaut-Mapping, NFD + kombinierende Zeichen strippen. */
function transliterate(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** URL-tauglicher Slug: "Jennifer Schütze-Strumpf" → "jennifer-schuetze-strumpf". */
function slugify(s) {
  return transliterate(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Vergleichsform für Namens-Matching: "Grill | Café" → "grill cafe". */
function normalizeForMatch(s) {
  return transliterate(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * slug aus URL oder blankem Pfad: letztes nicht-leeres Segment ohne .html
 * (für /pfad/<slug>/ UND <slug>.html). Keine Transliteration — der Slug
 * stammt bereits aus der Quell-URL.
 */
function slugFromUrl(urlOrPath) {
  try {
    const p = urlOrPath.includes('://') ? new URL(urlOrPath).pathname : urlOrPath;
    const segs = p.split('/').filter(Boolean);
    return (segs.pop() || '').replace(/\.html?$/i, '').toLowerCase();
  } catch { return ''; }
}

module.exports = { transliterate, slugify, normalizeForMatch, slugFromUrl };
