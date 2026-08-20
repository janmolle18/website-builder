const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderRechtsgebiete, renderRechtsgebietDetail } = require('../pages');

// Fixture nach dem Vorbild des handgebauten Physio-Projekts (mre4d7yj):
// echte Texte in specialtyDetails, Team-Qualifikationen, passende FAQ.
const PROJECT = {
  name: 'Physiotherapie im Sonnengrund',
  category: 'Physiotherapiepraxis',
  contact: { phone: '05251 871999-9', email: 'info@example.de', address: 'Anton-Heinen-Straße 36, 33102 Paderborn' },
  specialties: ['Krankengymnastik', 'Krankengymnastik am Gerät (KGG)', 'Manuelle Therapie'],
  specialtyDetails: [
    {
      name: 'Krankengymnastik', slug: 'krankengymnastik',
      text: 'Krankengymnastik lindert Schmerzen durch gezielte Bewegungsübungen und manuelle Techniken und verbessert die Funktionalität des Körpers.\n\nSie wird bei Verletzungen, Erkrankungen des Bewegungsapparats und zur Vorbeugung von Beschwerden angewendet.',
      chips: ['Verletzungen', 'Prävention'],
      photo: { src: 'assets/praxis/praxis-06.jpg', alt: 'Therapieliege in der Praxis' }
    },
    {
      name: 'Krankengymnastik am Gerät (KGG)', slug: 'krankengymnastik-am-geraet-kgg',
      text: 'Krankengymnastik am Gerät ist ein gezieltes Trainingsprogramm an speziellen Rehabilitationsgeräten für Kraft, Ausdauer und Stabilität.'
    }
  ],
  team: [
    { name: 'Ulrike Wannagat', slug: 'ulrike-wannagat', role: 'Praxisleitung', schwerpunkte: ['Manuelle Therapie (MT / OMT)', 'Bobath für Erwachsene'], qualifikationen: [] },
    { name: 'Stefanie Reuter', slug: 'stefanie-reuter', role: 'Physiotherapeutin', schwerpunkte: ['Manuelle Therapie (MT)'], qualifikationen: [] }
  ],
  faq: [
    { q: 'Was ist Physiotherapie oder Krankengymnastik?', a: 'Physiotherapie ist eine Behandlungsmethode mit gezielten Bewegungsübungen.' },
    { q: 'Was ist Krankengymnastik am Gerät (KGG)?', a: 'Krankengymnastik am Gerät ist ein gezieltes Trainingsprogramm.' },
    { q: 'Wie läuft die Terminvergabe?', a: 'Rufen Sie uns einfach an.' }
  ]
};

// ── Übersicht: editoriale nummerierte Liste statt leerer Karten ─────────────────

