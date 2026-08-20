const { test } = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../ui-intelligence');
const { dnaToPrompt } = require('../design-dna');

// Fixe uipro-Ausgabe (echtes `search.py --design-system -f markdown` für eine Kanzlei) —
// so ist der Parser-/Mapping-Test deterministisch und braucht KEIN Python.
const SAMPLE = `## Design System: Kanzlei Test

### Pattern
- **Name:** Hero + Testimonials + CTA
- **Conversion Focus:** Social proof before CTA. Use 3-5 testimonials.
- **CTA Placement:** Hero (sticky) + Post-testimonials
- **Color Strategy:** Hero: Brand color. CTA: Vibrant
- **Sections:** 1. Hero, 2. Problem statement, 3. Solution overview, 4. Testimonials, 5. CTA

### Style
- **Name:** Trust & Authority
- **Keywords:** Certificates/badges displayed, expert credentials, case studies
- **Best For:** legal services
- **Performance:** ⚡ Excellent | **Accessibility:** ✓ WCAG AAA

### Colors
| Role | Hex |
|------|-----|
| Primary | #1E3A8A |
| Secondary | #1E40AF |
| CTA | #B45309 |
| Background | #F8FAFC |
| Text | #0F172A |

*Notes: Authority navy + trust gold*

### Typography
- **Heading:** EB Garamond
- **Body:** Lato
- **Mood:** legal, professional, traditional
- **CSS Import:**
\`\`\`css
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Lato:wght@300;400;700&display=swap');
\`\`\`

### Key Effects
Badge hover effects, metric pulse animations, certificate carousel, smooth stat reveal

### Avoid (Anti-patterns)
- Outdated design
- Hidden credentials
- AI purple/pink gradients
`;

test('parseDesignSystem: extrahiert Farben, Typo, Style, Anti-Patterns', () => {
  const ds = ui.parseDesignSystem(SAMPLE);
  assert.ok(ds, 'geparst');
  assert.equal(ds.colors.primary, '#1E3A8A');
  assert.equal(ds.colors.cta, '#B45309');
  assert.equal(ds.colors.background, '#F8FAFC');
  assert.equal(ds.colors.text, '#0F172A');
  assert.equal(ds.typography.heading, 'EB Garamond');
  assert.equal(ds.typography.body, 'Lato');
  assert.equal(ds.style.name, 'Trust & Authority');
  assert.deepEqual(ds.antiPatterns, ['Outdated design', 'Hidden credentials', 'AI purple/pink gradients']);
  assert.match(ds.pattern.name, /Hero \+ Testimonials/);
});

test('parseDesignSystem: unbrauchbarer Input → null (fail-safe)', () => {
  assert.equal(ui.parseDesignSystem(''), null);
  assert.equal(ui.parseDesignSystem('irgendein Text ohne Farben'), null);
  assert.equal(ui.parseDesignSystem('### Colors\n| Role | Hex |\n(keine Farben)'), null);
});

