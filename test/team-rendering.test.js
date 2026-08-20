const test = require('node:test');
const assert = require('node:assert');
const { hasProfileContent, renderAnwaelteOverview, fixTeamProfileLinks } = require('../pages');

const ANWALT = {
  slug: 'eva-hofmann', name: 'Eva Hofmann', role: 'Rechtsanwältin',
  bio: 'Eva Hofmann ist seit 2015 als Rechtsanwältin zugelassen und vertritt Mandanten im Verkehrsrecht.',
  schwerpunkte: ['Verkehrsrecht'], qualifikationen: [], photo: null
};
const MITARBEITERIN = {
  slug: 'irina-maier', name: 'Irina Maier', role: 'Rechtsanwalts- & Notarfachangestellte',
  bio: '', schwerpunkte: [], qualifikationen: [], photo: 'https://alt.example/irina.jpg'
};

const PROJECT = { name: 'Testkanzlei', category: 'kanzlei', team: [ANWALT, MITARBEITERIN], contact: {} };
const DNA = {};

test('hasProfileContent unterscheidet Profil-Personen von Karten-Mitarbeitern', () => {
  assert.strictEqual(hasProfileContent(ANWALT), true);
  assert.strictEqual(hasProfileContent(MITARBEITERIN), false);
  assert.strictEqual(hasProfileContent({ name: 'X', bio: 'kurz' }), false);
});

test('Team-Übersicht: Profil-Personen verlinkt, Karten-Mitarbeiter unverlinkt in eigener Sektion', () => {
  const html = renderAnwaelteOverview(PROJECT, DNA);
  assert.match(html, /href="anwaelte\/eva-hofmann\.html"/, 'Anwältin verlinkt');
  assert.ok(!html.includes('anwaelte/irina-maier.html'), 'Mitarbeiterin NICHT verlinkt');
  assert.match(html, /Irina Maier/, 'Mitarbeiterin erscheint trotzdem als Karte');
  assert.match(html, /Unser Team/, 'zweite Sektion vorhanden');
});

test('Team-Übersicht: ohne Karten-Mitarbeiter keine Extra-Sektion', () => {
  const html = renderAnwaelteOverview({ ...PROJECT, team: [ANWALT] }, DNA);
  assert.ok(!html.includes('Unser Team'));
});

test('fixTeamProfileLinks biegt Links auf Karten-Mitarbeiter zur Übersicht um', () => {
  const input = '<a href="anwaelte/irina.html">Irina Maier</a><a href="anwaelte/eva.html">Eva Hofmann</a>';
  const { html } = fixTeamProfileLinks(input, PROJECT);
  assert.match(html, /href="anwaelte\.html">Irina Maier/, 'Mitarbeiterin → Übersicht');
  assert.match(html, /href="anwaelte\/eva-hofmann\.html">Eva Hofmann/, 'Anwältin → kanonisches Profil');
});
