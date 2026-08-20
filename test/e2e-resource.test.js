const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cheerio = require('cheerio');
const { injectAssets } = require('../assets');
const { assembleBlocks } = require('../blocks');
const { writeLicenseManifest, recordAsset } = require('../licenses');

function sampleHtml() {
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><header>h</header><main><h1>Test</h1></main><footer>f</footer></body></html>';
}

test('Resource-Schicht: injiziert, idempotent, Manifest, HTML intakt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const project = { category: 'Rechtsanwaltskanzlei', contact: { phone: '040 123456' } };
  const dna = { palette: { accent: '#9C7A3C', text: '#16202B' }, fonts: { heading: 'Fraunces', body: 'Inter' } };
  const assets = { fonts: '<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">', heroPhoto: null, icon: () => '' };

  let html = sampleHtml();
  html = injectAssets(html, assets).html;
  const ab = assembleBlocks(html, project, dna, assets);
  html = ab.html;
  const records = recordAsset([], { source: 'googlefonts', type: 'font', ref: 'Fraunces/Inter' });
  writeLicenseManifest(dir, records);

  assert.equal(ab.injected, 1, 'cta-band montiert');
  assert.match(html, /fonts\.googleapis\.com/);
  assert.match(html, /data-block="cta-band"/);
  assert.ok(fs.existsSync(path.join(dir, 'licenses.json')));

  const $ = cheerio.load(html);
  assert.equal($('h1').length, 1);
  assert.equal($('footer').length, 1);
  assert.ok(html.indexOf('data-block="cta-band"') < html.indexOf('<footer>'));

  const again = assembleBlocks(injectAssets(html, assets).html, project, dna, assets);
  assert.equal(again.injected, 0);
});
