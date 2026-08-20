/**
 * Website Generator v3 — Premium Multi-Pass
 *
 * Übersetzt Lukes Workflow ("Build Premium Sites with AI") in Automatisierung:
 *   "Three rounds. Structure first. Motion second. Polish last.
 *    Don't try to nail it in one shot."
 *
 * Pass 1 — Struktur:  Sektionen, Layout, Typografie. Keine Animationen.
 * Pass 2 — Motion:    Motion-Library-Layer, Scroll-Reveals, Hero-Motion.
 * Pass 3 — Polish:    Micro-Details aus der Design-DNA, Feinschliff.
 *
 * Regelwerk: premium-rules.js (aus der CLAUDE.md des Guides)
 * Referenzen: design-dna.js (automatisierte "Phase 1: Reference")
 * Quelle: "Build Premium Sites with AI" (öffentlicher Guide).
 */

require('dotenv').config();
const { callClaude } = require('./claude-cli');
const { PREMIUM_RULES } = require('./premium-rules');
const { selectDNA, dnaToPrompt } = require('./design-dna');
const { weighText } = require('./weight');
const { enrichDna, designSystemPrompt, PROFESSIONAL_RULES } = require('./ui-intelligence');

const MODEL = process.env.GENERATOR_MODEL || 'claude-opus-4-7';

/**
 * Haupteinstieg.
 * @param {object} project  Projektdaten (name, description, menu, contact, …)
 * @param {object} opts     { dna, visual, onPhase(phase) }
 * @returns {Promise<{html: string, dna: object, passes: string[]}>}
 */
