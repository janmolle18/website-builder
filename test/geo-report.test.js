const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeGeo, CHECKS } = require('../geo');

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const FULL_JSONLD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Attorney', '@id': 'x#business', name: 'Kanzlei Test',
      address: { '@type': 'PostalAddress', streetAddress: 'Weg 1' },
      telephone: '+49 123', dateModified: '2026-07-02T00:00:00Z',
      publisher: { '@id': 'x#org' }, knowsAbout: ['Verkehrsrecht']
    },
    { '@type': 'Organization', '@id': 'x#org', name: 'Kanzlei Test' }
  ]
});
const FAQ_JSONLD = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question', name: 'Was kostet ein Erstgespräch?', acceptedAnswer: { '@type': 'Answer', text: 'Ein Erstgespräch wird individuell vereinbart und richtet sich nach dem Aufwand. Details klären wir persönlich.' } }]
});

test('Gewichte summieren sich zu 100', () => {
  assert.equal(CHECKS.reduce((s, c) => s + c.weight, 0), 100);
});

test('voll ausgestattete Site erreicht hohen GEO-Score', () => {
  const dir = tmpProject({
    'index.html': `<!doctype html><html><head>
      <script type="application/ld+json">${FULL_JSONLD}</script>
      <script type="application/ld+json">${FAQ_JSONLD}</script>
      </head><body>x</body></html>`,
    'robots.txt': 'User-agent: GPTBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /',
    'llms.txt': '# Kanzlei Test\n## Leistungen\n- Verkehrsrecht',
    'sitemap.xml': '<urlset><url><loc>https://x/</loc></url></urlset>'
  });
  const r = analyzeGeo(dir, {});
  assert.ok(r.score >= 90, `Score sollte >=90 sein, war ${r.score}`);
  assert.equal(r.grade, 'A');
  assert.equal(r.missing.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nackte Site (nur HTML) erkennt fehlende GEO-Bausteine', () => {
  const dir = tmpProject({ 'index.html': '<!doctype html><html><head></head><body>x</body></html>' });
  const r = analyzeGeo(dir, {});
  assert.ok(r.score < 40, `Score sollte niedrig sein, war ${r.score}`);
  assert.ok(r.missing.length > 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ohne index.html → Score 0, kein Absturz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-empty-'));
  const r = analyzeGeo(dir, {});
  assert.equal(r.score, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('defektes JSON-LD wird ignoriert statt zu werfen', () => {
  const dir = tmpProject({
    'index.html': '<!doctype html><html><head><script type="application/ld+json">{ kaputt }</script></head><body>x</body></html>'
  });
  const r = analyzeGeo(dir, {});
  assert.equal(r.checks.find(c => c.key === 'jsonld_business').pass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Ergänzt 2026-08-10 (Mer:Form): Sport-/Wellness-Betriebe wurden nicht als
// Business erkannt, obwohl ihr Schema korrekt war — SportsActivityLocation
// fehlte in BUSINESS_TYPES. Ein Pilatesstudio verlor dadurch 16 von 100 Punkten.
test('erkennt Sport- und Wellness-Betriebe als Business-Schema', () => {
  const types = [
    'SportsActivityLocation', 'SportsClub', 'HealthClub', 'YogaStudio',
    'HealthAndBeautyBusiness', 'DaySpa', 'Physiotherapy'
  ];

  for (const type of types) {
    const dir = tmpProject({
      'index.html': `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [{ '@type': type, '@id': 'x#business', name: 'Test', knowsAbout: ['Test'] }]
      })}</script></head><body></body></html>`
    });
    const report = analyzeGeo(dir);
    const check = report.checks.find(c => c.key === 'jsonld_business');
    assert.equal(check.pass, true, `${type} muss als Business-Schema gelten`);
  }
});

test('erkennt Typ-Arrays wie ["LocalBusiness","SportsActivityLocation"]', () => {
  const dir = tmpProject({
    'index.html': `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': ['LocalBusiness', 'SportsActivityLocation'], '@id': 'x#business', name: 'Test' }]
    })}</script></head><body></body></html>`
  });
  const check = analyzeGeo(dir).checks.find(c => c.key === 'jsonld_business');
  assert.equal(check.pass, true);
  assert.match(check.detail, /SportsActivityLocation/);
});
