/**
 * pipeline/build-site.js — der komplette Weg von Projektdaten zur fertigen Website.
 *
 * Eine Bestellung durchläuft hier der Reihe nach: Design-System wählen,
 * Hero-Visual, Startseite generieren, deterministische SEO-/Recht-/Analytics-
 * Schichten, Unterseiten, Politur, QA, Nachveredelung und die Qualitätsberichte
 * (GEO, A11y, CWV, Self-Hosting, Bild-QA).
 *
 * Bewusst getrennt von server.js: Der Server nimmt Anfragen an, dieses Modul
 * baut. Es kennt keine Express-Objekte und lässt sich ohne laufenden Server
 * aufrufen.
 */

const fs = require('fs');
const path = require('path');
const { generateWebsite } = require('../generator');
const { selectDNA } = require('../design-dna');
const { enrichDna } = require('../ui-intelligence');
const { prepareHeroVisual } = require('../agent-visuals');
const { runQA } = require('../qa-agent');
const { applySEO, writeSeoFiles, writeDiscoveryFiles, resolveBaseUrl } = require('../seo');
const { slugify } = require('../lib/slugify');
const { writeLegalPages, injectLegalLinks } = require('../legal');
const { applyAnalytics } = require('../analytics');
const { downloadTeamPhotos, buildSubpages, planSubpages, applyTeamPhotos, fixTeamProfileLinks, applyRechtsgebiete, applyHomepageNav } = require('../pages');
const { applyPolish } = require('../polish');
const { generateFaq, injectFaq } = require('../faq');
const { resolveAssets, injectAssets } = require('../assets');
const { assembleBlocks } = require('../blocks');
const { writeLicenseManifest } = require('../licenses');
const { runPostBuildEnhancements } = require('../post-build');
const { analyzeSelfHosting } = require('../self-hosting');
const { analyzeImageQa } = require('../image-qa');
const { analyzeWeakImages } = require('../weak-images');
const { generateComparison } = require('../comparison');
const { analyzeGeo } = require('../geo');
const { analyzeA11y } = require('../a11y');
const { measureCwv } = require('../cwv');
const { PORT } = require('../lib/config');

