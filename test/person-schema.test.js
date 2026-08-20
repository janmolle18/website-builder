const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cheerio = require('cheerio');
const { buildPersonSchema, validatePersonSchema } = require('../person-schema');

const TEAM = [
  {
    slug: 'thomas-wilmes', name: 'Thomas Wilmes',
    role: 'Rechtsanwalt, Fachanwalt für Verkehrsrecht und Versicherungsrecht',
    bio: 'Fachanwalt für Verkehrsrecht und Versicherungsrecht in Paderborn mit langjähriger Erfahrung in der Unfallregulierung.',
    schwerpunkte: ['Verkehrsrecht', 'Versicherungsrecht', 'Unfallregulierung'],
    qualifikationen: ['Fachanwalt für Verkehrsrecht', 'Fachanwalt für Versicherungsrecht'],
    photoLocal: 'assets/team/thomas-wilmes.jpg',
  },
  {
    slug: 'eva-hofmann', name: 'Eva Hofmann', role: 'Rechtsanwältin',
    bio: 'Rechtsanwältin mit Schwerpunkt Familienrecht und Erbrecht in Paderborn.',
    schwerpunkte: ['Familienrecht', 'Erbrecht'], qualifikationen: [],
    photoLocal: 'assets/team/eva-hofmann.jpg',
  },
];
const PROJECT = { name: 'Dr. Weber & Mustermann Rechtsanwälte', category: 'kanzlei', contact: { address: 'Musterstraße 1, 33100 Paderborn' }, team: TEAM };
const BASE = 'https://kanzlei-example.de/';

