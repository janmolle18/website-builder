/**
 * css-build.js — Tailwind Play-CDN → selbst-gehostetes, gepurgtes Static-CSS (A1).
 *
 * WARUM: Der Generator liefert Seiten, die `cdn.tailwindcss.com` (Play-CDN) laden.
 * Das ist laut Tailwind-Doku „nicht für Produktion" (großes JS, Laufzeit-Kompilierung
 * → schwacher LCP) UND schickt Besucher-IPs an ein US-CDN → Widerspruch zum
 * DSGVO-Versprechen. Dieses Modul ersetzt das CDN nach dem Bau durch eine kleine,
 * gepurgte, lokal ausgelieferte CSS-Datei — pro Projekt mit dessen eigener Theme-Config.
 *
 * SICHERHEIT FÜRS KERN-ASSET: Erst wird das CSS erzeugt (inkl. Theme-Extraktion). Erst
 * wenn das erfolgreich ist, wird das HTML angefasst. Schlägt irgendetwas fehl, wirft die
 * Funktion — die Pipeline fängt das und lässt die (funktionierende) CDN-Version stehen.
 *
 * ABO-FREI: reiner Tailwind-CLI-Build + HTML-Rewrite, kein LLM.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');

const TAILWIND_BIN = path.join(__dirname, 'node_modules', '.bin', 'tailwindcss');
const CDN_RE = /cdn\.tailwindcss\.com/i;

/** Alle HTML-Dateien im Projektordner (rekursiv, ohne interne Ordner). */
function findHtmlFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['qa', 'comparison', 'assets', 'node_modules'].includes(entry.name)) continue;
      findHtmlFiles(full, base, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extrahiert das `tailwind.config = {...}`-Objekt aus dem HTML (inline <script>).
 * Läuft auf UNSEREM eigenen generierten HTML (vertrauenswürdig) → Function-Eval ok.
 * @returns {object|null} das Config-Objekt (z. B. { theme: { extend: {...} } }) oder null
 */
function extractTailwindConfig(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  let cfg = null;
  $('script').each((i, el) => {
    const txt = $(el).html() || '';
    if (!/tailwind\.config\s*=/.test(txt)) return;
    const expr = txt.replace(/^[\s\S]*?tailwind\.config\s*=\s*/, '').replace(/;?\s*$/, '');
    try {
      // eslint-disable-next-line no-new-func
      cfg = Function(`"use strict";return (${expr})`)();
    } catch { cfg = null; }
  });
  return cfg;
}

/**
 * Baut selbst-gehostetes CSS für ein Projekt und ersetzt das Tailwind-CDN.
 * @param {string} projectDir absoluter Pfad zum Projektordner (enthält index.html)
 * @returns {{ built:boolean, skipped?:boolean, cssBytes?:number, files?:number, reason?:string }}
 */
function buildCss(projectDir) {
  const indexPath = path.join(projectDir, 'index.html');
  if (!fs.existsSync(indexPath)) return { built: false, skipped: true, reason: 'kein index.html' };

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  // Idempotent: bereits verarbeitet (kein CDN mehr) → nichts zu tun.
  if (!CDN_RE.test(indexHtml)) return { built: false, skipped: true, reason: 'kein Tailwind-CDN (bereits self-hosted)' };

  if (!fs.existsSync(TAILWIND_BIN)) throw new Error('tailwindcss-CLI nicht installiert (npm i -D tailwindcss@3)');

  // 1) Theme-Config je Projekt übernehmen (Custom-Farben/Fonts wie bg-gold, font-display).
  const cfg = extractTailwindConfig(indexHtml);
  const theme = (cfg && cfg.theme) ? cfg.theme : { extend: {} };
  const plugins = (cfg && Array.isArray(cfg.plugins)) ? [] : []; // Inline-Plugins werden nicht übernommen (keine im Prompt)

  const htmlFiles = findHtmlFiles(projectDir);

  // 2) Temporäre Build-Dateien (außerhalb des Projekts → landen nie im Deploy).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
  const cfgPath = path.join(tmp, 'tailwind.config.js');
  const inPath = path.join(tmp, 'in.css');
  fs.writeFileSync(cfgPath, `module.exports = {
  content: ${JSON.stringify(htmlFiles)},
  theme: ${JSON.stringify(theme)},
  plugins: ${JSON.stringify(plugins)},
};
`);
  fs.writeFileSync(inPath, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');

  // 3) CSS bauen (gepurgt + minifiziert). Erst JETZT — vor jeder HTML-Änderung.
  const assetsDir = path.join(projectDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const cssPath = path.join(assetsDir, 'tailwind.css');
  try {
    execFileSync(TAILWIND_BIN, ['-c', cfgPath, '-i', inPath, '-o', cssPath, '--minify'],
      { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const cssBytes = fs.statSync(cssPath).size;
  if (!cssBytes) throw new Error('Tailwind-Build erzeugte leeres CSS');

  // 4) Jetzt (und erst jetzt) HTML umschreiben: CDN-Skripte raus, lokales <link> rein.
  for (const file of htmlFiles) {
    const rel = path.relative(projectDir, path.dirname(file));
    const prefix = rel ? rel.split(path.sep).map(() => '..').join('/') + '/' : '';
    const href = `${prefix}assets/tailwind.css`;
    rewriteHtml(file, href);
  }

  return { built: true, cssBytes, files: htmlFiles.length };
}

/** Entfernt Tailwind-CDN-Skript + inline tailwind.config und setzt lokales Stylesheet. */
function rewriteHtml(file, href) {
  const $ = cheerio.load(fs.readFileSync(file, 'utf8'), { decodeEntities: false });
  $('script[src*="cdn.tailwindcss.com"]').remove();
  $('script').each((i, el) => {
    if (/tailwind\.config\s*=/.test($(el).html() || '')) $(el).remove();
  });
  if (!$(`link[href="${href}"]`).length) {
    const link = `<link rel="stylesheet" href="${href}">`;
    if ($('head').length) $('head').prepend(link);
    else $.root().prepend(link);
  }
  fs.writeFileSync(file, $.html());
}

module.exports = { buildCss, extractTailwindConfig, findHtmlFiles };
