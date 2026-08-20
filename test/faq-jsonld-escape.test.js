const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { injectFaq } = require('../faq');
const { selectDNA } = require('../design-dna');

const BASE = '<!doctype html><html lang="de"><head><title>T</title></head>'
  + '<body><main><h1>x</h1></main><footer>f</footer></body></html>';

test('injectFaq: </script> in einer FAQ-Frage bricht das JSON-LD nicht aus', () => {
  const project = {
    name: 'Kanzlei Test', category: 'kanzlei',
    faq: [{ q: 'Was kostet </script><script>alert(1)</script> eine Beratung?', a: 'Das klären wir im Erstgespräch.' }],
  };
  const dna = selectDNA(project);
  const { html, injected } = injectFaq(BASE, project, dna);
  assert.ok(injected, 'FAQ wurde injiziert');

  const $ = cheerio.load(html);
  // Kein durch </script> abgespaltenes, ausführbares Script.
  const execScripts = $('script').toArray().filter(s => $(s).attr('type') !== 'application/ld+json');
  for (const s of execScripts) {
    assert.ok(!/alert\(1\)/.test($(s).text()), 'kein eingeschleustes ausführbares Script');
  }

  // FAQPage-JSON-LD: valides JSON, kein rohes </script> im Rohtext.
  const faqLd = $('script[type="application/ld+json"]').toArray()
    .map(s => $(s).text()).find(t => /"FAQPage"/.test(t));
  assert.ok(faqLd, 'FAQPage-JSON-LD vorhanden');
  assert.doesNotThrow(() => JSON.parse(faqLd), 'JSON-LD bleibt parsebar');
  assert.ok(!/<\/script/i.test(faqLd), 'kein rohes </script> im JSON-LD');
});

test('injectFaq: normale FAQ erzeugt weiterhin valides FAQPage-Schema', () => {
  const project = { name: 'Kanzlei Müller', faq: [{ q: 'Wie sind Ihre Zeiten?', a: 'Mo–Fr 9–17 Uhr.' }] };
  const dna = selectDNA(project);
  const { html } = injectFaq(BASE, project, dna);
  const $ = cheerio.load(html);
  const node = JSON.parse(
    $('script[type="application/ld+json"]').toArray().map(s => $(s).text()).find(t => /"FAQPage"/.test(t))
  );
  assert.equal(node['@type'], 'FAQPage');
  assert.ok(Array.isArray(node.mainEntity) && node.mainEntity.length === 1, 'genau eine FAQ im Schema');
});
