const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeSelfHosting } = require('../self-hosting');

function tmpSite(headExtra = '', bodyExtra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title>
     <link rel="stylesheet" href="assets/tailwind.css">${headExtra}</head>
     <body><h1>Kanzlei</h1>${bodyExtra}</body></html>`);
  return dir;
}

test('analyzeSelfHosting: voll self-hosted → selfHosted true, Score 100', () => {
  const dir = tmpSite('<link rel="stylesheet" href="assets/fonts.css">',
    '<script src="assets/app.js"></script>');
  const r = analyzeSelfHosting(dir);
  assert.equal(r.selfHosted, true);
  assert.equal(r.score, 100);
  assert.equal(r.hosts.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: Google Fonts CDN → selfHosted false + fonts-Kategorie', () => {
  const dir = tmpSite('<link href="https://fonts.googleapis.com/css2?family=Fraunces" rel="stylesheet">');
  const r = analyzeSelfHosting(dir);
  assert.equal(r.selfHosted, false);
  assert.ok(r.score < 100);
  assert.ok(r.hosts.some(h => h.host.includes('googleapis') && h.category === 'fonts'));
  assert.ok(r.issues.some(i => /font/i.test(i)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: Tailwind-CDN-Script + jsdelivr → cdn-Kategorie erkannt', () => {
  const dir = tmpSite('', '<script src="https://cdn.tailwindcss.com"></script>'
    + '<script src="https://cdn.jsdelivr.net/npm/alpinejs"></script>');
  const r = analyzeSelfHosting(dir);
  assert.equal(r.selfHosted, false);
  assert.ok(r.hosts.some(h => h.category === 'cdn'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: Tracker (google-analytics) → tracker-Kategorie (DSGVO)', () => {
  const dir = tmpSite('', '<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>');
  const r = analyzeSelfHosting(dir);
  assert.equal(r.selfHosted, false);
  assert.ok(r.hosts.some(h => h.category === 'tracker'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: gstatic-Preconnect zählt auch (fonts)', () => {
  const dir = tmpSite('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  const r = analyzeSelfHosting(dir);
  assert.equal(r.selfHosted, false);
  assert.ok(r.hosts.some(h => h.host.includes('gstatic')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: mehrere Seiten werden gescannt, Host dedupliziert mit count', () => {
  const dir = tmpSite('<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'x.html'),
    '<html><head><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head><body></body></html>');
  const r = analyzeSelfHosting(dir);
  const g = r.hosts.find(h => h.host.includes('googleapis'));
  assert.ok(g && g.count >= 2, 'count über beide Seiten');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: protokoll-lose CDN-URL → echter Hostname statt Label als Schlüssel', () => {
  // Kaputter Font-Fallback: buildFonts scheitert, hinterlässt protokoll-lose/root-relative CDN-Refs.
  // Genau der Fall, den das Modul erkennen soll — der Host darf NICHT zum Label kollabieren.
  const dir = tmpSite('<link rel="stylesheet" href="fonts.googleapis.com/css2?family=Inter">');
  const r = analyzeSelfHosting(dir);
  assert.equal(r.selfHosted, false);
  const g = r.hosts.find(h => h.category === 'fonts');
  assert.ok(g, 'fonts-Host erkannt');
  assert.equal(g.host, 'fonts.googleapis.com', `echter Host statt Label, war: ${g.host}`);
  assert.ok(!/\s|\(/.test(g.host), 'Host enthält kein Label-Textfragment');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeSelfHosting: keine index.html → n/a statt Absturz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-'));
  const r = analyzeSelfHosting(dir);
  assert.equal(r.grade, 'n/a');
  fs.rmSync(dir, { recursive: true, force: true });
});
