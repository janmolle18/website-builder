/**
 * subpage-schema.js — Service- + BreadcrumbList-Schema für Service-Unterseiten (C2, abo-frei, kein LLM).
 *
 * WARUM: seo.js legt strukturierte Daten (LocalBusiness/FAQ) nur auf die STARTSEITE. Die Rechtsgebiets-/
 * Leistungs-Unterseiten (rechtsgebiete/*.html, leistungen/*.html …) haben bisher KEIN Schema — obwohl
 * genau sie die spezifischen Leistungen beschreiben, die AI-Antwort-Engines (GEO) zitieren sollen.
 * Dieses Modul ergänzt deterministisch je Service-Unterseite ein `Service`-Schema (Leistung + Anbieter)
 * und eine `BreadcrumbList` (Navigationskontext) — nur wo noch keins existiert (idempotent).
 *
 * Sicher gegen `</script>`-Ausbruch: JSON-LD wird mit \\u003c/\\u003e/\\u0026 serialisiert.
 * Muster wie brand-assets.js/images-build.js: reines Post-Build-Rewrite, fail-safe, idempotent.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('./css-build');
const { schemaType, resolveBaseUrl, parseAddress } = require('./seo');

// Unterordner, die Service-/Leistungs-Detailseiten enthalten (branchenübergreifend).
const SERVICE_DIR_RE = /(^|\/)(rechtsgebiete|leistungen|services|angebot|behandlungen|fachgebiete)\/[^/]+\.html?$/i;
const OVERVIEW_LABEL = { rechtsgebiete: 'Rechtsgebiete', leistungen: 'Leistungen', services: 'Leistungen', angebot: 'Angebot', behandlungen: 'Behandlungen', fachgebiete: 'Fachgebiete' };

function readSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

/** JSON-LD sicher in ein <script> serialisieren (verhindert </script>-Ausbruch). */
function jsonLdScript(obj) {
  const json = JSON.stringify(obj, null, 2)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

function clamp(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Ort aus einer Adresse ziehen. Nutzt den robusten seo.js-Parser (verankert auf PLZ+Ort via
 * `\d{5}`), damit weder Straße noch Hausnummer fälschlich als Ort landen. Fallback auf das letzte
 * kommagetrennte Segment nur, wenn keine PLZ erkennbar ist. Gibt null zurück, wenn nichts passt.
 */
function localityFromAddress(address) {
  try {
    const loc = (parseAddress(address) || {}).addressLocality;
    if (loc && loc.trim()) return loc.trim();
  } catch { /* Fallback unten */ }
  const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
  const seg = (parts[parts.length - 1] || '').replace(/\b\d{4,5}\b/, '').trim();
  return seg || null;
}

/** @type-Werte der bereits vorhandenen JSON-LD-Blöcke einer Seite. */
function existingLdTypes($) {
  const types = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try { const n = JSON.parse($(el).text()); [].concat(n['@type'] || (n['@graph'] || []).map(g => g['@type'])).forEach(t => t && types.push(t)); } catch { /* defekt → ignorieren */ }
  });
  return types;
}

