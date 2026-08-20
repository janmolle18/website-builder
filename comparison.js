/**
 * comparison.js — Vorher/Nachher-Artefakt (der Sales-Hebel aus dem Website-Flip-Workflow).
 *
 * Wenn das Lead-Business eine bestehende (meist schwache) Website hat, schießt dieser
 * Schritt einen Screenshot der ALTEN Seite und stellt ihn neben die NEU generierte.
 * Ergebnis: eine eigenständige `comparison.html` im Projektordner — genau der Link,
 * der neben dem Preview-Link im LinkedIn-Erstkontakt überzeugt ("Vorher/Nachher in einem Link").
 *
 * Greift nur, wenn eine Alt-URL bekannt ist (project.sourceUrl / links.website).
 * Zuverlässigkeit (2026-07-09): beide Screenshots laufen unabhängig, mit Retry, eigener
 * Page pro Shot, tolerantem Laden und Scroll-Reveal-Trigger für die neue Site. Fehler
 * werden NICHT still verschluckt, sondern als strukturierter Status zurückgegeben.
 *
 * Quelle: 02_SOURCES/articles/2026-06-14-website-flip-mit-claude-code-florent.md
 */

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');

const VIEWPORT = { width: 1440, height: 900 };
const MAX_SHOT_HEIGHT = 7900; // Schutz gegen riesige Screenshots
const SHOT_RETRIES = 2;

/** Alt-Site-URL aus den Projektdaten ableiten (oder null, wenn es keine gibt). */
function oldSiteUrl(project) {
  const links = project.links || {};
  const candidates = [
    project.sourceUrl,
    project.oldSiteUrl,
    links.website,
    links.old,
    project.website
  ];
  const url = candidates.find(u => typeof u === 'string' && /^https?:\/\//i.test(u.trim()));
  return url ? url.trim() : null;
}

/** Führt fn bis zu `tries` Mal aus; wirft erst, wenn alle Versuche scheitern. */
async function withRetry(fn, tries = SHOT_RETRIES) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastError = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw lastError;
}

/** Scroll-Reveal-Animationen (IntersectionObserver) auslösen, sonst bleiben Sektionen im Screenshot leer. */
async function triggerReveals(page) {
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y <= max; y += step) { window.scrollTo(0, y); await sleep(120); }
    window.scrollTo(0, 0);
    await sleep(250);
  }).catch(() => {});
}

/**
 * Ein Screenshot mit eigener Page (isoliert, damit ein kaputter Alt-Seiten-Zustand
 * die andere Aufnahme nicht mitreißt). Alte Seiten werden tolerant geladen.
 */
async function shoot(browser, url, file, { old = false } = {}) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  page.on('dialog', d => d.dismiss().catch(() => {})); // Cookie-/JS-Dialoge nicht blockieren lassen
  try {
    // Alte Seiten sind oft langsam/kaputt → domcontentloaded genügt, mit Fallback auf 'commit'.
    await page.goto(url, { waitUntil: old ? 'domcontentloaded' : 'load', timeout: 30000 })
      .catch(() => page.goto(url, { waitUntil: 'commit', timeout: 30000 }));
    await page.waitForTimeout(old ? 2200 : 800);
    if (!old) await triggerReveals(page); // nur unsere neue Site hat Reveal-Animationen
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => VIEWPORT.height);
    const shot = { path: file, type: 'jpeg', quality: 72, fullPage: true };
    if (fullHeight > MAX_SHOT_HEIGHT) shot.clip = { x: 0, y: 0, width: VIEWPORT.width, height: MAX_SHOT_HEIGHT };
    await page.screenshot(shot);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Erzeugt comparison.html (+ Screenshots) im Projektordner.
 * @returns {Promise<null | {ok:true, comparisonUrl:string, oldUrl:string} | {ok:false, oldUrl:string, reason:string}>}
 *   null  = keine Alt-URL (nichts zu vergleichen),
 *   ok:true = Asset erzeugt, ok:false = Screenshot(s) gescheitert (mit Grund).
 */
