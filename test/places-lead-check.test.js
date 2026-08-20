const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { lookupPlace, FIELD_MASK } = require('../places-lead-check');

function tmpUsageFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'places-usage-'));
  return path.join(dir, 'places-usage.json');
}

const NOW = new Date('2026-07-14T12:00:00.000Z');
const QUERY = { name: 'Kanzlei Muster', address: 'Hauptstr 5, 33098 Paderborn', city: 'Paderborn' };

test('lookupPlace: Kill-Switch → ok:false, kein API-Call, kein Zählerverbrauch', async () => {
  const usageFile = tmpUsageFile();
  let called = 0;
  const r = await lookupPlace(QUERY, { enabled: false, apiKey: 'k', usageFile, now: NOW, post: async () => { called++; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /PLACES_LOOKUP/);
  assert.equal(called, 0);
  assert.equal(fs.existsSync(usageFile), false);
});

test('lookupPlace: fehlender API-Key → ok:false', async () => {
  const r = await lookupPlace(QUERY, { enabled: true, apiKey: '', usageFile: tmpUsageFile(), now: NOW, post: async () => {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /GOOGLE_PLACES_API_KEY/);
});

test('lookupPlace: Monats-Cap erreicht → ok:false, kein API-Call', async () => {
  const usageFile = tmpUsageFile();
  fs.writeFileSync(usageFile, JSON.stringify({ month: '2026-07', count: 3 }));
  let called = 0;
  const r = await lookupPlace(QUERY, { enabled: true, apiKey: 'k', usageFile, cap: 3, now: NOW, post: async () => { called++; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Cap/i);
  assert.equal(called, 0);
});

test('lookupPlace: Monatswechsel setzt den Zähler zurück', async () => {
  const usageFile = tmpUsageFile();
  fs.writeFileSync(usageFile, JSON.stringify({ month: '2026-06', count: 999 }));
  const post = async () => ({ data: { places: [] } });
  const r = await lookupPlace(QUERY, { enabled: true, apiKey: 'k', usageFile, cap: 1000, now: NOW, post });
  assert.equal(r.ok, true);
  const usage = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
  assert.deepEqual(usage, { month: '2026-07', count: 1 });
});

test('lookupPlace: Erfolg — richtige URL, FieldMask, Query; Kandidaten gemappt; Zähler hochgezählt', async () => {
  const usageFile = tmpUsageFile();
  let captured;
  const post = async (url, body, config) => {
    captured = { url, body, config };
    return {
      data: {
        places: [{
          id: 'ChIJabc', displayName: { text: 'Kanzlei Muster PartG' },
          websiteUri: 'https://muster.de', rating: 4.7, userRatingCount: 41,
          businessStatus: 'OPERATIONAL', nationalPhoneNumber: '05251 123'
        }]
      }
    };
  };
  const r = await lookupPlace(QUERY, { enabled: true, apiKey: 'test-key', usageFile, cap: 10, now: NOW, post });
  assert.equal(r.ok, true);
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0], {
    placeId: 'ChIJabc', name: 'Kanzlei Muster PartG', website: 'https://muster.de',
    rating: 4.7, userRatingCount: 41, businessStatus: 'OPERATIONAL', phone: '05251 123'
  });
  assert.match(captured.url, /places\.googleapis\.com\/v1\/places:searchText/);
  assert.equal(captured.config.headers['X-Goog-Api-Key'], 'test-key');
  assert.equal(captured.config.headers['X-Goog-FieldMask'], FIELD_MASK);
  assert.match(captured.body.textQuery, /Kanzlei Muster/);
  assert.match(captured.body.textQuery, /Paderborn/);
  assert.equal(JSON.parse(fs.readFileSync(usageFile, 'utf8')).count, 1);
});

test('lookupPlace: keine Treffer → ok:true mit leeren Kandidaten', async () => {
  const r = await lookupPlace(QUERY, { enabled: true, apiKey: 'k', usageFile: tmpUsageFile(), now: NOW, post: async () => ({ data: {} }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.candidates, []);
});

test('lookupPlace: HTTP-Fehler → ok:false mit Grund, wirft nicht', async () => {
  const post = async () => { const e = new Error('Request failed'); e.response = { status: 403, data: { error: { message: 'API not enabled' } } }; throw e; };
  const r = await lookupPlace(QUERY, { enabled: true, apiKey: 'k', usageFile: tmpUsageFile(), now: NOW, post });
  assert.equal(r.ok, false);
  assert.match(r.reason, /403/);
  assert.match(r.reason, /API not enabled/);
});
