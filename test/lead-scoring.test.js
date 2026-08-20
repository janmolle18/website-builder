const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BUCKET, computeBucket, computeDemandScore, priorityFromScore,
  namesSimilar, buildPlacesField, mergePlacesIntoLead,
  needsPlacesCheck, normalizeLeadV2, applyScoring, qualifyLead
} = require('../lead-scoring');

// ── Hilfsfixtures ─────────────────────────────────────────────────────────────

const AUDIT_SCHLECHT = { verdict: 'qualified', needScore: 76, evidence: ['Kein HTTPS'], pitchHook: 'kein HTTPS', reachable: true, url: 'http://alt.de' };
const AUDIT_GUT = { verdict: 'skip', needScore: 8, evidence: [], pitchHook: 'solide', reachable: true, url: 'https://modern.de' };
const AUDIT_OHNE_URL = { verdict: 'qualified', needScore: 100, evidence: ['Keine eigene Website gefunden'], pitchHook: 'hat keine eigene Website', reachable: false, url: null, unverified: true };
const AUDIT_UNREACHABLE = { verdict: 'qualified', needScore: 90, evidence: ['Website nicht sauber erreichbar (HTTP 404)'], pitchHook: 'nicht erreichbar', reachable: false, url: 'http://tot.de', unverified: true };

const PLACES_AKTIV = { matched: true, checkedAt: '2026-07-14T00:00:00.000Z', placeId: 'p1', name: 'X', website: null, rating: 4.5, userRatingCount: 120, businessStatus: 'OPERATIONAL', phone: '05251 1' };
const PLACES_MIT_SITE = { ...PLACES_AKTIV, website: 'https://gefunden.de' };
const PLACES_ZU = { ...PLACES_AKTIV, businessStatus: 'CLOSED_PERMANENTLY' };
const PLACES_KEIN_MATCH = { matched: false, checkedAt: '2026-07-14T00:00:00.000Z' };

// Echter Legacy-Datensatz (gekürzt) aus leads.json — Alt-Schema ohne audit/vertical.
const LEGACY_BALTHASAR = {
  id: '99928ffb-36c3-4cbf-a96e-c530e08e9826',
  osmId: 'node/256484567',
  name: 'Balthasar',
  address: 'Warburger Straße 28, 33098 Paderborn',
  city: 'Paderborn',
  phone: '+49 5251 24448',
  email: '',
  website: 'https://www.restaurant-balthasar.de/',
  websiteScore: 0,
  websiteIssues: 'Website sieht aktuell aus',
  rating: 0,
  reviewCount: 0,
  types: ['fine_dining'],
  cuisine: 'fine_dining',
  openingHours: ['Tu-Sa 19:00-23:00+'],
  googleMapsUrl: 'https://www.openstreetmap.org/#map=18/51.7149895/8.7639082',
  priority: 'high',
  status: 'new',
  pitchText: null,
  foundAt: '2026-06-14T16:29:04.515Z',
  region: 'Paderborn'
};

// ── computeBucket: die Entscheidungsmatrix ────────────────────────────────────

test('computeBucket: erreichbare Website mit Mängeln (Audit >= 25) → website-schlecht', () => {
  assert.equal(computeBucket({ audit: AUDIT_SCHLECHT, places: null }).bucket, BUCKET.WEBSITE_SCHLECHT);
});

test('computeBucket: erreichbare solide Website (Audit < 25) → website-gut (GEO-Kandidat statt Skip)', () => {
  assert.equal(computeBucket({ audit: AUDIT_GUT, places: null }).bucket, BUCKET.WEBSITE_GUT);
});

test('computeBucket: kein URL, Places gematcht OHNE Website → keine-website (bestätigt)', () => {
  assert.equal(computeBucket({ audit: AUDIT_OHNE_URL, places: PLACES_AKTIV }).bucket, BUCKET.KEINE_WEBSITE);
});

