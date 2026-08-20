/**
 * lead-scoring.js — Qualifizierung v2: Bedarfs-Buckets + Demand-Score.
 *
 * Warum: Der alte Pauschal-Pfad („kein OSM-Website-Tag → Score 100, qualifiziert")
 * hat 62 % der Liste ungeprüft nach oben gespült. Ab jetzt gilt:
 *   - Bucket = WAS wir über die Website wissen (schlecht / bestätigt keine / gut → GEO / unklar)
 *   - Demand-Score = Bedarf (max 60) + Aktivitätssignale aus Google Places (max 40)
 * „Website gut" ist KEIN Skip mehr — das sind GEO-Kandidaten (eigenes Angebot).
 *
 * Dieses Modul ist pur (kein fs/Netz). I/O kommt injiziert über qualifyLead-Deps.
 */

const BUCKET = {
  KEINE_WEBSITE: 'keine-website',
  WEBSITE_SCHLECHT: 'website-schlecht',
  WEBSITE_GUT: 'website-gut',
  UNKLAR: 'unklar'
};

const BUCKET_LABEL = {
  'keine-website': 'Keine Website',
  'website-schlecht': 'Website schwach',
  'website-gut': 'GEO-Kandidat',
  'unklar': 'Unklar'
};

// Schwellen aus prospect-audit (BORDERLINE=25) bewusst gespiegelt, nicht importiert:
// prospect-audit bleibt eigenständig, hier zählt nur „hat die Seite echte Mängel?".
const AUDIT_MIN_MAENGEL = 25;

const PLACES_TTL_TAGE = 90;
const SCHEMA_VERSION = 2;

// ── Bucket-Entscheidung ───────────────────────────────────────────────────────

/**
 * Entscheidet den Bedarfs-Bucket aus finalem Audit + Places-Ergebnis.
 * Erwartet, dass der Orchestrator (qualifyLead) entdeckte Websites bereits
 * re-auditiert hat — hier wird nur noch bewertet, nichts mehr nachgeladen.
 */
function computeBucket({ audit, places } = {}) {
  if (audit && audit.reachable) {
    return { bucket: (audit.needScore || 0) >= AUDIT_MIN_MAENGEL ? BUCKET.WEBSITE_SCHLECHT : BUCKET.WEBSITE_GUT, suggestArchive: false };
  }

  const matched = !!(places && places.matched);
  if (matched && places.businessStatus === 'CLOSED_PERMANENTLY') {
    return { bucket: BUCKET.UNKLAR, suggestArchive: true };
  }
  if (matched) {
    const hatteUrl = !!(audit && audit.url);
    if (hatteUrl) {
      // Website behauptet, aber tot: Betrieb laut Places aktiv → echter Bedarf.
      const aktiv = places.businessStatus === 'OPERATIONAL' || places.businessStatus == null;
      return { bucket: aktiv ? BUCKET.WEBSITE_SCHLECHT : BUCKET.UNKLAR, suggestArchive: false };
    }
    // Nie eine URL gehabt: Places bestätigt „wirklich keine Website" nur ohne eigenen Fund.
    return { bucket: places.website ? BUCKET.UNKLAR : BUCKET.KEINE_WEBSITE, suggestArchive: false };
  }

  return { bucket: BUCKET.UNKLAR, suggestArchive: false };
}

// ── Demand-Score ──────────────────────────────────────────────────────────────

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

/** Bedarf (max 60) + Aktivität (max 40). CLOSED_PERMANENTLY → 0. */
function computeDemandScore({ bucket, audit, places } = {}) {
  const matched = !!(places && places.matched);
  if (matched && places.businessStatus === 'CLOSED_PERMANENTLY') return 0;

  let score = 0;
  if (bucket === BUCKET.KEINE_WEBSITE) score = 60;
  else if (bucket === BUCKET.WEBSITE_SCHLECHT) score = clamp(Math.round((audit?.needScore || 0) * 0.6), 25, 60);
  else if (bucket === BUCKET.WEBSITE_GUT) score = 10;
  else score = 15;

  if (matched) {
    const reviews = places.userRatingCount || 0;
    if (reviews >= 100) score += 20;
    else if (reviews >= 25) score += 15;
    else if (reviews >= 5) score += 8;
    if ((places.rating || 0) >= 4.0 && reviews >= 10) score += 10;
    if (places.businessStatus === 'OPERATIONAL') score += 10;
  }

  return clamp(score, 0, 100);
}

function priorityFromScore(score) {
  return score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
}

// ── Namens-Guard für Places-Matches ──────────────────────────────────────────

