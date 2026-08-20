/**
 * person-schema.js — schema.org Person/Autor-Schema für Anwalts-/Team-Profil-Unterseiten (C3, abo-frei, kein LLM).
 *
 * WARUM (E-E-A-T + GEO): Such- und AI-Antwort-Engines bewerten „Experience, Expertise, Authoritativeness,
 * Trust" pro Person. Die Profil-Unterseiten (anwaelte/<slug>.html, team/…) tragen die stärksten
 * Autoritätssignale — bisher aber komplett ohne strukturierte Daten. Dieses Modul ergänzt je Profilseite
 * deterministisch ein `Person`-Schema (jobTitle, knowsAbout = Schwerpunkte, hasCredential = Qualifikationen,
 * worksFor = Kanzlei, image, url) plus eine `BreadcrumbList` (Navigationskontext).
 *
 * Datenquelle: project.team[] (per slug an die Datei gematcht), Fallback auf den h1 der Seite.
 * Sicher gegen `</script>`-Ausbruch: JSON-LD via seo.js `jsonLdSafe` (\\u003c/\\u003e/\\u0026) — die
 * Namen/Bios stammen teils aus Scrape und sind nicht vertrauenswürdig.
 * Muster wie subpage-schema.js: reines Post-Build-Rewrite, fail-safe, idempotent.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');
const { schemaType, resolveBaseUrl, jsonLdSafe } = require('./seo');

// Profil-Detailseiten (branchenübergreifend): anwaelte/<slug>.html, team/<slug>.html …
const PROFILE_DIR_RE = /(^|\/)(anwaelte|anwalt|rechtsanwaelte|team|mitarbeiter|aerzte|aerztinnen|zahnaerzte|therapeuten)\/[^/]+\.html?$/i;
const OVERVIEW_LABEL = { anwaelte: 'Anwälte', anwalt: 'Anwälte', rechtsanwaelte: 'Rechtsanwälte', team: 'Team', mitarbeiter: 'Team', aerzte: 'Ärzte', aerztinnen: 'Ärztinnen', zahnaerzte: 'Zahnärzte', therapeuten: 'Therapeuten' };

function readSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

/** JSON-LD sicher in ein <script> serialisieren (verhindert </script>-Ausbruch). */
function jsonLdScript(obj) {
  return `<script type="application/ld+json">\n${jsonLdSafe(obj)}\n</script>`;
}

function clamp(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/** Nicht-leere String-Liste (getrimmt, dedupliziert nach Kleinschreibung). */
function cleanList(arr) {
  const seen = new Set(); const out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const s = String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

/** @type-Werte der bereits vorhandenen JSON-LD-Blöcke einer Seite. */
function existingLdTypes($) {
  const types = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try { const n = JSON.parse($(el).text()); [].concat(n['@type'] || (n['@graph'] || []).map(g => g['@type'])).forEach(t => t && types.push(t)); } catch { /* defekt → ignorieren */ }
  });
  return types;
}

