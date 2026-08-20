/**
 * export-zip.js — Kundenpaket als ZIP (abo-frei, kein LLM).
 *
 * Packt die fertige STATISCHE Site eines Projekts in ein ZIP zum Weitergeben —
 * für Auslieferung über das bestehende Hosting des Kunden (Upload/FTP), Übergabe
 * an dessen IT, oder als Backup. Der statische Output ist der Trumpf: läuft überall.
 *
 * Ausgeschlossen werden INTERNE Dateien, die nie zum Kunden gehören (gleiche Logik
 * wie .vercelignore in deploy.js, plus interne Sales-Artefakte):
 *   - project.json        (Projekt-/Leaddaten der Agentur)
 *   - qa/                 (QA-Screenshots/Reports)
 *   - comparison/ , comparison.html  (Vorher/Nachher — internes Sales-Artefakt)
 *   - licenses.json       (interner Lizenz-Manifest; CREDITS.txt bleibt DRIN)
 *   - *.log, .DS_Store, .vercelignore, *.zip
 *
 * Nutzt das System-`zip` (macOS/Linux vorhanden) — keine neue npm-Abhängigkeit.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Interne Dateien/Ordner, die NICHT ins Kundenpaket gehören (zip -x Muster, relativ zum Projektordner).
const EXCLUDE = [
  'project.json',
  'tickets.json',
  'licenses.json',
  'qa/*',
  'comparison/*',
  'comparison.html',
  '.vercelignore',
  // vercel.json steuert nur das Vercel-Hosting (u. a. noindex für Vorschauen).
  // Auf dem Webhosting des Kunden ist sie wirkungslos und stiftet Verwirrung —
  // die entsprechenden Kopfzeilen stehen dort in der .htaccess.
  'vercel.json',
  // .vercel/project.json enthält Projekt- und Organisations-ID unseres
  // Vercel-Accounts. Interne Infrastruktur-Kennungen gehören nicht zum Kunden.
  '.vercel/*',
  '.vercel',
  '.gitignore',
  '.DS_Store',
  '*.log',
  '*.zip'
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/** Ist das System-`zip` verfügbar? */
async function zipAvailable() {
  try { await run('zip', ['--version']); return true; }
  catch { return false; }
}

/**
 * Baut das Kundenpaket-ZIP eines Projektordners.
 * @param {string} projectDir absoluter Pfad zum Projektordner (enthält index.html)
 * @param {{fileName?:string}} opts optionaler Ziel-Dateiname (Default: <ordnername>.zip)
 * @returns {Promise<{zipPath:string, fileName:string, bytes:number}>}
 */
async function exportProjectZip(projectDir, opts = {}) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    throw new Error('Kein index.html im Projektordner — Site ist noch nicht gebaut.');
  }
  if (!(await zipAvailable())) {
    throw new Error('System-`zip` nicht gefunden. Auf macOS/Linux normalerweise vorhanden.');
  }

  const fileName = (opts.fileName || (path.basename(projectDir) + '.zip')).replace(/[^a-z0-9._-]/gi, '');
  const zipPath = path.join(projectDir, fileName);

  // Frisch packen: altes Paket entfernen, damit keine veralteten Dateien zurückbleiben.
  try { fs.rmSync(zipPath, { force: true }); } catch { /* egal */ }

  // `zip -r -X <ziel> . -x <ausschluss…>` — aus dem Projektordner heraus, damit die
  // Pfade im ZIP relativ sind (der Kunde entpackt einen sauberen Website-Ordner).
  const args = ['-r', '-X', '-q', fileName, '.', '-x', ...EXCLUDE.map(p => `./${p}`)];
  await run('zip', args, { cwd: projectDir });

  const bytes = fs.statSync(zipPath).size;
  return { zipPath, fileName, bytes };
}

module.exports = { exportProjectZip, zipAvailable, EXCLUDE };
