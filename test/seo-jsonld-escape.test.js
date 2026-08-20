const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { applySEO } = require('../seo');

const BASE_HTML = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title></head><body><h1>Test</h1></body></html>';

function seoHtml(project) {
  const out = applySEO(BASE_HTML, project, 'https://example.com');
  return typeof out === 'string' ? out : out.html;
}

test('applySEO: </script> in project.name erzeugt KEIN ausführbares eingeschleustes <script> + JSON-LD bleibt valide', () => {
  const html = seoHtml({
    name: 'Kanzlei </script><script>alert(1)</script> Müller',
    category: 'kanzlei',
    contact: { address: 'Musterstraße 1, 33100 Paderborn' },
  });
  const $ = cheerio.load(html);

  // Kein eingeschleustes, ausführbares <script> (nur das JSON-LD darf existieren).
  const injected = $('script').toArray()
    .filter(s => $(s).attr('type') !== 'application/ld+json' && /alert\(1\)/.test($(s).text()));
  assert.equal(injected.length, 0, 'kein ausführbares eingeschleustes <script>');

  // JSON-LD: valides JSON, kein rohes </script> im Rohtext (muss \\u003c-escaped sein).
  const ld = $('script[type="application/ld+json"]').toArray();
  assert.ok(ld.length >= 1, 'mindestens ein JSON-LD-Block');
  for (const el of ld) {
    const raw = $(el).text();
    assert.doesNotThrow(() => JSON.parse(raw), 'JSON-LD parsebar');
    assert.ok(!/<\/script/i.test(raw), 'kein rohes </script> im JSON-LD');
  }
});

test('applySEO: " im project.name bricht NICHT aus einem Attribut aus (kein Event-Handler injizierbar)', () => {
  const html = seoHtml({ name: 'Boom" onload="alert(2)', category: 'kanzlei', contact: { address: 'x, 33100 Y' } });
  const $ = cheerio.load(html);
  assert.equal($('[onload]').length, 0, 'kein injiziertes onload-Attribut (esc schützt Attributkontext)');
});

test('applySEO: normale Daten erzeugen weiterhin valides schema.org-JSON-LD', () => {
  const html = seoHtml({ name: 'Dr. Weber & Mustermann', category: 'kanzlei', contact: { address: 'Paderwall 1, 33102 Paderborn' } });
  const $ = cheerio.load(html);
  const node = JSON.parse($('script[type="application/ld+json"]').first().text());
  assert.equal(node['@context'], 'https://schema.org');
  assert.ok(JSON.stringify(node).includes('Weber'), 'Name bleibt im geparsten JSON erhalten');
});
