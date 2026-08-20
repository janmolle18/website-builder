const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fontLink } = require('../assets-fonts');

test('baut Google-Fonts-Link aus DNA-Fonts', () => {
  const html = fontLink({ fonts: { heading: 'Fraunces', body: 'Inter' } });
  assert.match(html, /fonts\.googleapis\.com/);
  assert.match(html, /Fraunces/);
  assert.match(html, /Inter/);
  assert.match(html, /display=swap/);
});

test('ohne Fonts → leerer String', () => {
  assert.equal(fontLink({}), '');
  assert.equal(fontLink(null), '');
});
