const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { enrichFromInventory } = require('../agent-scraper');

// Mini-Site über localhost — deterministisch, kein externes Netz, keine Claude-Calls
// (kein team-profile im classified-Input → structureProfiles wird nie aufgerufen).
const PAGES = {
  '/impressum': `<html><body><h1>Impressum</h1><p>Kanzlei Muster, Musterstr. 1, 33098 Paderborn.
    E-Mail: kanzlei@muster.de</p><p>${'Rechtstext '.repeat(30)}</p></body></html>`,
  '/rechtsgebiete/arbeitsrecht': `<html><body><h1>Arbeitsrecht</h1>
    <p>${'Wir beraten Arbeitnehmer und Arbeitgeber umfassend. '.repeat(10)}</p></body></html>`,
  '/rechtsgebiete/erbrecht': `<html><body><h1>Erbrecht</h1>
    <p>${'Testament, Erbvertrag und Pflichtteil. '.repeat(10)}</p></body></html>`,
  '/aktuelles': `<html><body><h1>Aktuelles</h1><p>${'Neuigkeiten aus der Kanzlei. '.repeat(10)}</p>
    <a href="/aktuelles/beitrag-1">Beitrag 1</a></body></html>`,
  '/aktuelles/beitrag-1': `<html><body><h1>Neues Urteil</h1><p>${'Details zum Urteil. '.repeat(10)}</p></body></html>`
};

let server, baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const html = PAGES[req.url.replace(/\/+$/, '') || '/'];
    if (!html) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(() => server && server.close());

function classifiedFixture() {
  const entry = (path, type, textLength = 500) =>
    ({ url: new URL(path, baseUrl).href, path, type, personName: null, textLength, linkTexts: [] });
  return [
    entry('/', 'home'),
    entry('/impressum', 'legal-impressum'),
    entry('/rechtsgebiete/arbeitsrecht', 'practice-area'),
    entry('/rechtsgebiete/erbrecht', 'practice-area'),
    entry('/aktuelles', 'news'),
    entry('/aktuelles/beitrag-1', 'news'),
    entry('/leer', 'other', 50) // zu wenig Text → muss geskippt werden
  ];
}

test('enrichFromInventory: Rechtsgebiete aus Klassifizierung, ohne hardcodierte Pfade', async () => {
  const result = { specialties: ['Mietrecht'] };
  const { extractionLog } = await enrichFromInventory(result, classifiedFixture(), '<html></html>', baseUrl);

  const slugs = (result.specialtyDetails || []).map(d => d.slug).sort();
  assert.deepEqual(slugs, ['arbeitsrecht', 'erbrecht']);
  // Spiegelung: gescrapte Gebiete zuerst, Alt-Eintrag bleibt erhalten
  assert.ok(result.specialties.includes('Arbeitsrecht'));
  assert.ok(result.specialties.includes('Mietrecht'));
  assert.ok(extractionLog.some(l => l.usedAs === 'rechtsgebiet:arbeitsrecht'));
});

test('enrichFromInventory: Impressum verbatim + NAP-Backfill aus Impressum', async () => {
  const result = { address: 'Musterstr. 1, Paderborn' };
  await enrichFromInventory(result, classifiedFixture(), '<html></html>', baseUrl);

  assert.ok(result.legal && result.legal.impressum && result.legal.impressum.text.includes('Rechtstext'));
  assert.equal(result.email, 'kanzlei@muster.de');       // aus Impressum nachgezogen
  assert.ok(/33098/.test(result.address));                // PLZ ergänzt
});

test('enrichFromInventory: news-Seiten werden zu Extra-Seiten mit Unterseiten gruppiert', async () => {
  const result = {};
  const { extractionLog } = await enrichFromInventory(result, classifiedFixture(), '<html></html>', baseUrl);

  const akt = (result.extraPages || []).find(p => p.key === 'aktuelles');
  assert.ok(akt, 'aktuelles muss als Extra-Seite existieren');
  assert.equal(akt.subPages.length, 1);
  assert.equal(akt.subPages[0].title, 'Neues Urteil');
  // Seite mit zu wenig Text landet im Log als Skip mit Begründung
  assert.ok(extractionLog.some(l => l.reason === 'zu wenig Text' && l.url.includes('/leer')));
});
