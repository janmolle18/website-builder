require('dotenv').config();
// TLS-Prüfung bleibt AN. Falls die lokale SSL-Kette wirklich Probleme macht:
// NODE_TLS_REJECT_UNAUTHORIZED=0 gezielt in .env setzen (Sicherheitsrisiko, nur lokal).
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.warn('⚠️  TLS-Zertifikatsprüfung ist per .env DEAKTIVIERT — nur für lokale Debug-Zwecke!');
}
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { findLeads, loadLeads, saveLeads } = require('./agent-leads');
const { contactLead, updateLeadStatus, getPipelineStats, generateSalesMail } = require('./agent-sales');
const { scrapeRestaurant } = require('./agent-scraper');
const { saveInquiry, listAllTickets, updateTicketStatus, sendInquiryMail } = require('./tickets');
const { generateComparison } = require('./comparison');
const { deployProject } = require('./deploy');
const { exportProjectZip } = require('./export-zip');
const { analyzeGeo } = require('./geo');
const { analyzeA11y } = require('./a11y');
const { measureCwv } = require('./cwv');
const { syncPipelineToVault } = require('./pipeline-sync');
const { buildPremiumSite } = require('./pipeline/build-site');

const app = express();
const { PORT } = require('./lib/config');

// Kein offenes CORS: Dashboard und Vorschauen laufen same-origin. Ein offenes
// cors() würde jeder fremden Webseite erlauben, die lokalen APIs aufzurufen
// (Projekte löschen, Builds/Mails auslösen) — Drive-by-Risiko im Browser.
app.use(express.json({ limit: '2mb' }));

// Projekt-IDs sind Slugs (a-z, 0-9, Bindestrich). Alles andere (z. B. %2F → "/")
// wird abgewiesen — verhindert Path-Traversal in allen :id/:projectId-Routen.
const ID_RE = /^[a-z0-9-]+$/i;
for (const p of ['id', 'projectId']) {
  app.param(p, (req, res, next, value) => {
    if (!ID_RE.test(String(value))) return res.status(400).json({ error: 'Ungültige Projekt-ID' });
    next();
  });
}
app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/uploads', express.static('public/uploads'));
// Jedes Projekt direkt über /projects/slug/ aufrufbar
app.use('/projects', express.static(path.join(__dirname, 'projects')));

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Nur Bilder'))
});

// ── PREMIUM-PIPELINE ──────────────────────────────────────────────────────────
// Lukes Workflow automatisiert: DNA → Hero-Visual → 3 Generator-Pässe → QA-Gate.
// Endet IMMER in 'pending_review' — live geht nur, was Jan freigibt (Entscheidung 2026-06-10).


// ── PROJEKTE ──────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  const dir = path.join(__dirname, 'projects');
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonFile = path.join(dir, entry.name, 'project.json');
    if (!fs.existsSync(jsonFile)) continue;
    const d = JSON.parse(fs.readFileSync(jsonFile));
    projects.push({ id: d.id, name: d.name, createdAt: d.createdAt, status: d.status, url: d.url, leadId: d.leadId || null, previewUrl: d.previewUrl || null, deployUrl: d.deployUrl || null });
  }
  projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(projects);
});

app.get('/api/projects/:id', (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(JSON.parse(fs.readFileSync(file)));
});

