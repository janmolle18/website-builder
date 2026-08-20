const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weighCategory, buildMenuStructure } = require('../generator');
const { renderRechtsgebietDetail, applyRechtsgebiete } = require('../pages');
const { weighText } = require('../weight');

// ── Inhaltsgesteuerte Bento-Gewichtung ──────────────────────────────────────────

test('weighCategory: viel Fließtext → dominant', () => {
  const cat = { category: 'Arbeitsrecht', fullText: 'x'.repeat(500) };
  assert.equal(weighCategory(cat).weight, 'dominant');
});

test('weighCategory: viele Unterpunkte → dominant', () => {
  const cat = { category: 'Erbrecht', items: [1, 2, 3, 4, 5].map(n => ({ name: 'P' + n })) };
  assert.equal(weighCategory(cat).weight, 'dominant');
});

test('weighCategory: nur Titel, kein Text → compact (keine Erfindung)', () => {
  assert.equal(weighCategory({ category: 'Mietrecht' }).weight, 'compact');
});

test('weighCategory: mittlerer Text → standard', () => {
  // Länge zwischen WEIGHT_COMPACT_CHARS (60) und WEIGHT_DOMINANT_CHARS (400).
  const cat = { category: 'Verkehrsrecht', fullText: 'Wir beraten bei Bußgeldbescheiden, Fahrverbot, Punkten in Flensburg sowie nach Verkehrsunfällen rund um Schadensregulierung.' };
  assert.equal(weighCategory(cat).weight, 'standard');
});

test('buildMenuStructure: injiziert GEWICHT-Hinweis + echten Volltext', () => {
  const menu = [{ category: 'Arbeitsrecht', fullText: 'Kündigung, Abfindung, Aufhebungsvertrag. ' + 'Mehr Text. '.repeat(40) }];
  const out = buildMenuStructure(menu);
  assert.match(out, /\[GEWICHT: dominant/);
  assert.match(out, /Arbeitsrecht/);
  assert.match(out, /Kündigung, Abfindung/);
});

// ── Tiefer Fachtext überlebt bis auf die Detailseite (Anti-Datenverlust) ─────────

test('renderRechtsgebietDetail: zeigt echten gescrapten Text statt Platzhalter', () => {
  const project = {
    name: 'Kanzlei Test',
    specialtyDetails: [{
      name: 'Arbeitsrecht',
      slug: 'arbeitsrecht',
      text: 'Wir vertreten Arbeitnehmer und Arbeitgeber bundesweit seit vielen Jahren umfassend.\n\nSchwerpunkt sind Kündigungsschutzklagen und die Verhandlung fairer Abfindungen für unsere Mandanten.'
    }]
  };
  const html = renderRechtsgebietDetail(project, null, 'Arbeitsrecht');
  assert.match(html, /Kündigungsschutzklagen/);                       // echter Text drin
  assert.doesNotMatch(html, /Wir beraten und vertreten Sie im Arbeitsrecht/); // KEIN Platzhalter
});

test('renderRechtsgebietDetail: sachlicher Fallback ohne Daten (keine Halluzination)', () => {
  const html = renderRechtsgebietDetail({ name: 'Kanzlei Test', category: 'kanzlei' }, null, 'Mietrecht');
  assert.match(html, /Wir beraten und vertreten Sie im Mietrecht/);
  assert.doesNotMatch(html, /Gegründet|seit \d{4}|über \d+ Mandanten/);
});

// ── weight.js: geteilte Schwellen ───────────────────────────────────────────────

test('weighText: nutzt text-Feld (pages.js-Form) und stuft korrekt ein', () => {
  assert.equal(weighText({ text: '' }), 'compact');
  assert.equal(weighText({ text: 'x'.repeat(500) }), 'dominant');
});

// ── Deterministische Leistungs-Kacheln auf der Startseite (Physio-Muster) ────────

test('applyRechtsgebiete: gleichwertige Kacheln mit echtem Teaser, Mehr-Pfeil + Link', () => {
  const html = '<body><section><h2>Rechtsgebiete</h2><p>Arbeitsrecht</p><p>Mietrecht</p><p>Erbrecht</p></section></body>';
  const project = {
    category: 'kanzlei',
    specialties: ['Arbeitsrecht', 'Mietrecht', 'Erbrecht'],
    specialtyDetails: [{ name: 'Arbeitsrecht', slug: 'arbeitsrecht',
      text: 'Wir vertreten Arbeitnehmer und Arbeitgeber bei Kündigungsschutzklagen und Abfindungen. ' + 'Weiterer echter Fachtext. '.repeat(20) }],
    subpages: ['rechtsgebiete/arbeitsrecht.html']
  };
  const r = applyRechtsgebiete(html, project, null);
  assert.equal(r.changed, true);
  assert.match(r.html, /data-areas-grid/);
  assert.match(r.html, /Kündigungsschutzklagen/);                        // echter Teaser-Text
  assert.match(r.html, /href="rechtsgebiete\/arbeitsrecht\.html"/);      // Link zur Detailseite
  assert.match(r.html, /class="rg-go"/);                                 // „Mehr →" nur auf verlinkten Kacheln
  assert.doesNotMatch(r.html, /rg-dominant|rg-compact/);                 // kein Gewichts-Bento mehr
  assert.doesNotMatch(r.html, /translateY/);                             // Hover nur Border/Schatten
  assert.match(r.html, /prefers-reduced-motion/);
});

test('applyRechtsgebiete: Kacheln ohne Detailtext tragen KEINEN erfundenen Text', () => {
  const html = '<body><section><h2>Rechtsgebiete</h2><p>Arbeitsrecht</p><p>Mietrecht</p><p>Erbrecht</p></section></body>';
  const project = { specialties: ['Arbeitsrecht', 'Mietrecht', 'Erbrecht'] }; // keine Detailtexte
  const r = applyRechtsgebiete(html, project, null);
  assert.equal(r.changed, true);
  // Nur die echten Namen, keine generierte Prosa in den Kacheln.
  assert.doesNotMatch(r.html, /Wir beraten|Erstgespräch|Gegründet|kompetent/i);
  assert.doesNotMatch(r.html, /Mietrecht<\/h3><p>/);                     // kein leerer/erfundener Teaser
  // Idempotent: zweiter Lauf ändert nichts mehr.
  assert.equal(applyRechtsgebiete(r.html, project, null).changed, false);
});
