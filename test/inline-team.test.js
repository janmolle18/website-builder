const test = require('node:test');
const assert = require('node:assert');
const { extractInlineTeam, normalizePersonName, nameToSlug } = require('../agent-scraper');

// Nachempfunden der echten Struktur von weber-mustermann.example/kanzlei/mitarbeiter/
// (Karten mit Foto-alt = Name, Kartentext = Name + Funktion, KEINE Profil-Links).
const CARD_HTML = `
<html><body><main>
  <h1>Mitarbeiter</h1>
  <div class="row-fluid">
    <div class="span4"><div class="met_team_member">
      <div class="met_team_member_preview"><img src="/site/assets/files/1049/irina-m-thumb.jpg" alt="Irina Maier"></div>
      <div class="met_team_member_details"><h5>Irina Maier</h5><p>Rechtsanwalts- &amp; Notarfachangestellte</p></div>
    </div></div>
    <div class="span4"><div class="met_team_member">
      <div class="met_team_member_preview"><img src="/site/assets/files/1050/melanie-k-thumb.jpg" alt="Melanie Kott"></div>
      <div class="met_team_member_details"><h5>Melanie Kott</h5><p>Rechtsanwalts- &amp; Notarfachangestellte Zertifizierte Unfallsachbearbeiterin</p></div>
    </div></div>
    <div class="span4"><div class="met_team_member">
      <div class="met_team_member_preview"><img src="/site/assets/files/1220/dummy-_ma.png" alt="Alexander Herbst"></div>
      <div class="met_team_member_details"><h5>Alexander Herbst</h5><p>Zertifizierter Unfallsachbearbeiter</p></div>
    </div></div>
  </div>
  <img src="/site/assets/files/1/logo_2x.png" alt="">
  <img src="/img/kanzlei-gebaeude.jpg" alt="Kanzleigebäude Paderborn">
  <img src="/img/karte.png" alt="Anfahrt Karte">
</main></body></html>`;

test('extractInlineTeam findet Personen-Karten ohne Profil-Link', () => {
  const persons = extractInlineTeam(CARD_HTML, 'https://example.de/kanzlei/mitarbeiter/');

  assert.strictEqual(persons.length, 3);
  const irina = persons.find(p => p.name === 'Irina Maier');
  assert.ok(irina, 'Irina Maier gefunden');
  assert.match(irina.role, /Notarfachangestellte/);
  assert.strictEqual(irina.photo, 'https://example.de/site/assets/files/1049/irina-m-thumb.jpg');

  const melanie = persons.find(p => p.name === 'Melanie Kott');
  assert.match(melanie.role, /Unfallsachbearbeiterin/);
});

test('extractInlineTeam ignoriert Logos, Gebäude und Karten', () => {
  const persons = extractInlineTeam(CARD_HTML, 'https://example.de/x/');
  const names = persons.map(p => p.name);
  assert.ok(!names.some(n => /geb(ä|ae)ude|karte|logo/i.test(n)));
});

test('extractInlineTeam dedupliziert gleiche Namen', () => {
  const html = `<div>
    <figure><img src="/a.jpg" alt="Eva Hofmann"><figcaption>Eva Hofmann Rechtsanwältin</figcaption></figure>
    <figure><img src="/b.jpg" alt="Eva Hofmann"><figcaption>Eva Hofmann Rechtsanwältin</figcaption></figure>
  </div>`;
  const persons = extractInlineTeam(html, 'https://example.de/team/');
  assert.strictEqual(persons.length, 1);
});

test('extractInlineTeam akzeptiert Titel und Doppelnamen', () => {
  const html = `<div>
    <div><img src="/a.jpg" alt="Dr. Anna-Lena Müller-Schmidt"><span>Dr. Anna-Lena Müller-Schmidt Fachanwältin für Familienrecht</span></div>
  </div>`;
  const persons = extractInlineTeam(html, 'https://example.de/team/');
  assert.strictEqual(persons.length, 1);
  assert.match(persons[0].role, /Fachanwältin/);
});

test('extractInlineTeam liefert leeres Array bei Seiten ohne Personen', () => {
  const html = '<html><body><img src="/logo.png" alt="Firmenlogo"><p>Nur Text.</p></body></html>';
  assert.deepStrictEqual(extractInlineTeam(html, 'https://example.de/'), []);
});

test('normalizePersonName entfernt Titel für Dedupe', () => {
  assert.strictEqual(normalizePersonName('Dr. Eva Hofmann'), normalizePersonName('Eva Hofmann'));
  assert.notStrictEqual(normalizePersonName('Eva Hofmann'), normalizePersonName('Eva Braun'));
});

test('nameToSlug erzeugt saubere Slugs mit Umlauten', () => {
  assert.strictEqual(nameToSlug('Jennifer Schütze-Strumpf'), 'jennifer-schuetze-strumpf');
  assert.strictEqual(nameToSlug('Ulrike Noèl'), 'ulrike-noel');
});

test('extractInlineTeam trennt Rollen-Präfix vom Namen (Notarin Christine P.)', () => {
  const html = `<div>
    <div><img src="/n.jpg" alt="Notarin Christine Mustermann"></div>
  </div>`;
  const { extractInlineTeam: fx } = require('../agent-scraper');
  const persons = fx(html, 'https://example.de/notare/');
  assert.strictEqual(persons.length, 1);
  assert.strictEqual(persons[0].name, 'Christine Mustermann');
  assert.strictEqual(persons[0].role, 'Notarin');
});