/** Segment (rechtsgebiete/leistungen/…) aus dem Dateipfad. */
function serviceSegment(rel) {
  const m = rel.match(/(^|\/)(rechtsgebiete|leistungen|services|angebot|behandlungen|fachgebiete)\//i);
  return m ? m[2].toLowerCase() : null;
}

/**
 * Ergänzt Service- + BreadcrumbList-Schema auf allen Service-Unterseiten, die noch keins haben.
 * @param {string} projectDir
 * @param {object} project
 * @param {{baseUrl?:string}} [opts]
 * @returns {Promise<{built:boolean, reason?:string, pages?:object[], skipped?:number}>}
 */
async function buildSubpageSchema(projectDir, project = {}, opts = {}) {
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) return { built: false, reason: 'keine index.html' };

  let baseUrl = opts.baseUrl;
  if (baseUrl === undefined) { try { baseUrl = resolveBaseUrl(project); } catch { baseUrl = ''; } }
  const root = baseUrl ? baseUrl.replace(/\/+$/, '') + '/' : '';
  const providerType = (() => { try { return schemaType(project.category); } catch { return 'LocalBusiness'; } })();
  const locality = localityFromAddress((project.contact || {}).address);

  const pages = [];
  let skipped = 0;

  for (const file of findHtmlFiles(projectDir)) {
    const rel = path.relative(projectDir, file).split(path.sep).join('/');
    if (!SERVICE_DIR_RE.test(rel)) continue; // nur Service-Detailseiten

    const html = readSafe(file);
    const $ = cheerio.load(html, { decodeEntities: false });
    const head = $('head');
    if (!head.length) continue;

    const already = existingLdTypes($);
    if (already.includes('Service') || already.includes('BreadcrumbList')) { skipped++; continue; }

    const name = ($('h1').first().text() || $('title').first().text().split(/[–—|]/)[0] || 'Leistung').trim();
    if (!name) { skipped++; continue; }
    const firstP = $('main p, article p, p').toArray().map(p => $(p).text().trim()).find(t => t.length >= 40);
    const description = clamp(firstP || `${name} — ${project.name || ''}`.trim(), 300);
    const seg = serviceSegment(rel) || 'leistungen';
    const pageUrl = root + rel;

    const service = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name,
      serviceType: name,
      description,
      url: pageUrl,
      provider: { '@type': providerType, name: project.name || 'Anbieter', ...(root ? { url: root } : {}) },
      ...(locality ? { areaServed: { '@type': 'Place', name: locality } } : {}),
    };

    // Breadcrumb-Label branchen-korrekt (Kanzlei „Rechtsgebiete", Praxis „Leistungen" …) — passt zur
    // sichtbaren Übersichtsseite. Lazy-require auf pages.vocab, damit keine Modul-Ladeschleife entsteht.
    const crumbName = (() => {
      try { return require('./pages').vocab(project).areas || OVERVIEW_LABEL[seg] || 'Leistungen'; }
      catch { return OVERVIEW_LABEL[seg] || 'Leistungen'; }
    })();
    const breadcrumb = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Start', item: root || '/' },
        { '@type': 'ListItem', position: 2, name: crumbName, item: root ? root + seg + '.html' : `/${seg}.html` },
        { '@type': 'ListItem', position: 3, name },
      ],
    };

    head.append('\n' + jsonLdScript(service) + '\n' + jsonLdScript(breadcrumb) + '\n');
    try { fs.writeFileSync(file, $.html()); pages.push({ file: rel, name, types: ['Service', 'BreadcrumbList'] }); }
    catch { skipped++; /* nicht schreibbar → als übersprungen zählen (Observability) */ }
  }

  if (pages.length === 0 && skipped === 0) return { built: false, reason: 'keine Service-Unterseiten gefunden', pages: [], skipped };
  return { built: pages.length > 0, pages, skipped };
}

/**
 * Validiert das ergänzte Unterseiten-Schema (Service + BreadcrumbList, Pflichtfelder, valides JSON).
 * @param {string} projectDir
 * @returns {{ok:boolean, checks:object, issues:string[], stats:object}}
 */
function validateSubpageSchema(projectDir) {
  const issues = [];
  let serviceValid = true, breadcrumbValid = true, withSchema = 0, subpages = 0;

  for (const file of findHtmlFiles(projectDir)) {
    const rel = path.relative(projectDir, file).split(path.sep).join('/');
    if (!SERVICE_DIR_RE.test(rel)) continue;
    subpages++;
    const $ = cheerio.load(readSafe(file));
    const nodes = [];
    let parseError = false;
    $('script[type="application/ld+json"]').each((i, el) => { try { nodes.push(JSON.parse($(el).text())); } catch { parseError = true; } });
    if (parseError) { issues.push(`${rel}: defektes JSON-LD`); serviceValid = false; }

    const service = nodes.find(n => n['@type'] === 'Service');
    const bc = nodes.find(n => n['@type'] === 'BreadcrumbList');
    if (!service && !bc) continue; // Seite ohne unser Schema (z.B. bewusst übersprungen)
    withSchema++;

    if (!service || !service.name || !service.provider || !service.provider.name || service['@context'] !== 'https://schema.org') {
      serviceValid = false; issues.push(`${rel}: Service-Schema unvollständig`);
    }
    if (!bc || !Array.isArray(bc.itemListElement) || bc.itemListElement.length < 2 ||
        !bc.itemListElement.every(it => it['@type'] === 'ListItem' && it.name && typeof it.position === 'number')) {
      breadcrumbValid = false; issues.push(`${rel}: BreadcrumbList unvollständig`);
    }
  }

  const checks = { service_valid: serviceValid, breadcrumb_valid: breadcrumbValid };
  return { ok: issues.length === 0, checks, issues, stats: { subpages, withSchema } };
}

module.exports = { buildSubpageSchema, validateSubpageSchema, SERVICE_DIR_RE, localityFromAddress };
