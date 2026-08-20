const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cheerio = require('cheerio');
const { buildSubpageSchema, validateSubpageSchema, localityFromAddress } = require('../subpage-schema');

// Regression (Code-Review MEDIUM): Ort robust aus der Adresse ziehen — weder Straße noch
// Hausnummer dürfen als areaServed landen (nutzt jetzt den PLZ-verankerten seo.js-Parser).
test('localityFromAddress: PLZ+Ort ohne Komma → nur der Ort', () => {
  assert.equal(localityFromAddress('Paderwall 13 33102 Paderborn'), 'Paderborn');
});
test('localityFromAddress: lange Hausnummer verwirrt den Ort nicht', () => {
  assert.equal(localityFromAddress('Bahnhofstraße 1200, 33098 Paderborn'), 'Paderborn');
});
test('localityFromAddress: Standardformat Straße, PLZ Ort', () => {
  assert.equal(localityFromAddress('Musterstraße 1, 33100 Paderborn'), 'Paderborn');
});
test('localityFromAddress: leere/fehlende Adresse → null', () => {
  assert.equal(localityFromAddress(''), null);
  assert.equal(localityFromAddress(undefined), null);
});

const PROJECT = { name: 'Dr. Weber & Mustermann Rechtsanwälte', category: 'kanzlei', contact: { address: 'Musterstraße 1, 33100 Paderborn' } };

function page(h1, body = '') {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h1} – Kanzlei</title></head><body><h1 class="reveal">${h1}</h1>${body}</body></html>`;
}

function site({ withIndexSchema = true, areas = { 'strafrecht': 'Strafrecht' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subschema-'));
  const idxSchema = withIndexSchema ? '<script type="application/ld+json">{"@context":"https://schema.org","@type":"LegalService","name":"Kanzlei"}</script>' : '';
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${idxSchema}<title>Start</title></head><body><h1>Start</h1></body></html>`);
  fs.mkdirSync(path.join(dir, 'rechtsgebiete'));
  for (const [slug, name] of Object.entries(areas)) {
    fs.writeFileSync(path.join(dir, 'rechtsgebiete', `${slug}.html`),
      page(name, `<p>Unsere Kanzlei berät Sie umfassend im ${name} — von der ersten Beratung bis zur Vertretung vor Gericht.</p>`));
  }
  return dir;
}

function jsonLdNodes(html) {
  const $ = cheerio.load(html);
  const nodes = [];
  $('script[type="application/ld+json"]').each((i, el) => { try { nodes.push(JSON.parse($(el).text())); } catch { /* skip */ } });
  return nodes;
}

test('buildSubpageSchema: Rechtsgebiet-Unterseite bekommt Service-Schema mit Name + Provider', async () => {
  const dir = site();
  const r = await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  assert.equal(r.built, true);
  assert.ok(r.pages.some(p => /strafrecht/.test(p.file)));
  const nodes = jsonLdNodes(fs.readFileSync(path.join(dir, 'rechtsgebiete', 'strafrecht.html'), 'utf8'));
  const service = nodes.find(n => n['@type'] === 'Service');
  assert.ok(service, 'Service-Knoten vorhanden');
  assert.equal(service.name, 'Strafrecht');
  assert.equal(service.provider.name, PROJECT.name);
  assert.equal(service['@context'], 'https://schema.org');
  assert.match(service.url, /rechtsgebiete\/strafrecht\.html$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: Unterseite bekommt BreadcrumbList (Start > Rechtsgebiete > Bereich)', async () => {
  const dir = site();
  await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  const nodes = jsonLdNodes(fs.readFileSync(path.join(dir, 'rechtsgebiete', 'strafrecht.html'), 'utf8'));
  const bc = nodes.find(n => n['@type'] === 'BreadcrumbList');
  assert.ok(bc, 'BreadcrumbList vorhanden');
  assert.equal(bc.itemListElement.length, 3);
  assert.equal(bc.itemListElement[2].name, 'Strafrecht');
  assert.equal(bc.itemListElement[0].position, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: Startseite wird NICHT angefasst (nur Unterseiten)', async () => {
  const dir = site();
  const before = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  const after = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal(before, after, 'index.html unverändert');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: idempotent — zweiter Lauf fügt kein zweites Service-Schema hinzu', async () => {
  const dir = site();
  await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  const nodes = jsonLdNodes(fs.readFileSync(path.join(dir, 'rechtsgebiete', 'strafrecht.html'), 'utf8'));
  assert.equal(nodes.filter(n => n['@type'] === 'Service').length, 1);
  assert.equal(nodes.filter(n => n['@type'] === 'BreadcrumbList').length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('validateSubpageSchema: nach dem Bau valide (Service + Breadcrumb, keine Pflichtfelder fehlen)', async () => {
  const dir = site({ areas: { 'strafrecht': 'Strafrecht', 'erbrecht': 'Erbrecht' } });
  await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  const v = validateSubpageSchema(dir);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(v.checks.service_valid, true);
  assert.equal(v.checks.breadcrumb_valid, true);
  assert.equal(v.stats.withSchema, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: Site ohne Service-Unterordner (z.B. Restaurant) → built:false, kein Absturz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subschema-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>x</title></head><body></body></html>');
  const r = await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  assert.equal(r.built, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: literales </script> im extrahierten Text bricht das JSON-LD nicht auf (Security)', async () => {
  // Entity-kodiert im Quell-HTML → .text() dekodiert zu literalem </script><script>… — genau das
  // muss die \\u003c-Serialisierung abfangen (analog I6). Es darf KEIN echtes Script entstehen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subschema-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Start</title></head><body></body></html>');
  fs.mkdirSync(path.join(dir, 'rechtsgebiete'));
  fs.writeFileSync(path.join(dir, 'rechtsgebiete', 'x.html'),
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bereich</title></head><body>'
    + '<h1>Strafrecht &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</h1>'
    + '<p>Ausführliche Beschreibung des Rechtsgebiets mit mehr als vierzig Zeichen Länge hier.</p></body></html>');
  await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  const html = fs.readFileSync(path.join(dir, 'rechtsgebiete', 'x.html'), 'utf8');
  const $ = cheerio.load(html);
  const evil = $('script:not([type="application/ld+json"])').toArray().some(s => /alert\(1\)/.test($(s).html() || ''));
  assert.equal(evil, false, 'kein ausbrechendes Script aus dem JSON-LD');
  // Das JSON-LD muss weiterhin valide parsen und den (harmlosen) Text als String enthalten.
  const service = jsonLdNodes(html).find(n => n['@type'] === 'Service');
  assert.ok(service, 'Service-Schema valide geparst');
  assert.match(service.name, /alert\(1\)/, 'böser Text steckt harmlos als String im name');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: keine index.html → built:false, kein Absturz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subschema-'));
  const r = await buildSubpageSchema(dir, PROJECT, { baseUrl: 'https://example.com' });
  assert.equal(r.built, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSubpageSchema: fehlende baseUrl → relative URLs, kein Absturz, weiterhin valide', async () => {
  const dir = site();
  const r = await buildSubpageSchema(dir, PROJECT, {});
  assert.equal(r.built, true);
  const v = validateSubpageSchema(dir);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  fs.rmSync(dir, { recursive: true, force: true });
});
