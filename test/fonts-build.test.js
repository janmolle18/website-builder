const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseGoogleFontsLink, gwfhId } = require('../fonts-build');

test('gwfhId: Familienname → gwfh-ID', () => {
  assert.equal(gwfhId('Inter'), 'inter');
  assert.equal(gwfhId('Cormorant Garamond'), 'cormorant-garamond');
  assert.equal(gwfhId('Source Sans 3'), 'source-sans-3');
  assert.equal(gwfhId('Archivo Black'), 'archivo-black');
});

test('parseGoogleFontsLink: Familien + Gewichte aus css2-Link (inkl. opsz-Achse)', () => {
  const r = parseGoogleFontsLink('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500&display=swap');
  assert.deepEqual(r, [
    { family: 'Fraunces', weights: ['400', '600'] },
    { family: 'Inter', weights: ['400', '500'] }
  ]);
});

test('parseGoogleFontsLink: Familie ohne Gewichte → Default 400', () => {
  const r = parseGoogleFontsLink('https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap');
  assert.deepEqual(r, [{ family: 'Archivo Black', weights: ['400'] }]);
});

test('parseGoogleFontsLink: mehrere Gewichte einer einfachen Familie', () => {
  const r = parseGoogleFontsLink('https://fonts.googleapis.com/css2?family=Lora:wght@500;600&display=swap');
  assert.deepEqual(r, [{ family: 'Lora', weights: ['500', '600'] }]);
});
