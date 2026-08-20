const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildJsonLd } = require('../seo');

// ── Fixture ───────────────────────────────────────────────────────────────────
const BASE_URL = 'https://example.com/projects/restaurant-test/';

function makeProject() {
  return {
    id: 'restaurant-test',
    name: 'Trattoria Bella',
    category: 'Restaurant',
    description: 'Italienisches Restaurant in Paderborn.',
    cuisine: 'Italienisch',
    contact: {
      address: 'Westernstraße 12, 33098 Paderborn',
      phone: '05251 123456',
      email: 'hallo@trattoria-bella.de',
      hours: 'Di–Fr 11–22 Uhr'
    },
    logo: 'assets/logo.png',
    links: {
      instagram: 'https://instagram.com/trattoriabella',
      facebook: 'https://facebook.com/trattoriabella'
    }
  };
}

// ── Organization/publisher-Entität ──────────────────────────────────────────────
test('buildJsonLd liefert Organization-Knoten mit @id auf #org', () => {
  const ld = buildJsonLd(makeProject(), BASE_URL, { description: 'Test', image: 'https://example.com/og.jpg' });
  assert.ok(Array.isArray(ld['@graph']), '@graph ist ein Array');

  const org = ld['@graph'].find(n => n['@type'] === 'Organization');
  assert.ok(org, 'Organization-Knoten vorhanden');
  assert.match(org['@id'], /#org$/, '@id endet auf #org');
  assert.equal(org.name, 'Trattoria Bella');
  assert.equal(org.url, BASE_URL);
  assert.equal(org.logo, BASE_URL + 'assets/logo.png', 'logo via absUrl aufgelöst');
  assert.ok(Array.isArray(org.sameAs) && org.sameAs.length, 'sameAs aus links übernommen');
});

test('Business-Knoten verweist via publisher auf #org und hat mainEntityOfPage', () => {
  const ld = buildJsonLd(makeProject(), BASE_URL, { description: 'Test', image: null });

  const business = ld['@graph'].find(n => /#business$/.test(n['@id'] || ''));
  assert.ok(business, 'Business-Knoten vorhanden');
  assert.ok(business.publisher, 'publisher vorhanden');
  assert.match(business.publisher['@id'], /#org$/, 'publisher.@id endet auf #org');
  assert.equal(business.mainEntityOfPage, BASE_URL, 'mainEntityOfPage gesetzt');
});

test('Graph enthält Business + Organization + BreadcrumbList', () => {
  const ld = buildJsonLd(makeProject(), BASE_URL, { description: 'Test', image: null });

  assert.ok(ld['@graph'].some(n => /#business$/.test(n['@id'] || '')), 'Business-Knoten vorhanden');
  assert.ok(ld['@graph'].some(n => n['@type'] === 'Organization'), 'Organization vorhanden');
  assert.ok(ld['@graph'].some(n => n['@type'] === 'BreadcrumbList'), 'BreadcrumbList vorhanden');
});

test('Organization lässt logo und sameAs aus, wenn keine echten Daten vorhanden', () => {
  const project = { id: 'x', name: 'Café Sonne', category: 'Café', contact: {} };
  const ld = buildJsonLd(project, BASE_URL, { description: 'Test', image: null });

  const org = ld['@graph'].find(n => n['@type'] === 'Organization');
  assert.ok(org, 'Organization-Knoten vorhanden');
  assert.equal(org.name, 'Café Sonne');
  assert.ok(!('logo' in org), 'kein logo ohne echte Logo-Quelle');
  assert.ok(!('sameAs' in org), 'kein sameAs ohne Links');
  assert.ok(!('image' in org), 'kein image ohne Bild');
});

test('JSON.stringify des Ergebnisses parst verlustfrei zurück', () => {
  const ld = buildJsonLd(makeProject(), BASE_URL, { description: 'Test', image: 'https://example.com/og.jpg' });
  const json = JSON.stringify(ld);
  const parsed = JSON.parse(json);

  assert.equal(parsed['@context'], 'https://schema.org');
  assert.ok(Array.isArray(parsed['@graph']));
  assert.ok(parsed['@graph'].some(n => n['@type'] === 'Organization'));
});
