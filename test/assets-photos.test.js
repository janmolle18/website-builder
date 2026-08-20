const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keywordsFor, fetchHeroPhoto } = require('../assets-photos');

test('keywordsFor nutzt Kategorie + ersten Schwerpunkt', () => {
  const q = keywordsFor({ category: 'Rechtsanwaltskanzlei', specialties: ['Arbeitsrecht'] });
  assert.match(q, /Rechtsanwaltskanzlei/);
  assert.match(q, /Arbeitsrecht/);
});

test('fetchHeroPhoto ohne API-Key → null (sauberer Fallback)', async () => {
  const prevP = process.env.PEXELS_API_KEY;
  const prevU = process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.PEXELS_API_KEY;
  delete process.env.UNSPLASH_ACCESS_KEY;
  const res = await fetchHeroPhoto({ category: 'Restaurant' });
  assert.equal(res, null);
  if (prevP) process.env.PEXELS_API_KEY = prevP;
  if (prevU) process.env.UNSPLASH_ACCESS_KEY = prevU;
});
