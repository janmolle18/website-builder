/**
 * Regression: Google-Places-Foto-URLs dürfen den API-Key NIE nach außen tragen.
 * materializePlacePhotos lädt Fotos mit projectDir lokal (assets/scraped/) bzw.
 * löst ohne projectDir den Redirect zur key-losen googleusercontent-URL auf.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { materializePlacePhotos } = require('../agent-scraper');

const API_KEY = 'TEST-KEY-123';
const PHOTOS = [{ photo_reference: 'ref-a' }, { photo_reference: 'ref-b' }];

function withAxiosGet(fake, fn) {
  const original = axios.get;
  axios.get = fake;
  return Promise.resolve()
    .then(fn)
    .finally(() => { axios.get = original; });
}

test('mit projectDir: Fotos lokal in assets/scraped/, relative Pfade ohne Key', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-photos-'));
  const requestedUrls = [];

  const images = await withAxiosGet(async (url) => {
    requestedUrls.push(url);
    return { headers: { 'content-type': 'image/jpeg' }, data: Buffer.from('fake-jpg') };
  }, () => materializePlacePhotos(PHOTOS, API_KEY, projectDir));

  assert.deepEqual(images, ['assets/scraped/maps-1.jpg', 'assets/scraped/maps-2.jpg']);
  for (const rel of images) {
    assert.ok(fs.existsSync(path.join(projectDir, rel)), `${rel} muss geschrieben sein`);
    assert.ok(!rel.includes(API_KEY), 'kein Key im zurückgegebenen Pfad');
  }
  // Der Key wird nur serverseitig für den Abruf benutzt — nie zurückgegeben.
  assert.ok(requestedUrls.every(u => u.includes(`key=${API_KEY}`)));
});

test('ohne projectDir: Redirect wird zur key-losen URL aufgelöst', async () => {
  const images = await withAxiosGet(async () => (
    { headers: { location: 'https://lh3.googleusercontent.com/p/abc=s800' } }
  ), () => materializePlacePhotos(PHOTOS, API_KEY, undefined));

  assert.equal(images.length, 2);
  for (const url of images) {
    assert.equal(url, 'https://lh3.googleusercontent.com/p/abc=s800');
    assert.ok(!url.includes(API_KEY), 'kein Key in zurückgegebener URL');
  }
});

test('Foto-Fehler werden übersprungen, Rest kommt durch', async () => {
  let call = 0;
  const images = await withAxiosGet(async () => {
    call += 1;
    if (call === 1) throw new Error('403');
    return { headers: { location: 'https://lh3.googleusercontent.com/p/ok' } };
  }, () => materializePlacePhotos(PHOTOS, API_KEY, undefined));

  assert.deepEqual(images, ['https://lh3.googleusercontent.com/p/ok']);
});

test('ungültige Foto-Einträge werden ignoriert', async () => {
  const images = await withAxiosGet(async () => {
    throw new Error('darf nicht aufgerufen werden');
  }, () => materializePlacePhotos([null, {}, { photo_reference: '' }], API_KEY, undefined));

  assert.deepEqual(images, []);
});