async function buildPremiumSite(project, projectDir, opts = {}) {
  const writeState = () => fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));

  // uipro-Design-System EINMAL früh wählen (fail-safe → Original-DNA, wenn Python/Skill fehlt).
  // Muss VOR prepareHeroVisual + generateWebsite + allen deterministischen Schichten laufen, damit
  // Hero-Visual, Startseite UND Unterseiten/Recht/Politur exakt dieselbe Palette/Typo verwenden
  // (sonst: Startseite uipro-Farben, Unterseiten alte DNA = zwei kollidierende Farbwelten).
  let dna = selectDNA(project);
  dna = await enrichDna(dna, project);
  project.dna = { key: dna.key, name: dna.name, branch: dna.branch, source: dna.source || 'library' };

  project.phase = 'visual'; writeState();
  const visual = await prepareHeroVisual(project, projectDir, { video: !!opts.video, dna });
  project.heroVisual = { type: visual.type, src: visual.src };

  // Mehrseitig je nach Projektgröße: Unterseiten-Plan + Team-Fotos lokal laden,
  // damit die Startseite die echten Fotos einbinden und auf die Unterseiten verlinken kann.
  // Team-Slugs sicherstellen (Scrape liefert teils nur {name, role} ohne slug → sonst anwaelte/undefined.html).
  project.team = (project.team || []).map((t, i) =>
    (t && t.name) ? { ...t, slug: t.slug || slugify(t.name) || `anwalt-${i + 1}` } : t);

  const navLinks = planSubpages(project);
  if ((project.team || []).length) {
    try { await downloadTeamPhotos(projectDir, project.team); }
    catch (e) { console.warn('⚠️ Team-Fotos-Download übersprungen:', e.message); }
  }
  if (navLinks.length) console.log(`🗂️  Mehrseitig: ${navLinks.map(l => l.href).join(', ')}`);

  const { html } = await generateWebsite(project, {
    dna, visual, navLinks,
    onPhase: (phase) => { project.phase = phase; writeState(); }
  });

  // Deterministische SEO-Schicht: garantiert JSON-LD/OG/Canonical aus echten
  // project.json-Daten (statt Modell-Halluzination). Schreibt sitemap.xml + robots.txt.
  // baseUrl = explizite siteUrl → SITE_BASE_URL → ECHTE Kundendomain (sourceUrl) →
  // localhost. So landet NIE ein localhost-Canonical in der Auslieferung.
  const baseUrl = resolveBaseUrl(project, PORT);
  let finalHtml = html;
  try {
    const seo = applySEO(html, project, baseUrl);
    finalHtml = seo.html;
    writeSeoFiles(projectDir, project, baseUrl);
    project.seo = seo.audit;
    if (seo.audit.warnings.length) console.log(`🔎 SEO-Hinweise (${project.name}): ${seo.audit.warnings.join(' | ')}`);
  } catch (e) {
    console.warn('⚠️ SEO-Schicht übersprungen:', e.message);
    project.seo = { jsonLd: false, error: e.message };
  }

  // Rechtsseiten (Impressum/Datenschutz) aus den übernommenen Texten + Footer-Links — Pflicht für DE.
  try {
    const pages = writeLegalPages(projectDir, project, dna);
    project.legalPages = pages;
    finalHtml = injectLegalLinks(finalHtml, pages);
    console.log(Object.keys(pages).length
      ? `⚖️  Rechtsseiten: ${Object.keys(pages).join(', ')}`
      : '⚖️  Keine Rechtstexte gescrapt — Impressum/Datenschutz bitte manuell ergänzen.');
  } catch (e) {
    console.warn('⚠️ Rechtsseiten übersprungen:', e.message);
  }

  // Analytics (cookieless + GA4) + DSGVO-Consent-Banner.
  try {
    const ana = applyAnalytics(finalHtml, project, dna);
    finalHtml = ana.html;
    project.analyticsAudit = ana.audit;
    if (ana.audit.enabled) console.log(`📊 Analytics: cookieless=${ana.audit.cookieless || '-'} ga4=${ana.audit.ga4} banner=${ana.audit.banner}`);
  } catch (e) {
    console.warn('⚠️ Analytics übersprungen:', e.message);
  }

  fs.writeFileSync(path.join(projectDir, 'index.html'), finalHtml);
  project.url = `/projects/${project.id}/`;
  project.localPath = `projects/${project.id}/index.html`;

  // Mehrseitige Unterseiten (deterministisch, ohne Opus) — je nach Projektgröße.
  // Impressum/Datenschutz wurden oben bereits geschrieben (Footer-Links zeigen darauf).
  try {
    const sub = await buildSubpages(projectDir, project, dna);
    project.subpages = sub.pages;
    if (sub.pages.length) console.log(`📄 Unterseiten: ${sub.pages.join(', ')}`);
  } catch (e) {
    console.warn('⚠️ Unterseiten übersprungen:', e.message);
  }

  // GEO-Finalizer: vollständige sitemap.xml (Startseite + Rechtsseiten + Subpages),
  // AI-freundliche robots.txt und llms.txt — jetzt, da legalPages/subpages befüllt sind.
  try {
    const disc = writeDiscoveryFiles(projectDir, project, baseUrl);
    console.log(`🤖 GEO-Discovery: sitemap (${disc.urls.length} URLs) + robots + llms.txt`);
  } catch (e) {
    console.warn('⚠️ GEO-Discovery-Dateien übersprungen:', e.message);
  }

  // Deterministische Startseiten-Korrekturen (Team-Fotos, Rechtsgebiete, FAQ, Resource).
  // Läuft VOR der QA (damit die QA die FERTIGE Seite bewertet, inkl. Fotos) und nochmal
  // NACH der QA — idempotent (data-*-Marker), überlebt damit evtl. Auto-Fix-Pässe.
  const applyHomepageCorrections = async () => {
    try {
      const idxPath = path.join(projectDir, 'index.html');
      let html = fs.readFileSync(idxPath, 'utf8');
      let touched = false;
      if ((project.team || []).some(t => t && t.photoLocal)) {
        const r = applyTeamPhotos(html, project);
        if (r.replaced) { html = r.html; touched = true; console.log(`🖼️  Team-Fotos: ${r.replaced}`); }
      }
      const lk = fixTeamProfileLinks(html, project);
      if (lk.fixed) { html = lk.html; touched = true; console.log(`🔗 Team-Profil-Links korrigiert: ${lk.fixed}`); }
      const hn = applyHomepageNav(html, project);
      if (hn.added) { html = hn.html; touched = true; console.log(`🧭 Startseiten-Nav ergänzt: ${hn.added}`); }
      const rg = applyRechtsgebiete(html, project, dna);
      if (rg.changed) { html = rg.html; touched = true; console.log('⚖️  Rechtsgebiete-Section gesetzt'); }
      if (!Array.isArray(project.faq) || !project.faq.length) {
        try { project.faq = await generateFaq(project); } catch { project.faq = []; }
      }
      const fq = injectFaq(html, project, dna);
      if (fq.injected) { html = fq.html; touched = true; console.log(`❓ FAQ: ${(project.faq || []).length}`); }
      try {
        const res = await resolveAssets(project, projectDir, dna);
        const ai = injectAssets(html, res.assets);
        if (ai.html !== html) { html = ai.html; touched = true; }
        const ab = assembleBlocks(html, project, dna, res.assets);
        if (ab.injected) { html = ab.html; touched = true; console.log(`🧩 Blöcke: ${ab.injected}`); }
        if (res.records.length) { writeLicenseManifest(projectDir, res.records); project.assetRecords = res.records; }
      } catch (e) { console.warn('⚠️ Resource-Schicht übersprungen:', e.message); }
      // Auslieferungs-Politur als letzter Schritt (favicon, Skip-Link, Hero-Preload,
      // Bildmaße, CTA-Kontrast). Idempotent → unschädlich bei Vor-/Nach-QA-Doppellauf.
      try {
        const pol = applyPolish(html, { project, dna, projectDir });
        if (pol.html !== html) { html = pol.html; touched = true; console.log(`✨ Politur: ${pol.steps.join(', ')}`); }
      } catch (e) { console.warn('⚠️ Politur übersprungen:', e.message); }
      if (touched) fs.writeFileSync(idxPath, html);
    } catch (e) { console.warn('⚠️ Startseiten-Korrekturen übersprungen:', e.message); }
  };

  await applyHomepageCorrections(); // VOR der QA → QA sieht die fertige Seite

  project.phase = 'qa'; writeState();
  try {
    project.qa = await runQA(`http://localhost:${PORT}/projects/${project.id}/`, projectDir, project);
  } catch (e) {
    console.warn('⚠️ QA übersprungen:', e.message);
    project.qa = { score: null, verdict: 'skipped', issues: [], error: e.message };
  }

  await applyHomepageCorrections(); // NACH der QA → idempotent, überlebt Auto-Fix

  // GEO-Discovery erneut schreiben — JETZT ist project.faq befüllt, sodass die FAQ
  // (Answer-First) in llms.txt landen. Maximiert die Zitierbarkeit in AI-Suchen.
  try {
    writeDiscoveryFiles(projectDir, project, baseUrl);
  } catch (e) {
    console.warn('⚠️ GEO-Discovery-Neuschreiben übersprungen:', e.message);
  }

  // Post-Build-Veredelung (A1/A2/A3 self-hosting, I1 Bilder, I6 Brand-Assets, C2 Unterseiten-Schema).
  // Läuft ganz am Ende auf der finalen (korrigierten) Seite und VOR der CWV-Messung, damit die Zahlen
  // die optimierten Bilder widerspiegeln. Jeder Schritt fail-safe + idempotent.
  await runPostBuildEnhancements(projectDir, project, { baseUrl });

  // GEO-Readiness-Score in den Build/QA-Report falten — jeder Build zeigt seine
  // AI-Zitierbarkeit (deterministisch, abo-frei). Sichtbar im Dashboard + als Log.
  try {
    project.geo = analyzeGeo(projectDir, project);
    if (project.qa) project.qa.geo = { score: project.geo.score, grade: project.geo.grade };
    console.log(`🤖 GEO-Score: ${project.geo.score}/100 (Note ${project.geo.grade})`);
  } catch (e) {
    console.warn('⚠️ GEO-Score übersprungen:', e.message);
  }

  // A11y-Readiness-Score (deterministisch, abo-frei) — Barrierefreiheit als Qualitäts-
  // und Ranking-Signal. Ergänzt den Vision-QA-Pass (der Kontrast/Optik beurteilt).
  try {
    project.a11y = analyzeA11y(projectDir);
    if (project.qa) project.qa.a11y = { score: project.a11y.score, grade: project.a11y.grade };
    console.log(`♿ A11y-Score: ${project.a11y.score}/100 (Note ${project.a11y.grade})`);
  } catch (e) {
    console.warn('⚠️ A11y-Score übersprungen:', e.message);
  }

  // I3c: Self-Hosting-Guard — flaggt, wenn ein Build NICHT voll self-hostet (Fonts/CSS/JS
  // blieben auf einem CDN). Das ist der einzige Weg, wie CLS- (siehe I3b) und DSGVO-Regression
  // unbemerkt zurückkommen. Deterministisch, abo-frei.
  try {
    project.selfHosting = analyzeSelfHosting(projectDir);
    if (project.qa) project.qa.selfHosting = { score: project.selfHosting.score, grade: project.selfHosting.grade, selfHosted: project.selfHosting.selfHosted };
    if (project.selfHosting.selfHosted) {
      console.log('🔒 Self-Hosting: voll self-hosted (0 Fremd-Requests)');
    } else {
      console.warn(`⚠️ Self-Hosting UNVOLLSTÄNDIG (${project.selfHosting.score}/100): ${project.selfHosting.issues.join(' · ')}`);
    }
  } catch (e) {
    console.warn('⚠️ Self-Hosting-Check übersprungen:', e.message);
  }

  // I4: Bild-QA-Gate — misst die GEBAUTE Site auf Bildqualität (kaputte Bilder, moderne
  // Formate, responsive srcset, width/height gegen CLS, Datei-Budget, Alt-Text). Deterministisch,
  // abo-frei. Ergänzt die I1–I3-Pipeline (dort wird optimiert, hier wird gemessen/gegatet).
  try {
    project.imageQa = analyzeImageQa(projectDir);
    if (project.qa) project.qa.imageQa = { score: project.imageQa.score, grade: project.imageQa.grade };
    if (project.imageQa.issues.length) {
      console.warn(`🖼️ Bild-QA ${project.imageQa.score}/100 (Note ${project.imageQa.grade}): ${project.imageQa.issues.join(' · ')}`);
    } else {
      console.log(`🖼️ Bild-QA: ${project.imageQa.score}/100 (Note ${project.imageQa.grade})`);
    }
  } catch (e) {
    console.warn('⚠️ Bild-QA-Check übersprungen:', e.message);
  }

  // I5: Schwache-Fotos-Erkennung — misst die intrinsische Auflösung der Master-Fotos und flaggt
  // rollenbewusst zu niedrig aufgelöste (unscharfe) Scrape-Bilder. Deterministisch, abo-frei, kein LLM.
  // Ehrlich: erkennt/kennzeichnet (Upscaling ist ein separater, aktuell offener Schritt — siehe BUILD_LOG).
  try {
    project.weakImages = analyzeWeakImages(projectDir);
    if (project.qa) project.qa.weakImages = { score: project.weakImages.score, grade: project.weakImages.grade, weak: project.weakImages.stats.weak, veryWeak: project.weakImages.stats.veryWeak };
    if (project.weakImages.issues.length) {
      console.warn(`🔍 Schwache Fotos (${project.weakImages.score}/100): ${project.weakImages.issues.join(' · ')}`);
    } else {
      console.log(`🔍 Foto-Auflösung: ${project.weakImages.score}/100 (Note ${project.weakImages.grade}) — ${project.weakImages.summary}`);
    }
  } catch (e) {
    console.warn('⚠️ Schwache-Fotos-Check übersprungen:', e.message);
  }

  // B1: Echte Core Web Vitals (Playwright, abo-frei) — LCP/CLS/FCP unter mobilen
  // Bedingungen statt LLM-Bauchgefühl. Strikt lesend; bei Fehler läuft der Build weiter.
  try {
    project.cwv = await measureCwv(projectDir);
    if (project.qa) project.qa.cwv = { score: project.cwv.score, grade: project.cwv.grade, lcpMs: project.cwv.metrics?.lcpMs ?? null, cls: project.cwv.metrics?.cls ?? null };
    const m = project.cwv.metrics;
    console.log(m
      ? `⚡ CWV: LCP ${(m.lcpMs / 1000).toFixed(2)}s · CLS ${m.cls} · Score ${project.cwv.score}/100 (Note ${project.cwv.grade})`
      : `⚡ CWV: ${project.cwv.summary}`);
  } catch (e) {
    console.warn('⚠️ CWV-Messung übersprungen:', e.message);
  }

  // Vorher/Nachher-Artefakt — nur wenn das Alt-Business eine Website hatte (sourceUrl).
  try {
    const cmp = await generateComparison(project, projectDir, { newUrl: `http://localhost:${PORT}/projects/${project.id}/` });
    if (cmp && cmp.ok) {
      project.comparisonUrl = cmp.comparisonUrl;
      project.oldSiteUrl = cmp.oldUrl;
      project.comparisonError = null;
      writeState();
      console.log(`🆚 Vorher/Nachher: http://localhost:${PORT}${cmp.comparisonUrl}`);
    } else if (cmp && !cmp.ok) {
      // Nicht still verschlucken: Grund merken → im Dashboard nachziehbar (Regen-Button/-Endpoint).
      project.comparisonError = cmp.reason;
      writeState();
      console.warn('⚠️ Vorher/Nachher gescheitert:', cmp.reason);
    }
  } catch (e) {
    console.warn('⚠️ Vorher/Nachher übersprungen:', e.message);
  }

  project.status = 'pending_review';
  project.phase = 'review';
  writeState();
  console.log(`👀 Zur Freigabe: ${project.name} → http://localhost:${PORT}/projects/${project.id}/ (QA ${project.qa.score ?? '—'}/10)`);
  return project;
}

module.exports = { buildPremiumSite };
