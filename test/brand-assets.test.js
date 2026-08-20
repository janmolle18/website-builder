const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { buildBrandAssets, validateBrandAssets, OG_WIDTH, OG_HEIGHT } = require('../brand-assets');

const PROJECT = { name: 'Dr. Weber & Mustermann Rechtsanwälte', dnaKey: 'kanzlei-noir', category: 'kanzlei', description: 'Kanzlei für Wirtschafts- und Strafrecht in Musterstadt.' };

function site(extraPages = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  const head = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title></head>';
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="de">${head}<body><h1>Start</h1></body></html>`);
  for (const [rel, _] of Object.entries(extraPages)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `<!doctype html><html lang="de">${head}<body><h1>${rel}</h1></body></html>`);
  }
  return dir;
}

test('buildBrandAssets: erzeugt OG-Bild 1200x630 + Favicon-Set mit korrekten Maßen', async () => {
  const dir = site();
  const r = await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  assert.equal(r.built, true);

  const og = await sharp(path.join(dir, 'assets', 'og-image.png')).metadata();
  assert.equal(og.width, OG_WIDTH);
  assert.equal(og.height, OG_HEIGHT);
  assert.equal(OG_WIDTH, 1200);
  assert.equal(OG_HEIGHT, 630);

  const fav32 = await sharp(path.join(dir, 'assets', 'favicon-32.png')).metadata();
  assert.equal(fav32.width, 32);
  const apple = await sharp(path.join(dir, 'assets', 'apple-touch-icon.png')).metadata();
  assert.equal(apple.width, 180);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: OG-PNG hat plausible Dateigröße (nicht leer, nicht riesig)', async () => {
  const dir = site();
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  const bytes = fs.statSync(path.join(dir, 'assets', 'og-image.png')).size;
  assert.ok(bytes > 1024, `OG zu klein: ${bytes}`);
  assert.ok(bytes < 300 * 1024, `OG zu groß: ${bytes}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: jede Seite bekommt Favicon-, Apple-Touch- und OG-Image-Tags', async () => {
  const dir = site({ 'rechtsgebiete/strafrecht.html': 1 });
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  for (const rel of ['index.html', 'rechtsgebiete/strafrecht.html']) {
    const html = fs.readFileSync(path.join(dir, rel), 'utf8');
    assert.match(html, /rel="apple-touch-icon"/, `${rel} apple-touch-icon`);
    assert.match(html, /rel="icon"[^>]*favicon-32\.png/, `${rel} favicon 32`);
    assert.match(html, /property="og:image"[^>]*og-image\.png/, `${rel} og:image`);
    assert.match(html, /name="twitter:image"[^>]*og-image\.png/, `${rel} twitter:image`);
    assert.match(html, /name="twitter:card"[^>]*summary_large_image/, `${rel} twitter card`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: og:image ist absolut (baseUrl), Favicon-Href ist tiefenrichtig relativ', async () => {
  const dir = site({ 'rechtsgebiete/strafrecht.html': 1 });
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  const sub = fs.readFileSync(path.join(dir, 'rechtsgebiete', 'strafrecht.html'), 'utf8');
  assert.match(sub, /property="og:image" content="https:\/\/example\.com\/assets\/og-image\.png"/);
  assert.match(sub, /rel="icon"[^>]*href="\.\.\/assets\/favicon-32\.png"/, 'Unterseite braucht ../');
  const root = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(root, /rel="icon"[^>]*href="assets\/favicon-32\.png"/, 'Startseite ohne ../');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: idempotent — zweiter Lauf dupliziert keine Tags', async () => {
  const dir = site();
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal((html.match(/rel="apple-touch-icon"/g) || []).length, 1, 'apple-touch nur einmal');
  assert.equal((html.match(/property="og:image"/g) || []).length, 1, 'og:image nur einmal');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: ersetzt ein bestehendes og:image statt zu duplizieren', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta property="og:image" content="https://alt.example/hero.jpg"><title>T</title></head><body></body></html>');
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal((html.match(/property="og:image"/g) || []).length, 1, 'kein Duplikat');
  assert.match(html, /property="og:image" content="https:\/\/example\.com\/assets\/og-image\.png"/, 'gebrandetes Bild gewinnt');
  assert.doesNotMatch(html, /alt\.example/, 'altes og:image ersetzt');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('validateBrandAssets: nach dem Bau alle Checks bestanden', async () => {
  const dir = site();
  await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  const v = await validateBrandAssets(dir);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(v.checks.og_dimensions, true);
  assert.equal(v.checks.favicons_present, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: bösartige baseUrl wird escaped — keine Attribut-Injection (Security)', async () => {
  // baseUrl stammt aus resolveBaseUrl() → gescrapte project.siteUrl/sourceUrl. Ein Ausbruch aus
  // content="..." darf NICHT möglich sein (Code-Review CRITICAL).
  const cheerio = require('cheerio');
  const dir = site();
  const evil = 'https://x.example"><script>alert(1)</script><meta x="';
  await buildBrandAssets(dir, PROJECT, { baseUrl: evil });
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  // Verhaltensbeweis über die geparste DOM: der böse String darf KEINE echten Elemente erzeugen.
  const $ = cheerio.load(html);
  assert.equal($('script').length, 0, 'kein Script-ELEMENT erzeugt (kein Ausbruch)');
  assert.equal($('meta[x]').length, 0, 'kein untergeschobenes <meta x> aus dem baseUrl-Payload');
  assert.equal($('meta[property="og:image"]').length, 1, 'genau ein og:image-Tag');
  const content = $('meta[property="og:image"]').attr('content') || '';
  assert.ok(content.includes('<script>alert(1)</script>'), 'böser String steckt HARMLOS als Text im Attributwert');
  assert.ok(content.endsWith('/assets/og-image.png'), 'Wert vollständig, nicht abgeschnitten');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: bösartiger Projektname bricht nicht aus SVG/HTML aus (Security)', async () => {
  const dir = site();
  const evil = { name: 'Kanzlei "</text><script>x</script>', dnaKey: 'kanzlei-noir', category: 'kanzlei', description: '<img src=x onerror=alert(1)>' };
  const r = await buildBrandAssets(dir, evil, { baseUrl: 'https://example.com' });
  assert.equal(r.built, true, 'SVG bleibt valide trotz Sonderzeichen'); // sharp würde bei kaputtem SVG werfen → built:false
  const og = await sharp(path.join(dir, 'assets', 'og-image.png')).metadata();
  assert.equal(og.width, OG_WIDTH);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: keine index.html → built:false, kein Absturz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  const r = await buildBrandAssets(dir, PROJECT, { baseUrl: 'https://example.com' });
  assert.equal(r.built, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBrandAssets: fehlende baseUrl → og:image fällt auf root-relativ zurück, kein Absturz', async () => {
  const dir = site();
  const r = await buildBrandAssets(dir, PROJECT, {});
  assert.equal(r.built, true);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /property="og:image" content="\/assets\/og-image\.png"/);
  fs.rmSync(dir, { recursive: true, force: true });
});
