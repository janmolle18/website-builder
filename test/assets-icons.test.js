const { test } = require('node:test');
const assert = require('node:assert/strict');
const { icon, hasIcon } = require('../assets-icons');

test('liefert Inline-SVG für bekannten Namen', () => {
  const svg = icon('phone');
  assert.match(svg, /^<svg/);
  assert.match(svg, /currentColor/);
});

test('unbekannter Name → leerer String, kein Wurf', () => {
  assert.equal(hasIcon('does-not-exist'), false);
  assert.equal(icon('does-not-exist'), '');
});
