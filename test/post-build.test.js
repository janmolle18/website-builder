const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Die sechs Geschwister-Module werden gestubbt, damit wir EINEN gezielt werfen lassen
// können — ohne echte Builds oder Filesystem. So prüfen wir die Kernzusicherung von
// post-build.js: ein fehlgeschlagener Schritt lässt die übrigen fünf weiterlaufen und
// bringt runPostBuildEnhancements selbst NICHT zum Werfen. (Node 22 `node --test`
// isoliert Testdateien in eigenen Prozessen; der after-Hook räumt zusätzlich auf.)
function stub(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return resolved;
}

const stubbed = [
  stub('css-build', { buildCss: () => ({ built: true, cssBytes: 12000, files: 1 }) }),
  stub('vendor-build', { vendorBuild: () => ({ built: true, libs: ['alpine'], files: 1 }) }),
  stub('fonts-build', { buildFonts: async () => ({ built: true, families: ['Inter'], files: 1 }) }),
  stub('images-build', { buildImages: async () => { throw new Error('sharp kaputt'); } }), // der werfende Schritt
  stub('brand-assets', { buildBrandAssets: async () => ({ built: true, ogImage: { bytes: 40000 }, pagesUpdated: 2 }) }),
  stub('subpage-schema', { buildSubpageSchema: async () => ({ built: true, pages: [1, 2], skipped: 0 }) }),
];

const postBuildId = require.resolve('../post-build');
delete require.cache[postBuildId]; // frisch laden, damit die Stubs greifen
const { runPostBuildEnhancements } = require('../post-build');

after(() => {
  for (const id of stubbed) delete require.cache[id];
  delete require.cache[postBuildId];
});

test('runPostBuildEnhancements: ein werfender Schritt killt den Build nicht (Fail-Safe)', async () => {
  const project = {};
  let result;
  await assert.doesNotReject(
    async () => { result = await runPostBuildEnhancements('/nonexistent', project, {}); },
    'runPostBuildEnhancements selbst wirft nie'
  );
  assert.ok(result && Array.isArray(result.steps), 'gibt {steps} zurück');

  // Die fünf erfolgreichen Schritte liefen; der werfende (images) ist NICHT vermerkt.
  assert.ok(result.steps.includes('css'), 'css lief');
  assert.ok(result.steps.includes('vendor'), 'vendor lief');
  assert.ok(result.steps.includes('fonts'), 'fonts lief vor dem Fehler');
  assert.ok(!result.steps.includes('images'), 'werfender images-Schritt nicht als erledigt vermerkt');
  assert.ok(result.steps.includes('brand'), 'brand lief NACH dem Fehler weiter');
  assert.ok(result.steps.some(s => s.startsWith('subpage-schema')), 'subpage-schema lief');

  // Flags: erfolgreiche gesetzt, fehlgeschlagenes optimizedImages NICHT.
  assert.equal(project.selfHostedCss, true, 'selfHostedCss-Flag gesetzt');
  assert.equal(project.brandAssets, true, 'brandAssets-Flag gesetzt');
  assert.equal(project.optimizedImages, undefined, 'kein optimizedImages-Flag bei fehlgeschlagenem Bild-Schritt');
});
