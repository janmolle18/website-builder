const { test } = require('node:test');
const assert = require('node:assert/strict');
const { injectAssets } = require('../assets');

const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><img data-hero-img src="placeholder.jpg"><footer>f</footer></body></html>';

test('injectAssets fügt Font-Link ein und ist idempotent', () => {
  const fonts = '<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">';
  const once = injectAssets(HTML, { fonts, heroPhoto: null }).html;
  assert.ok(once.includes('fonts.googleapis.com'));
  const twice = injectAssets(once, { fonts, heroPhoto: null }).html;
  assert.equal((twice.match(/fonts\.googleapis\.com/g) || []).length, 1);
});

test('injectAssets setzt Hero-Foto auf [data-hero-img]', () => {
  const out = injectAssets(HTML, { fonts: '', heroPhoto: 'assets/pexels-1.jpg' }).html;
  assert.match(out, /data-hero-img[^>]*src="assets\/pexels-1\.jpg"/);
});
