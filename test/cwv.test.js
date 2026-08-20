const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { rateCwv, logNormalScore, measureCwv, startStaticServer, median, THRESHOLDS, CURVES } = require('../cwv');

// ── Median (Stabilität gegen Messvarianz) ────────────────────────────────────

test('median: ungerade/gerade Anzahl, unsortierte Eingabe', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

// ── Scoring-Kurve (deterministisch, kein Browser nötig) ─────────────────────

test('logNormalScore: Kontrollpunkte p10 → ~0.9 und median → ~0.5', () => {
  const curve = { p10: 2500, median: 4000 };
  assert.ok(Math.abs(logNormalScore(curve, 2500) - 0.9) < 0.02, `p10 sollte ~0.9 ergeben, war ${logNormalScore(curve, 2500)}`);
  assert.ok(Math.abs(logNormalScore(curve, 4000) - 0.5) < 0.02, `median sollte ~0.5 ergeben, war ${logNormalScore(curve, 4000)}`);
});

test('logNormalScore: monoton fallend, Randwerte begrenzt', () => {
  const curve = { p10: 1800, median: 3000 };
  let prev = 1;
  for (const v of [1, 500, 1800, 3000, 6000, 20000]) {
    const s = logNormalScore(curve, v);
    assert.ok(s <= prev + 1e-9, `Score muss monoton fallen (bei ${v}: ${s} > ${prev})`);
    assert.ok(s >= 0 && s <= 1, `Score muss in [0,1] liegen, war ${s}`);
    prev = s;
  }
  assert.equal(logNormalScore(curve, 0), 1);
});

// ── Bewertung (pure Funktion) ────────────────────────────────────────────────

test('rateCwv: sehr gute Metriken → Score ≥90, Note A, pass, keine Issues', () => {
  const r = rateCwv({ lcpMs: 900, cls: 0.005, fcpMs: 600 });
  assert.ok(r.score >= 90, `Score sollte ≥90 sein, war ${r.score}`);
  assert.equal(r.grade, 'A');
  assert.equal(r.pass, true);
  assert.deepEqual(r.issues, []);
});

test('rateCwv: schlechte Metriken → niedriger Score, kein pass, LCP+CLS in den Issues', () => {
  const r = rateCwv({ lcpMs: 6000, cls: 0.4, fcpMs: 4500 });
  assert.ok(r.score < 60, `Score sollte <60 sein, war ${r.score}`);
  assert.equal(r.pass, false);
  assert.ok(r.issues.some(i => i.includes('LCP')), 'LCP-Issue fehlt');
  assert.ok(r.issues.some(i => i.includes('CLS')), 'CLS-Issue fehlt');
});

test('rateCwv: Schwellwerte entsprechen dem Qualitätsstandard (LCP<2,5s, CLS<0,1, Score≥90)', () => {
  assert.equal(THRESHOLDS.lcpMs, 2500);
  assert.equal(THRESHOLDS.cls, 0.1);
  assert.equal(THRESHOLDS.score, 90);
  // Gerade über der LCP-Schwelle → pass=false, auch wenn der Score noch gut ist.
  const r = rateCwv({ lcpMs: 2600, cls: 0.01, fcpMs: 1000 });
  assert.equal(r.pass, false);
  assert.ok(r.issues.some(i => i.includes('LCP')));
});

test('CURVES: alle Metriken haben p10 < median (sonst ist die Kurve sinnlos)', () => {
  for (const [k, c] of Object.entries(CURVES)) {
    assert.ok(c.p10 < c.median, `${k}: p10 (${c.p10}) muss < median (${c.median}) sein`);
  }
});

// ── Interner Static-Server ───────────────────────────────────────────────────

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { res.resume(); resolve({ status: res.statusCode, type: res.headers['content-type'] || '' }); }).on('error', reject);
  });
}

test('startStaticServer: liefert index.html, blockt project.json und Path-Traversal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwv-srv-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  fs.writeFileSync(path.join(dir, 'project.json'), '{"geheim":true}');
  const outside = path.join(path.dirname(dir), `cwv-outside-${Date.now()}.txt`);
  fs.writeFileSync(outside, 'geheim');
  const srv = await startStaticServer(dir);
  try {
    assert.equal((await fetchStatus(`${srv.url}/`)).status, 200);
    assert.ok((await fetchStatus(`${srv.url}/`)).type.includes('text/html'));
    assert.equal((await fetchStatus(`${srv.url}/project.json`)).status, 404, 'project.json darf nicht ausgeliefert werden');
    assert.equal((await fetchStatus(`${srv.url}/..%2F${path.basename(outside)}`)).status, 404, 'Path-Traversal muss geblockt sein');
    assert.equal((await fetchStatus(`${srv.url}/gibt-es-nicht.css`)).status, 404);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('startStaticServer: interne Ordner qa/ und comparison/ sind geblockt (wie beim ZIP-Export)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwv-srv-dirs-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>ok</body></html>');
  fs.mkdirSync(path.join(dir, 'qa'));
  fs.writeFileSync(path.join(dir, 'qa', 'report.json'), '{"intern":true}');
  fs.mkdirSync(path.join(dir, 'comparison'));
  fs.writeFileSync(path.join(dir, 'comparison', 'old.jpg'), 'jpegdaten');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'site.css'), 'body{}');
  const srv = await startStaticServer(dir);
  try {
    assert.equal((await fetchStatus(`${srv.url}/qa/report.json`)).status, 404, 'qa/ darf nicht ausgeliefert werden');
    assert.equal((await fetchStatus(`${srv.url}/comparison/old.jpg`)).status, 404, 'comparison/ darf nicht ausgeliefert werden');
    assert.equal((await fetchStatus(`${srv.url}/assets/site.css`)).status, 200, 'echte Site-Assets müssen weiter funktionieren');
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Messung (Integration, braucht System-Chrome — überspringt sauber, wenn keiner da) ──

test('measureCwv: ohne index.html → Score 0, kein Absturz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwv-empty-'));
  const r = await measureCwv(dir);
  assert.equal(r.score, 0);
  assert.equal(r.grade, 'n/a');
  assert.equal(r.metrics, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('measureCwv: misst echte Metriken an einer Mini-Site', { timeout: 90000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwv-site-'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="de"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>CWV-Test</title>
    <style>body{font-family:sans-serif;margin:0}h1{font-size:2rem;padding:2rem}</style></head>
    <body><h1>Kanzlei Test — Core Web Vitals</h1><p>Statischer Inhalt ohne Layout-Shift.</p></body></html>`);
  let r;
  try {
    r = await measureCwv(dir, { runs: 2 }); // Median-Pfad mit ausüben, aber Testlaufzeit klein halten
  } catch (e) {
    if (/Kein Browser gefunden/.test(e.message)) { t.skip('Kein System-Browser installiert'); return; }
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(r.metrics, 'Metriken müssen vorhanden sein');
  assert.ok(r.metrics.lcpMs > 0, `LCP muss gemessen sein, war ${r.metrics.lcpMs}`);
  assert.ok(r.metrics.cls >= 0, 'CLS muss ≥0 sein');
  assert.ok(r.score >= 0 && r.score <= 100, `Score in [0,100], war ${r.score}`);
  assert.ok(typeof r.summary === 'string' && r.summary.length > 0);
  // Eine statische Mini-Seite ohne Bilder/Fonts muss die Gates locker schaffen.
  assert.ok(r.metrics.cls < 0.1, `Mini-Seite darf keinen Layout-Shift haben, CLS war ${r.metrics.cls}`);
});