// Rechtsformen + Branchen-Füllwörter, die bei DACH-Betriebsnamen keinen
// Unterscheidungswert haben („Kanzlei Dr. Müller" ≙ „Dr. Müller Rechtsanwälte").
const NAME_STOPWORDS = new Set([
  'gmbh', 'ug', 'kg', 'ohg', 'gbr', 'partg', 'partgmbb', 'mbb', 'co', 'cokg', 'ag',
  'und', 'and', 'die', 'der', 'das', 'im', 'am', 'an', 'zur', 'zum',
  'dr', 'med', 'dent', 'prof', 'dipl', 'mag',
  'kanzlei', 'rechtsanwalt', 'rechtsanwaelte', 'rechtsanwaltskanzlei', 'anwalt', 'anwaelte',
  'notar', 'notare', 'fachanwalt', 'steuerberater', 'steuerberatung', 'steuerbuero',
  'praxis', 'gemeinschaftspraxis', 'arztpraxis', 'zahnarztpraxis', 'zahnarzt', 'zahnaerzte',
  'physiotherapie', 'krankengymnastik', 'psychotherapie',
  'restaurant', 'gaststaette', 'gasthaus', 'gasthof', 'cafe', 'bistro', 'pizzeria',
  'imbiss', 'grill', 'bar', 'hotel', 'baeckerei', 'konditorei'
]);

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameTokens(s) {
  return normalizeName(s).split(' ').filter(t => t.length >= 2 && !NAME_STOPWORDS.has(t));
}

/** Token-Overlap ≥ 0.5 (nach Füllwort-Strip); Fallback: String-Enthaltensein. */
function namesSimilar(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length && tb.length) {
    const setB = new Set(tb);
    const overlap = ta.filter(t => setB.has(t)).length;
    return overlap / Math.min(ta.length, tb.length) >= 0.5;
  }
  const na = normalizeName(a), nb = normalizeName(b);
  return !!na && !!nb && (na.includes(nb) || nb.includes(na));
}

// ── Places-Feld am Lead ───────────────────────────────────────────────────────

/**
 * Wählt aus den Lookup-Kandidaten den ersten namensähnlichen Treffer.
 * Kein Treffer → matched:false wird trotzdem persistiert (checkedAt verhindert
 * Re-Billing-Schleifen; der Kandidat bleibt zur manuellen Kontrolle sichtbar).
 */
function buildPlacesField(lead, candidates, checkedAtIso) {
  const list = Array.isArray(candidates) ? candidates : [];
  const hit = list.find(c => namesSimilar(lead.name, c.name));
  const chosen = hit || list[0] || null;
  const base = { matched: !!hit, checkedAt: checkedAtIso };
  if (!chosen) return base;
  return {
    ...base,
    placeId: chosen.placeId || null,
    name: chosen.name || '',
    website: chosen.website || null,
    rating: chosen.rating ?? null,
    userRatingCount: chosen.userRatingCount ?? 0,
    businessStatus: chosen.businessStatus || null,
    phone: chosen.phone || ''
  };
}

/** OSM gewinnt; Places füllt nur Lücken (phone/website) — und nur bei echtem Match. */
function mergePlacesIntoLead(lead, placesField) {
  const next = { ...lead, places: placesField || null };
  if (placesField && placesField.matched) {
    if (!next.phone && placesField.phone) next.phone = placesField.phone;
    if (!next.website && placesField.website) next.website = placesField.website;
  }
  return next;
}

function needsPlacesCheck(lead, now = new Date()) {
  const checkedAt = lead?.places?.checkedAt;
  if (!checkedAt) return true;
  const alterMs = now - new Date(checkedAt);
  return !(alterMs >= 0 && alterMs <= PLACES_TTL_TAGE * 24 * 60 * 60 * 1000);
}

// ── Schema-Migration v1 → v2 ──────────────────────────────────────────────────

// Kopie der Klassifizierung aus agent-leads (dort OSM-gebunden). Bewusst dupliziert
// statt importiert: agent-leads hängt von diesem Modul ab, nicht umgekehrt.
function deriveVertical(...kandidaten) {
  for (const k of kandidaten.map(x => String(x || '').toLowerCase())) {
    if (/^(lawyer|tax_advisor|notary)$/.test(k)) return 'kanzlei';
    if (/^(doctors|dentist|doctor|physiotherapist|psychotherapist)$/.test(k) || /health/.test(k)) return 'praxis';
  }
  return 'gastro';
}

const VERTICAL_LABEL = { gastro: 'Gastro', kanzlei: 'Kanzlei', praxis: 'Praxis' };

/**
 * Hebt einen Lead (v1, Legacy oder v2) verlustfrei auf Schema v2.
 * Idempotent; vorhandene v2-Felder werden nie überschrieben.
 */
