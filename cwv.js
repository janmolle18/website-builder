/**
 * cwv.js — Echte Core-Web-Vitals-Messung (B1, abo-frei, kein LLM).
 *
 * Misst LCP, CLS und FCP einer gebauten Site mit Playwright (System-Chrome via
 * browser.js) unter mobilen Bedingungen (CDP-Netz-/CPU-Throttling nach
 * Lighthouse-Mobile-Defaults). Daraus entsteht ein Score 0–100 über die
 * Lighthouse-Lognormal-Kurven — bewusst „CWV-Score" genannt, NICHT „Lighthouse"
 * (kein TBT/Speed-Index; ehrliches, vereinfachtes Modell aus LCP/CLS/FCP).
 *
 * Doppelter Nutzen wie geo.js/a11y.js:
 *   1. QA-Gate beim Bauen (Score in project.cwv) — Qualitätsversprechen messbar.
 *   2. Vorher/Nachher-Beweis für den Bilder-Sprint (Block I).
 *
 * Die Messung ist strikt lesend: Projektdateien werden NIE verändert.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { launchBrowser } = require('./browser');

// Qualitätsstandard aus CLAUDE.md — nicht verhandelbar.
const THRESHOLDS = { lcpMs: 2500, cls: 0.1, score: 90 };

// Lighthouse-Mobile-Kontrollpunkte (p10/median) je Metrik.
const CURVES = {
  lcpMs: { p10: 2500, median: 4000 },
  fcpMs: { p10: 1800, median: 3000 },
  cls:   { p10: 0.1,  median: 0.25 }
};

// Gewichtung des CWV-Scores (vereinfachtes Modell, dokumentiert im Report).
const WEIGHTS = { lcpMs: 0.5, cls: 0.25, fcpMs: 0.25 };

// Lighthouse-Mobile-Throttling: ~1,6 Mbit/s down, 150 ms RTT, 4× CPU-Slowdown.
const THROTTLE = {
  latencyMs: 150,
  downloadBps: (1.6 * 1024 * 1024) / 8,
  uploadBps: (0.75 * 1024 * 1024) / 8,
  cpuRate: 4
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json'
};

// Interne Dateien/Ordner, die der Mess-Server niemals ausliefert — gleiche
// Ausschlussliste wie beim ZIP-Export (export-zip.js): qa/ und comparison/
// sind interne Artefakte, keine Site-Inhalte.
const BLOCKED_FILES = new Set(['project.json', 'licenses.json']);
const BLOCKED_DIRS = new Set(['qa', 'comparison']);

/** Fehlerfunktion (Abramowitz & Stegun 7.1.26, max. Fehler ~1,5e-7). */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Lognormal-Score wie bei Lighthouse: 1.0 bei sehr guten Werten, 0.9 am
 * p10-Kontrollpunkt, 0.5 am Median, gegen 0 bei sehr schlechten Werten.
 */
function logNormalScore({ p10, median }, value) {
  if (value <= 0) return 1;
  const mu = Math.log(median);
  // Φ⁻¹(0.1) = −1.28155 → σ so wählen, dass CDF(p10) = 0.1.
  const sigma = (mu - Math.log(p10)) / 1.28155;
  if (sigma <= 0) return value <= median ? 1 : 0;
  const z = (Math.log(value) - mu) / sigma;
  const cdf = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.min(1, Math.max(0, 1 - cdf));
}

/**
 * Bewertet gemessene Metriken (pure Funktion, testbar ohne Browser).
 * @param {{lcpMs:number, cls:number, fcpMs:number}} m
 */
function rateCwv(m) {
  const parts = {
    lcpMs: logNormalScore(CURVES.lcpMs, m.lcpMs),
    cls:   logNormalScore(CURVES.cls, m.cls),
    fcpMs: logNormalScore(CURVES.fcpMs, m.fcpMs)
  };
  let weighted = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) weighted += w * parts[k];
  const score = Math.round(weighted * 100);

  const issues = [];
  if (m.lcpMs > THRESHOLDS.lcpMs) issues.push(`LCP über Ziel: ${(m.lcpMs / 1000).toFixed(2)}s (Ziel < ${THRESHOLDS.lcpMs / 1000}s)`);
  if (m.cls > THRESHOLDS.cls) issues.push(`CLS über Ziel: ${m.cls.toFixed(3)} (Ziel < ${THRESHOLDS.cls})`);
  if (score < THRESHOLDS.score) issues.push(`CWV-Score unter Ziel: ${score}/100 (Ziel ≥ ${THRESHOLDS.score})`);

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  const pass = issues.length === 0;
  return { score, grade, pass, issues };
}

/**
 * Ephemerer Static-Server für die Messung (nur 127.0.0.1, zufälliger Port).
 * Liefert ausschließlich Dateien innerhalb des Projektordners; interne
 * Projektdateien und versteckte Dateien sind geblockt.
 */
