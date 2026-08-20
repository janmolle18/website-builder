const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { analyzeWeakImages, THRESHOLDS } = require('../weak-images');

async function writeJpeg(file, w, h) {
  fs.writeFileSync(file, await sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg({ quality: 80 }).toBuffer());
}

/** Baut ein Mini-Projekt mit index.html + Assets. imgs: [{file,w,h,html}]. */
async function project(imgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weakimg-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const tags = [];
  for (const im of imgs) {
    await writeJpeg(path.join(dir, 'assets', im.file), im.w, im.h);
    tags.push(im.html || `<img src="assets/${im.file}" alt="Foto">`);
  }
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title></head><body>${tags.join('')}</body></html>`);
  return dir;
}

test('analyzeWeakImages: alle Fotos groß genug → Score 100, Note A, keine Flags', async () => {
  const dir = await project([
    { file: 'team.jpg', w: 1600, h: 1200 },
    { file: 'hero.jpg', w: 2000, h: 1000, html: '<img src="assets/hero.jpg" data-hero-photo alt="Kanzlei">' },
  ]);
  const r = analyzeWeakImages(dir);
  assert.equal(r.score, 100, r.issues.join('; '));
  assert.equal(r.grade, 'A');
  assert.equal(r.stats.weak, 0);
  assert.equal(r.stats.veryWeak, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: sehr niedrig aufgelöstes Content-Foto (< 480px) → very-weak, no_very_weak schlägt fehl', async () => {
  const dir = await project([{ file: 'klein.jpg', w: 320, h: 240 }]);
  const r = analyzeWeakImages(dir);
  assert.equal(r.stats.veryWeak, 1);
  assert.equal(r.checks.find(c => c.key === 'no_very_weak').pass, false);
  assert.ok(r.score < 60, `Score ${r.score}`);
  assert.ok(r.images.some(i => i.level === 'very-weak' && /klein\.jpg/.test(i.src)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: grenzwertiges Content-Foto (480–768px) → weak, no_weak schlägt fehl aber no_very_weak ok', async () => {
  const dir = await project([{ file: 'mittel.jpg', w: 640, h: 480 }]);
  const r = analyzeWeakImages(dir);
  assert.equal(r.stats.weak, 1);
  assert.equal(r.stats.veryWeak, 0);
  assert.equal(r.checks.find(c => c.key === 'no_weak').pass, false);
  assert.equal(r.checks.find(c => c.key === 'no_very_weak').pass, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: rollenbewusst — 1000px ist als Hero schwach, als Content ok', async () => {
  const asHero = await project([{ file: 'h.jpg', w: 1000, h: 600, html: '<img src="assets/h.jpg" data-hero-photo alt="x">' }]);
  const rh = analyzeWeakImages(asHero);
  assert.equal(rh.stats.weak, 1, 'Hero 1000px zu klein');
  fs.rmSync(asHero, { recursive: true, force: true });

  const asContent = await project([{ file: 'c.jpg', w: 1000, h: 600 }]);
  const rc = analyzeWeakImages(asContent);
  assert.equal(rc.stats.weak, 0, 'Content 1000px ok');
  assert.equal(rc.score, 100);
  fs.rmSync(asContent, { recursive: true, force: true });
});

test('analyzeWeakImages: kleiner Avatar/Thumbnail (width-Attribut ≤ 200) → ausgenommen, nicht geflaggt', async () => {
  const dir = await project([{ file: 'avatar.jpg', w: 160, h: 160, html: '<img src="assets/avatar.jpg" width="80" height="80" alt="Porträt" class="avatar">' }]);
  const r = analyzeWeakImages(dir);
  assert.equal(r.stats.veryWeak, 0, 'bewusst kleines Thumbnail nicht als schwach werten');
  assert.equal(r.score, 100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: Dateiname enthält "icon" als Teilwort (iconic) → NICHT ausgenommen, schwaches Foto wird geflaggt', async () => {
  // Regression (Code-Review MEDIUM): EXEMPT_SRC ohne Wortgrenzen nahm "praxis-iconic-ansicht.jpg"
  // fälschlich als Icon aus → schwaches Content-Foto blieb ungeflaggt.
  const dir = await project([{ file: 'praxis-iconic-ansicht.jpg', w: 360, h: 240 }]);
  const r = analyzeWeakImages(dir);
  assert.equal(r.stats.exempt, 0, 'iconic ist kein Icon → nicht ausnehmen');
  assert.equal(r.stats.veryWeak, 1, 'schwaches Foto wird geflaggt');
  assert.equal(r.checks.find(c => c.key === 'no_very_weak').pass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: echtes Logo (logo.png) bleibt ausgenommen', async () => {
  const dir = await project([{ file: 'logo.png', w: 200, h: 60, html: '<img src="assets/logo.png" alt="Logo">' }]);
  const r = analyzeWeakImages(dir);
  assert.equal(r.stats.exempt, 1, 'logo.png weiterhin ausgenommen');
  assert.equal(r.score, 100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: Site ohne Raster-Fotos → n/a → Score 100', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weakimg-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>x</title></head><body><h1>Nur Text</h1></body></html>');
  const r = analyzeWeakImages(dir);
  assert.equal(r.score, 100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: keine index.html → n/a statt Absturz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weakimg-'));
  const r = analyzeWeakImages(dir);
  assert.equal(r.grade, 'n/a');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeWeakImages: kaputtes/unlesbares Master-Bild → Fail-Safe, kein Absturz', async () => {
  const dir = await project([{ file: 'ok.jpg', w: 1600, h: 1200 }]);
  fs.writeFileSync(path.join(dir, 'assets', 'kaputt.jpg'), 'das ist kein JPEG');
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>x</title></head><body><img src="assets/ok.jpg" alt="A"><img src="assets/kaputt.jpg" alt="B"></body></html>');
  const r = analyzeWeakImages(dir); // darf nicht werfen
  assert.ok(r && typeof r.score === 'number');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('THRESHOLDS: an die Derivat-Leiter angelehnt (Content 480/768, Hero höher)', () => {
  assert.equal(THRESHOLDS.content.veryWeak, 480);
  assert.equal(THRESHOLDS.content.weak, 768);
  assert.ok(THRESHOLDS.hero.weak > THRESHOLDS.content.weak);
});
