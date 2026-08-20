/**
 * browser.js — gemeinsamer headless-Browser-Helfer (playwright-core).
 *
 * playwright-core bringt keinen eigenen Browser mit → wir nutzen das System-Chrome
 * (oder Edge). Derselbe Channel-Fallback wie im QA-Agent, aber zentral, damit
 * comparison.js und der Scraper-Fallback ihn teilen.
 */

const { chromium } = require('playwright-core');

const CHANNELS = ['chrome', 'msedge', 'chrome-beta'];

async function launchBrowser() {
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch { /* nächsten Kanal probieren */ }
  }
  throw new Error('Kein Browser gefunden — Google Chrome oder Edge muss installiert sein.');
}

module.exports = { launchBrowser };
