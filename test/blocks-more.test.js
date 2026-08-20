const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleBlocks } = require('../blocks');

const HTML = '<!doctype html><html><body><main>x</main><footer>f</footer></body></html>';
const dna = { palette: { bg: '#F5F4F1', surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C' } };

// ── anfahrt ──────────────────────────────────────────────────────────────────
test('anfahrt wird montiert mit Adresse und Google-Maps-Link', () => {
  const project = { contact: { address: 'Musterallee 81, 22763 Hamburg' } };
  const out = assembleBlocks(HTML, project, dna, {});
  assert.match(out.html, /data-block="anfahrt"/);
  assert.match(out.html, /Musterallee 81, 22763 Hamburg/);
  // & wird beim HTML-Serialisieren korrekt zu &amp; escaped
  assert.match(out.html, /google\.com\/maps\/search\/\?api=1&amp;query=/);
  // Adresse muss URL-kodiert im Link stehen
  assert.match(out.html, new RegExp(encodeURIComponent('Musterallee 81, 22763 Hamburg').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('anfahrt ist idempotent', () => {
  const project = { contact: { address: 'Musterallee 81, 22763 Hamburg' } };
  const first = assembleBlocks(HTML, project, dna, {}).html;
  const second = assembleBlocks(first, project, dna, {});
  assert.equal((second.html.match(/data-block="anfahrt"/g) || []).length, 1);
});

test('ohne Adresse → kein anfahrt', () => {
  const out = assembleBlocks(HTML, { contact: {} }, dna, {});
  assert.doesNotMatch(out.html, /data-block="anfahrt"/);
});

// ── leistungen ───────────────────────────────────────────────────────────────
test('leistungen rendert aus >=3 Spezialitäten', () => {
  const project = { specialties: ['Arbeitsrecht', 'Mietrecht', 'Steuerrecht'] };
  const out = assembleBlocks(HTML, project, dna, {});
  assert.match(out.html, /data-block="leistungen"/);
  assert.match(out.html, /Arbeitsrecht/);
  assert.match(out.html, /Mietrecht/);
  assert.match(out.html, /Steuerrecht/);
});

test('leistungen ist idempotent', () => {
  const project = { specialties: ['Arbeitsrecht', 'Mietrecht', 'Steuerrecht'] };
  const first = assembleBlocks(HTML, project, dna, {}).html;
  const second = assembleBlocks(first, project, dna, {});
  assert.equal((second.html.match(/data-block="leistungen"/g) || []).length, 1);
});

test('leistungen rendert NICHT bei < 3 Spezialitäten', () => {
  const out = assembleBlocks(HTML, { specialties: ['Arbeitsrecht', 'Mietrecht'] }, dna, {});
  assert.doesNotMatch(out.html, /data-block="leistungen"/);
});

test('leistungen rendert NICHT ohne specialties-Array', () => {
  const out = assembleBlocks(HTML, {}, dna, {});
  assert.doesNotMatch(out.html, /data-block="leistungen"/);
});
