/**
 * vendor-build.js — Alpine.js + Motion self-hosten (A2).
 *
 * WARUM: Der Generator lädt Alpine (Interaktivität) und Motion (Animationen) via
 * jsdelivr-CDN. Das schickt Besucher-Requests an ein Dritt-CDN (US) → Widerspruch
 * zum DSGVO-Versprechen und ein render-blockierender Fremd-Roundtrip. Dieses Modul
 * kopiert die beiden Libs nach der Generierung lokal in den Projektordner (assets/)
 * und ersetzt die jsdelivr-<script>-Tags durch lokale Pfade.
 *
 * Master-Kopien liegen einmalig im Repo unter vendor/ (per Fetch geholt) — der Build
 * selbst braucht KEIN Netzwerk (nur Datei-Kopie) und ist damit abo-frei & offline.
 *
 * SICHERHEIT FÜRS KERN-ASSET: Fehlt eine Master-Datei, wirft die Funktion, BEVOR sie
 * HTML anfasst → die Pipeline fängt das und lässt die (funktionierende) CDN-Version stehen.
 *
 * SRI: Für gleich-origin ausgelieferte lokale Dateien ist Subresource Integrity ohne
 * Nutzen (kein Dritt-Origin) → bewusst weggelassen.
 */

const fs = require('fs');
const path = require('path');
const { findHtmlFiles } = require('./css-build');

const VENDOR_DIR = path.join(__dirname, 'vendor');

// Lokaler Dateiname ← Master-Datei ← Erkennung im CDN-<script>-src.
const LIBS = [
  { file: 'alpine.min.js', master: 'alpine.min.js', match: /jsdelivr\.net.*alpine/i, defer: true },
  { file: 'motion.js',     master: 'motion.js',     match: /jsdelivr\.net.*motion/i,  defer: false }
];

const CDN_RE = /jsdelivr\.net/i;

/**
 * Ersetzt jsdelivr-Alpine/Motion durch lokale Kopien im Projektordner.
 * @param {string} projectDir absoluter Pfad zum Projektordner (enthält index.html)
 * @param {{vendorDir?:string}} [opts] Master-Verzeichnis (Default: repo vendor/) — testbar
 * @returns {{ built:boolean, skipped?:boolean, reason?:string, libs?:string[], files?:number }}
 */
function vendorBuild(projectDir, opts = {}) {
  const vendorDir = opts.vendorDir || VENDOR_DIR;
  const indexPath = path.join(projectDir, 'index.html');
  if (!fs.existsSync(indexPath)) return { built: false, skipped: true, reason: 'kein index.html' };

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  if (!CDN_RE.test(indexHtml)) return { built: false, skipped: true, reason: 'kein jsdelivr (bereits self-hosted)' };

  // Master-Kopien müssen vorhanden sein (einmalig ins Repo geholt) — sonst sauberer Abbruch.
  for (const lib of LIBS) {
    const src = path.join(vendorDir, lib.master);
    if (!fs.existsSync(src)) throw new Error(`Vendor-Master fehlt: vendor/${lib.master} (einmalig holen)`);
  }

  // 1) Libs lokal ablegen (nur wenn CDN im Spiel war). Erst kopieren, dann HTML ändern.
  const assetsDir = path.join(projectDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const lib of LIBS) {
    fs.copyFileSync(path.join(vendorDir, lib.master), path.join(assetsDir, lib.file));
  }

  // 2) In allen HTML-Dateien die jsdelivr-Skripte auf lokale Pfade umbiegen (tiefenrichtig).
  const htmlFiles = findHtmlFiles(projectDir);
  for (const file of htmlFiles) {
    const rel = path.relative(projectDir, path.dirname(file));
    const prefix = rel ? rel.split(path.sep).map(() => '..').join('/') + '/' : '';
    rewriteScripts(file, prefix);
  }

  return { built: true, libs: LIBS.map(l => l.file), files: htmlFiles.length };
}

const cheerio = require('cheerio');

/** Biegt jsdelivr-Alpine/Motion-Skripte auf lokale assets/-Pfade um. */
function rewriteScripts(file, prefix) {
  const $ = cheerio.load(fs.readFileSync(file, 'utf8'), { decodeEntities: false });
  $('script[src]').each((i, el) => {
    const src = $(el).attr('src') || '';
    for (const lib of LIBS) {
      if (lib.match.test(src)) {
        $(el).attr('src', `${prefix}assets/${lib.file}`);
        if (lib.defer) $(el).attr('defer', ''); else $(el).removeAttr('defer');
      }
    }
  });
  fs.writeFileSync(file, $.html());
}

module.exports = { vendorBuild, LIBS };