async function generateWebsite(project, opts = {}) {
  let dna = opts.dna || selectDNA(project);
  // uipro-Design-System einweben (fail-safe: DNA unverändert, wenn Python/Skill fehlt). Macht jede
  // Site datengetrieben distinktiv (67 Styles × 96 Paletten × 57 Font-Paare) statt fixer Regex-DNA.
  dna = await enrichDna(dna, project);
  const visual = opts.visual || { type: 'gradient', src: null, motionHint: 'Animierter Premium-Gradient aus der DNA-Palette.' };
  const onPhase = opts.onPhase || (() => {});
  const brief = buildBrief(project, visual, opts.navLinks || []);

  console.log(`🎨 Design-DNA: ${dna.name}${dna.source === 'uipro' ? ' (uipro)' : ''} (${dna.branch || 'generisch'}) für "${project.name}"`);

  // System-Prompt: stabile Regelwerk-Blöcke zuerst (Prompt-Cache greift über alle Pässe und Builds
  // hinweg), danach die variable DNA + optionale uipro-Direktive (Anti-Patterns, CTA, Conversion).
  const dsExtra = designSystemPrompt(dna);
  const system = [
    { type: 'text', text: PREMIUM_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: PROFESSIONAL_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dnaToPrompt(dna) + (dsExtra ? '\n\n' + dsExtra : '') }
  ];

  // ── Pass 1: Struktur ─────────────────────────────────────────────────────
  onPhase('structure');
  console.log('🏗️  Pass 1/3: Struktur…');
  const pass1 = await runPass(system, `${brief}

# AUFGABE — PASS 1 von 3: STRUKTUR
Baue die komplette Website als EINE HTML-Datei: alle Sections im DNA-Rhythmus, echte Inhalte aus dem Briefing, Typografie und Palette exakt nach DNA.

NOCH NICHT in diesem Pass: keine Scroll-Animationen, keine Motion-Library, keine Hover-Spielereien. Nur sauberes, fertiges Layout — die "Knochen" müssen stimmen. (Motion kommt in Pass 2, Feinschliff in Pass 3.)

LEISTUNGS-/RECHTSGEBIET-GRID — inhaltsgesteuertes Bento (Pflicht): KEIN symmetrisches Raster (kein grid-cols-4, keine lauter gleich großen Karten). Baue ein Bento-Grid (grid + grid-flow-dense, gemischte col-span/row-span) und setze die [GEWICHT: …]-Hinweise je Eintrag aus dem Briefing 1:1 um: dominant = große Kachel mit Überschrift, Volltext und Bulletpoints; standard = 1x1-Kachel mit Kurztext; compact = kleine Titel-Kachel oder Text-Link (nur der echte Titel, KEIN erfundener Text). So entsteht eine bewusst ungleichmäßige, redaktionelle Komposition.

Hero-Visual für diese Seite: ${describeVisual(visual)}

Gib NUR das HTML zurück, beginnend mit <!DOCTYPE html>. Kein Markdown.`);

  // ── Pass 2: Motion ───────────────────────────────────────────────────────
  onPhase('motion');
  console.log('🎬 Pass 2/3: Motion…');
  const pass2 = await runPass(system, `Hier ist die Website aus Pass 1 (Struktur steht):

\`\`\`html
${pass1}
\`\`\`

# AUFGABE — PASS 2 von 3: MOTION (reichhaltig, aber edel — nicht verspielt)
Füge eine spürbare, durchchoreografierte Scroll-Erfahrung hinzu — exakt nach Regelwerk:
1. Motion-Library (CDN) einbinden und nutzen: const { animate, inView, scroll } = Motion;
2. Hero: ${visual.motionHint} — plus dezenter Parallax/Scale-Effekt am Hero-Visual beim Scrollen (scroll-getrieben, nur transform).
3. Scroll-Reveals auf ALLE Section-Inhalte: opacity 0→1, y 24px→0, 0.7s easeOut, einmalig (inView, einmaliger Trigger).
4. STAGGER (organisch, NICHT mechanisch): in Grids/Karten-Listen (Rechtsgebiete, Team-Teaser, Werte) die Elemente versetzt einblenden — Delay leicht unregelmäßig staffeln (Jitter): delay = 60 + ((i * 37) % 90) in ms, statt konstantem linearen Versatz. So wirkt die Reveal-Welle lebendig, nicht wie ein Metronom.
5. Headline-Reveal im Hero beim Laden (Wort für Wort, 80ms Versatz).
6. Section-Übergänge: Kicker-Label/Trennlinie beim Eintreten kurz „aufziehen" (scaleX 0→1 oder width), wo es zur DNA passt.
7. Sticky/scroll-verknüpfte Akzente NUR wo tasteful (z. B. fortschreitende Linie) — niemals Layout-ruckelnd.
8. Buttons/Karten: Hover- UND Fokus-Microinteraktionen (150–250ms).
9. prefers-reduced-motion: ALLES deaktivieren, Inhalte sofort sichtbar.
10. KRITISCH: Initial-Zustände (opacity:0) NUR per JS setzen — ohne JS muss die Seite vollständig sichtbar sein.
11. Nur transform/opacity/clip-path animieren (kompositor-freundlich), kein Layout-Thrash.
12. 3D-TILT auf Key-Cards (dominante Bento-Kacheln + Hero-nahe Karten — für visuelle Tiefe ohne 3D-Library): Mausposition via Alpine tracken (x-data am Karten-Element, @mousemove berechnet rotateX/rotateY aus der relativen Cursor-Position, max. 6–8°) und ausschließlich CSS transform: perspective(800px) rotateX() rotateY() anwenden; bei @mouseleave sanft auf 0 zurückfedern (transition transform 200–300ms). KEINE schwere Library, nur transform. Bei prefers-reduced-motion komplett deaktivieren (Karte bleibt statisch). Nicht auf jede Karte legen — nur auf die hervorgehobenen.

Ändere NICHTS an Struktur, Inhalten, Texten oder Farben (das Hinzufügen von x-data/@mousemove für den Tilt ist erlaubt — es ist Teil des Motion-Layers). Gib die KOMPLETTE aktualisierte HTML-Datei zurück, beginnend mit <!DOCTYPE html>. Kein Markdown.`);

  // ── Pass 3: Polish ───────────────────────────────────────────────────────
  onPhase('polish');
  console.log('✨ Pass 3/3: Polish…');
  const pass3 = await runPass(system, `Hier ist die Website aus Pass 2 (Struktur + Motion stehen):

\`\`\`html
${pass2}
\`\`\`

# AUFGABE — PASS 3 von 3: POLISH
Der Feinschliff, der "gut" von "premium" trennt:
1. Baue alle drei Micro-Details aus der DESIGN-DNA vollständig ein (siehe System-Prompt)
2. Hover-Zustände auf ALLE interaktiven Elemente (Buttons, Links, Karten) — 150–250ms Transitions
3. Typografie-Feinschliff: Letter-Spacing der Headlines prüfen (tracking-tight), Zeilenlängen begrenzen (max-w), Hierarchie schärfen
4. Abstände harmonisieren: konsistente Section-Paddings, kein gequetschter Inhalt
5. Letzter Check gegen die ANTI-PATTERNS im Regelwerk — alles Gefundene sofort beheben
6. SEO komplettieren: title, meta description, OG-Tags, JSON-LD passend zur Branche

Ändere nichts Grundsätzliches an Layout oder Motion — nur verfeinern. Gib die KOMPLETTE finale HTML-Datei zurück, beginnend mit <!DOCTYPE html>. Kein Markdown.`);

  return { html: pass3, dna, passes: [pass1, pass2, pass3] };
}