function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + path.posix.normalize('/' + pathname));
      const rel = path.relative(root, file);
      const base = path.basename(file);
      const isInside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      const parts = rel.split(path.sep);
      const isBlocked = BLOCKED_FILES.has(base) || BLOCKED_DIRS.has(parts[0]) || parts.some(p => p.startsWith('.'));
      if (!isInside || isBlocked || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(400); res.end('bad request');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

/** PerformanceObserver, die VOR der Navigation registriert werden müssen. */
const INIT_SCRIPT = `
  window.__cwv = { lcp: 0, cls: 0, fcp: 0 };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__cwv.lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cwv.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__cwv.fcp = e.startTime; })
      .observe({ type: 'paint', buffered: true });
  } catch (e) { /* ältere Engines: Metriken bleiben 0 */ }
`;

/** Median einer Zahlenliste — stabilisiert die Messung gegen Lauf-zu-Lauf-Varianz. */
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Ein einzelner Messlauf in einem frischen Browser-Context. */
async function measureOnce(browser, baseUrl, pageFile, opts) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(INIT_SCRIPT);

    let requests = 0;
    let weightBytes = 0;
    page.on('response', r => {
      requests += 1;
      const len = parseInt(r.headers()['content-length'] || '0', 10);
      weightBytes += Number.isFinite(len) ? len : 0;
    });

    // Mobile Bedingungen (Lighthouse-Defaults) — ohne Throttling wären lokale
    // Messungen unrealistisch gut. Fällt bei CDP-Problemen sauber zurück.
    let throttled = opts.throttle !== false;
    if (throttled) {
      try {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: THROTTLE.latencyMs,
          downloadThroughput: THROTTLE.downloadBps, uploadThroughput: THROTTLE.uploadBps
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpuRate });
      } catch { throttled = false; }
    }

    await page.goto(`${baseUrl}/${pageFile === 'index.html' ? '' : pageFile}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(opts.settleMs ?? 1500); // LCP/CLS nach dem Load stabilisieren lassen

    const raw = await page.evaluate(() => window.__cwv);
    return { lcpMs: raw.lcp, cls: raw.cls, fcpMs: raw.fcp, requests, weightBytes, throttled };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Misst die Core Web Vitals der Startseite eines gebauten Projekts.
 * Strikt lesend — verändert keine Projektdateien. Führt standardmäßig 3 Läufe
 * aus und nimmt je Metrik den Median (Lab-Messungen streuen; ein Einzellauf
 * wäre als Gate zu instabil).
 *
 * @param {string} projectDir absoluter Pfad zum Projektordner (mit index.html)
 * @param {{page?:string, throttle?:boolean, settleMs?:number, runs?:number}} [opts]
 * @returns {Promise<{score:number, grade:string, pass:boolean, metrics:object|null, thresholds:object, summary:string, issues:string[]}>}
 */
async function measureCwv(projectDir, opts = {}) {
  const pageFile = opts.page || 'index.html';
  const runs = Math.max(1, Math.min(9, opts.runs ?? 3));
  if (!fs.existsSync(path.join(projectDir, pageFile))) {
    return {
      score: 0, grade: 'n/a', pass: false, metrics: null, thresholds: THRESHOLDS,
      summary: 'Keine index.html — Site noch nicht gebaut.', issues: ['Site bauen']
    };
  }

  const srv = await startStaticServer(projectDir);
  let browser;
  try {
    browser = await launchBrowser();
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await measureOnce(browser, srv.url, pageFile, opts));

    const metrics = {
      lcpMs: Math.round(median(samples.map(s => s.lcpMs))),
      cls: Math.round(median(samples.map(s => s.cls)) * 1000) / 1000,
      fcpMs: Math.round(median(samples.map(s => s.fcpMs))),
      requests: Math.round(median(samples.map(s => s.requests))),
      weightKb: Math.round(median(samples.map(s => s.weightBytes)) / 1024),
      throttled: samples.every(s => s.throttled),
      runs,
      page: pageFile
    };

    const rated = rateCwv(metrics);
    const summary = rated.pass
      ? `CWV im Ziel (${rated.score}/100, Note ${rated.grade}): LCP ${(metrics.lcpMs / 1000).toFixed(2)}s, CLS ${metrics.cls} (Median aus ${runs} Läufen).`
      : `CWV-Score ${rated.score}/100 (Note ${rated.grade}): ${rated.issues.length} Metrik(en) über Ziel (Median aus ${runs} Läufen).`;

    return { ...rated, metrics, thresholds: THRESHOLDS, summary };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await srv.close().catch(() => {});
  }
}

module.exports = { measureCwv, rateCwv, logNormalScore, startStaticServer, median, THRESHOLDS, CURVES, WEIGHTS };
