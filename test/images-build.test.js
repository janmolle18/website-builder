const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { buildImages, MAX_WIDTH, DERIVATIVE_WIDTHS } = require('../images-build');

/** Erzeugt ein echtes JPEG (Volltonfarbe) in der gewünschten Auflösung. */
async function writeJpeg(file, width, height) {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 60, b: 90 } },
  }).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync(file, buf);
}

const IMG_ATTRS = 'alt="Team Foto" class="team-photo" loading="lazy"';

function indexHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title></head>
<body>
  <img src="assets/pic.jpg" ${IMG_ATTRS}>
  <img src="assets/logo.svg" alt="Logo" width="120" height="40">
  <img src="https://cdn.example.com/remote.jpg" alt="Remote">
  <img src="data:image/png;base64,iVBOR0" alt="Inline">
</body></html>`;
}

function subHtml() {
  return `<!doctype html><html lang="de"><head><title>Sub</title></head>
<body><img src="../assets/pic.jpg" alt="Team Foto" class="team-photo" loading="lazy"></body></html>`;
}

async function tmpProject({ picW = 2400, picH = 1800 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbuild-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'sub'));
  await writeJpeg(path.join(dir, 'assets', 'pic.jpg'), picW, picH);
  fs.writeFileSync(path.join(dir, 'assets', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"></svg>');
  fs.writeFileSync(path.join(dir, 'index.html'), indexHtml());
  fs.writeFileSync(path.join(dir, 'sub', 'detail.html'), subHtml());
  return dir;
}

/** Zieht die `Nw`-Breiten aus einem srcset-String. */
function srcsetWidths(srcset) {
  return [...srcset.matchAll(/(\d+)w/g)].map(m => Number(m[1])).sort((a, b) => a - b);
}

test('buildImages: responsive AVIF+WebP-Leiter, Original bleibt, wrapt in <picture>', async () => {
  const dir = await tmpProject();
  const r = await buildImages(dir);
  assert.equal(r.built, true);

  // Master unangetastet.
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'pic.jpg')), 'Original-JPG darf nicht verschwinden');
  // Für 2400px (auf 1920 gedeckelt) erwarten wir die Leiter 480/768/1200/1920.
  for (const w of [480, 768, 1200, 1920]) {
    assert.ok(fs.existsSync(path.join(dir, 'assets', `pic-${w}.avif`)), `AVIF ${w}w fehlt`);
    assert.ok(fs.existsSync(path.join(dir, 'assets', `pic-${w}.webp`)), `WebP ${w}w fehlt`);
  }

  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const $ = require('cheerio').load(idx);
  const avif = $('source[type="image/avif"]').attr('srcset');
  const webp = $('source[type="image/webp"]').attr('srcset');
  assert.deepEqual(srcsetWidths(avif), [480, 768, 1200, 1920], 'AVIF-srcset-Leiter falsch');
  assert.deepEqual(srcsetWidths(webp), [480, 768, 1200, 1920], 'WebP-srcset-Leiter falsch');
  assert.ok(/pic-480\.avif 480w/.test(avif), 'AVIF-Pfad/Deskriptor falsch');
  assert.ok($('source[type="image/avif"]').attr('sizes'), 'sizes fehlt auf AVIF-source');

  // Fallback-img mit erhaltenen Attributen + explizite Maße.
  assert.match(idx, /<img[^>]+src="assets\/pic\.jpg"/, 'Fallback-src fehlt');
  assert.match(idx, /alt="Team Foto"/, 'alt verloren');
  assert.match(idx, /loading="lazy"/, 'loading verloren');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: explizite width/height aus echten Dateimaßen (korrektes Seitenverhältnis)', async () => {
  const dir = await tmpProject({ picW: 2400, picH: 1800 }); // 4:3, auf 1920 gedeckelt → 1920x1440
  await buildImages(dir);
  const $ = require('cheerio').load(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  const img = $('img[src="assets/pic.jpg"]');
  const w = Number(img.attr('width'));
  const h = Number(img.attr('height'));
  assert.ok(w > 0 && h > 0, 'width/height fehlen');
  // Seitenverhältnis muss dem echten Bild entsprechen (4:3), nicht geraten.
  assert.ok(Math.abs((w / h) - (2400 / 1800)) < 0.02, `Seitenverhältnis falsch: ${w}x${h}`);
  assert.ok(w <= MAX_WIDTH, 'width über MAX_WIDTH');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: kein Upscaling — kleines Bild bekommt keine Breiten über der Auflösung', async () => {
  const dir = await tmpProject({ picW: 600, picH: 400 });
  await buildImages(dir);
  const $ = require('cheerio').load(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  const widths = srcsetWidths($('source[type="image/avif"]').attr('srcset'));
  assert.ok(Math.max(...widths) <= 600, `kein Upscaling erwartet, war ${widths}`);
  assert.ok(widths.includes(600), 'die native Breite sollte enthalten sein');
  // Größte erzeugte Datei hat max. 600px.
  const meta = await sharp(path.join(dir, 'assets', 'pic-600.avif')).metadata();
  assert.equal(meta.width, 600, 'native Breite nicht 600');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: EXIF-Orientierung — width/height sind die angezeigten (rotierten) Maße', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbuild-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  // Hochkant-Bild mit EXIF-Orientation 6 (90° gedreht → angezeigt 800 breit x 1200 hoch).
  const buf = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  fs.writeFileSync(path.join(dir, 'assets', 'pic.jpg'), buf);
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>x</title></head><body><img src="assets/pic.jpg" alt="a"></body></html>`);
  await buildImages(dir);
  const $ = require('cheerio').load(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  const img = $('img[src="assets/pic.jpg"]');
  const w = Number(img.attr('width')), h = Number(img.attr('height'));
  assert.ok(h > w, `angezeigt hochkant erwartet, war ${w}x${h}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: tiefenrichtige Pfade auf Unterseiten (../-Prefix in srcset)', async () => {
  const dir = await tmpProject();
  await buildImages(dir);
  const sub = fs.readFileSync(path.join(dir, 'sub', 'detail.html'), 'utf8');
  assert.match(sub, /srcset="[^"]*\.\.\/assets\/pic-480\.avif 480w/, 'Unterseite braucht ../-Pfad im AVIF-srcset');
  assert.match(sub, /src="\.\.\/assets\/pic\.jpg"/, 'Fallback-Pfad falsch');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: SVG, Remote- und Data-URIs bleiben unangetastet', async () => {
  const dir = await tmpProject();
  await buildImages(dir);
  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!fs.existsSync(path.join(dir, 'assets', 'logo-480.avif')), 'SVG darf nicht konvertiert werden');
  assert.match(idx, /<img src="assets\/logo\.svg"/, 'SVG-img soll plain bleiben');
  assert.match(idx, /<img src="https:\/\/cdn\.example\.com\/remote\.jpg"/, 'Remote-img soll plain bleiben');
  assert.match(idx, /<img src="data:image\/png/, 'Data-URI-img soll plain bleiben');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages ist idempotent: zweiter Lauf ändert nichts, kein Doppel-<picture>', async () => {
  const dir = await tmpProject();
  await buildImages(dir);
  const after1 = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const r2 = await buildImages(dir);
  assert.equal(r2.built, false, 'zweiter Lauf sollte nichts bauen');
  assert.equal(r2.skipped, true);
  const after2 = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal(after1, after2, 'HTML darf sich beim zweiten Lauf nicht ändern');
  assert.equal((after2.match(/<picture>/g) || []).length, 1, 'kein Doppel-<picture>');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: Fail-Safe — korruptes Bild bleibt plain <img>, kein Absturz, Master unangetastet', async () => {
  const dir = await tmpProject();
  const picPath = path.join(dir, 'assets', 'pic.jpg');
  fs.writeFileSync(picPath, 'NOT-A-REAL-JPEG'); // korrupt
  const before = fs.readFileSync(picPath);

  await buildImages(dir); // darf NICHT werfen
  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!/<picture>/.test(idx), 'korruptes Bild darf nicht gewrappt werden');
  assert.match(idx, /<img src="assets\/pic\.jpg"/, 'Original-img muss stehen bleiben');
  assert.deepEqual(fs.readFileSync(picPath), before, 'Master-Datei wurde verändert');
  assert.ok(!fs.existsSync(path.join(dir, 'assets', 'pic-480.avif')), 'kein AVIF aus korruptem Bild');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: src mit Query-String (Cache-Buster) → srcset zeigt aufs Derivat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbuild-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  await writeJpeg(path.join(dir, 'assets', 'pic.jpg'), 800, 600);
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>Q</title></head><body><img src="assets/pic.jpg?v=2" alt="x"></body></html>`);

  const r = await buildImages(dir);
  assert.equal(r.built, true);
  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(idx, /srcset="[^"]*pic-480\.avif\?v=2 480w/, 'AVIF-srcset zeigt nicht aufs .avif mit Query');
  assert.ok(!/type="image\/avif"[^>]+srcset="[^"]*\.jpg/.test(idx), 'AVIF-source zeigt fälschlich aufs JPEG');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: Sonderzeichen im Dateinamen (Komma/Leerzeichen) → srcset bleibt gültig', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbuild-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  await writeJpeg(path.join(dir, 'assets', 'my pic, one.jpg'), 800, 600);
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>x</title></head><body><img src="assets/my pic, one.jpg" alt="a"></body></html>`);

  const r = await buildImages(dir);
  assert.equal(r.built, true);
  const $ = require('cheerio').load(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), { decodeEntities: false });
  const avif = $('source[type="image/avif"]').attr('srcset');
  // Das rohe ", " des Dateinamens darf NICHT im srcset stehen (sonst falscher Kandidaten-Split).
  assert.ok(!/one\.jpg/.test(avif), 'srcset zeigt fälschlich aufs JPEG');
  // Anzahl Kandidaten = Anzahl `Nw`-Deskriptoren (Kommas nur als echte Trenner).
  const widths = [...avif.matchAll(/(\d+)w/g)];
  const candidates = avif.split(/\s*,\s*/).filter(Boolean);
  assert.equal(candidates.length, widths.length, `srcset fehlformatiert: ${avif}`);
  assert.ok(/%2C|%20/.test(avif), 'Sonderzeichen sollten prozent-kodiert sein');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildImages: kein index.html → skipped statt Absturz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbuild-'));
  const r = await buildImages(dir);
  assert.equal(r.built, false);
  assert.equal(r.skipped, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DERIVATIVE_WIDTHS ist eine aufsteigende Leiter innerhalb MAX_WIDTH', () => {
  assert.ok(Array.isArray(DERIVATIVE_WIDTHS) && DERIVATIVE_WIDTHS.length >= 2);
  const sorted = [...DERIVATIVE_WIDTHS].sort((a, b) => a - b);
  assert.deepEqual(DERIVATIVE_WIDTHS, sorted, 'muss aufsteigend sein');
  assert.ok(Math.max(...DERIVATIVE_WIDTHS) <= MAX_WIDTH);
});
