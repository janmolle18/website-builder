const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderRechtsgebietDetail, renderAnwaelteOverview, planSubpages } = require('../pages');

const DNA = {};
const TEAM1 = [{ name: 'Dr. Anna Muster', slug: 'anna-muster', role: 'Physiotherapeutin', bio: 'Langjährige Erfahrung in der Behandlung von Rückenbeschwerden und Sportverletzungen.', schwerpunkte: ['Krankengymnastik'] }];

test('vocab: Physio-Detailseite spricht Behandlungs- statt Anwaltssprache', () => {
  const html = renderRechtsgebietDetail({ name: 'Physio im Sonnengrund', category: 'Physiotherapiepraxis' }, DNA, 'Manuelle Therapie');
  assert.match(html, /Termin vereinbaren/);
  assert.match(html, /Für Ihre Behandlung im Bereich Manuelle Therapie/);
  assert.match(html, />Leistung</); // Kicker
  assert.match(html, /Alle Leistungen/); // Zurück-Link
  assert.doesNotMatch(html, /Rechtsgebiet|Erstberatung|beraten und vertreten/);
});

test('vocab: Kanzlei-Detailseite behält die Anwaltssprache (rückwärtskompatibel)', () => {
  const html = renderRechtsgebietDetail({ name: 'Kanzlei X', category: 'kanzlei' }, DNA, 'Mietrecht');
  assert.match(html, /Wir beraten und vertreten Sie im Mietrecht/);
  assert.match(html, /Erstberatung anfragen/);
  assert.match(html, />Rechtsgebiet</);
  assert.match(html, /Alle Rechtsgebiete/);
});

test('vocab: Team-Übersicht heißt bei der Praxis „Team", bei der Kanzlei „Anwälte & Team"', () => {
  const physio = renderAnwaelteOverview({ name: 'Physio', category: 'physiotherapie', team: TEAM1 }, DNA);
  assert.match(physio, /<h1[^>]*>Team<\/h1>/);
  assert.doesNotMatch(physio, /Anwält/);

  const kanzlei = renderAnwaelteOverview({ name: 'Kanzlei', category: 'kanzlei', team: TEAM1 }, DNA);
  assert.match(kanzlei, /Anwälte &amp; Team/);
});

test('vocab: planSubpages-Labels folgen der Branche (fließen in die Startseiten-Nav)', () => {
  const physio = planSubpages({ category: 'Physiotherapiepraxis', specialties: ['A', 'B'], team: [{ name: 'X' }], contact: { phone: '1' } });
  const labels = physio.map(p => p.label);
  assert.ok(labels.includes('Leistungen') && labels.includes('Team'), 'Physio: Leistungen/Team — ' + labels.join(','));
  assert.ok(!labels.includes('Rechtsgebiete'), 'keine Anwalts-Labels');

  const kanzlei = planSubpages({ category: 'kanzlei', specialties: ['A', 'B'], team: [{ name: 'X' }], contact: { phone: '1' } });
  const kl = kanzlei.map(p => p.label);
  assert.ok(kl.includes('Rechtsgebiete') && kl.includes('Anwälte & Team'), 'Kanzlei: alte Labels');
});

test('vocab: URL-Slugs folgen der Branche (behebt den leistungen.html-404)', () => {
  const physio = planSubpages({ category: 'Physiotherapiepraxis', specialties: ['A', 'B'], team: [{ name: 'X', slug: 'x', bio: 'x'.repeat(50) }], contact: { phone: '1' } });
  assert.ok(physio.find(p => p.href === 'leistungen.html'), 'Physio areas → leistungen.html');
  assert.ok(physio.find(p => p.href === 'team.html'), 'Physio team → team.html');
  const kanzlei = planSubpages({ category: 'kanzlei', specialties: ['A', 'B'], team: [{ name: 'X', slug: 'x', bio: 'x'.repeat(50) }], contact: { phone: '1' } });
  assert.ok(kanzlei.find(p => p.href === 'rechtsgebiete.html'), 'Kanzlei areas → rechtsgebiete.html (rückwärtskompatibel)');
  assert.ok(kanzlei.find(p => p.href === 'anwaelte.html'), 'Kanzlei team → anwaelte.html');
  // Interne Links folgen dem Slug (Physio-Detailseite verlinkt zurück auf leistungen.html):
  assert.match(renderRechtsgebietDetail({ category: 'physiotherapie' }, {}, 'Massage'), /href="\.\.\/leistungen\.html"/);
  assert.match(renderRechtsgebietDetail({ category: 'kanzlei' }, {}, 'Mietrecht'), /href="\.\.\/rechtsgebiete\.html"/);
});