/**
 * QA-Fix-Pass: behebt konkrete Issues aus dem Vision-Review.
 * Wird vom QA-Agent aufgerufen (max. 2 Iterationen).
 */
async function fixWebsite(html, issues, project) {
  const issueList = issues.map((i, n) =>
    `${n + 1}. [${i.severity}] ${i.where}: ${i.problem} → FIX: ${i.fix}`).join('\n');

  const system = [{ type: 'text', text: PREMIUM_RULES, cache_control: { type: 'ephemeral' } }];

  return runPass(system, `Diese Website (${project.name}) hat im visuellen QA-Review konkrete Mängel. Hier die Datei:

\`\`\`html
${html}
\`\`\`

# GEFUNDENE MÄNGEL (aus Screenshot-Review)
${issueList}

Behebe GENAU diese Mängel — wie in Lukes Workflow: nicht neu anfangen, nur das Kaputte reparieren. Alles andere unverändert lassen.
Gib die KOMPLETTE korrigierte HTML-Datei zurück, beginnend mit <!DOCTYPE html>. Kein Markdown.`);
}

// ── Claude-Helper (über das Abo, via claude-cli.js) ─────────────────────────────

/** Ein Generator-Pass: langer Output (HTML) über die Claude-CLI, HTML-Extraktion. */
async function runPass(system, userContent) {
  // System wird hier als Block-Array gebaut (PREMIUM_RULES + DNA) — für die CLI
  // zu einem reinen System-Prompt zusammenführen (Cache-Control entfällt, die CLI
  // cached intern selbst).
  const systemText = Array.isArray(system)
    ? system.map(b => b.text).join('\n\n')
    : system;

  const text = (await callClaude({ system: systemText, prompt: userContent, model: MODEL })).trim();

  const html = extractHtml(text);
  if (!html) throw new Error('Generator-Pass hat kein gültiges HTML zurückgegeben');
  return html;
}

/** HTML aus der Antwort extrahieren (Markdown-Fences + Modell-Kommentare tolerieren). */
function extractHtml(text) {
  let t = text.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('<!DOCTYPE');
  let html;
  if (start !== -1) {
    html = t.substring(start);
  } else {
    const htmlStart = t.indexOf('<html');
    if (htmlStart === -1) return null;
    html = t.substring(htmlStart);
  }
  // KRITISCH: Manche (Fix-)Pässe hängen nach/zwischen das HTML einen Markdown-Fence ```
  // + Kommentar ("Alle Mängel behoben…") an — das wurde sonst als sichtbarer Text
  // gerendert. ``` kommt in validem HTML nie vor → ab erstem Vorkommen abschneiden.
  const fence = html.indexOf('```');
  if (fence !== -1) html = html.slice(0, fence).trim();
  // sauber schließen, falls der Schnitt schließende Tags entfernt hat
  if (!/<\/html>\s*$/i.test(html)) {
    if (!/<\/body>/i.test(html)) html += '\n</body>';
    html += '\n</html>';
  }
  return html;
}

// ── Briefing aus Projektdaten ─────────────────────────────────────────────────

