const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildScrapeReport, compareTeamNames, normalizeName } = require('../scrape-report');

// ── Namens-Normalisierung / Team-Abgleich ───────────────────────────────────────

test('normalizeName: Titel raus, Umlaute vereinheitlicht', () => {
  assert.equal(normalizeName('Dr. Anna Müller'), 'anna mueller');
  assert.equal(normalizeName('Prof. Dr. h.c. Jörg Weiß'), 'joerg weiss');
});

test('compareTeamNames: erkennt fehlende Personen trotz Titel-Varianten', () => {
  const onOverview = ['Dr. Anna Müller', 'Ben Beispiel', 'Clara Muster'];
  const extracted = [{ name: 'Anna Müller' }, { name: 'Ben Beispiel, Fachanwalt' }];
  const r = compareTeamNames(onOverview, extracted);
  assert.deepEqual(r.missing, ['Clara Muster']);
  assert.equal(r.extracted.length, 2);
});

// ── Report / Coverage ───────────────────────────────────────────────────────────

const CLASSIFIED = [
  { url: 'https://x.de/', path: '/', type: 'home' },
  { url: 'https://x.de/team', path: '/team', type: 'team-overview' },
  { url: 'https://x.de/team/anna-muster', path: '/team/anna-muster', type: 'team-profile' },
  { url: 'https://x.de/team/ben-beispiel', path: '/team/ben-beispiel', type: 'team-profile' },
  { url: 'https://x.de/rechtsgebiete/arbeitsrecht', path: '/rechtsgebiete/arbeitsrecht', type: 'practice-area' },
  { url: 'https://x.de/impressum', path: '/impressum', type: 'legal-impressum' }
];

test('buildScrapeReport: deterministische Zuordnung used/skipped', () => {
  const result = {
    team: [{ slug: 'anna-muster', name: 'Anna Muster' }],
    specialtyDetails: [{ slug: 'arbeitsrecht', name: 'Arbeitsrecht' }],
    legal: { impressum: { url: '', text: 'x' } }
  };
  const report = buildScrapeReport({ inventory: CLASSIFIED, classified: CLASSIFIED, result });
  const usedUrls = report.used.map(u => u.url);
  assert.ok(usedUrls.includes('https://x.de/team/anna-muster'));
  assert.ok(usedUrls.includes('https://x.de/rechtsgebiete/arbeitsrecht'));
  assert.ok(usedUrls.includes('https://x.de/impressum'));
  // Ben hat eine Profil-Seite, wurde aber nicht extrahiert → skipped + Warnung
  const skippedUrls = report.skipped.map(s => s.url);
  assert.ok(skippedUrls.includes('https://x.de/team/ben-beispiel'));
  assert.ok(report.warnings.some(w => w.includes('2 Profil-Seiten')));
  assert.equal(report.team.profilePagesFound, 2);
});

test('buildScrapeReport: extractionLog hat Vorrang', () => {
  const log = [
    { url: 'https://x.de/team/ben-beispiel', usedAs: 'team:ben-beispiel' },
    { url: 'https://x.de/rechtsgebiete/arbeitsrecht', reason: 'zu wenig Text' }
  ];
  const report = buildScrapeReport({ inventory: CLASSIFIED, classified: CLASSIFIED, result: {}, extractionLog: log });
  assert.ok(report.used.some(u => u.url.endsWith('ben-beispiel')));
  assert.ok(report.skipped.some(s => s.url.endsWith('arbeitsrecht') && s.reason === 'zu wenig Text'));
});

test('buildScrapeReport: Coverage-Mathe und Soft-Gate-Flag', () => {
  // Nichts extrahiert → Content-Coverage 0% → geflaggt, aber kein Throw
  const report = buildScrapeReport({ inventory: CLASSIFIED, classified: CLASSIFIED, result: {} });
  assert.equal(report.coverage.contentPagesUsedPct, 0);
  assert.equal(report.flagged, true);
  assert.ok(report.warnings.some(w => w.includes('Coverage')));

  // Alles extrahiert → 100 %, kein Flag
  const full = buildScrapeReport({
    inventory: CLASSIFIED, classified: CLASSIFIED,
    result: {
      team: [{ slug: 'anna-muster', name: 'Anna' }, { slug: 'ben-beispiel', name: 'Ben' }],
      specialtyDetails: [{ slug: 'arbeitsrecht' }],
      legal: { impressum: { text: 'x' } },
      phone: '0123'
    }
  });
  assert.equal(full.coverage.contentPagesUsedPct, 100);
  assert.equal(full.flagged, false);
});

test('buildScrapeReport: SCRAPE_MIN_COVERAGE steuert die Schwelle', () => {
  const result = { team: [{ slug: 'anna-muster', name: 'Anna' }] }; // 2 von 4 Content-Seiten = 50%
  process.env.SCRAPE_MIN_COVERAGE = '40';
  try {
    const lax = buildScrapeReport({ inventory: CLASSIFIED, classified: CLASSIFIED, result });
    assert.equal(lax.flagged, false);
    process.env.SCRAPE_MIN_COVERAGE = '90';
    const strict = buildScrapeReport({ inventory: CLASSIFIED, classified: CLASSIFIED, result });
    assert.equal(strict.flagged, true);
  } finally {
    delete process.env.SCRAPE_MIN_COVERAGE;
  }
});

test('buildScrapeReport: Inventar-Statistik nach Quelle und Typ', () => {
  const inv = CLASSIFIED.map((e, i) => ({ ...e, source: i < 2 ? 'sitemap' : 'crawl' }));
  const report = buildScrapeReport({ inventory: inv, classified: CLASSIFIED, result: {} });
  assert.equal(report.inventory.total, 6);
  assert.equal(report.inventory.bySource.sitemap, 2);
  assert.equal(report.inventory.bySource.crawl, 4);
  assert.equal(report.inventory.byType['team-profile'], 2);
});