async function generateComparison(project, projectDir, opts = {}) {
  const oldUrl = oldSiteUrl(project);
  if (!oldUrl) return null; // kein Alt-Business mit Website → nichts zu vergleichen

  const newUrl = opts.newUrl;
  if (!newUrl) throw new Error('generateComparison: newUrl (lokale URL der neuen Site) fehlt');

  const cmpDir = path.join(projectDir, 'comparison');
  fs.mkdirSync(cmpDir, { recursive: true });
  const oldImg = path.join(cmpDir, 'old.jpg');
  const newImg = path.join(cmpDir, 'new.jpg');

  const browser = await launchBrowser();
  try {
    // Alt-Site zuerst — sie ist der Grund für das Asset. Beide Shots unabhängig mit Retry.
    try {
      await withRetry(() => shoot(browser, oldUrl, oldImg, { old: true }));
    } catch (e) {
      return { ok: false, oldUrl, reason: `Alt-Site nicht erreichbar/screenshot-bar (${e.message})` };
    }
    try {
      await withRetry(() => shoot(browser, newUrl, newImg, { old: false }));
    } catch (e) {
      return { ok: false, oldUrl, reason: `Neue Site nicht screenshot-bar (${e.message})` };
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const html = buildComparisonHtml(project, oldUrl);
  fs.writeFileSync(path.join(projectDir, 'comparison.html'), html);
  return { ok: true, comparisonUrl: `/projects/${project.id}/comparison.html`, oldUrl };
}

// ── HTML-Builder (kundenseitiges Sales-Asset, bewusst kein Template-Look) ────────
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildComparisonHtml(project, oldUrl) {
  const name = esc(project.name || 'Ihre Website');
  const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${name} — Vorher / Nachher</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--ink:#0e0e12;--paper:#f6f4ef;--muted:#8a8a94;--line:#e4e0d6;--accent:#c8553d}
  html{scroll-behavior:smooth}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);line-height:1.5}
  .band{background:var(--ink);color:#f4f1ea;padding:clamp(2.5rem,6vw,5rem) 1.5rem;text-align:center}
  .eyebrow{font-size:.72rem;letter-spacing:.32em;text-transform:uppercase;color:#b8b3a6;margin-bottom:1.1rem}
  .band h1{font-size:clamp(2rem,5vw,3.4rem);font-weight:800;letter-spacing:-.02em;line-height:1.05}
  .band p{color:#b8b3a6;margin-top:1rem;font-size:1rem}
  .wrap{max-width:1500px;margin:0 auto;padding:clamp(1.5rem,4vw,3.5rem) 1.25rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(1rem,3vw,2.5rem);align-items:start}
  @media (max-width:860px){.grid{grid-template-columns:1fr}}
  .panel{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 18px 50px -28px rgba(0,0,0,.35)}
  .tag{display:flex;align-items:center;gap:.6rem;padding:1rem 1.25rem;font-size:.74rem;letter-spacing:.22em;text-transform:uppercase;font-weight:700;border-bottom:1px solid var(--line)}
  .dot{width:9px;height:9px;border-radius:50%}
  .before .dot{background:var(--muted)} .after .dot{background:var(--accent)}
  .before .tag{color:var(--muted)} .after .tag{color:var(--accent)}
  .shot{display:block;width:100%;height:auto}
  .before .shot{filter:grayscale(.45) brightness(.97)}
  .meta{padding:.85rem 1.25rem;font-size:.82rem;color:var(--muted);border-top:1px solid var(--line);word-break:break-all}
  .cta{text-align:center;padding:clamp(2.5rem,6vw,4.5rem) 1.5rem 4rem}
  .cta h2{font-size:clamp(1.4rem,3.5vw,2.1rem);font-weight:800;letter-spacing:-.01em;max-width:22ch;margin:0 auto 1rem}
  .cta p{color:#5b5b63;max-width:46ch;margin:0 auto}
  .stamp{margin-top:1.75rem;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
</style>
</head>
<body>
  <header class="band">
    <p class="eyebrow">Website-Konzept · ${date}</p>
    <h1>${name}</h1>
    <p>Links Ihre aktuelle Seite — rechts ein neuer Entwurf. Kein Pitch, einfach zum Anschauen.</p>
  </header>

  <main class="wrap">
    <div class="grid">
      <section class="panel before">
        <div class="tag"><span class="dot"></span>Vorher</div>
        <img class="shot" src="comparison/old.jpg" alt="Aktuelle Website von ${name}" loading="lazy">
        <div class="meta">${esc(oldUrl)}</div>
      </section>
      <section class="panel after">
        <div class="tag"><span class="dot"></span>Nachher</div>
        <img class="shot" src="comparison/new.jpg" alt="Neuer Website-Entwurf für ${name}" loading="lazy">
        <div class="meta">Neuer Entwurf · responsive · schnell · für Google optimiert</div>
      </section>
    </div>
  </main>

  <section class="cta">
    <h2>Gefällt Ihnen die neue Version?</h2>
    <p>Antworten Sie einfach kurz — dann gehen wir die Details durch. Unverbindlich.</p>
    <div class="stamp">Erstellt für ${name}</div>
  </section>
</body>
</html>
`;
}

module.exports = { generateComparison, oldSiteUrl, buildComparisonHtml };