// Vorher/Nachher-Asset für ein bestehendes Projekt neu erzeugen (abo-frei: nur Screenshots).
// Direkter Retry-Weg, wenn die Generierung im Build fehlschlug (project.comparisonError).
app.post('/api/projects/:id/comparison', async (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  const project = JSON.parse(fs.readFileSync(file));
  try {
    const cmp = await generateComparison(project, path.dirname(file), { newUrl: `http://localhost:${PORT}/projects/${project.id}/` });
    if (!cmp) return res.status(422).json({ error: 'Keine Alt-Website hinterlegt — nichts zu vergleichen', field: 'sourceUrl' });
    if (!cmp.ok) {
      project.comparisonError = cmp.reason;
      fs.writeFileSync(file, JSON.stringify(project, null, 2));
      return res.status(502).json({ error: cmp.reason });
    }
    project.comparisonUrl = cmp.comparisonUrl;
    project.oldSiteUrl = cmp.oldUrl;
    project.comparisonError = null;
    fs.writeFileSync(file, JSON.stringify(project, null, 2));
    res.json({ success: true, comparisonUrl: cmp.comparisonUrl, oldUrl: cmp.oldUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload', upload.array('photos', 20), (req, res) => {
  res.json({ success: true, urls: req.files.map(f => `/uploads/${f.filename}`) });
});

app.post('/api/generate', async (req, res) => {
  // Slug aus Name erzeugen: "Trattoria da Marco" → "trattoria-da-marco"
  const slug = (req.body.name || 'projekt')
    .toLowerCase().replace(/[äöüß]/g, c => ({ä:'ae',ö:'oe',ü:'ue',ß:'ss'}[c]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
    + '-' + Date.now().toString(36);

  const project = {
    id: slug,
    name: req.body.name,
    description: req.body.description,
    category: req.body.category,
    photos: req.body.photos || [],
    menu: req.body.menu || [],
    cuisine: req.body.cuisine || '',
    atmosphere: req.body.atmosphere || '',
    specialties: req.body.specialties || [],
    team: req.body.team || [],                                          // z.B. Anwälte/Ärzte (branchenübergreifend), inkl. Profil + Foto
    about: req.body.about || '',                                        // Über-uns-Text von der Alt-Seite
    legal: req.body.legal || {},                                        // verbatim Impressum/Datenschutz von der Alt-Seite
    specialtyDetails: req.body.specialtyDetails || [],                  // tiefe Fachtexte je Rechtsgebiet/Leistung (pages.js: Detailseiten)
    extraPages: req.body.extraPages || [],                              // weitere Bereiche der Alt-Site (Notare, Aktuelles, …)
    analytics: req.body.analytics || {},                               // {plausible,umami,ga4,banner} — sonst ENV-Defaults
    priceLevel: req.body.priceLevel || 'mittel',
    contact: req.body.contact || {},
    links: req.body.links || {},
    references: req.body.references || [],
    siteUrl: req.body.siteUrl || '',                                   // Kundendomain (Canonical/SEO), wenn bekannt
    sourceUrl: req.body.sourceUrl || (req.body.links && req.body.links.website) || '', // Alt-Site für Vorher/Nachher
    leadId: req.body.leadId || null,
    dnaKey: req.body.dnaKey || null,                                   // optionaler DNA-Pin (z. B. 'kanzlei-noir' für dunkel)
    createdAt: new Date().toISOString(),
    status: 'generating'
  };

  // Projektordner anlegen: projects/slug/
  const projectDir = path.join(__dirname, 'projects', slug);
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  persistScrapeReport(projectDir, project, req.body.scrapeReport); // falls vom Scrape mitgeliefert
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));

  res.json({ success: true, projectId: slug });

  try {
    await buildPremiumSite(project, projectDir, { video: !!req.body.video });

    // Falls Lead vorhanden: in Leads-Datei verknüpfen
    if (project.leadId) {
      const leads = loadLeads();
      const lead = leads.find(l => l.id === project.leadId);
      if (lead) { lead.projectId = slug; lead.websiteUrl = project.url; saveLeads(leads); }
    }
  } catch (err) {
    console.error('Generator Fehler:', err.message);
    project.status = 'error';
    project.error = err.message;
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  }
});

// ── FREIGABE (Review-Gate) ────────────────────────────────────────────────────
// Auto-QA läuft in der Pipeline, aber live geht nur, was hier freigegeben wird.

app.post('/api/projects/:id/approve', (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  const project = JSON.parse(fs.readFileSync(file));
  if (project.status !== 'pending_review' && project.status !== 'rejected') {
    return res.status(409).json({ error: `Status ist '${project.status}', erwartet 'pending_review'` });
  }
  project.status = 'approved';
  project.approvedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  console.log(`✅ Freigegeben: ${project.name}`);
  res.json({ success: true, project });
});

app.post('/api/projects/:id/reject', (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  const project = JSON.parse(fs.readFileSync(file));
  project.status = 'rejected';
  project.rejectNote = req.body.note || '';
  project.rejectedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  console.log(`❌ Abgelehnt: ${project.name}${project.rejectNote ? ` — ${project.rejectNote}` : ''}`);
  res.json({ success: true, project });
});

// Projekt komplett löschen (Ordner + Dateien). id wird sanitisiert (kein Path-Traversal).
app.delete('/api/projects/:id', (req, res) => {
  const safe = String(req.params.id).replace(/[^a-z0-9-]/gi, '');
  const dirPath = path.join(__dirname, 'projects', safe);
  if (!safe || !fs.existsSync(path.join(dirPath, 'project.json'))) {
    return res.status(404).json({ error: 'Nicht gefunden' });
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`🗑️  Projekt gelöscht: ${safe}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DEPLOY (nur freigegebene Projekte gehen live) ─────────────────────────────

app.post('/api/projects/:id/deploy', async (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  const project = JSON.parse(fs.readFileSync(file));
  if (project.status !== 'approved') {
    return res.status(409).json({ error: `Nur freigegebene Projekte gehen live (Status: '${project.status}', erwartet 'approved').` });
  }
  try {
    const projectDir = path.join(__dirname, 'projects', req.params.id);
    const { url } = await deployProject(projectDir, { prod: !!req.body.prod });
    project.deployUrl = url;
    project.deployedAt = new Date().toISOString();
    if (!project.siteUrl) project.siteUrl = url; // bis die Kundendomain verbunden ist
    fs.writeFileSync(file, JSON.stringify(project, null, 2));
    console.log(`🚀 Live: ${project.name} → ${url}`);
    res.json({
      success: true,
      url,
      note: 'Für die Kundendomain: in Vercel Domains → Add die Domain hinzufügen + DNS setzen, danach project.siteUrl/SITE_BASE_URL auf die Domain ändern und neu generieren (SEO-Canonical zeigt dann auf die Kundendomain).'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PREVIEW-LINK (Signature-Move der Akquise) ─────────────────────────────────
// Teilbarer Entwurfs-Link für Interessenten — als Vercel-PREVIEW-Deploy (ohne --prod):
//   • unerratbare URL (…-hash.vercel.app), nur wer den Link hat, sieht den Entwurf
//   • Vercel liefert Preview-Deploys automatisch mit X-Robots-Tag: noindex aus
//     → der Entwurf landet NICHT im Google-Index (wichtig vor Vertragsabschluss)
//   • .vercelignore (deploy.js) hält project.json/tickets/QA-Daten draußen
//     → keine Lead-/Kontaktdaten im öffentlich erreichbaren Entwurf
// Das Review-Gate bleibt unberührt: LIVE (--prod) geht weiterhin nur 'approved'.
// Ein Preview darf dagegen schon ab 'pending_review' raus — Jan prüft den Entwurf
// ohnehin selbst, bevor er den Link verschickt.

app.post('/api/projects/:id/preview-link', async (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  const project = JSON.parse(fs.readFileSync(file));
  const shareable = ['pending_review', 'approved', 'rejected', 'done'];
  if (!shareable.includes(project.status)) {
    return res.status(409).json({ error: `Projekt ist noch nicht fertig gebaut (Status: '${project.status}').` });
  }
  try {
    const projectDir = path.join(__dirname, 'projects', req.params.id);
    const { url } = await deployProject(projectDir, { prod: false });
    project.previewUrl = url;
    project.previewedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2));
    console.log(`🔗 Preview-Link: ${project.name} → ${url}`);
    res.json({ success: true, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── EXPORT-ZIP (Kundenpaket, abo-frei) ────────────────────────────────────────
// Fertige statische Site als ZIP zum Weitergeben — für Auslieferung über das
// bestehende Hosting des Kunden (Upload/FTP) oder als Übergabe an dessen IT.
// Interne Dateien (project.json, QA, Vorher/Nachher) werden ausgeschlossen (siehe export-zip.js).
app.get('/api/projects/:id/export', async (req, res) => {
  const projectDir = path.join(__dirname, 'projects', req.params.id);
  if (!fs.existsSync(path.join(projectDir, 'project.json'))) {
    return res.status(404).json({ error: 'Nicht gefunden' });
  }
  try {
    const { zipPath, fileName } = await exportProjectZip(projectDir);
    res.download(zipPath, fileName, (err) => {
      // Temporäres ZIP nach dem Senden entfernen — gehört nicht in den Deploy/Ordner.
      fs.rm(zipPath, { force: true }, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GEO-REPORT (abo-frei) ─────────────────────────────────────────────────────
// Bewertet deterministisch, wie AI-zitierfähig die gebaute Site ist (Score + Checkliste).
// Verkaufsargument: "Wird Ihre Kanzlei von ChatGPT empfohlen? Ich zeige es Ihnen."
app.get('/api/projects/:id/geo', (req, res) => {
  const projectDir = path.join(__dirname, 'projects', req.params.id);
  const file = path.join(projectDir, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    const project = JSON.parse(fs.readFileSync(file));
    res.json(analyzeGeo(projectDir, project));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── A11Y-REPORT (abo-frei) ────────────────────────────────────────────────────
// Deterministischer Barrierefreiheits-Report (Score + Checkliste) — ergänzt den
// Vision-QA-Pass um maschinell prüfbare A11y-Mängel.
app.get('/api/projects/:id/a11y', (req, res) => {
  const projectDir = path.join(__dirname, 'projects', req.params.id);
  if (!fs.existsSync(path.join(projectDir, 'project.json'))) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    res.json(analyzeA11y(projectDir));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CWV-REPORT (abo-frei) ─────────────────────────────────────────────────────
// Misst echte Core Web Vitals (LCP/CLS/FCP) der gebauten Site mit Playwright unter
// mobilen Bedingungen — das Qualitätsversprechen (LCP<2,5s, CLS<0,1) messbar gemacht.
app.get('/api/projects/:id/cwv', async (req, res) => {
  const projectDir = path.join(__dirname, 'projects', req.params.id);
  if (!fs.existsSync(path.join(projectDir, 'project.json'))) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    res.json(await measureCwv(projectDir));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SCRAPE-REPORT (abo-frei) ──────────────────────────────────────────────────
// Coverage-Abgleich: Was existierte auf der Alt-Site, was wurde übernommen, was
// fehlt (inkl. Team-Vollständigkeit)? Wird beim Scrape erzeugt und hier gelesen.
app.get('/api/projects/:id/scrape-report', (req, res) => {
  const file = path.join(__dirname, 'projects', req.params.id, 'scrape-report.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Kein Scrape-Report vorhanden' });
  try {
    res.json(JSON.parse(fs.readFileSync(file)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SCRAPER ───────────────────────────────────────────────────────────────────

/**
 * Scrape-Report (Coverage-Abgleich Alt-Site vs. Übernahme) persistieren:
 * Volltext als scrape-report.json im Projektordner, Kurzfassung (coverage/
 * warnings/flagged) additiv am Projekt — Dashboard/API können darauf zugreifen.
 */
function persistScrapeReport(projectDir, project, scrapeReport) {
  if (!scrapeReport) return;
  try {
    fs.writeFileSync(path.join(projectDir, 'scrape-report.json'), JSON.stringify(scrapeReport, null, 2));
    project.scrapeReport = {
      coverage: scrapeReport.coverage,
      warnings: scrapeReport.warnings,
      flagged: !!scrapeReport.flagged
    };
    if (scrapeReport.flagged) {
      console.warn(`🚩 Scrape-Coverage niedrig (${scrapeReport.coverage?.contentPagesUsedPct}%) — scrape-report.json prüfen: ${projectDir}`);
    }
  } catch (e) {
    console.warn('⚠️ Scrape-Report konnte nicht gespeichert werden:', e.message);
  }
}

// URL → alle Infos automatisch extrahieren
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL fehlt' });
  try {
    const data = await scrapeRestaurant(url);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LEADS (Agent 2) ───────────────────────────────────────────────────────────

app.get('/api/leads', (req, res) => {
  res.json(loadLeads());
});

// Lead-Suche starten (SSE für Live-Updates)
app.get('/api/leads/scan', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const city = (req.query.city || '').trim() || 'Paderborn';
  // Verticals aus der Query (?verticals=kanzlei,praxis oder ?vertical=kanzlei) —
  // leer/unbekannt/"all" → alle (in agent-leads normalisiert).
  const verticals = (req.query.verticals || req.query.vertical || '').split(',').map(v => v.trim()).filter(Boolean);
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ phase: 'start', message: `Starte Suche in ${city}...` });
    const result = await findLeads({
      city,
      verticals,
      maxResults: 120,
      onlyQualified: true,
      onProgress: (p) => send(p)
    });
    send({ phase: 'done', newLeads: result.newLeads.length, total: result.totalLeads, skipped: result.skipped, verticals: result.verticals });
  } catch (e) {
    send({ phase: 'error', message: e.message });
  }
  res.end();
});

// 1-Klick: Lead scrapen + Website generieren
app.post('/api/leads/:id/auto-build', async (req, res) => {
  const leads = loadLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nicht gefunden' });
  if (lead.projectId) return res.status(409).json({ error: 'Bereits gebaut', projectId: lead.projectId });

  const slugBase = (lead.name || 'restaurant')
    .toLowerCase().replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'restaurant';
  const slug = slugBase + '-' + Date.now().toString(36);

  const project = {
    id: slug,
    name: lead.name,
    description: `${lead.name} in ${lead.city || lead.address || ''}.`,
    category: lead.types?.includes('cafe') ? 'cafe' : lead.types?.includes('bar') ? 'bar' : 'restaurant',
    photos: [],
    menu: [],
    cuisine: lead.cuisine || '',
    atmosphere: '',
    specialties: [],
    priceLevel: 'mittel',
    contact: {
      address: lead.address,
      phone: lead.phone,
      email: lead.email || '',
      hours: lead.openingHours?.join('\n') || ''
    },
    links: { maps: lead.googleMapsUrl || '' },
    references: [],
    siteUrl: '',                          // Kundendomain bei Auto-Build noch unbekannt
    sourceUrl: lead.website || '',        // Alt-Site des Leads → Vorher/Nachher
    leadId: lead.id,
    createdAt: new Date().toISOString(),
    status: 'generating'
  };

  const projectDir = path.join(__dirname, 'projects', slug);
  try {
    fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  } catch (err) {
    return res.status(500).json({ error: 'Projektordner konnte nicht erstellt werden: ' + err.message });
  }

  res.json({ success: true, projectId: slug });

  try {
    if (lead.website) {
      // projectDir mitgeben: Google-Places-Fotos landen lokal in assets/scraped/
      // (relative Pfade in project.photos) statt als URL mit eingebettetem API-Key.
      const scraped = await scrapeRestaurant(lead.website, { projectDir });
      if (scraped.description) project.description = scraped.description;
      if (scraped.cuisine) project.cuisine = scraped.cuisine;
      if (scraped.atmosphere) project.atmosphere = scraped.atmosphere;
      if (scraped.specialties?.length) project.specialties = scraped.specialties;
      if (scraped.priceLevel) project.priceLevel = scraped.priceLevel;
      if (scraped.menu?.length) project.menu = scraped.menu;
      if (scraped.images?.length) project.photos = scraped.images.slice(0, 8);
      if (scraped.social) project.links = { ...project.links, ...scraped.social };
      // Tiefen-Content mitkopieren — ohne diese Felder fehlen Team-Seiten,
      // Rechtsgebiets-Detailseiten und Extra-Bereiche auf der neuen Site komplett.
      if (scraped.team?.length) project.team = scraped.team;
      if (scraped.about) project.about = scraped.about;
      if (scraped.legal && Object.keys(scraped.legal).length) project.legal = scraped.legal;
      if (scraped.specialtyDetails?.length) project.specialtyDetails = scraped.specialtyDetails;
      if (scraped.extraPages?.length) project.extraPages = scraped.extraPages;
      persistScrapeReport(projectDir, project, scraped.scrapeReport);
      // Stand nach Scrape sichern, damit project.json den vollen Content trägt
      fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
    }

    await buildPremiumSite(project, projectDir, { video: !!req.body.video });

    lead.projectId = slug;
    lead.websiteUrl = project.url;
    saveLeads(leads);
  } catch (err) {
    console.error('Auto-Build Fehler:', err.message);
    project.status = 'error';
    project.error = err.message;
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  }
});

// Lead direkt als Projekt-Formular vorausfüllen
app.get('/api/leads/:id/prefill', (req, res) => {
  const leads = loadLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nicht gefunden' });

  // Konvertiere Lead → Projekt-Formular-Format
  res.json({
    leadId: lead.id,
    name: lead.name,
    description: `${lead.name} ist ein Restaurant in ${lead.address}. ${lead.reviewCount} Google-Bewertungen mit ${lead.rating}/5 Sternen.`,
    category: guessCategory(lead.types),
    contact: {
      address: lead.address,
      phone: lead.phone,
      hours: lead.openingHours.join('\n')
    },
    links: {
      maps: lead.googleMapsUrl
    }
  });
});

function guessCategory(types = []) {
  if (types.includes('cafe')) return 'cafe';
  if (types.includes('bar')) return 'bar';
  if (types.includes('bakery')) return 'bakery';
  return 'restaurant';
}

// ── SALES (Agent 3) ───────────────────────────────────────────────────────────

app.get('/api/pipeline/stats', (req, res) => {
  res.json(getPipelineStats());
});

// Dashboard-Leads in die Markdown-Pipeline spiegeln (eine Quelle der Wahrheit).
app.post('/api/pipeline/sync-vault', (req, res) => {
  try {
    const r = syncPipelineToVault();
    console.log(`🔄 Pipeline → Vault gespiegelt: ${r.leadCount} Leads → ${r.path}`);
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mail-Vorschau generieren
app.post('/api/leads/:id/mail-preview', async (req, res) => {
  const leads = loadLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nicht gefunden' });

  try {
    const { subject, body } = await generateSalesMail(lead, req.body.websiteUrl || null);
    res.json({ subject, body });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mail senden
app.post('/api/leads/:id/contact', async (req, res) => {
  try {
    const result = await contactLead(req.params.id, {
      sendEmail: req.body.sendEmail || false,
      websiteUrl: req.body.websiteUrl || null,
      recipientEmail: req.body.email || null
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pipeline-Status updaten
app.patch('/api/leads/:id/status', (req, res) => {
  try {
    const lead = updateLeadStatus(req.params.id, req.body.status, req.body.note);
    res.json({ success: true, lead });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ERSTANFRAGEN / TICKETS ────────────────────────────────────────────────────
const PROJECTS_ROOT = path.join(__dirname, 'projects');

// Die Ticket-VERWALTUNG ist intern (Agentur) — NICHT für Website-Besucher. Schutz per Token:
// ADMIN_TOKEN aus .env, sonst pro Start zufällig erzeugt (wird im Log ausgegeben).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || require('crypto').randomBytes(12).toString('hex');
const ADMIN_TOKEN_GENERATED = !process.env.ADMIN_TOKEN;

function requireAdmin(req, res, next) {
  const token = req.query.key || req.get('x-admin-token');
  if (token === ADMIN_TOKEN) return next();
  res.status(403).type('html').send('<p style="font-family:system-ui;padding:2rem">403 — Kein Zugriff. Die Ticket-Verwaltung ist nur intern erreichbar (Token nötig).</p>');
}

// Einfaches Rate-Limit für das ÖFFENTLICHE Formular: max. 5 Anfragen/Minute pro IP.
// Verhindert Spam-Fluten (Disk) und Mail-Bombing über sendInquiryMail.
const INQUIRY_LIMIT = { windowMs: 60_000, max: 5 };
const inquiryHits = new Map();
function inquiryRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  const hits = (inquiryHits.get(ip) || []).filter(t => now - t < INQUIRY_LIMIT.windowMs);
  if (hits.length >= INQUIRY_LIMIT.max) {
    return res.status(429).json({ error: 'Zu viele Anfragen — bitte in einer Minute erneut versuchen.' });
  }
  hits.push(now);
  inquiryHits.set(ip, hits);
  if (inquiryHits.size > 10_000) inquiryHits.clear(); // Speicher-Notbremse
  next();
}

// Anfrage aus dem Website-Formular → Ticket speichern + (optional) Mail. ÖFFENTLICH (Formular).
app.post('/api/inquiry/:projectId', inquiryRateLimit, async (req, res) => {
  const result = saveInquiry(PROJECTS_ROOT, req.params.projectId, req.body || {});
  if (!result.ok) return res.status(result.code || 400).json({ error: result.error });
  let mail = { sent: false };
  try { mail = await sendInquiryMail(result.project, result.ticket); } catch (e) { mail = { sent: false, reason: e.message }; }
  console.log(`📨 Erstanfrage (${result.project.name}): ${result.ticket.name} <${result.ticket.email}> — Mail ${mail.sent ? 'gesendet' : 'nur gespeichert (' + (mail.reason || '') + ')'}`);
  res.json({ success: true, mailed: mail.sent });
});

app.get('/api/tickets', requireAdmin, (req, res) => res.json(listAllTickets(PROJECTS_ROOT)));

app.post('/api/tickets/:projectId/:ticketId/status', requireAdmin, (req, res) => {
  const r = updateTicketStatus(PROJECTS_ROOT, req.params.projectId, req.params.ticketId, req.body.status);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ success: true, ticket: r.ticket });
});

app.get('/tickets', requireAdmin, (req, res) => res.type('html').send(renderTicketsPage(listAllTickets(PROJECTS_ROOT), ADMIN_TOKEN)));

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const STATUS_COLOR = { neu: '#c0392b', in_bearbeitung: '#b8860b', erledigt: '#2e7d32' };

function renderTicketsPage(tickets, token) {
  const rows = tickets.map(t => `<article class="t" data-id="${escHtml(t.id)}" data-project="${escHtml(t.projectId)}">
  <div class="th"><span class="dot" style="background:${STATUS_COLOR[t.status] || '#666'}"></span>
    <strong>${escHtml(t.name)}</strong> · <a href="mailto:${escHtml(t.email)}">${escHtml(t.email)}</a>${t.phone ? ' · ' + escHtml(t.phone) : ''}
    <span class="meta">${escHtml(t.projectName || '')}${t.area ? ' · ' + escHtml(t.area) : ''} · ${new Date(t.createdAt).toLocaleString('de-DE')}</span>
  </div>
  <p class="msg">${escHtml(t.message).replace(/\n/g, '<br>')}</p>
  <div class="actions">${['neu', 'in_bearbeitung', 'erledigt'].map(s => `<button data-s="${s}" class="${t.status === s ? 'on' : ''}">${s.replace('_', ' ')}</button>`).join('')}</div>
</article>`).join('');

  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anfragen / Tickets</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f4f1;color:#16202b;padding:2rem clamp(1rem,4vw,3rem)}
  h1{font-size:1.6rem;margin:0 0 1.5rem}h1 span{color:#8a8f98;font-weight:400}
  .t{background:#fff;border:1px solid #e4e2dd;border-radius:14px;padding:1.1rem 1.3rem;margin:0 auto 1rem;max-width:780px}
  .th{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;font-size:.98rem}
  .dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:.3rem}
  .th a{color:#9c7a3c;text-decoration:none}
  .meta{flex-basis:100%;color:#8a8f98;font-size:.82rem;margin-top:.2rem}
  .msg{white-space:normal;color:#39414b;margin:.7rem 0 1rem;line-height:1.55}
  .actions button{border:1px solid #d8d5cf;background:#faf9f7;border-radius:8px;padding:.4rem .8rem;margin-right:.5rem;cursor:pointer;font:inherit;font-size:.85rem;text-transform:capitalize}
  .actions button.on{background:#16202b;color:#fff;border-color:#16202b}
  .empty{color:#8a8f98;text-align:center;margin-top:3rem}
</style></head><body>
<h1>Erstanfragen <span>(${tickets.length})</span></h1>
${tickets.length ? rows : '<p class="empty">Noch keine Anfragen.</p>'}
<script>
document.querySelectorAll('.actions button').forEach(function(b){b.addEventListener('click',function(){
  var art=b.closest('.t'),s=b.dataset.s,C={neu:'#c0392b',in_bearbeitung:'#b8860b',erledigt:'#2e7d32'};
  fetch('/api/tickets/'+art.dataset.project+'/'+art.dataset.id+'/status',{method:'POST',headers:{'content-type':'application/json','x-admin-token':${JSON.stringify(token)}},body:JSON.stringify({status:s})})
    .then(function(r){return r.json();}).then(function(){
      art.querySelectorAll('.actions button').forEach(function(x){x.classList.toggle('on',x.dataset.s===s);});
      art.querySelector('.dot').style.background=C[s];
    });
});});
</script></body></html>`;
}

// Bestehendes Projekt am selben Ort neu generieren (gleiche URL, neue Texte/Fixes).
app.post('/api/projects/:id/rebuild', (req, res) => {
  const dir = path.join(__dirname, 'projects', req.params.id);
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Nicht gefunden' });
  const project = JSON.parse(fs.readFileSync(file));
  project.status = 'generating';
  project.phase = 'visual';
  delete project.error;
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  res.json({ success: true, projectId: req.params.id });

  buildPremiumSite(project, dir, { video: !!req.body.video }).catch(err => {
    console.error('Rebuild Fehler:', err.message);
    project.status = 'error';
    project.error = err.message;
    fs.writeFileSync(file, JSON.stringify(project, null, 2));
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Restaurant Builder läuft auf http://localhost:${PORT}\n`);
  console.log(`   Dashboard:  http://localhost:${PORT}`);
  console.log(`   Tickets:    http://localhost:${PORT}/tickets?key=${ADMIN_TOKEN}  (intern, Token nötig)`);
  if (ADMIN_TOKEN_GENERATED) console.log(`   ⚠️  ADMIN_TOKEN nicht in .env gesetzt → zufälliges Token oben (ändert sich bei Neustart). Für festes Token: ADMIN_TOKEN in .env eintragen.`);
  console.log(`   Leads API:  http://localhost:${PORT}/api/leads`);
  console.log(`   Pipeline:   http://localhost:${PORT}/api/pipeline/stats\n`);
});
