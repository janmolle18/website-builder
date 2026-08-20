const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vocab, planSubpages, renderSpeisekarte, countMenuItems, inquiryForm } = require('../pages');
const { menuItemCount, parseJsonLoose } = require('../agent-scraper');

const PIZZERIA = {
  name: 'Pizza Bellissima', category: 'Pizzeria',
  contact: { email: 'toni@example.de', address: 'Heiersstraße 37, 33098 Paderborn', phone: '05251 22375' },
  specialties: ['Pizza', 'Italienische Küche', 'Lieferservice'],
  menu: [
    { category: 'Pizza', sizes: ['24 cm', '30 cm'], items: [
      { name: 'Margherita', description: 'Tomaten, Käse', prices: ['6,00 €', '9,00 €'] },
      { name: 'Salami', description: 'Tomaten, Käse, Salami', prices: ['8,00 €', '11,00 €'] },
    ] },
    { category: 'Salate', items: [
      { name: 'Grüner Salat', price: '6,50 €' },
      { name: 'Tomatensalat', description: 'mit Zwiebeln', price: '8,50 €' },
      { name: 'Salat Italia <script>', price: '10,50 €' },
    ] },
  ],
  menuNotes: ['Lieferservice innerhalb von Paderborn ab 15 € Bestellwert.'],
};

test('vocab: Pizzeria/Trattoria/Burger werden als Gastro erkannt (nicht Default)', () => {
  for (const category of ['Pizzeria', 'Trattoria Milano', 'Ristorante', 'Burger-Laden', 'Eiscafé Venezia']) {
    const v = vocab({ category });
    assert.equal(v.menu && v.menu.slug, 'speisekarte', `${category} muss Gastro-Vokabular bekommen`);
    assert.ok(!/Erstgespräch|Erstanfrage|Rechtsgebiet/.test(JSON.stringify(v)), `${category}: kein Kanzlei-Sprech`);
  }
});

test('vocab: Kanzlei behält exakt die alten Labels (Rückwärtskompatibilität)', () => {
  const v = vocab({ category: 'Kanzlei' });
  assert.equal(v.areas, 'Rechtsgebiete');
  assert.equal(v.form.topicLabel, 'Rechtsgebiet');
  assert.equal(v.form.submit, 'Erstanfrage senden');
});

test('planSubpages: Gastro mit Karte bekommt speisekarte.html, keine leeren Angebot-Hüllen', () => {
  const plan = planSubpages(PIZZERIA);
  const keys = plan.map(p => p.key);
  assert.ok(keys.includes('speisekarte'), 'Speisekarte fehlt im Plan');
  assert.equal(plan.find(p => p.key === 'speisekarte').href, 'speisekarte.html');
  assert.ok(!keys.includes('rechtsgebiete'), 'leere Angebot-Detailseiten dürfen nicht geplant werden');
});

test('planSubpages: Kanzlei-Plan bleibt unverändert (kein speisekarte, areas ab 2 Gebieten)', () => {
  const plan = planSubpages({ category: 'Kanzlei', specialties: ['Arbeitsrecht', 'Mietrecht'], contact: { email: 'x@y.de' } });
  const keys = plan.map(p => p.key);
  assert.ok(keys.includes('rechtsgebiete'));
  assert.ok(!keys.includes('speisekarte'));
});

test('renderSpeisekarte: echte Gerichte, Größenpreise, Hinweise, XSS-Escaping', () => {
  const html = renderSpeisekarte(PIZZERIA, {});
  assert.ok(html.includes('Margherita'));
  assert.ok(html.includes('6,00 €'));
  assert.ok(html.includes('24 cm'), 'Größenlabel fehlt');
  assert.ok(html.includes('Grüner Salat'));
  assert.ok(html.includes('Lieferservice innerhalb von Paderborn'), 'menuNotes fehlen');
  assert.ok(!html.includes('Salat Italia <script>'), 'Item-Namen müssen escaped werden');
  assert.ok(html.includes('Salat Italia &lt;script&gt;'));
});

test('inquiryForm: Gastro fragt nach Anlass mit Reservierungs-Optionen, nicht nach Rechtsgebiet', () => {
  const html = inquiryForm(PIZZERIA);
  assert.ok(html.includes('Anlass'));
  assert.ok(html.includes('Tischreservierung'));
  assert.ok(!html.includes('Rechtsgebiet'), 'Kanzlei-Sprech im Gastro-Formular');
  assert.ok(!html.includes('Erstanfrage'), 'Kanzlei-Sprech im Gastro-Formular');
});

test('inquiryForm: Kanzlei bekommt weiterhin Rechtsgebiet-Auswahl aus specialties', () => {
  const html = inquiryForm({ category: 'Kanzlei', specialties: ['Arbeitsrecht'], contact: { email: 'k@x.de' } });
  assert.ok(html.includes('Rechtsgebiet'));
  assert.ok(html.includes('Arbeitsrecht'));
  assert.ok(html.includes('Erstanfrage senden'));
});

test('countMenuItems/menuItemCount: zählen nur echte Positionen', () => {
  assert.equal(countMenuItems(PIZZERIA.menu), 5);
  assert.equal(menuItemCount(PIZZERIA.menu), 5);
  assert.equal(menuItemCount([{ name: 'flach', price: '1 €' }]), 1);
  assert.equal(menuItemCount(null), 0);
});

test('parseJsonLoose: JSON roh und im ```json-Zaun', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Hier ist das Ergebnis:\n```json\n{"menu":[]}\n```\nFertig.'), { menu: [] });
});

test('buildSubpages: räumt verwaiste Areas-Seiten auf, wenn die Speisekarte sie ersetzt', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { buildSubpages } = require('../pages');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gastro-legacy-'));
  try {
    // Altbestand aus einem Build vor dem Gastro-Upgrade (Default-Vokabular):
    fs.writeFileSync(path.join(dir, 'leistungen.html'), '<html>alt</html>');
    fs.mkdirSync(path.join(dir, 'leistungen'));
    fs.writeFileSync(path.join(dir, 'leistungen', 'pizza.html'), '<html>alt</html>');
    await buildSubpages(dir, PIZZERIA, {});
    assert.ok(fs.existsSync(path.join(dir, 'speisekarte.html')), 'speisekarte.html muss entstehen');
    assert.ok(!fs.existsSync(path.join(dir, 'leistungen.html')), 'verwaiste leistungen.html muss weg');
    assert.ok(!fs.existsSync(path.join(dir, 'leistungen')), 'verwaister leistungen/-Ordner muss weg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
