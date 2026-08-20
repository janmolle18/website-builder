/**
 * legal.js — Deterministische Rechtsseiten (Impressum + Datenschutz)
 *
 * Pflicht für DE-Websites (§5 TMG Impressum, DSGVO/TTDSG Datenschutzerklärung) und
 * besonders für eine Anwaltskanzlei. Bewusst OHNE LLM: Rechtstexte werden VERBATIM
 * aus project.legal übernommen (vom Scraper aus der Alt-Seite gezogen) — niemals
 * umgeschrieben, da rechtlich verbindlich.
 *
 * Erzeugt impressum.html + datenschutz.html im DNA-Design (Palette/Fonts) und liefert
 * die Footer-Links, die in die generierte index.html injiziert werden.
 *
 * Doku: docs/LEGAL.md.
 */

const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** E-Mail-Adressen im (bereits escapten) Text zu mailto-Links machen. */
function linkifyEmails(escapedText) {
  return escapedText.replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
}

/**
 * Verbatim-Klartext → HTML mit Absätzen/Überschriften.
 * Blöcke per Leerzeile; einzelne kurze Zeilen mit ":" am Ende werden zu Überschriften.
 */
function textToHtml(text, pageTitle) {
  const blocks = String(text || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

    // Führende Dublette des Seitentitels überspringen (z. B. "Impressum:" / "Datenschutz")
    if (i === 0 && lines.length === 1) {
      const norm = lines[0].replace(/[:\s]+$/, '').toLowerCase();
      if (norm === pageTitle.toLowerCase() || norm === pageTitle.toLowerCase() + 'erklärung') continue;
    }

    if (lines.length === 1 && lines[0].length <= 70 && /[:]$/.test(lines[0])) {
      out.push(`<h2>${linkifyEmails(esc(lines[0].replace(/:$/, '')))}</h2>`);
    } else {
      out.push(`<p>${lines.map(l => linkifyEmails(esc(l))).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

/** Google-Fonts-URL aus DNA bauen. */
function fontsHref(dna) {
  const f = (dna && dna.fonts) || { heading: 'Sora', body: 'Inter', headingWeights: '500;600', bodyWeights: '400;500' };
  const fam = (name, weights) => `family=${encodeURIComponent(name)}:wght@${weights || '400;600'}`;
  return `https://fonts.googleapis.com/css2?${fam(f.heading, f.headingWeights)}&${fam(f.body, f.bodyWeights)}&display=swap`;
}

/** Eine vollständige, DNA-gestylte Rechtsseite rendern. */
function renderLegalPage({ pageTitle, text, project, dna }) {
  const p = (dna && dna.palette) || { bg: '#F6F5F2', surface: '#FFFFFF', text: '#15161A', muted: '#5A5A66', accent: '#3B5BDB' };
  const f = (dna && dna.fonts) || { heading: 'Sora', body: 'Inter' };
  const name = project.name || 'Website';
  const content = textToHtml(text, pageTitle);

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)} – ${esc(name)}</title>
<meta name="robots" content="noindex, follow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${esc(fontsHref(dna))}" rel="stylesheet">
<style>
  :root{
    --bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--accent:${p.accent};
    --font-heading:'${f.heading}',Georgia,serif;--font-body:'${f.body}',system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);
       line-height:1.7;-webkit-font-smoothing:antialiased}
  .lp-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;
       max-width:860px;margin:0 auto;padding:1.6rem 1.5rem;border-bottom:1px solid color-mix(in oklab,var(--text) 12%,transparent)}
  .lp-home{font-family:var(--font-heading);font-weight:600;color:var(--text);text-decoration:none;font-size:1.05rem}
  .lp-home:hover{color:var(--accent)}
  .lp-main{max-width:760px;margin:0 auto;padding:3rem 1.5rem 4rem}
  .lp-main h1{font-family:var(--font-heading);font-size:clamp(2rem,1.4rem+2.4vw,3rem);
       line-height:1.1;margin:0 0 .4rem}
  .lp-main h1::after{content:"";display:block;width:64px;height:2px;background:var(--accent);margin-top:1.1rem}
  .lp-main h2{font-family:var(--font-heading);font-size:1.2rem;margin:2.4rem 0 .6rem;color:var(--text)}
  .lp-main p{margin:0 0 1rem;color:color-mix(in oklab,var(--text) 88%,var(--muted))}
  .lp-main a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
  .lp-footer{max-width:860px;margin:0 auto;padding:2rem 1.5rem 3rem;color:var(--muted);
       font-size:.9rem;border-top:1px solid color-mix(in oklab,var(--text) 12%,transparent)}
  .lp-footer a{color:var(--muted);text-decoration:none;margin:0 .35rem}
  .lp-footer a:hover{color:var(--accent)}
  @media (prefers-reduced-motion:no-preference){.lp-home,.lp-main a,.lp-footer a{transition:color .2s ease}}
</style>
</head>
<body>
<header class="lp-header">
  <a class="lp-home" href="./">${esc(name)}</a>
  <a class="lp-home" href="./" style="font-weight:400;color:var(--muted)">&larr; Zur Startseite</a>
</header>
<main class="lp-main">
  <h1>${esc(pageTitle)}</h1>
  ${content}
