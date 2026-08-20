const { test } = require('node:test');
const assert = require('node:assert');
const { oldSiteUrl, buildComparisonHtml } = require('../comparison');

test('oldSiteUrl: findet die Alt-URL in der Prioritätsreihenfolge', () => {
  assert.strictEqual(oldSiteUrl({ sourceUrl: 'https://alt.de' }), 'https://alt.de');
  assert.strictEqual(oldSiteUrl({ oldSiteUrl: 'http://x.de' }), 'http://x.de');
  assert.strictEqual(oldSiteUrl({ links: { website: 'https://link.de' } }), 'https://link.de');
  assert.strictEqual(oldSiteUrl({ website: 'https://w.de' }), 'https://w.de');
  // sourceUrl gewinnt vor website
  assert.strictEqual(oldSiteUrl({ sourceUrl: 'https://a.de', website: 'https://b.de' }), 'https://a.de');
});

test('oldSiteUrl: null bei fehlender/ungültiger URL', () => {
  assert.strictEqual(oldSiteUrl({}), null);
  assert.strictEqual(oldSiteUrl({ sourceUrl: '' }), null);
  assert.strictEqual(oldSiteUrl({ sourceUrl: 'kein-http.de' }), null);
  assert.strictEqual(oldSiteUrl({ website: 'ftp://x.de' }), null);
});

test('oldSiteUrl: trimmt Whitespace', () => {
  assert.strictEqual(oldSiteUrl({ sourceUrl: '  https://alt.de  ' }), 'https://alt.de');
});

test('buildComparisonHtml: enthält beide Screenshots, noindex und escaped den Namen', () => {
  const html = buildComparisonHtml({ name: 'Kanzlei <B> & Co' }, 'https://alt.de/pfad');
  assert.match(html, /comparison\/old\.jpg/);
  assert.match(html, /comparison\/new\.jpg/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /Kanzlei &lt;B&gt; &amp; Co/); // XSS-sicher escaped
  assert.doesNotMatch(html, /<B>/);
  assert.match(html, /https:\/\/alt\.de\/pfad/); // Alt-URL als Meta angezeigt
});