function buildBrief(project, visual, navLinks = []) {
  const links = project.links || {};
  const orderLinks = [];
  if (links.delivery?.includes('lieferando')) orderLinks.push({ name: 'Lieferando', url: links.delivery });
  else if (links.delivery?.includes('wolt')) orderLinks.push({ name: 'Wolt', url: links.delivery });
  else if (links.delivery?.includes('uber')) orderLinks.push({ name: 'Uber Eats', url: links.delivery });
  else if (links.delivery) orderLinks.push({ name: 'Online bestellen', url: links.delivery });
  if (links.reservation) orderLinks.push({ name: 'Reservieren', url: links.reservation });

  return `# BRIEFING
Name: ${project.name}
Branche/Kategorie: ${project.category || 'lokales Geschäft'}
Beschreibung: ${project.description || ''}
${project.cuisine ? `Küche/Angebot: ${project.cuisine}` : ''}
${project.atmosphere ? `Atmosphäre: ${project.atmosphere}` : ''}
${(project.specialties || []).length ? `Schwerpunkte/Leistungen: ${project.specialties.join(', ')}` : ''}
${project.priceLevel ? `Preisniveau: ${project.priceLevel}` : ''}
Kontakt: ${JSON.stringify(project.contact || {})}
Links: ${JSON.stringify(links)}
${orderLinks.length ? `CTA-Kandidaten (EINEN als Hero-CTA wählen, Rest in Navi/Footer): ${JSON.stringify(orderLinks)}` : 'Kein Bestell-Link — Hero-CTA ist Telefon oder Kontakt-Anker.'}
${project.about ? `\n## Über uns\n${String(project.about).slice(0, 2000)}` : ''}
${buildTeamBrief(project.team || [])}
${buildMultiPageBrief(navLinks)}

## Leistungen / Angebot (bei Gastronomie: Speisekarte)
${buildMenuStructure(project.menu || []) || 'Keine strukturierten Leistungsdaten vorhanden. NICHTS erfinden — keine Leistungen, Preise oder Beschreibungen ausdenken. Stattdessen die Sektion kompakt aus den oben genannten Schwerpunkten als schlichte Titel-Liste / kleine Kacheln bauen. Stehen auch dort keine echten Angaben: Sektion ganz weglassen und das Layout entsprechend kompakter ziehen.'}

## Fotos
${buildPhotoReferences(project.photos || [], visual) || 'Keine Fotos verfügbar.'}`;
}

/** Team-Briefing inkl. lokaler Foto-Pfade (für einen Team-Teaser auf der Startseite). */
const TEAM_BRIEF_MAX = 10; // Startseiten-Teaser: mehr Personen gehören auf anwaelte.html, nicht ins Briefing

function buildTeamBrief(team) {
  if (!team.length) return '';
  // Personen mit echtem Profil (Bio/Schwerpunkte) zuerst — die gehören in den Teaser.
  const ranked = [...team].sort((a, b) =>
    Number(Boolean((b.bio || '').trim() || (b.schwerpunkte || []).length)) -
    Number(Boolean((a.bio || '').trim() || (a.schwerpunkte || []).length)));
  const rows = ranked.slice(0, TEAM_BRIEF_MAX).map(t => {
    const photo = t.photoLocal ? ` [Foto: ${t.photoLocal}]` : ' [kein Foto → Initialen-Platzhalter]';
    const sw = (t.schwerpunkte || []).length ? ` — Schwerpunkte: ${t.schwerpunkte.slice(0, 3).join(', ')}` : '';
    return `- ${t.name}${t.role ? `, ${t.role}` : ''}${sw}${photo}`;
  }).join('\n');
  const more = team.length > TEAM_BRIEF_MAX
    ? `\n- … und ${team.length - TEAM_BRIEF_MAX} weitere Teammitglieder (vollständig auf anwaelte.html). Startseite: nur 3–4 Personen teasern und auf anwaelte.html verlinken — NICHT alle zeigen.`
    : '';
  return `\n## Team (echte Fotos lokal vorhanden — UNBEDINGT als <img> einbinden, NICHT leere Platzhalter!)\n${rows}${more}`;
}

/** Multi-Page-Direktive: Startseite muss auf die vorhandenen Unterseiten verlinken. */
function buildMultiPageBrief(navLinks) {
  if (!navLinks || !navLinks.length) return '';
  const nav = navLinks.map(l => `${l.label} → ${l.href}`).join(', ');
  return `
# MEHRSEITIGE WEBSITE (WICHTIG)
Dies ist die STARTSEITE einer mehrseitigen Site. Die Hauptnavigation (Header) MUSS auf diese echten Unterseiten verlinken (echte href, KEINE #-Anker): ${nav}.
- Baue die Startseite als überzeugende Übersicht: Hero, kurze Vorstellung, Teaser-Sektionen, die auf die Unterseiten führen (z. B. Team-Teaser mit echten Fotos → verlinkt auf anwaelte.html bzw. die einzelnen Profile unter anwaelte/<vorname-nachname>.html).
- Wiederhole NICHT die kompletten Inhalte der Unterseiten; teasere an und verlinke.
- Footer: Links zu impressum.html und datenschutz.html.`;
}

const MENU_TEXT_CAP = 2500; // Volltext pro Kategorie kappen (Prompt-Budget), aber großzügig

