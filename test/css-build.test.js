const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCss, extractTailwindConfig, findHtmlFiles } = require('../css-build');

const SITE = `<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kanzlei Test</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = { theme: { extend: {
  fontFamily: { display: ['Fraunces','serif'], body: ['Inter','sans-serif'] },
  colors: { base: '#0E1116', gold: '#C9A24B', ink: '#ECECEA' }
} } }
</script>
<style>body{background:#0E1116}</style>
</head>
<body class="bg-base font-body">
  <h1 class="text-gold font-display text-4xl">Kanzlei</h1>
  <p class="text-ink mt-4">Text</p>
  <a href="sub/detail.html" class="underline">Detail</a>
</body></html>`;

const SUB = `<!doctype html><html lang="de"><head>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { theme: { extend: { colors: { gold: '#C9A24B' } } } }</script>
</head><body class="bg-base"><h1 class="text-gold">Detail</h1></body></html>`;

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssbuild-'));
  fs.writeFileSync(path.join(dir, 'index.html'), SITE);
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'detail.html'), SUB);
  return dir;
}

test('extractTailwindConfig liest das inline Theme-Objekt', () => {
  const cfg = extractTailwindConfig(SITE);
  assert.ok(cfg && cfg.theme && cfg.theme.extend);
  assert.equal(cfg.theme.extend.colors.gold, '#C9A24B');
});

test('findHtmlFiles findet Startseite + Unterseite, überspringt interne Ordner', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'qa')); fs.writeFileSync(path.join(dir, 'qa', 'x.html'), '<html></html>');
  const files = findHtmlFiles(dir).map(f => path.relative(dir, f));
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes(path.join('sub', 'detail.html')));
  assert.ok(!files.some(f => f.startsWith('qa')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildCss: CDN raus, lokales CSS mit Custom-Klassen, Link je nach Tiefe', () => {
  const dir = tmpProject();
  const r = buildCss(dir);
  assert.equal(r.built, true);
  assert.ok(r.cssBytes > 0);

  const css = fs.readFileSync(path.join(dir, 'assets', 'tailwind.css'), 'utf8');
  assert.ok(css.includes('.bg-base'), 'Custom-Farbe bg-base fehlt im CSS');
  assert.ok(css.includes('.text-gold'), 'Custom-Farbe text-gold fehlt');
  assert.ok(/\.font-display/.test(css), 'Custom-Font font-display fehlt');

  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!/cdn\.tailwindcss\.com/.test(idx), 'CDN-Script noch da');
  assert.ok(!/tailwind\.config\s*=/.test(idx), 'inline config noch da');
  assert.match(idx, /<link rel="stylesheet" href="assets\/tailwind\.css">/);

  const sub = fs.readFileSync(path.join(dir, 'sub', 'detail.html'), 'utf8');
  assert.match(sub, /href="\.\.\/assets\/tailwind\.css"/, 'Unterseite braucht ../-Pfad');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildCss ist idempotent: zweiter Lauf ohne CDN → skipped', () => {
  const dir = tmpProject();
  buildCss(dir);
  const r2 = buildCss(dir);
  assert.equal(r2.built, false);
  assert.equal(r2.skipped, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