</main>
<footer class="lp-footer">
  <a href="./">Startseite</a> · <a href="impressum.html">Impressum</a> · <a href="datenschutz.html">Datenschutz</a>
</footer>
</body>
</html>`;
}

/**
 * Schreibt impressum.html und datenschutz.html (sofern Texte vorhanden) in den Projektordner.
 * @returns {{impressum?:string, datenschutz?:string}} relative Dateinamen der erzeugten Seiten
 */
/**
 * Rechtstext-Gerüst aus den vorhandenen Kontaktdaten, wenn von der Alt-Site nichts gescrapt wurde.
 * Deutsche Websites brauchen Impressum + Datenschutz zwingend, und der Footer verlinkt sie — es darf
 * also NIE eine tote impressum/datenschutz-Seite geben. Ehrlich als „vor Veröffentlichung
 * vervollständigen"-Gerüst gekennzeichnet (keine vorgetäuschte Vollständigkeit).
 */
function legalFallback(kind, project) {
  const c = project.contact || {};
  const who = c.name || project.name || '[Name / Inhaber:in]';
  const addr = c.address || '[Straße Hausnr., PLZ Ort]';
  const lines = [who, addr];
  if (c.phone) lines.push(`Telefon: ${c.phone}`);
  if (c.email) lines.push(`E-Mail: ${c.email}`);
  const contact = lines.join('\n');
  if (kind === 'impressum') {
    return `Angaben gemäß § 5 TMG\n\n${contact}\n\nHINWEIS (bitte vor Veröffentlichung vervollständigen und rechtlich prüfen lassen): Dieses Impressum ist ein automatisch aus den vorliegenden Kontaktdaten erzeugtes Gerüst. Es fehlen ggf. Pflichtangaben wie Berufsbezeichnung und zuständige Kammer/Aufsichtsbehörde, Umsatzsteuer-Identifikationsnummer sowie – bei Heilberufen – berufsrechtliche Angaben.`;
  }
  return `Datenschutzerklärung\n\nVerantwortlich im Sinne der DSGVO:\n${contact}\n\nDiese Website verarbeitet personenbezogene Daten nur im technisch notwendigen Umfang. HINWEIS (bitte vor Veröffentlichung vervollständigen und rechtlich prüfen lassen): Dies ist ein automatisch erzeugtes Datenschutz-Gerüst. Zu ergänzen sind u. a. die konkreten Verarbeitungen (Kontaktformular, Hosting, ggf. Terminbuchung/Karten), die Rechtsgrundlagen, Ihre Betroffenenrechte nach Art. 15–21 DSGVO und die Aufbewahrungsfristen.`;
}

function writeLegalPages(projectDir, project, dna) {
  const legal = project.legal || {};
  const written = {};

  // Impressum + Datenschutz IMMER erzeugen (Footer verlinkt sie → keine 404). Gescrapter Text hat
  // Vorrang; sonst ein Gerüst aus den Kontaktdaten mit klarem Vervollständigungs-Hinweis.
  const imp = (legal.impressum && legal.impressum.text) || legalFallback('impressum', project);
  fs.writeFileSync(path.join(projectDir, 'impressum.html'),
    renderLegalPage({ pageTitle: 'Impressum', text: imp, project, dna }));
  written.impressum = 'impressum.html';

  const ds = (legal.datenschutz && legal.datenschutz.text) || legalFallback('datenschutz', project);
  fs.writeFileSync(path.join(projectDir, 'datenschutz.html'),
    renderLegalPage({ pageTitle: 'Datenschutz', text: ds, project, dna }));
  written.datenschutz = 'datenschutz.html';

  return written;
}

/**
 * Injiziert eine dezente Footer-Rechtsleiste (Impressum/Datenschutz) ans Ende der
 * generierten index.html. Idempotent (markiert per data-legal-bar).
 * @param {string} html
 * @param {{impressum?:string, datenschutz?:string}} pages
 * @returns {string}
 */
function injectLegalLinks(html, pages = {}) {
  if (!pages.impressum && !pages.datenschutz) return html;
  if (/data-legal-bar/.test(html)) return html;

  // Wenn die generierte Seite die Rechtslinks bereits im Footer hat, KEINE zweite Leiste
  // (sonst doppeltes „Impressum · Datenschutz" wie zuvor).
  const impOk = !pages.impressum || /impressum\.html/i.test(html);
  const dsOk = !pages.datenschutz || /datenschutz\.html/i.test(html);
  if (impOk && dsOk) return html;

  const links = [
    pages.impressum ? `<a href="${pages.impressum}">Impressum</a>` : '',
    pages.datenschutz ? `<a href="${pages.datenschutz}">Datenschutz</a>` : ''
  ].filter(Boolean).join('<span aria-hidden="true">·</span>');

  const bar = `
<div data-legal-bar style="text-align:center;padding:1.1rem 1rem;font-size:.85rem;opacity:.75;font-family:inherit">
  <style>[data-legal-bar] a{color:inherit;text-decoration:none;margin:0 .5rem}[data-legal-bar] a:hover{text-decoration:underline}[data-legal-bar] span{opacity:.5}</style>
  ${links}
</div>`;

  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, bar + '\n</body>');
  return html + bar;
}

module.exports = { writeLegalPages, injectLegalLinks, renderLegalPage };