test('computeBucket: kein URL, Places liefert Website (Re-Audit kam nicht durch) → unklar', () => {
  // Der Orchestrator re-auditiert entdeckte URLs; landet trotzdem eine hier, ist nichts bewiesen.
  assert.equal(computeBucket({ audit: AUDIT_OHNE_URL, places: PLACES_MIT_SITE }).bucket, BUCKET.UNKLAR);
});

test('computeBucket: Website unreachable, Places OPERATIONAL → website-schlecht (Betrieb aktiv, Site kaputt)', () => {
  assert.equal(computeBucket({ audit: AUDIT_UNREACHABLE, places: PLACES_AKTIV }).bucket, BUCKET.WEBSITE_SCHLECHT);
});

test('computeBucket: Places kein Match / gar nicht geprüft → unklar', () => {
  assert.equal(computeBucket({ audit: AUDIT_OHNE_URL, places: PLACES_KEIN_MATCH }).bucket, BUCKET.UNKLAR);
  assert.equal(computeBucket({ audit: AUDIT_OHNE_URL, places: null }).bucket, BUCKET.UNKLAR);
  assert.equal(computeBucket({ audit: AUDIT_UNREACHABLE, places: null }).bucket, BUCKET.UNKLAR);
});

test('computeBucket: CLOSED_PERMANENTLY → unklar + Archiv-Vorschlag', () => {
  const r = computeBucket({ audit: AUDIT_OHNE_URL, places: PLACES_ZU });
  assert.equal(r.bucket, BUCKET.UNKLAR);
  assert.equal(r.suggestArchive, true);
});

test('computeBucket: unreachable + CLOSED_TEMPORARILY → unklar (kein Bedarf beweisbar)', () => {
  const places = { ...PLACES_AKTIV, businessStatus: 'CLOSED_TEMPORARILY' };
  assert.equal(computeBucket({ audit: AUDIT_UNREACHABLE, places }).bucket, BUCKET.UNKLAR);
});

// ── computeDemandScore: Gewichte + Grenzwerte ────────────────────────────────

test('computeDemandScore: keine-website + volle Aktivität = 100', () => {
  const s = computeDemandScore({ bucket: BUCKET.KEINE_WEBSITE, audit: AUDIT_OHNE_URL, places: PLACES_AKTIV });
  assert.equal(s, 100); // 60 + 20 (>=100 Reviews) + 10 (Rating>=4) + 10 (OPERATIONAL)
});

test('computeDemandScore: website-schlecht skaliert mit Audit-Score und clampt auf 25–60', () => {
  const base = (needScore) => computeDemandScore({ bucket: BUCKET.WEBSITE_SCHLECHT, audit: { ...AUDIT_SCHLECHT, needScore }, places: null });
  assert.equal(base(76), 46);  // round(76*0.6)
  assert.equal(base(100), 60); // Obergrenze
  assert.equal(base(26), 25);  // Untergrenze
});

test('computeDemandScore: Review-Schwellen 5/25/100', () => {
  const s = (userRatingCount) => computeDemandScore({
    bucket: BUCKET.KEINE_WEBSITE, audit: AUDIT_OHNE_URL,
    places: { ...PLACES_AKTIV, rating: null, userRatingCount, businessStatus: null }
  });
  assert.equal(s(4), 60);       // unter allen Schwellen
  assert.equal(s(5), 68);       // +8
  assert.equal(s(25), 75);      // +15
  assert.equal(s(100), 80);     // +20
});

test('computeDemandScore: Rating-Bonus nur ab 4.0 UND >=10 Reviews', () => {
  const s = (rating, userRatingCount) => computeDemandScore({
    bucket: BUCKET.WEBSITE_GUT, audit: AUDIT_GUT,
    places: { ...PLACES_AKTIV, rating, userRatingCount, businessStatus: null }
  });
  assert.equal(s(4.2, 9), 10 + 8);        // 9 Reviews: nur +8, kein Rating-Bonus
  assert.equal(s(4.2, 12), 10 + 8 + 10);  // Bonus greift
  assert.equal(s(3.9, 50), 10 + 15);      // Rating zu niedrig
});

