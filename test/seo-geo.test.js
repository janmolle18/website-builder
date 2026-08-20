const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applySEO, writeSeoFiles, writeDiscoveryFiles, buildJsonLd } = require('../seo');

// ── Fixture ───────────────────────────────────────────────────────────────────
const BASE_URL = 'https://example.com/projects/kanzlei-test/';

function makeProject() {
  return {
    id: 'kanzlei-test',
    name: 'Kanzlei Müller & Söhne',
    category: 'Rechtsanwaltskanzlei',
    description: 'Rechtsanwälte für Familienrecht und Erbrecht in Köln.',
    contact: {
      address: 'Hauptstraße 12, 50667 Köln',
      phone: '0221 1234567',
      email: 'kontakt@kanzlei-mueller.de',
      hours: 'Mo–Fr 9–18 Uhr'
    },
    specialties: ['Familienrecht', 'Erbrecht'],
    legalPages: { impressum: 'impressum.html', datenschutz: 'datenschutz.html' },
    subpages: ['rechtsgebiete.html', 'anwaelte.html', 'anwaelte/max-mueller.html', 'kontakt.html']
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seo-geo-'));
}

// ── llms.txt ────────────────────────────────────────────────────────────────────
test('writeDiscoveryFiles schreibt llms.txt mit Businessname und Seitenlink', () => {
  const dir = mkTmp();
  writeDiscoveryFiles(dir, makeProject(), BASE_URL);
  const llms = fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8');

  assert.match(llms, /^# Kanzlei Müller & Söhne/m, 'H1 = Businessname mit echten Umlauten');
  assert.match(llms, /Adresse: Hauptstraße 12, 50667 Köln/);
  assert.match(llms, /Telefon: 0221 1234567/);
  assert.ok(llms.includes(`[Startseite](${BASE_URL})`), 'Startseiten-Link als Markdown');
  assert.ok(llms.includes(`(${BASE_URL}kontakt.html)`), 'Subpage-Link in llms.txt');
});

test('llms.txt überspringt fehlende Daten (lieber nichts als falsch)', () => {
  const dir = mkTmp();
  const project = { id: 'x', name: 'Café Sonne', contact: {} };
  writeDiscoveryFiles(dir, project, BASE_URL);
  const llms = fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8');

  assert.match(llms, /^# Café Sonne/m);
  assert.ok(!/Telefon:/.test(llms), 'keine Telefon-Zeile ohne Nummer');
  assert.ok(!/Adresse:/.test(llms), 'keine Adress-Zeile ohne Adresse');
  assert.ok(llms.includes(`[Startseite](${BASE_URL})`));
});

// ── sitemap.xml ───────────────────────────────────────────────────────────────────
test('writeDiscoveryFiles-Sitemap enthält Subpage- und Rechtsseiten-URL', () => {
  const dir = mkTmp();
  writeDiscoveryFiles(dir, makeProject(), BASE_URL);
  const sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');

  assert.ok(sitemap.includes(`<loc>${BASE_URL}</loc>`), 'Startseite enthalten');
  assert.ok(sitemap.includes(`<loc>${BASE_URL}kontakt.html</loc>`), 'Subpage enthalten');
  assert.ok(sitemap.includes(`<loc>${BASE_URL}impressum.html</loc>`), 'Rechtsseite enthalten');
  assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, 'lastmod gesetzt');
});

test('writeSeoFiles-Sitemap (früh) enthält nur die Startseite', () => {
  const dir = mkTmp();
  writeSeoFiles(dir, makeProject(), BASE_URL);
  const sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');
  const locCount = (sitemap.match(/<loc>/g) || []).length;
  assert.equal(locCount, 1, 'Basis-Sitemap nur Startseite');
});

// ── robots.txt ────────────────────────────────────────────────────────────────────
test('robots.txt erlaubt AI-Crawler explizit + behält Wildcard und Sitemap', () => {
  const dir = mkTmp();
  writeDiscoveryFiles(dir, makeProject(), BASE_URL);
  const robots = fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8');

  for (const ua of ['GPTBot', 'PerplexityBot', 'ClaudeBot', 'OAI-SearchBot', 'Google-Extended', 'anthropic-ai']) {
    assert.match(robots, new RegExp(`User-agent: ${ua}\\nAllow: /`), `${ua} explizit erlaubt`);
  }
  assert.match(robots, /User-agent: \*\nAllow: \//, 'generischer Block bleibt');
  assert.match(robots, new RegExp(`Sitemap: ${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}sitemap.xml`), 'Sitemap-Zeile bleibt');
});

// ── JSON-LD: BreadcrumbList + dateModified ──────────────────────────────────────────
test('buildJsonLd liefert @graph mit BreadcrumbList und dateModified', () => {
  const ld = buildJsonLd(makeProject(), BASE_URL, { description: 'Test', image: null });
  assert.ok(Array.isArray(ld['@graph']), '@graph ist ein Array');

  const business = ld['@graph'].find(n => /Attorney|LegalService|LocalBusiness/.test(n['@type']));
  assert.ok(business, 'Business-Knoten vorhanden');
  assert.ok(business.datePublished, 'datePublished gesetzt');
  assert.match(business.dateModified, /^\d{4}-\d{2}-\d{2}T/, 'dateModified ist ISO');

  const breadcrumb = ld['@graph'].find(n => n['@type'] === 'BreadcrumbList');
  assert.ok(breadcrumb, 'BreadcrumbList vorhanden');
  assert.equal(breadcrumb.itemListElement[0].name, 'Start');
  assert.equal(breadcrumb.itemListElement[0].item, BASE_URL);
});

test('buildJsonLd behält bestehende NAP-Felder im Business-Knoten', () => {
  const ld = buildJsonLd(makeProject(), BASE_URL, { description: 'Test', image: null });
  const business = ld['@graph'][0];
  assert.equal(business.name, 'Kanzlei Müller & Söhne');
  assert.ok(business.address, 'Adresse vorhanden');
  assert.ok(business.telephone, 'Telefon vorhanden');
  assert.ok(business.openingHoursSpecification, 'Öffnungszeiten geparst');
});

// ── applySEO: JSON-LD parst und Breadcrumb landet im HTML ────────────────────────────
test('applySEO injiziert valides JSON-LD mit BreadcrumbList', () => {
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><h1>Test</h1></body></html>';
  const { html: out } = applySEO(html, makeProject(), BASE_URL);

  const m = out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'JSON-LD-Block vorhanden');
  const parsed = JSON.parse(m[1].trim());
  assert.ok(Array.isArray(parsed['@graph']), 'JSON-LD parst als @graph');
  assert.ok(parsed['@graph'].some(n => n['@type'] === 'BreadcrumbList'), 'BreadcrumbList im injizierten LD');
});

// ── C1: FAQ in llms.txt ─────────────────────────────────────────────────────
test('llms.txt enthält Answer-First-FAQ, wenn project.faq vorhanden', () => {
  const { writeDiscoveryFiles } = require('../seo');
  const os = require('os'); const fs = require('fs'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llms-faq-'));
  const project = {
    id: 'x', name: 'Kanzlei Test', category: 'Rechtsanwaltskanzlei',
    contact: { address: 'Weg 1, 33098 Paderborn' },
    specialties: ['Verkehrsrecht', 'Familienrecht'],
    faq: [{ q: 'Was kostet ein Erstgespräch?', a: 'Das Erstgespräch wird individuell vereinbart und richtet sich nach dem Aufwand.' }]
  };
  writeDiscoveryFiles(dir, project, 'https://kanzlei-test.de/');
  const llms = fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8');
  assert.match(llms, /## Häufige Fragen/);
  assert.match(llms, /Was kostet ein Erstgespräch\?/);
  assert.match(llms, /individuell vereinbart/);
  assert.match(llms, /## Leistungen/);
  assert.match(llms, /Verkehrsrecht/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('llms.txt ohne FAQ → kein Häufige-Fragen-Block', () => {
  const { writeDiscoveryFiles } = require('../seo');
  const os = require('os'); const fs = require('fs'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llms-nofaq-'));
  writeDiscoveryFiles(dir, { id: 'y', name: 'Test', contact: {} }, 'https://t.de/');
  const llms = fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8');
  assert.doesNotMatch(llms, /Häufige Fragen/);
  fs.rmSync(dir, { recursive: true, force: true });
});
