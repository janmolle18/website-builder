const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vendorBuild } = require('../vendor-build');

const SITE = `<!doctype html><html lang="de"><head>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/motion@12/dist/motion.js"></script>
</head><body><a href="sub/d.html">x</a></body></html>`;
const SUB = `<!doctype html><html><head>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head><body>d</body></html>`;

function tmpVendor() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'vend-'));
  fs.writeFileSync(path.join(v, 'alpine.min.js'), '/*alpine stub*/');
  fs.writeFileSync(path.join(v, 'motion.js'), '/*motion stub*/');
  return v;
}
function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vproj-'));
  fs.writeFileSync(path.join(dir, 'index.html'), SITE);
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'd.html'), SUB);
  return dir;
}

test('vendorBuild: jsdelivr → lokale assets/, Dateien kopiert, tiefenrichtige Pfade', () => {
  const vendorDir = tmpVendor();
  const dir = tmpProject();
  const r = vendorBuild(dir, { vendorDir });
  assert.equal(r.built, true);

  assert.ok(fs.existsSync(path.join(dir, 'assets', 'alpine.min.js')));
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'motion.js')));

  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!/jsdelivr/.test(idx), 'jsdelivr noch im HTML');
  assert.match(idx, /src="assets\/alpine\.min\.js"/);
  assert.match(idx, /src="assets\/motion\.js"/);
  assert.match(idx, /defer/); // Alpine behält defer

  const sub = fs.readFileSync(path.join(dir, 'sub', 'd.html'), 'utf8');
  assert.match(sub, /src="\.\.\/assets\/alpine\.min\.js"/, 'Unterseite braucht ../-Pfad');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(vendorDir, { recursive: true, force: true });
});

test('idempotent: zweiter Lauf ohne jsdelivr → skipped', () => {
  const vendorDir = tmpVendor();
  const dir = tmpProject();
  vendorBuild(dir, { vendorDir });
  const r2 = vendorBuild(dir, { vendorDir });
  assert.equal(r2.built, false);
  assert.equal(r2.skipped, true);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(vendorDir, { recursive: true, force: true });
});

test('fehlender Vendor-Master → wirft, HTML unangetastet (CDN bleibt)', () => {
  const emptyVendor = fs.mkdtempSync(path.join(os.tmpdir(), 'vend-empty-'));
  const dir = tmpProject();
  assert.throws(() => vendorBuild(dir, { vendorDir: emptyVendor }), /Vendor-Master fehlt/);
  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(/jsdelivr/.test(idx), 'HTML darf bei Fehler NICHT verändert sein');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(emptyVendor, { recursive: true, force: true });
});