test('computeDemandScore: ohne Places-Match zählt nur der Bedarfsanteil', () => {
  assert.equal(computeDemandScore({ bucket: BUCKET.UNKLAR, audit: AUDIT_OHNE_URL, places: PLACES_KEIN_MATCH }), 15);
  assert.equal(computeDemandScore({ bucket: BUCKET.WEBSITE_GUT, audit: AUDIT_GUT, places: null }), 10);
});

test('computeDemandScore: CLOSED_PERMANENTLY → 0', () => {
  assert.equal(computeDemandScore({ bucket: BUCKET.UNKLAR, audit: AUDIT_OHNE_URL, places: PLACES_ZU }), 0);
});

test('priorityFromScore: Schwellen 60/35', () => {
  assert.equal(priorityFromScore(60), 'high');
  assert.equal(priorityFromScore(59), 'medium');
  assert.equal(priorityFromScore(35), 'medium');
  assert.equal(priorityFromScore(34), 'low');
});

// ── Namens-Guard ──────────────────────────────────────────────────────────────

test('namesSimilar: Rechtsform-/Branchen-Füllwörter stören den Match nicht', () => {
  assert.equal(namesSimilar('Kanzlei Dr. Müller', 'Dr. Müller Rechtsanwälte'), true);
  assert.equal(namesSimilar('Physiotherapie im Sonnengrund', 'Physiotherapie Sonnengrund GmbH'), true);
  assert.equal(namesSimilar('Grill | Café', 'Grill Café Paderborn'), true);
});

test('namesSimilar: verschiedene Betriebe matchen nicht', () => {
  assert.equal(namesSimilar('Balthasar', 'Pizzeria Roma'), false);
  assert.equal(namesSimilar('Kanzlei Schmidt', 'Kanzlei Meyer'), false);
});

// ── buildPlacesField / mergePlacesIntoLead ────────────────────────────────────

test('buildPlacesField: wählt den ersten namensähnlichen Kandidaten', () => {
  const lead = { name: 'Kanzlei Dr. Müller' };
  const candidates = [
    { placeId: 'a', name: 'Steuerbüro Krause', website: null, rating: 4, userRatingCount: 3, businessStatus: 'OPERATIONAL', phone: '' },
    { placeId: 'b', name: 'Dr. Müller Rechtsanwälte', website: 'https://m.de', rating: 4.8, userRatingCount: 44, businessStatus: 'OPERATIONAL', phone: '05251 2' }
  ];
  const f = buildPlacesField(lead, candidates, '2026-07-14T10:00:00.000Z');
  assert.equal(f.matched, true);
  assert.equal(f.placeId, 'b');
  assert.equal(f.checkedAt, '2026-07-14T10:00:00.000Z');
});

test('buildPlacesField: kein ähnlicher Kandidat → matched:false wird persistiert (kein Re-Billing)', () => {
  const f = buildPlacesField({ name: 'Balthasar' }, [{ placeId: 'x', name: 'Pizzeria Roma' }], '2026-07-14T10:00:00.000Z');
  assert.equal(f.matched, false);
  assert.equal(f.checkedAt, '2026-07-14T10:00:00.000Z');
  const leer = buildPlacesField({ name: 'Balthasar' }, [], '2026-07-14T10:00:00.000Z');
  assert.equal(leer.matched, false);
});

test('mergePlacesIntoLead: füllt nur Lücken, OSM gewinnt, Original bleibt unverändert', () => {
  const lead = { name: 'X', phone: '05251 111', website: null };
  const kopie = JSON.parse(JSON.stringify(lead));
  const merged = mergePlacesIntoLead(lead, { ...PLACES_MIT_SITE, phone: '05251 999' });
  assert.equal(merged.phone, '05251 111', 'vorhandenes OSM-Telefon bleibt');
  assert.equal(merged.website, 'https://gefunden.de', 'Website-Lücke wird gefüllt');
  assert.deepEqual(lead, kopie, 'Input darf nicht mutiert werden');
});

