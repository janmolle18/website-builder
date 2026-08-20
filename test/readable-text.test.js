const { test } = require('node:test');
const assert = require('node:assert/strict');
const { htmlToReadableText } = require('../agent-scraper');

const FLIESSTEXT = 'Krankengymnastik hilft bei Rückenschmerzen, Gelenkbeschwerden und nach Operationen. '
  + 'Unsere Praxis behandelt Sie mit individuellen Übungsprogrammen und manueller Therapie in Paderborn.';

test('htmlToReadableText: Astra-Body-Klassen (ast-hfb-header) löschen nicht die ganze Seite', () => {
  // Echtes Muster von bergenundbergen.de: WordPress/Astra trägt Layout-Klassen auf <body>,
  // u. a. "ast-hfb-header" — [class*="header"] darf das Wurzelelement nicht entfernen.
  const html = `<html><body class="page-template-default ast-hfb-header ast-header-break-point ast-plain-container">
    <a class="skip-link screen-reader-text" href="#main">Zum Inhalt springen</a>
    <div id="page" class="hfeed site"><p>${FLIESSTEXT}</p></div>
  </body></html>`;
  const text = htmlToReadableText(html);
  assert.ok(text.includes('Krankengymnastik'), `Inhalt fehlt: "${text.slice(0, 80)}"`);
  assert.ok(text.length > 100, `nur ${text.length} Zeichen extrahiert`);
});

test('htmlToReadableText: Navigation/Header/Footer werden weiterhin entfernt', () => {
  const html = `<html><body>
    <header><nav class="main-menu"><a href="/">Home</a><a href="/preise">Preisliste</a></nav></header>
    <main><p>${FLIESSTEXT}</p></main>
    <footer>Impressum Datenschutz</footer>
  </body></html>`;
  const text = htmlToReadableText(html);
  assert.ok(text.includes('Krankengymnastik'));
  assert.ok(!text.includes('Preisliste'), 'Navigation muss draußen bleiben');
  assert.ok(!text.includes('Impressum Datenschutz'), 'Footer muss draußen bleiben');
});

test('htmlToReadableText: Sicherheitsnetz, wenn ein Theme-Wrapper den ganzen Inhalt hält', () => {
  // Wrapper mit "nav"-Klasse um ALLES (Theme-Eigenart) — lieber mit Menü extrahieren als leer.
  const html = `<html><body>
    <div class="nav-canvas-wrapper"><div><p>${FLIESSTEXT}</p></div></div>
  </body></html>`;
  const text = htmlToReadableText(html);
  assert.ok(text.includes('Krankengymnastik'), `Fallback fehlt: "${text.slice(0, 80)}"`);
});
