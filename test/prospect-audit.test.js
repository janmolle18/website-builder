const { test } = require('node:test');
const assert = require('node:assert/strict');
const { auditProspect, inspectHtml, QUALIFY } = require('../prospect-audit');

const MODERN = `<!doctype html><html lang="de"><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Moderne Kanzlei in Paderborn mit Beratung im Arbeitsrecht.">
<meta property="og:title" content="Kanzlei">
<script type="application/ld+json">{"@type":"Attorney"}</script>
</head><body><main><h1>Kanzlei</h1>
<p>${'Ausführlicher, moderner Inhalt über unsere Kanzlei und unsere Rechtsgebiete. '.repeat(20)}</p>
</main></body></html>`;

const OUTDATED = `<!doctype html><html><head><title>Kanzlei</title></head>
<body><font face="Arial"><table><tr><td>Menü</td><td>Kanzlei Mustermann</td></tr>
<tr><td>Home</td><td>Kontakt</td></tr><tr><td>x</td><td>y</td></tr><tr><td>a</td><td>b</td></tr>
<tr><td>c</td><td>d</td></tr><tr><td>e</td><td>f</td></tr><tr><td>g</td><td>h</td></tr></table>
<p>Willkommen. Copyright 2011 Kanzlei Mustermann.</p></font></body></html>`;

test('inspectHtml: moderne Seite hat kaum Mängel', () => {
  const { hits } = inspectHtml(MODERN);
  assert.ok(!hits.noMobile, 'moderne Seite ist mobil-optimiert');
  assert.ok(!hits.noMetaDesc);
  assert.ok(!hits.noSchema);
  assert.ok(!hits.legacyTech);
});

test('inspectHtml: veraltete Seite wird erkannt (Tabellen-Layout, <font>, altes ©, kein viewport)', () => {
  const { hits } = inspectHtml(OUTDATED);
  assert.ok(hits.noMobile, 'kein viewport → nicht mobil');
  assert.ok(hits.legacyTech, 'Tabellen-Layout/<font> → legacy');
  assert.ok(hits.outdated && hits.outdated.year === 2011, 'altes Copyright');
  assert.ok(hits.noSchema);
});

test('auditProspect: keine Website → qualifiziert, aber als unverifiziert markiert', async () => {
  const r = await auditProspect({ name: 'Test' });
  assert.equal(r.verdict, 'qualified');
  assert.equal(r.needScore, 100);
  assert.equal(r.url, null);
  assert.equal(r.unverified, true, 'kein URL-Tag ist KEIN Beweis — Places muss bestätigen');
});

test('QUALIFY-Schwelle ist konservativ (>= 45)', () => {
  assert.ok(QUALIFY >= 45, 'Schwelle darf nicht zu locker sein → keine Fehlalarme');
});