function normalizeLeadV2(lead) {
  const { websiteScore, rating, reviewCount, ...rest } = lead || {};

  const vertical = rest.vertical || deriveVertical(rest.category, ...(rest.types || []), rest.cuisine);
  const verticalLabel = rest.verticalLabel || VERTICAL_LABEL[vertical];

  // Legacy-Records (websiteScore statt audit): synthetisches, als unverifiziert
  // markiertes Audit — der Backfill holt sich damit automatisch ein frisches.
  let audit = rest.audit;
  if (!audit) {
    const score = typeof websiteScore === 'number' ? websiteScore : 0;
    audit = {
      verdict: score >= 45 ? 'qualified' : score >= 25 ? 'borderline' : 'skip',
      needScore: score,
      evidence: rest.websiteIssues ? [rest.websiteIssues] : [],
      pitchHook: rest.websiteIssues || '',
      reachable: false,
      url: rest.website || null,
      unverified: true
    };
  }

  const activity = Array.isArray(rest.activity) ? rest.activity : [];
  const migrierteNotiz = (!activity.length && typeof rest.notes === 'string' && rest.notes.trim())
    ? [{ at: rest.foundAt || new Date().toISOString(), type: 'note', text: rest.notes.trim() }]
    : activity;

  return {
    ...rest,
    schemaVersion: SCHEMA_VERSION,
    vertical,
    verticalLabel,
    branche: rest.branche || verticalLabel,
    category: rest.category || (rest.types && rest.types[0]) || '',
    audit,
    bucket: rest.bucket ?? null,
    demandScore: rest.demandScore ?? null,
    suggestArchive: rest.suggestArchive ?? false,
    source: rest.source || 'osm',
    places: rest.places || null,
    ansprechpartner: rest.ansprechpartner || '',
    outreach: {
      channel: null, variant: null, sentAt: null, repliedAt: null, nextActionAt: null,
      ...(rest.outreach || {})
    },
    activity: migrierteNotiz,
    archived: rest.archived === true,
    archivedAt: rest.archivedAt || null,
    archivedReason: rest.archivedReason || null
  };
}

// ── Scoring anwenden + Orchestrierung ────────────────────────────────────────

/** Berechnet bucket/demandScore/priority neu aus lead.audit + lead.places (immutabel). */
function applyScoring(lead) {
  const { bucket, suggestArchive } = computeBucket({ audit: lead.audit, places: lead.places });
  const demandScore = computeDemandScore({ bucket, audit: lead.audit, places: lead.places });
  return {
    ...lead,
    bucket,
    suggestArchive,
    demandScore,
    score: demandScore, // Alias: Ranking-Zahl fürs Dashboard (ersetzt needScore-Kopie)
    priority: priorityFromScore(demandScore),
    websiteIssues: (lead.audit?.evidence || []).join(', ')
  };
}

/**
 * Voll-Qualifizierung eines Leads mit injizierten I/O-Deps (kein direkter Netz-Zugriff hier):
 *   1. normalisieren (v2)  2. Audit (je nach reAudit-Modus)  3. Places-Lookup (TTL)
 *   4. entdeckte Website re-auditieren  5. Bucket + Score.
 *
 * @param {object} lead
 * @param {{auditFn:Function, lookupFn:Function|null, now?:Date, reAudit?:'auto'|'always'|'never'}} deps
 *   reAudit 'auto' (Default): nur wenn Audit fehlt oder unverifiziert ist.
 */
async function qualifyLead(lead, deps = {}) {
  const { auditFn, lookupFn = null, now = new Date(), reAudit = 'auto' } = deps;
  if (typeof auditFn !== 'function') throw new Error('qualifyLead: auditFn fehlt');

  let next = normalizeLeadV2(lead);

  let audit = next.audit;
  if (reAudit === 'always' || (reAudit === 'auto' && (!audit || audit.unverified))) {
    audit = await auditFn({ name: next.name, url: next.website });
  }

  let places = next.places;
  if (lookupFn && needsPlacesCheck(next, now)) {
    const res = await lookupFn({ name: next.name, address: next.address, city: next.city });
    if (res && res.ok) places = buildPlacesField(next, res.candidates, now.toISOString());
    // ok:false (Cap/Kill-Switch/HTTP) → places bleibt wie es war; nächster Lauf versucht es erneut.
  }

  next = mergePlacesIntoLead({ ...next, audit }, places);

  // Places hat eine Website entdeckt, die das Audit noch nicht gesehen hat → nachprüfen.
  if (places && places.matched && places.website && (!audit || !audit.reachable)) {
    const nachAudit = await auditFn({ name: next.name, url: places.website });
    if (nachAudit && nachAudit.reachable) {
      audit = nachAudit;
      next = { ...next, website: places.website };
    }
  }

  return applyScoring({ ...next, audit });
}

module.exports = {
  BUCKET, BUCKET_LABEL, SCHEMA_VERSION, PLACES_TTL_TAGE,
  computeBucket, computeDemandScore, priorityFromScore,
  normalizeName, namesSimilar, buildPlacesField, mergePlacesIntoLead,
  needsPlacesCheck, normalizeLeadV2, applyScoring, qualifyLead
};
