const { test } = require('node:test');
const assert = require('node:assert/strict');

// callClaude stubben BEVOR faq.js geladen wird (faq.js destrukturiert beim require).
const cli = require('../claude-cli');
let lastPrompt = '';
let fakeResponse = '[]';
cli.callClaude = async ({ prompt }) => { lastPrompt = prompt; return fakeResponse; };

const { generateFaq, faqJsonLd } = require('../faq');

const project = { name: 'Kanzlei Müller', category: 'Rechtsanwaltskanzlei', specialties: ['Erbrecht'] };

test('generateFaq-Prompt fordert 12 answer-first FAQs', async () => {
  fakeResponse = '[]';
  await generateFaq(project);
  assert.match(lastPrompt, /12 häufige Fragen/, 'fordert 12 FAQs');
  assert.match(lastPrompt, /ANSWER-FIRST/, 'answer-first Anweisung vorhanden');
  assert.match(lastPrompt, /KEINE erfundenen Preise/, 'Preis-/Fristen-Regel bleibt');
  assert.match(lastPrompt, /echte Umlaute/, 'Umlaut-Regel bleibt');
  assert.match(lastPrompt, /KEINE Gedankenstriche/, 'Gedankenstrich-Verbot bleibt');
});

test('generateFaq kappt bei 14 Einträgen', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ q: `Frage ${i}?`, a: `Antwort ${i}.` }));
  fakeResponse = JSON.stringify(many);
  const out = await generateFaq(project);
  assert.equal(out.length, 14, 'Slice-Cap 14');
  assert.equal(out[0].q, 'Frage 0?');
});

test('generateFaq filtert unvollständige Einträge und trimmt', async () => {
  fakeResponse = JSON.stringify([{ q: ' Wie? ', a: ' So. ' }, { q: '', a: 'x' }, { a: 'kein q' }]);
  const out = await generateFaq(project);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { q: 'Wie?', a: 'So.' });
});

test('generateFaq gibt [] zurück, wenn keine JSON-Liste kommt (kein Throw)', async () => {
  fakeResponse = 'Entschuldigung, ich kann das nicht.';
  const out = await generateFaq(project);
  assert.deepEqual(out, []);
});

test('faqJsonLd erzeugt valides FAQPage-Schema', () => {
  const ld = faqJsonLd([{ q: 'Frage?', a: 'Antwort.' }]);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity[0]['@type'], 'Question');
  assert.equal(ld.mainEntity[0].name, 'Frage?');
  assert.equal(ld.mainEntity[0].acceptedAnswer.text, 'Antwort.');
});
