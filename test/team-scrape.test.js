const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slugFromUrl, findProfileLinks } = require('../agent-scraper');

test('slugFromUrl: Verzeichnis- UND .html-Stil', () => {
  assert.equal(slugFromUrl('https://x.de/rechtsanwaelte/thomas-wilmes/'), 'thomas-wilmes');
  assert.equal(slugFromUrl('https://x.de/rechtsanwaelte/thomas-wilmes.html'), 'thomas-wilmes');
  assert.equal(slugFromUrl('https://x.de/rechtsanwaelte/'), 'rechtsanwaelte');
});

test('findProfileLinks erkennt Verzeichnis-Profile (echtes wessel-Muster)', () => {
  const html = `
    <a href="/rechtsanwaelte/thomas-wilmes/">Thomas Wilmes</a>
    <a href="/rechtsanwaelte/christine-mustermann/">Christine Mustermann</a>
    <a href="/rechtsanwaelte/">Übersicht</a>
    <a href="thomas-wilmes.html">selbe Person, .html</a>
    <a href="/impressum/">Impressum</a>
    <a href="mailto:kanzlei@anwalt-paderborn.de">Mail</a>`;
  const links = findProfileLinks(html, 'https://www.weber-mustermann.example/rechtsanwaelte/');
  const slugs = links.map(l => l.slug).sort();
  assert.deepEqual(slugs, ['christine-mustermann', 'thomas-wilmes']); // Container/Impressum/Mail raus, .html-Dublette dedupliziert
});

test('findProfileLinks: keine Profile außerhalb des Bereichs', () => {
  const html = `<a href="/rechtsgebiete/arbeitsrecht/">Arbeitsrecht</a><a href="/kontakt/">Kontakt</a>`;
  const links = findProfileLinks(html, 'https://www.weber-mustermann.example/rechtsanwaelte/');
  assert.equal(links.length, 0);
});
