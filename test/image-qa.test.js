const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { buildImages } = require('../images-build');
const { analyzeImageQa } = require('../image-qa');

async function writeJpeg(file, w, h) {
  fs.writeFileSync(file, await sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 50, b: 80 } } }).jpeg({ quality: 80 }).toBuffer());
}

async function builtProject({ alt = 'Thomas Wilmes, Rechtsanwalt' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgqa-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  await writeJpeg(path.join(dir, 'assets', 'team.jpg'), 1600, 1200);
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title></head>
     <body><img src="assets/team.jpg" alt="${alt}" class="avatar"></body></html>`);
  await buildImages(dir); // erzeugt AVIF/WebP-Leiter + <picture> + width/height
  return dir;
}

test('analyzeImageQa: durch die Pipeline gebautes Bild → hoher Score (modern, responsive, Maße)', async () => {
  const dir = await builtProject();
  const r = analyzeImageQa(dir);
  assert.ok(r.score >= 90, `Score zu niedrig: ${r.score} (${r.issues.join('; ')})`);
  const byKey = Object.fromEntries(r.checks.map(c => [c.key, c.pass]));
  assert.equal(byKey.no_broken, true);
  assert.equal(byKey.modern_format, true);
  assert.equal(byKey.responsive, true);
  assert.equal(byKey.dimensions, true);
  assert.equal(byKey.alt_quality, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeImageQa: kaputtes Derivat (0-Byte) → no_broken schlägt fehl', async () => {
  const dir = await builtProject();
  // Ein AVIF-Derivat auf 0 Byte kürzen.
  const avif = fs.readdirSync(path.join(dir, 'assets')).find(f => f.endsWith('.avif'));
  fs.writeFileSync(path.join(dir, 'assets', avif), '');
  const r = analyzeImageQa(dir);
  assert.equal(r.checks.find(c => c.key === 'no_broken').pass, false);
  assert.ok(r.stats.broken >= 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeImageQa: schwacher Alt-Text (Dateiname) → alt_quality schlägt fehl', async () => {
  const dir = await builtProject({ alt: 'team.jpg' });
  const r = analyzeImageQa(dir);
  assert.equal(r.checks.find(c => c.key === 'alt_quality').pass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeImageQa: fehlender Alt-Text → alt_quality schlägt fehl', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgqa-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  await writeJpeg(path.join(dir, 'assets', 'team.jpg'), 800, 600);
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>x</title></head><body><img src="assets/team.jpg"></body></html>`);
  await buildImages(dir);
  const r = analyzeImageQa(dir);
  assert.equal(r.checks.find(c => c.key === 'alt_quality').pass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeImageQa: unoptimiertes Bild (kein <picture>) → modern_format + responsive schlagen fehl', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgqa-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  await writeJpeg(path.join(dir, 'assets', 'team.jpg'), 800, 600);
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>x</title></head><body><img src="assets/team.jpg" alt="Ein Anwalt" width="800" height="600"></body></html>`);
  // KEIN buildImages → nacktes <img>
  const r = analyzeImageQa(dir);
  assert.equal(r.checks.find(c => c.key === 'modern_format').pass, false);
  assert.equal(r.checks.find(c => c.key === 'responsive').pass, false);
  assert.equal(r.checks.find(c => c.key === 'no_broken').pass, true); // die jpg existiert ja
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeImageQa: Site ohne Raster-Bilder → bild-spezifische Checks n/a → hoher Score', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgqa-'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>x</title></head><body><h1>Nur Text</h1></body></html>`);
  const r = analyzeImageQa(dir);
  assert.ok(r.score >= 90, `Score ${r.score}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeImageQa: keine index.html → n/a statt Absturz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgqa-'));
  const r = analyzeImageQa(dir);
  assert.equal(r.grade, 'n/a');
  fs.rmSync(dir, { recursive: true, force: true });
});
