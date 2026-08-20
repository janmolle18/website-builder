const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleBlocks, isDuplicateSection } = require('../blocks');

const cheerio = require('cheerio');

const dna = {
  palette: {
    bg: '#F5F4F1', surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C'
  }
};

const BARE = '<!doctype html><html><body><main>x</main><footer>f</footer></body></html>';

// Vollständiges Projekt mit allen Daten, die die Blöcke benötigen.
const project = {
  category: 'Kanzlei',
  contact: { phone: '040 123456', address: 'Musterallee 81, 22763 Hamburg' },
  specialties: ['Arbeitsrecht', 'Mietrecht', 'Steuerrecht']
};

// ── leistungen (type 'services') ───────────────────────────────────────────────
test('leistungen wird ÜBERSPRUNGEN, wenn die Seite bereits eine Leistungen-Überschrift hat', () => {
  const html = '<!doctype html><html><body><main><h2>Leistungen</h2><p>...</p></main><footer>f</footer></body></html>';
  const out = assembleBlocks(html, project, dna, {});
  assert.doesNotMatch(out.html, /data-block="leistungen"/);
});

test('leistungen wird auf einer leeren Seite INJIZIERT', () => {
  const out = assembleBlocks(BARE, project, dna, {});
  assert.match(out.html, /data-block="leistungen"/);
});

// ── anfahrt (type 'location') ──────────────────────────────────────────────────
test('anfahrt wird ÜBERSPRUNGEN, wenn die Seite bereits einen Google-Maps-Link enthält', () => {
  const html = '<!doctype html><html><body><main><a href="https://www.google.com/maps/place/Hamburg">Karte</a></main><footer>f</footer></body></html>';
  const out = assembleBlocks(html, project, dna, {});
  assert.doesNotMatch(out.html, /data-block="anfahrt"/);
});

test('anfahrt wird auf einer leeren Seite INJIZIERT', () => {
  const out = assembleBlocks(BARE, project, dna, {});
  assert.match(out.html, /data-block="anfahrt"/);
});

// ── cta-band (type 'cta') ──────────────────────────────────────────────────────
test('cta-band wird auf einer leeren Seite mit Telefon INJIZIERT (cta nie als Duplikat)', () => {
  const out = assembleBlocks(BARE, { category: 'Kanzlei', contact: { phone: '040 123456' } }, dna, {});
  assert.match(out.html, /data-block="cta-band"/);
  assert.match(out.html, /040 123456/);
});

// ── isDuplicateSection direkt ──────────────────────────────────────────────────
test('isDuplicateSection: services erkennt diverse Überschriften, cta nie', () => {
  for (const heading of ['Leistungen', 'Unsere Schwerpunkte', 'Rechtsgebiete', 'Angebot', 'Services']) {
    const $ = cheerio.load(`<h2>${heading}</h2>`);
    assert.equal(isDuplicateSection('services', $), true, heading);
  }
  const $bare = cheerio.load('<main>x</main>');
  assert.equal(isDuplicateSection('services', $bare), false);
  assert.equal(isDuplicateSection('location', $bare), false);
  assert.equal(isDuplicateSection('cta', cheerio.load('<h2>Leistungen</h2>')), false);
});

test('isDuplicateSection: location erkennt Maps-Varianten und Kontakt-Überschriften', () => {
  for (const href of [
    'https://www.google.com/maps/place/X',
    'https://maps.google.com/?q=X',
    'https://maps.app.goo.gl/abc'
  ]) {
    const $ = cheerio.load(`<a href="${href}">Karte</a>`);
    assert.equal(isDuplicateSection('location', $), true, href);
  }
  for (const heading of ['Anfahrt', 'So finden Sie uns', 'Standort', 'Kontakt']) {
    const $ = cheerio.load(`<h3>${heading}</h3>`);
    assert.equal(isDuplicateSection('location', $), true, heading);
  }
});

test('isDuplicateSection wirft nie, auch bei kaputtem Input', () => {
  assert.doesNotThrow(() => isDuplicateSection('services', cheerio.load('')));
  assert.doesNotThrow(() => isDuplicateSection('location', null));
  assert.doesNotThrow(() => isDuplicateSection('unknown', cheerio.load('<h2>Leistungen</h2>')));
});
