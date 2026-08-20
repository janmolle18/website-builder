/**
 * deploy.js — Deploy-Stufe (Vercel CLI).
 *
 * Stellt einen genehmigten Projektordner als statische Site online. Entscheidung
 * 2026-06-14 (Jan): "Kundendomain pro Projekt" → Deploy liefert eine vercel.app-URL,
 * die anschließend auf die Kundendomain gemappt wird (DNS, manueller Schritt).
 *
 * Wichtig (Review-Gate, DECISIONS #3): live geht NUR, was freigegeben ist. Der
 * Endpoint in server.js prüft status === 'approved'. Dieses Modul deployt nur,
 * wenn es explizit aufgerufen wird — nie automatisch.
 *
 * Auth: entweder vorher `vercel login`, oder VERCEL_TOKEN in .env.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const VERCEL_URL_RE = /https?:\/\/[a-z0-9.-]+\.vercel\.app/i;

// Interne Dateien, die NIEMALS mit zum Kunden deployt werden dürfen (nur die öffentliche
// statische Site geht live — keine Projektdaten, kein QA, keine Logs).
//
// 2026-08-10 ergänzt: *.md, *.zip und licenses.json. Beim Mer:Form-Deploy wäre sonst
// die interne Inhalte-Liste an die Kundin (INHALTE-MERLE.md), das Export-Archiv und
// eine Datei mit dem Vermerk "Lizenz ungeklärt" öffentlich abrufbar gewesen.
// Ein Projektordner ist ein Arbeitsordner — es gehört nicht alles daraus ins Netz.
const DEPLOY_IGNORE = [
  'project.json',
  'tickets.json',
  'qa',
  'licenses.json',
  '*.md',
  '*.zip',
  '*.log',
  '.DS_Store',
  'node_modules',
  ''
].join('\n');

function writeIgnore(projectDir) {
  try { fs.writeFileSync(path.join(projectDir, '.vercelignore'), DEPLOY_IGNORE); } catch { /* best effort */ }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/** Ist die Vercel CLI verfügbar? */
async function vercelAvailable() {
  try {
    await run('vercel', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deployt einen Projektordner.
 * @param {string} projectDir  absoluter Pfad zum Projektordner (enthält index.html)
 * @param {{prod?:boolean}} opts
 * @returns {Promise<{url:string, raw:string}>}
 */
async function deployProject(projectDir, opts = {}) {
  if (!(await vercelAvailable())) {
    throw new Error('Vercel CLI nicht gefunden. Installieren: `npm i -g vercel`, dann `vercel login` (oder VERCEL_TOKEN in .env).');
  }

  writeIgnore(projectDir); // interne Dateien vom Deploy ausschließen

  const args = ['deploy', projectDir, '--yes'];
  if (opts.prod) args.push('--prod');
  if (process.env.VERCEL_TOKEN) args.push('--token', process.env.VERCEL_TOKEN);

  let out;
  try {
    const res = await run('vercel', args);
    out = `${res.stdout}\n${res.stderr}`;
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').trim();
    throw new Error(`Vercel-Deploy fehlgeschlagen: ${detail.split('\n').slice(-3).join(' ') || err.message}`);
  }

  const match = out.match(VERCEL_URL_RE);
  const url = match ? match[0] : out.trim().split('\n').filter(Boolean).pop();
  if (!url) throw new Error('Vercel lieferte keine Deploy-URL zurück.');

  return { url, raw: out };
}

module.exports = { deployProject, vercelAvailable };
