const { test } = require('node:test');
const assert = require('node:assert/strict');
const { injectAssets } = require('../assets');

const HEADER_IMG = '<!doctype html><html><head></head><body><header><img src="placeholder.jpg" alt="Hero"></header><main>x</main><footer>f</footer></body></html>';

test('injectAssets setzt Hero-Foto auf <header><img>, wenn kein [data-hero-img]', () => {
  const out = injectAssets(HEADER_IMG, { fonts: '', heroPhoto: 'assets/pexels-1.jpg' }).html;
  assert.match(out, /src="assets\/pexels-1\.jpg"/);
  assert.match(out, /data-hero-photo/);
});

test('injectAssets Hero-Fallback ist idempotent (kein doppeltes Anwenden)', () => {
  const once = injectAssets(HEADER_IMG, { fonts: '', heroPhoto: 'assets/pexels-1.jpg' }).html;
  const twice = injectAssets(once, { fonts: '', heroPhoto: 'assets/pexels-2.jpg' }).html;
  // Marker bleibt einmalig, das Foto wird nicht erneut überschrieben.
  assert.equal((twice.match(/data-hero-photo/g) || []).length, 1);
  assert.match(twice, /src="assets\/pexels-1\.jpg"/);
  assert.doesNotMatch(twice, /pexels-2/);
});

test('injectAssets bevorzugt explizites [data-hero-img]', () => {
  const html = '<!doctype html><html><head></head><body><header><img data-hero-img src="p.jpg"></header><footer>f</footer></body></html>';
  const out = injectAssets(html, { fonts: '', heroPhoto: 'assets/hero.jpg' }).html;
  assert.match(out, /data-hero-img[^>]*src="assets\/hero\.jpg"/);
});

test('injectAssets setzt background-image auf <header>, wenn kein <img> vorhanden', () => {
  const html = '<!doctype html><html><head></head><body><header data-hero>Intro</header><footer>f</footer></body></html>';
  const out = injectAssets(html, { fonts: '', heroPhoto: 'assets/bg.jpg' }).html;
  assert.match(out, /background-image:url\('assets\/bg\.jpg'\)/);
  assert.match(out, /data-hero-photo/);
});

test('injectAssets wirft nicht und lässt HTML unbeschädigt ohne Foto', () => {
  const out = injectAssets(HEADER_IMG, { fonts: '', heroPhoto: null }).html;
  assert.match(out, /placeholder\.jpg/);
  assert.doesNotMatch(out, /data-hero-photo/);
});