test('toDnaOverride: mappt uipro-System auf die DNA-Form + leitet Surface/Muted/Mode ab', () => {
  const dna = ui.toDnaOverride(ui.parseDesignSystem(SAMPLE));
  assert.equal(dna.source, 'uipro');
  assert.equal(dna.mode, 'light', 'heller Hintergrund → light');
  assert.equal(dna.palette.bg, '#F8FAFC');
  assert.equal(dna.palette.text, '#0F172A');
  assert.equal(dna.palette.accent, '#1E3A8A', 'Akzent = Primary');
  assert.equal(dna.palette.cta, '#B45309', 'CTA separat erhalten');
  assert.match(dna.palette.surface, /^#[0-9a-f]{6}$/i);
  assert.match(dna.palette.muted, /^#[0-9a-f]{6}$/i);
  // Surface heller als bg (Richtung Weiß), Muted zwischen Text und bg.
  assert.ok(ui._internal.luminance(dna.palette.surface) >= ui._internal.luminance(dna.palette.bg));
  const lm = ui._internal.luminance(dna.palette.muted);
  assert.ok(lm > ui._internal.luminance(dna.palette.text) && lm < ui._internal.luminance(dna.palette.bg), 'Muted liegt zwischen Text und bg');
  assert.equal(dna.fonts.heading, 'EB Garamond');
  assert.equal(dna.fonts.headingWeights, '400;500;600;700', 'Weights aus @import geparst');
  assert.equal(dna.fonts.bodyWeights, '300;400;700');
  assert.ok(Array.isArray(dna.microDetails) && dna.microDetails.length >= 3, 'Effekte → microDetails');
});

test('Farb-Helfer: mix + luminance plausibel', () => {
  const { mix, luminance, hexToRgb } = ui._internal;
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(hexToRgb('nonsense'), null);
  assert.ok(luminance('#ffffff') > 0.9 && luminance('#000000') < 0.05);
});

test('buildQuery: deutsche Kategorie → englische uipro-Keywords + Schwerpunkte', () => {
  const q = ui.buildQuery({ category: 'kanzlei', specialties: ['Arbeitsrecht', 'Erbrecht'] });
  assert.match(q, /law firm/);
  assert.match(q, /Arbeitsrecht/);
  // Unbekannte Kategorie fällt durch, ohne zu werfen.
  assert.match(ui.buildQuery({ category: 'seltsam' }), /seltsam/);
  // Freie Scrape-Kategorien matchen per Teilstring (echte Scrapes liefern zusammengesetzte Wörter).
  assert.match(ui.buildQuery({ category: 'Physiotherapiepraxis' }), /healthcare|therapy|wellness/);
  assert.match(ui.buildQuery({ category: 'Rechtsanwaltskanzlei' }), /law firm|legal/);
});

test('designSystemPrompt: rendert Anti-Patterns + CTA nur bei uipro-Quelle', () => {
  const dna = ui.toDnaOverride(ui.parseDesignSystem(SAMPLE));
  const p = ui.designSystemPrompt(dna);
  assert.match(p, /Anti-Patterns/i);
  assert.match(p, /#B45309/);
  assert.equal(ui.designSystemPrompt({ source: 'library' }), '', 'nicht-uipro → leer');
});

test('enrichDna: reuseOnly wendet vorhandenes uiDesign an, holt aber nie neu', async () => {
  const base = { name: 'Basis', branch: 'kanzlei', palette: { bg: '#111', surface: '#222', text: '#eee', muted: '#999', accent: '#abc' }, fonts: { heading: 'A', body: 'B' } };
  // Mit vorab gewähltem System → wird angewandt (ohne Python).
  const project = { name: 'X', uiDesign: ui.parseDesignSystem(SAMPLE) };
  const enriched = await ui.enrichDna({ ...base }, project, { reuseOnly: true });
  assert.equal(enriched.source, 'uipro');
  assert.equal(enriched.palette.accent, '#1E3A8A');
  assert.equal(enriched.branch, 'kanzlei', 'DNA-Felder ohne uipro-Pendant bleiben erhalten');
  // reuseOnly OHNE uiDesign → Original-DNA unverändert (kein Fetch, kein source).
  const untouched = await ui.enrichDna({ ...base }, { name: 'Y' }, { reuseOnly: true });
  assert.equal(untouched.source, undefined);
  assert.equal(untouched.palette.accent, '#abc');
});

test('PROFESSIONAL_RULES enthält die Kern-Profi-Regeln', () => {
  assert.match(ui.PROFESSIONAL_RULES, /KEINE Emojis als Icons/);
  assert.match(ui.PROFESSIONAL_RULES, /cursor-pointer/);
  assert.match(ui.PROFESSIONAL_RULES, /prefers-reduced-motion/);
});

// Regression (Review HIGH 2): uipro ohne Effekte darf die Basis-DNA nicht mit undefined überschreiben.
test('toDnaOverride: leere Key-Effects lassen microDetails WEG (Basis-DNA überlebt, dnaToPrompt wirft nicht)', () => {
  const noEffects = ui.parseDesignSystem(SAMPLE.replace(/### Key Effects[\s\S]*?\n\n/, ''));
  const override = ui.toDnaOverride(noEffects);
  assert.ok(!('microDetails' in override), 'microDetails wird bei leeren Effekten weggelassen (nicht undefined)');
  const base = { name: 'B', mode: 'light', vibe: 'v', heroPattern: 'h', sectionRhythm: 's',
    palette: { bg: '#fff', surface: '#fff', text: '#000', muted: '#888', accent: '#123' },
    fonts: { heading: 'A', body: 'B', headingWeights: '400', bodyWeights: '400' }, microDetails: ['a', 'b', 'c'] };
  const merged = { ...base, ...override };
  assert.deepEqual(merged.microDetails, ['a', 'b', 'c'], 'Basis-microDetails bleiben erhalten');
  assert.doesNotThrow(() => dnaToPrompt(merged), 'dnaToPrompt wirft nicht auf der gemergten DNA');
});

// Regression (Review LOW): 3-stelliges Hex wird korrekt expandiert.
test('hexToRgb: 3-stelliges Hex expandiert korrekt', () => {
  assert.deepEqual(ui._internal.hexToRgb('#abc'), { r: 170, g: 187, b: 204 });
  assert.equal(ui._internal.mix('#000', '#fff', 0.5), '#808080');
});

// Regression (Review LOW): der Fail-Safe-Kontrakt, auf den generator.js baut — Subprozess-Fehler → Original-DNA.
test('enrichDna: Subprozess-Fehler (unauffindbares Binary) → unveränderte Original-DNA', async () => {
  const base = { name: 'Basis', palette: { bg: '#111', surface: '#222', text: '#eee', muted: '#999', accent: '#abc' }, fonts: {} };
  const out = await ui.enrichDna({ ...base }, { name: 'X', category: 'kanzlei' }, { python: 'definitely-no-such-binary-xyz-123' });
  assert.equal(out.source, undefined, 'kein uipro angewandt');
  assert.equal(out.palette.accent, '#abc', 'Original-DNA unverändert');
});

// Gegateter Integrationstest: nutzt das echte search.py NUR, wenn Python + Skill vorhanden.
// Beweist robust die „keine identischen Sites"-Eigenschaft: über mehrere Branchen entstehen
// MEHRERE verschiedene Paletten (kein Vergleich zweier fixer Kategorien, die zufällig kollidieren
// könnten — uipros Fuzzy-Scoring ist keywordabhängig).
test('Integration (falls Python da): verschiedene Branchen → mehrere verschiedene Paletten', async () => {
  const probe = await ui.fetchDesignSystem({ name: 'K', category: 'kanzlei', specialties: ['Arbeitsrecht'] });
  if (!probe) { console.log('  (übersprungen — Python/uipro nicht verfügbar)'); return; }

  const branches = [
    { name: 'K', category: 'kanzlei', specialties: ['Arbeitsrecht'] },
    { name: 'R', category: 'restaurant', cuisine: 'italienisch', atmosphere: 'warm' },
    { name: 'C', category: 'cafe' },
    { name: 'Z', category: 'zahnarzt' },
    { name: 'F', category: 'friseur' },
  ];
  const systems = [];
  for (const b of branches) systems.push(await ui.fetchDesignSystem(b));
  for (const s of systems) assert.ok(s && s.colors.background && s.colors.text, 'jedes System vollständig');

  const distinctPrimaries = new Set(systems.map(s => s.colors.primary));
  assert.ok(distinctPrimaries.size >= 2, `Varianz erwartet, aber alle gleich: ${[...distinctPrimaries].join(',')}`);
  // Und die abgeleiteten DNA-Overrides sind valide Hex-Paletten.
  for (const s of systems) {
    const dna = ui.toDnaOverride(s);
    assert.match(dna.palette.bg, /^#[0-9a-f]{6}$/i);
    assert.match(dna.palette.accent, /^#[0-9a-f]{3,6}$/i);
  }
});
