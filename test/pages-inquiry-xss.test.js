const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { inquiryForm } = require('../pages');

// Ein bösartiger contact.email-Wert. project.contact wird im /api/generate-Pfad NICHT
// serverseitig validiert, landet also unverändert in der ausgelieferten kontakt.html.
const PAYLOAD_EMAIL = 'x</script><script>alert(1)</script>@evil.tld';

test('inquiryForm: </script> in contact.email bricht NICHT aus dem <script> aus', () => {
  const frag = inquiryForm({ contact: { email: PAYLOAD_EMAIL }, specialties: [] });
  const $ = cheerio.load(`<!doctype html><html><body>${frag}</body></html>`);

  // Genau EIN Script-Element (die Formular-IIFE). Bei einem Ausbruch würde das
  // eingebettete </script> das erste Script vorzeitig schließen und ein zweites,
  // ausführendes <script>alert(1)</script> als eigenes Element abspalten.
  assert.equal($('script').length, 1, 'kein durch </script> eingeschleustes zweites <script>');

  // Im Roh-Fragment darf keine </script><script>-Ausbruchsequenz stehen.
  assert.ok(!/<\/script\s*>\s*<script/i.test(frag), 'keine </script><script>-Ausbruchsequenz im Output');
});

test('inquiryForm: nutzt keinen innerHTML-Sink mit der E-Mail (DOM-XSS-Schutz)', () => {
  const frag = inquiryForm({ contact: { email: 'kanzlei@example.de' }, specialties: [] });
  // innerHTML + zur Laufzeit verkettete Werte = DOM-XSS-Sink. Formular baut die
  // Erfolgsmeldung stattdessen mit textContent/createElement.
  assert.ok(!/innerHTML/.test(frag), 'kein innerHTML im Formular-Script');
});

test('inquiryForm: normale E-Mail bleibt unverändert nutzbar', () => {
  const frag = inquiryForm({ contact: { email: 'info@kanzlei-mueller.de' }, specialties: ['Familienrecht'] });
  assert.ok(frag.includes('info@kanzlei-mueller.de'), 'echte Adresse bleibt erhalten');
  assert.ok(/id="inquiry"/.test(frag), 'Formular wird gerendert');
});