test('renderRechtsgebiete: nummerierte Liste mit echten Teasern + Abschluss-CTA', () => {
  const html = renderRechtsgebiete(PROJECT, null);
  assert.match(html, /class="svc-row/, 'Zeilen-Karten (svc-row) statt leerer Kacheln');
  assert.match(html, />01</, 'laufende Nummern');
  assert.match(html, /lindert Schmerzen durch gezielte/, 'echter Teaser aus specialtyDetails');
  assert.match(html, /href="leistungen\/krankengymnastik\.html"/, 'Link zur Detailseite');
  assert.match(html, /cta-card/, 'Abschluss-CTA-Karte');
  assert.match(html, /tel:0525187199(99|9-9)?/, 'echte Telefonnummer im CTA');
  assert.doesNotMatch(html, /class="grid g3"/, 'alte leere Kartengalerie ist weg');
});

test('renderRechtsgebiete: Gebiete ohne Detailtext bekommen KEINEN erfundenen Teaser', () => {
  const html = renderRechtsgebiete(PROJECT, null);
  // Manuelle Therapie hat kein specialtyDetail → Zeile ohne <p>-Teaser.
  assert.doesNotMatch(html, /Manuelle Therapie<\/h2>\s*<p>/);
  assert.doesNotMatch(html, /Gegründet|kompetent|jahrelange Erfahrung/i, 'keine erfundene Prosa');
});

// ── Detailseite: Physio-Muster (Brotkrümel, Lead, Chips, Foto, FAQ, CTA, Pills) ──

test('renderRechtsgebietDetail: Brotkrümel + echter Lead + Folgetext + Chips + Foto', () => {
  const html = renderRechtsgebietDetail(PROJECT, null, 'Krankengymnastik');
  assert.match(html, /class="crumbs/, 'sichtbare Brotkrümel-Navigation');
  assert.match(html, /href="\.\.\/leistungen\.html"/, 'Brotkrümel verlinkt die Übersicht');
  assert.match(html, /lindert Schmerzen durch gezielte/, 'Lead = erster echter Absatz');
  assert.match(html, /Bewegungsapparats/, 'Folgeabsatz wird gerendert');
  assert.match(html, /class="chip">Verletzungen</, 'echte Anwendungs-Chips');
  assert.match(html, /src="\.\.\/assets\/praxis\/praxis-06\.jpg"/, 'Foto mit ../-Prefix');
  assert.match(html, /alt="Therapieliege in der Praxis"/, 'echter Alt-Text');
});

test('renderRechtsgebietDetail: FAQ-Zuordnung — spezifischste Leistung gewinnt', () => {
  const kg = renderRechtsgebietDetail(PROJECT, null, 'Krankengymnastik');
  assert.match(kg, /Was ist Physiotherapie oder Krankengymnastik\?/, 'allgemeine KG-Frage auf der KG-Seite');
  assert.doesNotMatch(kg, /Was ist Krankengymnastik am Gerät/, 'KGG-Frage gehört NICHT auf die KG-Seite');
  assert.doesNotMatch(kg, /Terminvergabe/, 'themenfremde FAQ bleibt draußen');

  const kgg = renderRechtsgebietDetail(PROJECT, null, 'Krankengymnastik am Gerät (KGG)');
  assert.match(kgg, /Was ist Krankengymnastik am Gerät \(KGG\)\?/, 'KGG-Frage auf der KGG-Seite');
});

test('renderRechtsgebietDetail: Wer-Sie-behandelt nur bei echter Qualifikations-Übereinstimmung', () => {
  const mt = renderRechtsgebietDetail(PROJECT, null, 'Manuelle Therapie');
  assert.match(mt, /Wer Sie behandelt/, 'Who-Sektion auf der MT-Seite (beide Therapeutinnen qualifiziert)');
  assert.match(mt, /Ulrike Wannagat/);
  assert.match(mt, /Stefanie Reuter/);
  assert.match(mt, /Manuelle Therapie \(MT \/ OMT\)/, 'echte Qualifikations-Chips');

  const kg = renderRechtsgebietDetail(PROJECT, null, 'Krankengymnastik');
  assert.doesNotMatch(kg, /Wer Sie behandelt/, 'keine passende Qualifikation → Sektion ehrlich weggelassen');
});

test('renderRechtsgebietDetail: CTA-Karte mit echten Kontaktdaten + Weitere-Leistungen-Pills', () => {
  const html = renderRechtsgebietDetail(PROJECT, null, 'Krankengymnastik');
  assert.match(html, /cta-card/, 'dunkle CTA-Karte');
  assert.match(html, /tel:0525187199/, 'Telefon-Button');
  assert.match(html, /href="\.\.\/kontakt\.html"/, 'Link zur Kontaktseite');
  assert.match(html, /Weitere Leistungen/, 'Pills-Sektion');
  assert.match(html, /href="krankengymnastik-am-geraet-kgg\.html"/, 'Geschwister-Link relativ im selben Ordner');
  assert.doesNotMatch(html, /href="krankengymnastik\.html"/, 'die eigene Seite ist keine Pill');
});

test('renderRechtsgebietDetail: ohne Daten sachlicher Fallback, KEINE erfundenen Sektionen', () => {
  const min = renderRechtsgebietDetail({ name: 'Kanzlei Test', category: 'kanzlei', specialties: ['Mietrecht', 'Erbrecht'] }, null, 'Mietrecht');
  assert.match(min, /Wir beraten und vertreten Sie im Mietrecht/, 'sachlicher Fallback-Lead');
  assert.doesNotMatch(min, /class="(svc-photo|who-card|faq-i|chip)/, 'keine leeren/erfundenen Sektionen (CSS-Definitionen zählen nicht)');
  assert.match(min, /Weitere Rechtsgebiete/, 'echte Geschwister-Pills sind ok');
  assert.match(min, /href="erbrecht\.html"/);
});