test('mergePlacesIntoLead: matched:false füllt gar nichts', () => {
  const merged = mergePlacesIntoLead({ name: 'X', phone: '', website: null }, { ...PLACES_MIT_SITE, matched: false });
  assert.equal(merged.website, null);
  assert.equal(merged.phone, '');
});

// ── needsPlacesCheck (TTL 90 Tage) ────────────────────────────────────────────

test('needsPlacesCheck: ohne checkedAt → true, frisch → false, älter als 90 Tage → true', () => {
  const now = new Date('2026-07-14T00:00:00.000Z');
  assert.equal(needsPlacesCheck({}, now), true);
  assert.equal(needsPlacesCheck({ places: { checkedAt: '2026-07-01T00:00:00.000Z' } }, now), false);
  assert.equal(needsPlacesCheck({ places: { checkedAt: '2026-01-01T00:00:00.000Z' } }, now), true);
});

// ── normalizeLeadV2 ───────────────────────────────────────────────────────────

test('normalizeLeadV2: Legacy-Record wird vollständig migriert', () => {
  const v2 = normalizeLeadV2(LEGACY_BALTHASAR);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.vertical, 'gastro', 'Vertical aus types/cuisine abgeleitet');
  assert.equal(v2.verticalLabel, 'Gastro');
  assert.equal(v2.branche, 'Gastro');
  assert.equal('websiteScore' in v2, false, 'Alt-Feld fliegt raus');
  assert.equal('rating' in v2, false, 'totes Feld fliegt raus');
  assert.equal('reviewCount' in v2, false, 'totes Feld fliegt raus');
  assert.ok(v2.audit && v2.audit.unverified, 'synthetisches Audit ist als unverifiziert markiert');
  assert.equal(v2.source, 'osm');
  assert.equal(v2.archived, false);
  assert.deepEqual(v2.activity, []);
  assert.equal(v2.outreach.sentAt, null);
  // Bestehende Felder bleiben erhalten
  assert.equal(v2.name, 'Balthasar');
  assert.equal(v2.website, 'https://www.restaurant-balthasar.de/');
});

test('normalizeLeadV2: idempotent (2x anwenden = 1x anwenden)', () => {
  const once = normalizeLeadV2(LEGACY_BALTHASAR);
  const twice = normalizeLeadV2(once);
  assert.deepEqual(twice, once);
});

test('normalizeLeadV2: v2-Felder werden nie überschrieben', () => {
  const lead = normalizeLeadV2({
    ...LEGACY_BALTHASAR,
    schemaVersion: 2,
    bucket: 'website-gut', demandScore: 42, source: 'inbound',
    places: PLACES_AKTIV, ansprechpartner: 'Frau Test',
    outreach: { channel: 'linkedin', variant: 'B', sentAt: '2026-07-10T00:00:00.000Z', repliedAt: null, nextActionAt: null },
    activity: [{ at: '2026-07-10T00:00:00.000Z', type: 'sent', text: 'LinkedIn B' }],
    audit: AUDIT_GUT
  });
  assert.equal(lead.bucket, 'website-gut');
  assert.equal(lead.demandScore, 42);
  assert.equal(lead.source, 'inbound');
  assert.equal(lead.ansprechpartner, 'Frau Test');
  assert.equal(lead.outreach.variant, 'B');
  assert.equal(lead.activity.length, 1);
  assert.equal(lead.audit.verdict, 'skip');
});

// ── applyScoring + qualifyLead (Orchestrierung mit injizierten Deps) ─────────

