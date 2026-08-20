/**
 * QA-Agent — das Qualitäts-Gate vor der Freigabe.
 *
 * Automatisiert den Schritt, den Lukes Workflow implizit dem Menschen überlässt:
 * draufschauen, bevor es jemand sieht. Ablauf:
 *
 *   Screenshot (Desktop + Mobile, Playwright)
 *     → Claude-Vision-Review gegen die Anti-Pattern-Checkliste (premium-rules.js)
 *     → bei "fix": konkrete Mängel an den Generator zurück (fixWebsite)
 *     → erneut screenshotten + reviewen (max. QA_MAX_FIXES Iterationen)
 *
 * Entscheidung Jan 2026-06-10: Auto-QA läuft immer, aber die finale Freigabe
 * bleibt menschlich (Dashboard, Status 'pending_review' → 'approved').
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { callClaudeVision } = require('./claude-cli');
const { QA_CHECKLIST } = require('./premium-rules');
const { fixWebsite } = require('./generator');

const MODEL = process.env.QA_MODEL || 'claude-opus-4-7';
const MAX_FIXES = parseInt(process.env.QA_MAX_FIXES || '2', 10);

// Claude-API-Limit: keine Bildkante über 8000px — lange Seiten clippen
const MAX_SHOT_HEIGHT = 7900;

/**
 * Haupteinstieg: QA-Loop für ein gebautes Projekt.
 * @param {string} url         Aufrufbare URL der Seite (localhost oder file://)
 * @param {string} projectDir  Projektordner (index.html, qa/ Screenshots, Report)
 * @param {object} project     Projektdaten (für den Fix-Pass)
 * @returns {Promise<{score:number, verdict:string, issues:[], iterations:number, screenshots:{}}>}
 */
async function runQA(url, projectDir, project, opts = {}) {
  const maxFixes = opts.maxFixes ?? MAX_FIXES;
  const qaDir = path.join(projectDir, 'qa');
  fs.mkdirSync(qaDir, { recursive: true });

  let report = null;

  for (let iteration = 0; iteration <= maxFixes; iteration++) {
    const suffix = iteration === 0 ? '' : `-fix${iteration}`;
    console.log(`🔍 QA-Review${iteration ? ` (nach Fix ${iteration})` : ''}: ${url}`);

    const shots = await takeScreenshots(url, qaDir, suffix);
    report = await reviewScreenshots(shots, project);
    report.iterations = iteration;
    report.screenshots = { desktop: path.relative(projectDir, shots.desktop), mobile: path.relative(projectDir, shots.mobile) };

    console.log(`   Score: ${report.score}/10 — ${report.verdict}${report.issues.length ? ` (${report.issues.length} Issues)` : ''}`);

    if (report.verdict === 'pass' || iteration === maxFixes) break;

    // Auto-Fix: Mängel an den Generator zurückgeben
    console.log(`🔧 Auto-Fix ${iteration + 1}/${maxFixes}: ${report.issues.map(i => i.where).join(', ')}`);
    const htmlPath = path.join(projectDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const fixed = await fixWebsite(html, report.issues, project);
    fs.writeFileSync(htmlPath, fixed);
  }

  fs.writeFileSync(path.join(qaDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

// ── Screenshots ───────────────────────────────────────────────────────────────

async function takeScreenshots(url, qaDir, suffix = '') {
  const browser = await launchBrowser();
  try {
    const shots = {};
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 }
    })) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
        // networkidle kann an Streaming-CDNs hängen — dann reicht load + Wartezeit
        await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      });
      // Fonts + Tailwind-CDN-Runtime + Motion-Initialisierung abwarten
      await page.waitForTimeout(2500);
      // Einmal komplett durchscrollen, damit Scroll-Reveals ausgelöst sind
      await page.evaluate(async () => {
        const step = window.innerHeight;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(800);

      const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const file = path.join(qaDir, `${name}${suffix}.jpg`);
      // fullPage erfasst die ganze Seite; clip nur als Deckel gegen das
      // 8000px-Bildlimit der API (clip ohne fullPage klemmt auf den Viewport!)
      const shot = { path: file, type: 'jpeg', quality: 60, fullPage: true };
      if (fullHeight > MAX_SHOT_HEIGHT) {
        shot.clip = { x: 0, y: 0, width: viewport.width, height: MAX_SHOT_HEIGHT };
      }
      await page.screenshot(shot);
      shots[name] = file;
      await page.close();
    }
    return shots;
  } finally {
    await browser.close();
  }
}

/** System-Chrome nutzen (playwright-core bringt keinen Browser mit). */
async function launchBrowser() {
  const channels = ['chrome', 'msedge', 'chrome-beta'];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch { /* nächsten Kanal probieren */ }
  }
  throw new Error('Kein Browser gefunden — Google Chrome oder Edge muss installiert sein (QA-Screenshots).');
}

// ── Vision-Review ─────────────────────────────────────────────────────────────

async function reviewScreenshots(shots, project) {
  const desktop = path.resolve(shots.desktop);
  const mobile = path.resolve(shots.mobile);

  const prompt = `Du reviewst die generierte Website für "${project.name}" (${project.category || 'lokales Geschäft'}).

Bild 1 = Desktop-Screenshot (1440px): ${desktop}
Bild 2 = Mobile-Screenshot (390px) derselben Seite: ${mobile}

${QA_CHECKLIST}`;

  const text = await callClaudeVision({
    prompt,
    imagePaths: [desktop, mobile],
    model: MODEL,
    addDir: path.dirname(desktop) // qa/-Ordner mit beiden Screenshots
  });

  return parseReport(text);
}

function parseReport(text) {
  // JSON aus der Antwort fischen (tolerant gegenüber Fences/Prosa)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { score: 5, verdict: 'fix', issues: [{ severity: 'quality', where: 'QA', problem: 'Review-Antwort nicht parsebar', fix: 'manuell prüfen' }] };
  try {
    const report = JSON.parse(match[0]);
    return {
      score: typeof report.score === 'number' ? report.score : 5,
      verdict: report.verdict === 'pass' ? 'pass' : 'fix',
      issues: Array.isArray(report.issues) ? report.issues : []
    };
  } catch {
    return { score: 5, verdict: 'fix', issues: [{ severity: 'quality', where: 'QA', problem: 'Review-JSON ungültig', fix: 'manuell prüfen' }] };
  }
}

module.exports = { runQA, takeScreenshots };
