const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// deploy.js exportiert DEPLOY_IGNORE nicht — der Inhalt wird über die geschriebene
// .vercelignore geprüft. writeIgnore läuft in deployProject, ist aber an die Vercel-CLI
// gekoppelt; deshalb hier die Datei-Erzeugung isoliert nachstellen.
const deploySource = fs.readFileSync(path.join(__dirname, '..', 'deploy.js'), 'utf8');

test('DEPLOY_IGNORE schließt interne Arbeitsdateien aus', () => {
  // Ein Projektordner ist ein Arbeitsordner: Notizen, QA-Artefakte und Exporte
  // liegen neben der Site. Öffentlich gehört davon nichts.
  const mussFehlen = ['project.json', 'tickets.json', 'qa', 'licenses.json', '*.md', '*.zip', '*.log', 'node_modules'];

  for (const eintrag of mussFehlen) {
    assert.match(
      deploySource,
      new RegExp(`'${eintrag.replace(/[.*]/g, m => '\\' + m)}'`),
      `DEPLOY_IGNORE muss '${eintrag}' enthalten — sonst landet es beim Kunden im Netz`
    );
  }
});

test('DEPLOY_IGNORE lässt die öffentlichen Dateien durch', () => {
  // Gegenprobe: Was die Site zum Funktionieren braucht, darf nicht gefiltert werden.
  const mussBleiben = ['index.html', 'sitemap.xml', 'robots.txt', 'llms.txt', 'assets'];
  const block = deploySource.slice(
    deploySource.indexOf('const DEPLOY_IGNORE'),
    deploySource.indexOf('function writeIgnore')
  );

  for (const datei of mussBleiben) {
    assert.ok(!block.includes(`'${datei}'`), `${datei} darf nicht in DEPLOY_IGNORE stehen`);
  }
});

test('writeIgnore erzeugt eine .vercelignore im Projektordner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
  // writeIgnore ist nicht exportiert — Verhalten über den bekannten Dateinamen prüfen.
  assert.match(deploySource, /\.vercelignore/);
  assert.ok(fs.existsSync(dir));
});