// Gewicht → Tailwind-Span-Hinweis für den Opus-Pass (Bento-Kachelgröße im Briefing).
const SPAN_HINT = {
  compact: '1x1 Begleitkachel / reiner Text-Link, NUR der echte Titel — KEINEN Text erfinden',
  dominant: 'md:col-span-2 md:row-span-2, mit Überschrift, vollem Text und Bulletpoints',
  standard: '1x1-Kachel mit Kurztext'
};

/**
 * Gewichtet eine Leistungs-/Rechtsgebiet-Kategorie nach Inhaltsmenge → steuert die
 * Bento-Kachelgröße im Generator-Prompt. Schwellen in weight.js (geteilt mit pages.js).
 * @param {{category?:string, fullText?:string, description?:string, items?:Array}} cat
 * @returns {{weight:'dominant'|'standard'|'compact', span:string}}
 */
function weighCategory(cat) {
  const weight = weighText(cat);
  return { weight, span: SPAN_HINT[weight] };
}

function buildMenuStructure(menu) {
  if (!menu || !menu.length) return '';
  if (Array.isArray(menu) && menu[0]?.category) {
    const total = menu.reduce((s, c) => s + ((c.items || []).length), 0);
    // Riesige Karten (Pizzeria mit 100+ Positionen): die Startseite teasert nur —
    // die vollständige Karte lebt auf speisekarte.html (eigene Unterseite).
    const compact = total > 24;
    const fmtItem = (cat, item) => {
      const price = item.price
        || (Array.isArray(item.prices) && item.prices.length
          ? `ab ${item.prices[0]}${Array.isArray(cat.sizes) && cat.sizes[0] ? ` (${cat.sizes[0]})` : ''}`
          : '');
      return `  - ${item.name}${price ? ` (${price})` : ''}${item.description ? `: ${item.description}` : ''}`;
    };
    const parts = menu.map(cat => {
      const items = cat.items || [];
      const { weight, span } = weighCategory(cat);
      const head = `**${cat.category}** (${items.length} Positionen) [GEWICHT: ${weight} → ${span}]`;
      const body = String(cat.fullText || '').trim().slice(0, MENU_TEXT_CAP);
      const shown = compact ? items.slice(0, 3) : items;
      const rows = shown.map(i => fmtItem(cat, i)).join('\n');
      const more = compact && items.length > shown.length
        ? `  - … und ${items.length - shown.length} weitere (vollständig auf speisekarte.html)` : '';
      return [head, body, rows, more].filter(Boolean).join('\n');
    });
    const directive = compact
      ? 'GROSSE SPEISEKARTE: Die Startseite zeigt NUR einen appetitmachenden Auszug (3–6 Positionen) und verlinkt prominent auf speisekarte.html — NICHT die ganze Karte auf die Startseite bauen.\n\n'
      : '';
    return directive + parts.join('\n\n');
  }
  if (Array.isArray(menu) && menu[0]?.name) {
    return menu.map(item => `- ${item.name}${item.price ? ` – ${item.price}` : ''}`).join('\n');
  }
  return JSON.stringify(menu).substring(0, 1000);
}

function buildPhotoReferences(photos, visual) {
  const usable = (photos || []).filter(p => typeof p === 'string');
  if (!usable.length) return '';
  return usable.slice(0, 8).map((p, i) => {
    const isHero = visual && visual.src === p;
    return `Foto ${i + 1}${isHero ? ' (= HERO, nicht doppelt in der Galerie verwenden)' : ''}: ${p}`;
  }).join('\n');
}

function describeVisual(visual) {
  switch (visual.type) {
    case 'video':
      return `Video-Loop "assets/hero.mp4" (Fullscreen-Background: autoplay, loop, muted, playsinline; Poster: ${visual.poster || '—'}). Overlay nicht vergessen.`;
    case 'photo':
      return `Echtes Foto als Fullscreen-Background: ${visual.src} — Overlay nicht vergessen. Motion kommt in Pass 2.`;
    case 'ai-image':
      return `Generiertes Hero-Bild "assets/hero.jpg" als Fullscreen-Background — Overlay nicht vergessen. Motion kommt in Pass 2.`;
    default:
      return `Kein Bildmaterial — baue einen animierten Premium-Gradient aus der DNA-Palette (Animation kommt in Pass 2; in diesem Pass nur die statische Gradient-Fläche).`;
  }
}

module.exports = { generateWebsite, fixWebsite, weighCategory, buildMenuStructure };
