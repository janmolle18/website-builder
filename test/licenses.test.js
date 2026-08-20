const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isAllowed, recordAsset, writeLicenseManifest } = require('../licenses');

test('isAllowed nur für Whitelist-Quellen', () => {
  assert.equal(isAllowed('unsplash'), true);
  assert.equal(isAllowed('pexels'), true);
  assert.equal(isAllowed('shutterstock'), false);
});

test('recordAsset ist immutable und hängt die Lizenz an', () => {
  const before = [];
  const after = recordAsset(before, { source: 'unsplash', type: 'photo', ref: 'hero.jpg' });
  assert.equal(before.length, 0);
  assert.equal(after.length, 1);
  assert.equal(after[0].license, 'Unsplash License');
});

test('recordAsset wirft bei nicht-gelisteter Quelle', () => {
  assert.throws(() => recordAsset([], { source: 'shutterstock', type: 'photo', ref: 'x' }));
});

test('writeLicenseManifest schreibt licenses.json + CREDITS.txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const recs = recordAsset([], { source: 'lucide', type: 'icon', ref: 'phone' });
  writeLicenseManifest(dir, recs);
  assert.ok(fs.existsSync(path.join(dir, 'licenses.json')));
  const credits = fs.readFileSync(path.join(dir, 'CREDITS.txt'), 'utf8');
  assert.ok(credits.includes('phone'));
});
