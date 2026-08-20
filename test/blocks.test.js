const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleBlocks, selectBlocks } = require('../blocks');

const HTML = '<!doctype html><html><body><main>x</main><footer>f</footer></body></html>';
const dna = { palette: { accent: '#9C7A3C', text: '#16202B' } };

test('cta-band wird montiert, wenn Telefon vorhanden', () => {
  const out = assembleBlocks(HTML, { category: 'Kanzlei', contact: { phone: '040 123' } }, dna, {});
  assert.equal(out.injected, 1);
  assert.match(out.html, /data-block="cta-band"/);
  assert.match(out.html, /040 123/);
});

test('ohne Telefon → kein cta-band', () => {
  const out = assembleBlocks(HTML, { category: 'Kanzlei', contact: {} }, dna, {});
  assert.equal(out.injected, 0);
});

test('idempotent: zweiter Lauf fügt nichts doppelt hinzu', () => {
  const first = assembleBlocks(HTML, { contact: { phone: '040 123' } }, dna, {}).html;
  const second = assembleBlocks(first, { contact: { phone: '040 123' } }, dna, {});
  assert.equal(second.injected, 0);
  assert.equal((second.html.match(/data-block="cta-band"/g) || []).length, 1);
});

test('selectBlocks filtert nach type', () => {
  const ctas = selectBlocks({ type: 'cta' });
  assert.ok(ctas.find(b => b.id === 'cta-band'));
});
