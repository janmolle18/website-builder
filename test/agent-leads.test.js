const { test } = require('node:test');
const assert = require('node:assert');

const {
  ALL_VERTICALS, normalizeVerticals, buildOverpassQuery,
  categoryOf, verticalOf, osmToBusiness, elementsToBusinesses, toLead, findLeads
} = require('../agent-leads');

const BBOX = { south: 51.6, west: 8.6, north: 51.8, east: 8.9 };

test('normalizeVerticals: unbekannte/leere Auswahl → alle Verticals', () => {
  assert.deepStrictEqual(normalizeVerticals([]), ALL_VERTICALS);
  assert.deepStrictEqual(normalizeVerticals(['quatsch']), ALL_VERTICALS);
  assert.deepStrictEqual(normalizeVerticals(undefined), ALL_VERTICALS);
});

test('normalizeVerticals: gültige Auswahl bleibt erhalten + dedupliziert', () => {
  assert.deepStrictEqual(normalizeVerticals(['kanzlei', 'kanzlei', 'gastro']), ['kanzlei', 'gastro']);
  assert.deepStrictEqual(normalizeVerticals('praxis,gastro'), ['praxis', 'gastro']);
});

test('buildOverpassQuery: enthält Selektoren aller gewählten Verticals als Regex', () => {
  const q = buildOverpassQuery(BBOX, ['gastro', 'kanzlei', 'praxis']);
  assert.match(q, /\["amenity"~"\^\(restaurant\|cafe\|bar\|fast_food\|pub\)\$"\]/);
  assert.match(q, /\["office"~"\^\(lawyer\|tax_advisor\|notary\)\$"\]/);
  assert.match(q, /\["amenity"~"\^\(doctors\|dentist\)\$"\]/);
  assert.match(q, /\["healthcare"~/);
  // node UND way pro Selektor
  assert.match(q, /node\["office"/);
  assert.match(q, /way\["office"/);
  // Bounding-Box korrekt eingesetzt
  assert.ok(q.includes(`${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`));
});

test('buildOverpassQuery: nur der gewählte Vertical steht drin', () => {
  const q = buildOverpassQuery(BBOX, ['kanzlei']);
  assert.match(q, /"office"~/);
  assert.doesNotMatch(q, /restaurant\|cafe/);
  assert.doesNotMatch(q, /"healthcare"/);
});

test('categoryOf/verticalOf: klassifiziert korrekt', () => {
  assert.strictEqual(categoryOf({ office: 'lawyer' }), 'lawyer');
  assert.strictEqual(verticalOf('lawyer'), 'kanzlei');
  assert.strictEqual(verticalOf('tax_advisor'), 'kanzlei');
  assert.strictEqual(verticalOf('notary'), 'kanzlei');
  assert.strictEqual(categoryOf({ amenity: 'restaurant' }), 'restaurant');
  assert.strictEqual(verticalOf('restaurant'), 'gastro');
  assert.strictEqual(categoryOf({ amenity: 'dentist' }), 'dentist');
  assert.strictEqual(verticalOf('dentist'), 'praxis');
  assert.strictEqual(categoryOf({ healthcare: 'physiotherapist' }), 'physiotherapist');
  assert.strictEqual(verticalOf('physiotherapist'), 'praxis');
});

test('osmToBusiness: baut Adresse, Kategorie und Vertical', () => {
  const el = {
    type: 'node', id: 42, lat: 51.7, lon: 8.75,
    tags: {
      name: 'Kanzlei Muster', office: 'lawyer',
      'addr:street': 'Hauptstr', 'addr:housenumber': '5',
      'addr:postcode': '33098', 'addr:city': 'Paderborn',
      'contact:phone': '05251 123', website: 'http://kanzlei-muster.de'
    }
  };
  const biz = osmToBusiness(el);
  assert.strictEqual(biz.osmId, 'node/42');
  assert.strictEqual(biz.name, 'Kanzlei Muster');
  assert.strictEqual(biz.address, 'Hauptstr 5, 33098 Paderborn');
  assert.strictEqual(biz.phone, '05251 123');
  assert.strictEqual(biz.category, 'lawyer');
  assert.strictEqual(biz.vertical, 'kanzlei');
  assert.strictEqual(biz.verticalLabel, 'Kanzlei');
});

test('elementsToBusinesses: filtert Namenlose, dedupliziert, respektiert existingIds + maxResults', () => {
  const els = [
    { type: 'node', id: 1, tags: { name: 'A', amenity: 'restaurant' } },
    { type: 'node', id: 1, tags: { name: 'A', amenity: 'restaurant' } }, // Duplikat
    { type: 'node', id: 2, tags: { amenity: 'cafe' } },                   // ohne Name
    { type: 'way', id: 3, tags: { name: 'B', office: 'notary' } },
    { type: 'way', id: 4, tags: { name: 'C', amenity: 'dentist' } },
  ];
  const existingIds = new Set(['way/3']);
  const out = elementsToBusinesses(els, { existingIds, maxResults: 10 });
  const ids = out.map(b => b.osmId);
  assert.deepStrictEqual(ids, ['node/1', 'way/4']); // Duplikat, Namenlos, Existierendes raus
  assert.strictEqual(elementsToBusinesses(els, { maxResults: 1 }).length, 1);
});

test('toLead: mappt Audit-Verdict auf Prioritität und Schema-Felder', () => {
  const biz = osmToBusiness({ type: 'node', id: 7, tags: { name: 'X', amenity: 'restaurant', cuisine: 'italian' } });
  // reachable:true wie in der echten Pipeline (auditProspect setzt es bei erreichbarer Site).
  // Bucket-Scoring: WEBSITE_SCHLECHT → needScore·0,6 = 49; ohne Places-Aktivität ⇒ 'medium'.
  // (Alte Erwartung 'high' stammte aus der Vor-Bucket-Ära, in der das Verdict direkt mappte.)
  const audit = { verdict: 'qualified', needScore: 82, reachable: true, evidence: ['Kein HTTPS', 'Nicht mobil'], pitchHook: 'kein HTTPS' };
  const lead = toLead(biz, audit, 'Paderborn');
  assert.strictEqual(lead.bucket, 'website-schlecht');
  assert.strictEqual(lead.priority, 'medium');
  assert.strictEqual(lead.score, 49);
  assert.strictEqual(lead.branche, 'Gastro');
  assert.strictEqual(lead.vertical, 'gastro');
  assert.strictEqual(lead.websiteIssues, 'Kein HTTPS, Nicht mobil');
  assert.deepStrictEqual(lead.types, ['restaurant', 'italian']);
  assert.strictEqual(lead.audit.verdict, 'qualified');
  assert.strictEqual(lead.status, 'new');
});

test('findLeads: End-to-End mit injizierten Deps — sortiert solide Seiten aus', async () => {
  const elements = [
    { type: 'node', id: 100, tags: { name: 'Alt-Kanzlei', office: 'lawyer', website: 'http://alt.de' } },
    { type: 'node', id: 101, tags: { name: 'Moderne Praxis', amenity: 'dentist', website: 'https://modern.de' } },
    { type: 'node', id: 102, tags: { name: 'Cafe Ohne Site', amenity: 'cafe' } },
  ];
  const auditsByName = {
    'Alt-Kanzlei': { verdict: 'qualified', needScore: 76, evidence: ['Kein HTTPS'], pitchHook: 'kein HTTPS' },
    'Moderne Praxis': { verdict: 'skip', needScore: 5, evidence: [], pitchHook: 'solide' },
    'Cafe Ohne Site': { verdict: 'qualified', needScore: 100, evidence: ['Keine Website'], pitchHook: 'keine Website' },
  };
  const deps = {
    geocode: async () => BBOX,
    fetchElements: async () => elements,
    audit: async ({ name }) => auditsByName[name],
    pitch: async () => 'PITCH',
  };
  // isoliertes leads.json über Env? findLeads schreibt echt — hier nur newLeads prüfen.
  const before = require('../agent-leads').loadLeads().length;
  const result = await findLeads({ city: 'Paderborn', verticals: ['kanzlei', 'praxis', 'gastro'], onlyQualified: true }, deps);
  assert.strictEqual(result.newLeads.length, 2, 'solide Praxis muss aussortiert sein');
  assert.strictEqual(result.skipped, 1);
  const names = result.newLeads.map(l => l.name).sort();
  assert.deepStrictEqual(names, ['Alt-Kanzlei', 'Cafe Ohne Site']);
  assert.strictEqual(result.newLeads.every(l => l.pitchText === null), true, 'withPitch=false → kein LLM-Text');

  // Aufräumen: die zwei Test-Leads wieder entfernen, damit leads.json sauber bleibt.
  const { loadLeads, saveLeads } = require('../agent-leads');
  const cleaned = loadLeads().filter(l => !['node/100', 'node/102'].includes(l.osmId));
  saveLeads(cleaned);
  assert.strictEqual(cleaned.length, before);
});
