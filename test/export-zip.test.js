const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { exportProjectZip, EXCLUDE } = require('../export-zip');

function tmpBuiltProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>Site</body></html>');
  fs.writeFileSync(path.join(dir, 'impressum.html'), '<html>Impressum</html>');
  fs.writeFileSync(path.join(dir, 'llms.txt'), '# Site');
  fs.writeFileSync(path.join(dir, 'CREDITS.txt'), 'Foto: Pexels');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'logo.svg'), '<svg></svg>');
  // Interne Dateien, die NICHT ins Paket dürfen:
  fs.writeFileSync(path.join(dir, 'project.json'), '{"secret":"lead-data"}');
  fs.writeFileSync(path.join(dir, 'licenses.json'), '{}');
  fs.writeFileSync(path.join(dir, 'comparison.html'), '<html>vorher/nachher</html>');
  fs.mkdirSync(path.join(dir, 'qa'));
  fs.writeFileSync(path.join(dir, 'qa', 'shot.png'), 'x');
  return dir;
}

function zipList(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
}

test('EXCLUDE deckt die sensiblen internen Dateien ab', () => {
  for (const f of ['project.json', 'qa/*', 'comparison.html', 'licenses.json']) {
    assert.ok(EXCLUDE.includes(f), `${f} sollte ausgeschlossen sein`);
  }
});

test('ZIP enthält die Kundendateien, aber KEINE internen Dateien', async () => {
  const dir = tmpBuiltProject();
  const { zipPath, fileName, bytes } = await exportProjectZip(dir);
  assert.ok(fileName.endsWith('.zip'));
  assert.ok(bytes > 0);
  const entries = zipList(zipPath);

  // Kundendateien drin:
  assert.ok(entries.some(e => e.endsWith('index.html')), 'index.html fehlt');
  assert.ok(entries.some(e => e.endsWith('impressum.html')), 'impressum.html fehlt');
  assert.ok(entries.some(e => e.includes('assets/logo.svg')), 'assets fehlen');
  assert.ok(entries.some(e => e.endsWith('CREDITS.txt')), 'CREDITS.txt (Lizenz) fehlt');

  // Interne Dateien NICHT drin:
  assert.ok(!entries.some(e => e.includes('project.json')), 'project.json darf NICHT im Paket sein');
  assert.ok(!entries.some(e => e.includes('licenses.json')), 'licenses.json darf NICHT im Paket sein');
  assert.ok(!entries.some(e => e.includes('comparison')), 'comparison darf NICHT im Paket sein');
  assert.ok(!entries.some(e => e.includes('qa/')), 'qa/ darf NICHT im Paket sein');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ohne index.html → Fehler (Site nicht gebaut)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-empty-'));
  await assert.rejects(() => exportProjectZip(dir), /index\.html/);
  fs.rmSync(dir, { recursive: true, force: true });
});