test('applyScoring: setzt bucket, demandScore, score-Alias, priority und websiteIssues konsistent', () => {
  const lead = normalizeLeadV2({ ...LEGACY_BALTHASAR, audit: AUDIT_SCHLECHT });
  const scored = applyScoring(lead);
  assert.equal(scored.bucket, BUCKET.WEBSITE_SCHLECHT);
  assert.equal(scored.demandScore, 46);
  assert.equal(scored.score, scored.demandScore, 'score ist Alias für demandScore');
  assert.equal(scored.priority, 'medium');
  assert.equal(scored.websiteIssues, 'Kein HTTPS');
});

test('qualifyLead: Places entdeckt Website → Re-Audit → website-schlecht mit übernommener URL', async () => {
  const lead = {
    id: 'x1', name: 'Physio Sonnengrund', address: 'Weg 1', city: 'Paderborn',
    website: null, audit: AUDIT_OHNE_URL, status: 'new', foundAt: '2026-07-01T00:00:00.000Z'
  };
  const lookupFn = async () => ({ ok: true, candidates: [{ placeId: 'p9', name: 'Physio Sonnengrund GmbH', website: 'https://physio-sonnengrund.de', rating: 4.6, userRatingCount: 31, businessStatus: 'OPERATIONAL', phone: '05251 77' }] });
  const auditFn = async ({ url }) => {
    assert.equal(url, 'https://physio-sonnengrund.de', 'entdeckte URL wird auditiert');
    return { verdict: 'qualified', needScore: 50, evidence: ['Kein HTTPS'], pitchHook: 'kein HTTPS', reachable: true, url };
  };
  const out = await qualifyLead(lead, { auditFn, lookupFn, now: new Date('2026-07-14T00:00:00.000Z'), reAudit: 'never' });
  assert.equal(out.bucket, BUCKET.WEBSITE_SCHLECHT);
  assert.equal(out.website, 'https://physio-sonnengrund.de');
  assert.equal(out.places.matched, true);
  // 30 (clamp(50*0.6,25,60)) + 15 (>=25 Reviews) + 10 (Rating) + 10 (OPERATIONAL)
  assert.equal(out.demandScore, 65);
  assert.equal(out.priority, 'high');
  assert.equal(lead.website, null, 'Input bleibt unverändert');
});

test('qualifyLead: Places ohne Match → unklar, matched:false bleibt gespeichert', async () => {
  const lead = { id: 'x2', name: 'Balthasar', city: 'Paderborn', website: null, audit: AUDIT_OHNE_URL, status: 'new' };
  const lookupFn = async () => ({ ok: true, candidates: [{ placeId: 'z', name: 'Pizzeria Roma' }] });
  const out = await qualifyLead(lead, { auditFn: async () => AUDIT_OHNE_URL, lookupFn, reAudit: 'never' });
  assert.equal(out.bucket, BUCKET.UNKLAR);
  assert.equal(out.places.matched, false);
});

test('qualifyLead: Lookup-Fehler (ok:false) → places bleibt null, Bucket unklar, kein Absturz', async () => {
  const lead = { id: 'x3', name: 'Cafe Test', website: null, audit: AUDIT_OHNE_URL, status: 'new' };
  const out = await qualifyLead(lead, { auditFn: async () => AUDIT_OHNE_URL, lookupFn: async () => ({ ok: false, reason: 'Cap' }), reAudit: 'never' });
  assert.equal(out.places, null);
  assert.equal(out.bucket, BUCKET.UNKLAR);
});

test('qualifyLead: reAudit=always holt ein frisches Audit', async () => {
  const lead = { id: 'x4', name: 'Alt', website: 'http://alt.de', audit: AUDIT_GUT, status: 'new', places: PLACES_KEIN_MATCH };
  let called = 0;
  const auditFn = async () => { called++; return AUDIT_SCHLECHT; };
  const out = await qualifyLead(lead, { auditFn, lookupFn: null, reAudit: 'always', now: new Date('2026-07-15T00:00:00.000Z') });
  assert.equal(called, 1);
  assert.equal(out.bucket, BUCKET.WEBSITE_SCHLECHT);
});
