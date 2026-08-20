const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickVariant, LAYOUT_VARIANTS, selectDNA, dnaToPrompt } = require('../design-dna');

test('pickVariant ist deterministisch (gleicher Name → gleiche Variante)', () => {
  const a = pickVariant({ name: 'Dr. Weber & Mustermann' });
  const b = pickVariant({ name: 'Dr. Weber & Mustermann' });
  assert.equal(a.key, b.key);
  assert.ok(LAYOUT_VARIANTS.find(v => v.key === a.key));
});

test('pickVariant streut über verschiedene Namen (Anti-Sameness)', () => {
  const names = ['Kanzlei Alpha', 'Praxis Beta', 'Restaurant Gamma', 'Friseur Delta', 'Bau Epsilon', 'Steuerkanzlei Zeta', 'Cafe Eta', 'Gym Theta'];
  const keys = new Set(names.map(n => pickVariant({ name: n }).key));
  assert.ok(keys.size >= 3, `erwartet >=3 verschiedene Varianten, bekam ${keys.size}`);
});

test('selectDNA hängt eine Variante an und dnaToPrompt rendert sie', () => {
  const dna = selectDNA({ name: 'Test Kanzlei', category: 'kanzlei' });
  assert.ok(dna.variant && dna.variant.key, 'dna.variant fehlt');
  const p = dnaToPrompt(dna);
  assert.match(p, /LAYOUT-VARIANTE/);
});

test('dnaKey-Pin bleibt funktionsfähig + bekommt trotzdem eine Variante', () => {
  const dna = selectDNA({ name: 'Noir Test', category: 'kanzlei', dnaKey: 'kanzlei-noir' });
  assert.equal(dna.key, 'kanzlei-noir');
  assert.equal(dna.mode, 'dark');
  assert.ok(dna.variant && dna.variant.key);
});
