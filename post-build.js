/**
 * post-build.js — Post-Build-Veredelung des generate-Pfads (server.js).
 *
 * WARUM: Diese sechs deterministischen, abo-freien Schritte machen aus dem rohen HTML die
 * ausgelieferte Qualität (self-hosted CSS/JS/Fonts, AVIF-Bilder, Brand-Assets, Unterseiten-Schema).
 * Eine Quelle der Wahrheit statt Inline-Schritten. Jeder Schritt ist fail-safe (wirft nicht
 * bzw. wird gefangen) und idempotent — ein zweiter Lauf ändert nichts.
 */

const { buildCss } = require('./css-build');
const { vendorBuild } = require('./vendor-build');
const { buildFonts } = require('./fonts-build');
const { buildImages } = require('./images-build');
const { buildBrandAssets } = require('./brand-assets');
const { buildSubpageSchema } = require('./subpage-schema');
const { buildPersonSchema } = require('./person-schema');

/**
 * Führt die sechs Veredelungsschritte auf einer bereits gebauten Site aus.
 * Setzt Flags auf `project` (selfHostedCss/Js/Fonts, optimizedImages, brandAssets) und loggt
 * pro Schritt. Mutiert `project`, aber niemals fatal — ein fehlgeschlagener Schritt lässt die
 * Site im Vorzustand und den Build weiterlaufen.
 * @param {string} projectDir
 * @param {object} project
 * @param {{baseUrl?:string}} [opts]
 * @returns {Promise<{steps:string[]}>}
 */
async function runPostBuildEnhancements(projectDir, project = {}, opts = {}) {
  const baseUrl = opts.baseUrl;
  const steps = [];

  // A1: Tailwind Play-CDN → selbst-gehostetes, gepurgtes CSS (Performance + DSGVO).
  try {
    const css = buildCss(projectDir);
    if (css.built) { project.selfHostedCss = true; steps.push('css'); console.log(`🎨 CSS self-hosted: ${(css.cssBytes / 1024).toFixed(1)} kB über ${css.files} Seite(n)`); }
  } catch (e) {
    console.warn('⚠️ CSS-Self-Hosting übersprungen (CDN bleibt):', e.message);
  }

  // A2: Alpine + Motion self-hosten (jsdelivr → lokale Kopie).
  try {
    const v = vendorBuild(projectDir);
    if (v.built) { project.selfHostedJs = true; steps.push('vendor'); console.log(`📦 JS self-hosted: ${v.libs.join(', ')} über ${v.files} Seite(n)`); }
  } catch (e) {
    console.warn('⚠️ JS-Self-Hosting übersprungen (CDN bleibt):', e.message);
  }

  // A3: Google Fonts self-hosten (WOFF2 + @font-face). DSGVO-Abmahn-Kern.
  try {
    const f = await buildFonts(projectDir);
    if (f.built) { project.selfHostedFonts = true; steps.push('fonts'); console.log(`🔤 Fonts self-hosted: ${f.families.join(', ')} über ${f.files} Seite(n)`); }
  } catch (e) {
    console.warn('⚠️ Font-Self-Hosting übersprungen (Google Fonts bleibt):', e.message);
  }

  // I1: Bilder → AVIF/WebP + <picture>. Fail-safe: fehlgeschlagenes Bild bleibt Original-<img>.
  try {
    const img = await buildImages(projectDir);
    if (img.built) { project.optimizedImages = true; steps.push('images'); console.log(`🖼️  Bilder optimiert: ${img.images} über ${img.files} Seite(n), −${(img.savedBytes / 1024).toFixed(1)} kB (AVIF vs. Original)`); }
  } catch (e) {
    console.warn('⚠️ Bild-Optimierung übersprungen (Originale bleiben):', e.message);
  }

  // I6: OG-Image + Favicon-Set generieren und Meta-/Favicon-Tags verdrahten.
  try {
    const brand = await buildBrandAssets(projectDir, project, { baseUrl });
    if (brand.built) { project.brandAssets = true; steps.push('brand'); console.log(`🎨 Brand-Assets: OG-Image (${(brand.ogImage.bytes / 1024).toFixed(0)} kB) + Favicon-Set, ${brand.pagesUpdated} Seite(n) verdrahtet`); }
    else if (brand.reason) console.warn('⚠️ Brand-Assets übersprungen:', brand.reason);
  } catch (e) {
    console.warn('⚠️ Brand-Assets übersprungen (Site unverändert):', e.message);
  }

  // C2: Service- + BreadcrumbList-Schema auf Service-Unterseiten ergänzen (wo keins existiert).
  try {
    const sub = await buildSubpageSchema(projectDir, project, { baseUrl });
    if (sub.built) { steps.push(`subpage-schema:${sub.pages.length}`); console.log(`🧩 Unterseiten-Schema: Service+Breadcrumb auf ${sub.pages.length} Seite(n) ergänzt${sub.skipped ? `, ${sub.skipped} übersprungen` : ''}`); }
  } catch (e) {
    console.warn('⚠️ Unterseiten-Schema übersprungen:', e.message);
  }

  // C3: Person/Autor-Schema (E-E-A-T) auf Anwalts-/Team-Profil-Unterseiten ergänzen (wo keins existiert).
  try {
    const per = await buildPersonSchema(projectDir, project, { baseUrl });
    if (per.built) { steps.push(`person-schema:${per.pages.length}`); console.log(`👤 Person-Schema (E-E-A-T): ${per.pages.length} Profil-Seite(n)${per.skipped ? `, ${per.skipped} übersprungen` : ''}`); }
  } catch (e) {
    console.warn('⚠️ Person-Schema übersprungen:', e.message);
  }

  return { steps };
}

module.exports = { runPostBuildEnhancements };