/** Segment (anwaelte/team/…) aus dem Dateipfad. */
function profileSegment(rel) {
  const m = rel.match(/(^|\/)(anwaelte|anwalt|rechtsanwaelte|team|mitarbeiter|aerzte|aerztinnen|zahnaerzte|therapeuten)\//i);
  return m ? m[2].toLowerCase() : null;
}

/**
 * Ergänzt Person- + BreadcrumbList-Schema auf allen Profil-Unterseiten, die noch keins haben.
 * @param {string} projectDir
 * @param {object} project
 * @param {{baseUrl?:string}} [opts]
 * @returns {Promise<{built:boolean, reason?:string, pages?:object[], skipped?:number}>}
 */
async function buildPersonSchema(projectDir, project = {}, opts = {}) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) return { built: false, reason: 'keine index.html' };

  let baseUrl = opts.baseUrl;
  if (baseUrl === undefined) { try { baseUrl = resolveBaseUrl(project); } catch { baseUrl = ''; } }
  const root = baseUrl ? baseUrl.replace(/\/+$/, '') + '/' : '';
  const orgType = (() => { try { return schemaType(project.category); } catch { return 'Organization'; } })();
  const team = Array.isArray(project.team) ? project.team : [];
  const bySlug = new Map(team.filter(m => m && m.slug).map(m => [String(m.slug), m]));

  const pages = [];
  let skipped = 0;

  for (const file of findHtmlFiles(projectDir)) {
    const rel = path.relative(projectDir, file).split(path.sep).join('/');
    if (!PROFILE_DIR_RE.test(rel)) continue; // nur Profil-Detailseiten

    const html = readSafe(file);
    const $ = cheerio.load(html, { decodeEntities: false });
    const head = $('head');
    if (!head.length) { skipped++; continue; }

    // Idempotent UND bewusst konservativ: Trägt die Seite bereits IRGENDEIN Person-Schema
    // (unseres aus einem früheren Lauf ODER ein fremdes), überspringen wir sie — zwei
    // konkurrierende Person-Entitäten auf einer Profilseite wären mehrdeutig. Aktuell erzeugt
    // kein Pfad im Builder fremdes Person-Markup auf Profilseiten (applySEO schreibt nur die
    // Startseite, pages.js rendert Profile ohne JSON-LD), der Fall ist also derzeit nur „unser
    // 2. Lauf". Gleiches Muster wie subpage-schema.js (Skip bei vorhandenem Service/BreadcrumbList).
    if (existingLdTypes($).includes('Person')) { skipped++; continue; }

    const slug = path.basename(rel).replace(/\.html?$/i, '');
    const member = bySlug.get(slug) || {};
    const name = (member.name || $('h1').first().text() || '').replace(/\s+/g, ' ').trim();
    if (!name) { skipped++; continue; } // ohne Namen kein Person-Schema

    const seg = profileSegment(rel) || 'team';
    const pageUrl = root + rel;
    const bioText = member.bio || $('main p, article p, p').toArray().map(p => $(p).text().trim()).find(t => t.length >= 40) || '';

    const person = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name,
      url: pageUrl,
      ...(member.role ? { jobTitle: clamp(member.role, 160) } : {}),
      ...(bioText ? { description: clamp(bioText, 320) } : {}),
      ...(member.photoLocal && root ? { image: root + String(member.photoLocal).replace(/^\/+/, '') } : {}),
      worksFor: { '@type': orgType, name: project.name || 'Kanzlei', ...(root ? { url: root } : {}) },
    };
    const knows = cleanList(member.schwerpunkte && member.schwerpunkte.length ? member.schwerpunkte : project.specialties);
    if (knows.length) person.knowsAbout = knows;
    const creds = cleanList(member.qualifikationen);
    if (creds.length) person.hasCredential = creds.map(c => ({ '@type': 'EducationalOccupationalCredential', name: c }));

    const crumbLabel = OVERVIEW_LABEL[seg] || 'Team';
    const breadcrumb = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Start', item: root || '/' },
        { '@type': 'ListItem', position: 2, name: crumbLabel, item: root ? root + seg + '.html' : `/${seg}.html` },
        { '@type': 'ListItem', position: 3, name },
      ],
    };

    head.append('\n' + jsonLdScript(person) + '\n' + jsonLdScript(breadcrumb) + '\n');
    try { fs.writeFileSync(file, $.html()); pages.push({ file: rel, name, types: ['Person', 'BreadcrumbList'] }); }
    catch { skipped++; /* nicht schreibbar → als übersprungen zählen (Observability) */ }
  }

  if (pages.length === 0 && skipped === 0) return { built: false, reason: 'keine Profil-Unterseiten gefunden', pages: [], skipped };
  return { built: pages.length > 0, pages, skipped };
}

/**
 * Validiert das ergänzte Person-Schema (Person + BreadcrumbList, Pflichtfelder, valides JSON).
 * @param {string} projectDir
 * @returns {{ok:boolean, checks:object, issues:string[], stats:object}}
 */
function validatePersonSchema(projectDir) {
  const issues = [];
  let personValid = true, breadcrumbValid = true, withSchema = 0, profiles = 0;

  for (const file of findHtmlFiles(projectDir)) {
    const rel = path.relative(projectDir, file).split(path.sep).join('/');
    if (!PROFILE_DIR_RE.test(rel)) continue;
    profiles++;
    const $ = cheerio.load(readSafe(file));
    const nodes = [];
    let parseError = false;
    $('script[type="application/ld+json"]').each((i, el) => { try { nodes.push(JSON.parse($(el).text())); } catch { parseError = true; } });
    if (parseError) { issues.push(`${rel}: defektes JSON-LD`); personValid = false; }

    const person = nodes.find(n => n['@type'] === 'Person');
    const bc = nodes.find(n => n['@type'] === 'BreadcrumbList');
    if (!person && !bc) continue; // Seite ohne unser Schema (z. B. ohne Namen übersprungen)
    withSchema++;

    if (!person || !person.name || !person.worksFor || !person.worksFor.name || person['@context'] !== 'https://schema.org') {
      personValid = false; issues.push(`${rel}: Person-Schema unvollständig`);
    }
    if (person && person.hasCredential && !person.hasCredential.every(c => c['@type'] === 'EducationalOccupationalCredential' && c.name)) {
      personValid = false; issues.push(`${rel}: hasCredential unvollständig`);
    }
    if (!bc || !Array.isArray(bc.itemListElement) || bc.itemListElement.length < 2 ||
        !bc.itemListElement.every(it => it['@type'] === 'ListItem' && it.name && typeof it.position === 'number')) {
      breadcrumbValid = false; issues.push(`${rel}: BreadcrumbList unvollständig`);
    }
  }

  const checks = { person_valid: personValid, breadcrumb_valid: breadcrumbValid };
  return { ok: issues.length === 0, checks, issues, stats: { profiles, withSchema } };
}

module.exports = { buildPersonSchema, validatePersonSchema, PROFILE_DIR_RE };