function profileHtml(name, bio) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${name} – Kanzlei</title></head>`
    + `<body><h1 class="reveal">${name}</h1><p class="lead">${bio}</p></body></html>`;
}

function site({ team = TEAM, extraProfileNoTeam = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'personschema-'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><script type="application/ld+json">{"@context":"https://schema.org","@type":"LegalService","name":"Kanzlei"}</script><title>Start</title></head><body><h1>Start</h1></body></html>');
  // Übersichtsseite (darf KEIN Person-Schema bekommen)
  fs.writeFileSync(path.join(dir, 'anwaelte.html'), profileHtml('Unser Team', 'Die Anwälte der Kanzlei.'));
  // Service-Unterseite (darf KEIN Person-Schema bekommen)
  fs.mkdirSync(path.join(dir, 'rechtsgebiete'));
  fs.writeFileSync(path.join(dir, 'rechtsgebiete', 'verkehrsrecht.html'), profileHtml('Verkehrsrecht', 'Wir beraten Sie umfassend im Verkehrsrecht.'));
  // Profil-Unterseiten
  fs.mkdirSync(path.join(dir, 'anwaelte'));
  for (const m of team) fs.writeFileSync(path.join(dir, 'anwaelte', `${m.slug}.html`), profileHtml(m.name, m.bio));
  if (extraProfileNoTeam) fs.writeFileSync(path.join(dir, 'anwaelte', 'gastautor.html'), profileHtml('Dr. Gast Autor', 'Externer Fachautor für Steuerrecht.'));
  return dir;
}

function ldNodes(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('script[type="application/ld+json"]').each((i, el) => { out.push(JSON.parse($(el).text())); });
  return out;
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('buildPersonSchema: Person + BreadcrumbList auf jeder Profil-Unterseite mit E-E-A-T-Feldern', async () => {
  const dir = site();
  const res = await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  assert.equal(res.built, true);
  assert.equal(res.pages.length, 2, 'beide Profile bekommen Schema');

  const html = fs.readFileSync(path.join(dir, 'anwaelte', 'thomas-wilmes.html'), 'utf8');
  const nodes = ldNodes(html);
  const person = nodes.find(n => n['@type'] === 'Person');
  assert.ok(person, 'Person-Schema vorhanden');
  assert.equal(person.name, 'Thomas Wilmes');
  assert.match(person.jobTitle, /Fachanwalt für Verkehrsrecht/);
  assert.ok(Array.isArray(person.knowsAbout) && person.knowsAbout.includes('Verkehrsrecht'), 'knowsAbout aus schwerpunkte');
  assert.ok(Array.isArray(person.hasCredential) && person.hasCredential[0]['@type'] === 'EducationalOccupationalCredential', 'hasCredential aus qualifikationen');
  assert.equal(person.hasCredential[0].name, 'Fachanwalt für Verkehrsrecht');
  assert.ok(person.worksFor && person.worksFor.name === PROJECT.name, 'worksFor verlinkt die Kanzlei');
  assert.equal(person.image, BASE + 'assets/team/thomas-wilmes.jpg', 'image absolut aus photoLocal');
  assert.equal(person.url, BASE + 'anwaelte/thomas-wilmes.html');
  assert.equal(person['@context'], 'https://schema.org');

  const bc = nodes.find(n => n['@type'] === 'BreadcrumbList');
  assert.ok(bc && bc.itemListElement.length === 3, 'Breadcrumb Start→Anwälte→Name');
  assert.equal(bc.itemListElement[2].name, 'Thomas Wilmes');
  rm(dir);
});

test('buildPersonSchema: Mitglied ohne Qualifikationen lässt hasCredential weg (kein leeres Feld)', async () => {
  const dir = site();
  await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  const person = ldNodes(fs.readFileSync(path.join(dir, 'anwaelte', 'eva-hofmann.html'), 'utf8')).find(n => n['@type'] === 'Person');
  assert.ok(!('hasCredential' in person), 'kein hasCredential bei leeren Qualifikationen');
  assert.ok(person.knowsAbout.includes('Familienrecht'));
  rm(dir);
});

test('buildPersonSchema: idempotent — zweiter Lauf fügt nichts hinzu', async () => {
  const dir = site();
  await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  const res2 = await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  assert.equal(res2.pages.length, 0, '2. Lauf: keine neuen Seiten');
  assert.ok(res2.skipped >= 2, '2. Lauf: vorhandene übersprungen');
  const persons = ldNodes(fs.readFileSync(path.join(dir, 'anwaelte', 'thomas-wilmes.html'), 'utf8')).filter(n => n['@type'] === 'Person');
  assert.equal(persons.length, 1, 'kein doppeltes Person-Schema');
  rm(dir);
});

test('buildPersonSchema: </script> in Name/Bio bricht das JSON-LD nicht aus', async () => {
  const team = [{ slug: 'boese', name: 'A</script><script>alert(1)</script>', role: 'Rechtsanwalt',
    bio: 'Bio </script><script>alert(2)</script> Text.', schwerpunkte: ['X</script>'], qualifikationen: ['Q</script>'], photoLocal: 'assets/team/boese.jpg' }];
  const dir = site({ team });
  // Fixture-h1 bereinigen: der Payload soll NUR über die Team-Daten ins Schema fließen —
  // stünde er roh im Body-HTML, wäre ein gefundenes <script> ein Fixture-Artefakt, keine Schema-Lücke.
  fs.writeFileSync(path.join(dir, 'anwaelte', 'boese.html'), profileHtml('Profil', 'Anwaltsprofil der Kanzlei.'));
  await buildPersonSchema(dir, { ...PROJECT, team }, { baseUrl: BASE });
  const raw = fs.readFileSync(path.join(dir, 'anwaelte', 'boese.html'), 'utf8');
  const $ = cheerio.load(raw);
  // Kein eingeschleustes ausführbares Script.
  const exec = $('script').toArray().filter(s => $(s).attr('type') !== 'application/ld+json' && /alert\(\d\)/.test($(s).text()));
  assert.equal(exec.length, 0, 'kein ausführbares eingeschleustes <script>');
  // Person-JSON-LD valide + kein rohes </script>.
  const personRaw = $('script[type="application/ld+json"]').toArray().map(s => $(s).html()).find(t => /"Person"/.test(t));
  assert.ok(personRaw, 'Person-Block da');
  assert.doesNotThrow(() => JSON.parse(personRaw));
  assert.ok(!/<\/script/i.test(personRaw), 'kein rohes </script> im Person-Block');
  rm(dir);
});

test('buildPersonSchema: Profil ohne Team-Match fällt auf den h1-Namen zurück', async () => {
  const dir = site({ extraProfileNoTeam: true });
  await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  const person = ldNodes(fs.readFileSync(path.join(dir, 'anwaelte', 'gastautor.html'), 'utf8')).find(n => n['@type'] === 'Person');
  assert.ok(person && person.name === 'Dr. Gast Autor', 'Name aus h1');
  assert.ok(person.worksFor && person.worksFor.name === PROJECT.name);
  rm(dir);
});

test('buildPersonSchema: rührt Übersichts- und Service-Seiten NICHT an', async () => {
  const dir = site();
  await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  const overview = ldNodes(fs.readFileSync(path.join(dir, 'anwaelte.html'), 'utf8'));
  assert.ok(!overview.some(n => n['@type'] === 'Person'), 'Übersichtsseite bekommt kein Person-Schema');
  const service = ldNodes(fs.readFileSync(path.join(dir, 'rechtsgebiete', 'verkehrsrecht.html'), 'utf8'));
  assert.ok(!service.some(n => n['@type'] === 'Person'), 'Service-Seite bekommt kein Person-Schema');
  const index = ldNodes(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  assert.ok(!index.some(n => n['@type'] === 'Person'), 'Startseite bekommt kein Person-Schema');
  rm(dir);
});

test('validatePersonSchema: erkennt valides Schema als ok', async () => {
  const dir = site();
  await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  const v = validatePersonSchema(dir);
  assert.equal(v.ok, true, 'valide: ' + JSON.stringify(v.issues));
  assert.equal(v.checks.person_valid, true);
  assert.equal(v.checks.breadcrumb_valid, true);
  assert.equal(v.stats.withSchema, 2);
  rm(dir);
});

test('buildPersonSchema: fehlende index.html → built:false, wirft nicht', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'personschema-empty-'));
  const res = await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  assert.equal(res.built, false);
  rm(dir);
});

// Regression (C3-Review MEDIUM/LOW): Robustheit der Feld-Ableitung + bewusster Skip-Fall.
test('buildPersonSchema: photoLocal mit führendem Slash erzeugt keine doppelten Slashes in image', async () => {
  const team = [{ slug: 'eva-hofmann', name: 'Eva Hofmann', role: 'Rechtsanwältin', bio: 'Eine ausreichend lange Biografie für das Personen-Schema in Paderborn.', schwerpunkte: ['Familienrecht'], qualifikationen: [], photoLocal: '/assets/team/eva-hofmann.jpg' }];
  const dir = site({ team });
  await buildPersonSchema(dir, { ...PROJECT, team }, { baseUrl: BASE });
  const person = ldNodes(fs.readFileSync(path.join(dir, 'anwaelte', 'eva-hofmann.html'), 'utf8')).find(n => n['@type'] === 'Person');
  assert.equal(person.image, BASE + 'assets/team/eva-hofmann.jpg', 'führender / in photoLocal → kein //');
  rm(dir);
});

test('buildPersonSchema: leere schwerpunkte → knowsAbout fällt auf project.specialties zurück', async () => {
  const team = [{ slug: 'eva-hofmann', name: 'Eva Hofmann', role: 'Rechtsanwältin', bio: 'Eine ausreichend lange Biografie für das Personen-Schema in Paderborn.', schwerpunkte: [], qualifikationen: [], photoLocal: 'assets/team/eva-hofmann.jpg' }];
  const project = { ...PROJECT, team, specialties: ['Arbeitsrecht', 'Erbrecht'] };
  const dir = site({ team });
  await buildPersonSchema(dir, project, { baseUrl: BASE });
  const person = ldNodes(fs.readFileSync(path.join(dir, 'anwaelte', 'eva-hofmann.html'), 'utf8')).find(n => n['@type'] === 'Person');
  assert.deepEqual(person.knowsAbout, ['Arbeitsrecht', 'Erbrecht'], 'knowsAbout aus project.specialties');
  rm(dir);
});

test('buildPersonSchema: vorhandenes (fremdes) Person-Schema wird respektiert — kein zweites, kein Konflikt', async () => {
  const dir = site();
  const f = path.join(dir, 'anwaelte', 'thomas-wilmes.html');
  const withForeign = fs.readFileSync(f, 'utf8')
    .replace('</head>', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Fremd"}</script></head>');
  fs.writeFileSync(f, withForeign);
  const res = await buildPersonSchema(dir, PROJECT, { baseUrl: BASE });
  const persons = ldNodes(fs.readFileSync(f, 'utf8')).filter(n => n['@type'] === 'Person');
  assert.equal(persons.length, 1, 'kein zweites, konkurrierendes Person-Schema hinzugefügt');
  assert.equal(persons[0].name, 'Fremd', 'das vorhandene Schema bleibt unangetastet');
  assert.ok(res.skipped >= 1, 'Seite als übersprungen gezählt');
  rm(dir);
});
