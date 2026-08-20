const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeA11y, CHECKS } = require('../a11y');

function tmp(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}

const GOOD = `<!doctype html><html lang="de"><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Kanzlei Test – Paderborn</title></head>
  <body>
    <h1>Kanzlei</h1><h2>Leistungen</h2><h3>Verkehrsrecht</h3>
    <img src="a.jpg" alt="Team"><a href="/x">Kontakt</a>
    <button>Menü öffnen</button>
    <form><label for="e">E-Mail</label><input id="e" type="email"></form>
  </body></html>`;

const BAD = `<!doctype html><html><head></head><body>
    <h2>Start</h2><h4>Sprung</h4>
    <img src="a.jpg"><a href="/x"></a><button></button>
    <input type="text">
  </body></html>`;

test('Gewichte summieren sich zu 100', () => {
  assert.equal(CHECKS.reduce((s, c) => s + c.weight, 0), 100);
});

test('saubere Seite erreicht Top-Score', () => {
  const dir = tmp(GOOD);
  const r = analyzeA11y(dir);
  assert.ok(r.score >= 90, `Score sollte >=90 sein, war ${r.score} (${r.issues.join('; ')})`);
  assert.equal(r.grade, 'A');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mangelhafte Seite wird erkannt (kein lang, kein h1, alt fehlt, Heading-Sprung, leere Links/Buttons)', () => {
  const dir = tmp(BAD);
  const r = analyzeA11y(dir);
  assert.ok(r.score < 60, `Score sollte niedrig sein, war ${r.score}`);
  const failed = r.checks.filter(c => !c.pass).map(c => c.key);
  assert.ok(failed.includes('lang'));
  assert.ok(failed.includes('single_h1'));
  assert.ok(failed.includes('img_alt'));
  assert.ok(failed.includes('heading_order'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ohne index.html → Score 0, kein Absturz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-empty-'));
  assert.equal(analyzeA11y(dir).score, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
