/**
 * ui-intelligence.js — Bindet die „UI/UX Pro Max"-Design-Datenbank (uipro-Skill) in die
 * Website-Generierung ein, damit JEDE generierte Site ein datengetriebenes, distinktives
 * Design-System bekommt (67 Styles × 96 Paletten × 57 Font-Paare) statt der fixen Regex-DNA.
 *
 * Ablauf: `search.py --design-system` (im installierten Skill unter .claude/skills/ui-ux-pro-max)
 * bekommt den Business-Kontext (Branche + Schwerpunkte) und liefert Style, Palette, Typo, Effekte
 * und Anti-Patterns. Das wird auf die vorhandene DNA-Form gemappt (palette/fonts/vibe/…), sodass
 * die GESAMTE Pipeline (Startseite-Prompt + deterministische Unterseiten/Recht/Blöcke) dieselbe
 * Auswahl kohärent verwendet.
 *
 * FAIL-SAFE: Fehlt Python oder das Skill, oder scheitert der Aufruf/Parse, wird die Original-DNA
 * unverändert zurückgegeben — die Generierung läuft immer weiter (nur ohne uipro-Veredelung).
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const SKILL_DIR = path.join(__dirname, '.claude', 'skills', 'ui-ux-pro-max');
const SEARCH_PY = path.join(SKILL_DIR, 'scripts', 'search.py');

// Deutsche Builder-Kategorie → englische uipro-Suchbegriffe (die Datenbank ist englisch).
const CATEGORY_KEYWORDS = {
  kanzlei: 'law firm legal services professional trust authority',
  rechtsanwalt: 'law firm legal services professional trust authority',
  anwalt: 'law firm legal services professional trust authority',
  steuerberater: 'accounting financial services professional trust',
  notar: 'legal notary professional trust authority',
  arzt: 'healthcare medical clinic practice trust calm',
  praxis: 'healthcare medical clinic practice trust calm',
  zahnarzt: 'dental healthcare clinic modern clean',
  physiotherapie: 'healthcare wellness therapy calm',
  restaurant: 'restaurant fine dining hospitality elegant',
  cafe: 'cafe coffee cozy warm inviting',
  bar: 'bar cocktail nightlife moody premium',
  friseur: 'beauty salon hair styling elegant',
  kosmetik: 'beauty spa wellness elegant soft',
  handwerk: 'construction trades service reliable solid',
  immobilien: 'real estate property premium trust',
};

/** JSON-sicherer, schlanker Query-Bau aus dem Projekt (Branche + echte Schwerpunkte). */
function buildQuery(project = {}) {
  const cat = String(project.category || '').toLowerCase().trim();
  let base = CATEGORY_KEYWORDS[cat];
  if (!base) {
    // Scrape liefert freie Kategorien („Physiotherapiepraxis", „Rechtsanwaltskanzlei") — ersten
    // Schlüssel nehmen, der als Teilstring passt; sonst die Rohkategorie als Suchbegriff.
    const key = Object.keys(CATEGORY_KEYWORDS).find(k => cat.includes(k) || k.includes(cat));
    base = key ? CATEGORY_KEYWORDS[key] : (cat || 'professional service business');
  }
  const extras = []
    .concat(project.specialties || [], project.cuisine ? [project.cuisine] : [], project.atmosphere ? [project.atmosphere] : [])
    .filter(Boolean).slice(0, 4).join(' ');
  return `${base} ${extras}`.replace(/\s+/g, ' ').trim();
}

// ── Farb-Helfer (kein Fremd-Paket) ───────────────────────────────────────────────
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return null;
  const i = parseInt(n, 16);
  return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255 };
}
function rgbToHex({ r, g, b }) {
  const c = x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a;
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}
function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 1;
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

// ── Markdown-Parser für `search.py --design-system -f markdown` ───────────────────
function section(md, title) {
  const re = new RegExp(`###\\s+${title}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|$)`, 'i');
  const m = md.match(re);
  return m ? m[1].trim() : '';
}
function bullet(block, label) {
  const m = block.match(new RegExp(`\\*\\*${label}:?\\*\\*\\s*([^\\n]+)`, 'i'));
  return m ? m[1].trim() : '';
}

/** Rohes uipro-Markdown → strukturiertes Design-System (oder null bei Unbrauchbarkeit). */
function parseDesignSystem(md) {
  if (!md || !/###\s+Colors/i.test(md)) return null;
  const colorsBlock = section(md, 'Colors');
  const colorOf = role => {
    const m = colorsBlock.match(new RegExp(`\\|\\s*${role}\\s*\\|\\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\\s*\\|`, 'i'));
    return m ? m[1] : null;
  };
  const colors = {
    primary: colorOf('Primary'), secondary: colorOf('Secondary'), cta: colorOf('CTA'),
    background: colorOf('Background'), text: colorOf('Text'),
  };
  if (!colors.background || !colors.text || !(colors.primary || colors.cta)) return null; // Kern fehlt

  const typo = section(md, 'Typography');
  const cssImport = (typo.match(/@import url\([^)]+\)[^\n]*/) || [])[0] || '';
  const styleBlock = section(md, 'Style');
  const patternBlock = section(md, 'Pattern');
  const effects = section(md, 'Key Effects').replace(/\n+/g, ' ').trim();
  const avoid = (section(md, 'Avoid \\(Anti-patterns\\)') || section(md, 'Avoid'))
    .split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);

  return {
    pattern: { name: bullet(patternBlock, 'Name'), sections: bullet(patternBlock, 'Sections'), cta: bullet(patternBlock, 'CTA Placement'), conversion: bullet(patternBlock, 'Conversion Focus') },
    style: { name: bullet(styleBlock, 'Name'), keywords: bullet(styleBlock, 'Keywords') },
    colors,
    typography: { heading: bullet(typo, 'Heading'), body: bullet(typo, 'Body'), mood: bullet(typo, 'Mood'), cssImport },
    effects,
    antiPatterns: avoid,
  };
}

/** Font-Weights aus einer Google-Fonts-`@import`-Zeile ziehen (Fallbacks, wenn nicht vorhanden). */
function weightsFromImport(cssImport, family) {
  const m = cssImport && cssImport.match(new RegExp(`family=${String(family).replace(/\s+/g, '\\+')}:wght@([0-9;]+)`, 'i'));
  return m ? m[1] : null;
}

/**
 * uipro-Design-System → DNA-Override (gleiche Form wie design-dna.js: palette/fonts/mode/…).
 * Leitet Surface/Muted/Mode aus den 5 uipro-Farben ab (uipro liefert keine Surface/Muted-Rollen).
 */
function toDnaOverride(ds) {
  const c = ds.colors;
  const bg = c.background, text = c.text;
  const mode = luminance(bg) < 0.4 ? 'dark' : 'light';
  const surface = mode === 'dark' ? mix(bg, '#FFFFFF', 0.06) : mix(bg, '#FFFFFF', 0.7);
  const muted = mix(text, bg, 0.42);
  const accent = c.primary || c.cta;
  const heading = ds.typography.heading || 'Fraunces';
  const body = ds.typography.body || 'Inter';
  const micro = (ds.effects ? ds.effects.split(/[,;]\s*/) : []).map(s => s.trim()).filter(Boolean).slice(0, 4);
  const heroPattern = [ds.pattern.name, ds.pattern.cta].filter(Boolean).join(' · ');
  const sectionRhythm = ds.pattern.sections || '';

  return {
    name: ds.style.name || 'UI Pro Max',
    source: 'uipro',
    mode,
    palette: { bg, surface, text, muted, accent, cta: c.cta || accent, primary: c.primary || accent },
    fonts: {
      heading, body,
      headingWeights: weightsFromImport(ds.typography.cssImport, heading) || '400;600;700',
      bodyWeights: weightsFromImport(ds.typography.cssImport, body) || '400;600',
    },
    vibe: [ds.style.name, ds.style.keywords].filter(Boolean).join(' — ') || 'distinktiv, hochwertig',
    // Leere uipro-Felder WEGLASSEN (nicht undefined setzen): der Merge {...dna, ...override} würde
    // sonst vorhandene Basis-DNA-Werte mit undefined überschreiben → dnaToPrompt wirft bei
    // microDetails.map(). So überleben die Basis-DNA-Werte, wenn uipro nichts liefert.
    ...(heroPattern ? { heroPattern } : {}),
    ...(sectionRhythm ? { sectionRhythm } : {}),
    ...(micro.length ? { microDetails: micro } : {}),
    ...(Array.isArray(ds.antiPatterns) && ds.antiPatterns.length ? { antiPatterns: ds.antiPatterns } : {}),
    ...(ds.pattern.conversion ? { conversion: ds.pattern.conversion } : {}),
  };
}

/** search.py aufrufen (async, fail-safe). Gibt geparstes Design-System oder null. */
function fetchDesignSystem(project = {}, opts = {}) {
  return new Promise(resolve => {
    if (!fs.existsSync(SEARCH_PY)) return resolve(null);
    const py = opts.python || process.env.UIPRO_PYTHON || 'python3';
    const args = [SEARCH_PY, buildQuery(project), '--design-system', '-f', 'markdown', '-p', String(project.name || 'Website')];
    execFile(py, args, { timeout: opts.timeout || 15000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(parseDesignSystem(String(stdout))); } catch { resolve(null); }
    });
  });
}

/**
 * Reichert eine Basis-DNA mit dem uipro-Design-System an (fail-safe: unverändert bei Fehler).
 * Merkt sich das rohe System auf `project.uiDesign`, damit jeder spätere Lauf dieselbe Wahl
 * deterministisch (ohne erneuten Python-Aufruf) wiederverwendet → alle Seiten bleiben kohärent.
 * @returns {Promise<object>} angereicherte (oder unveränderte) DNA
 */
async function enrichDna(dna, project = {}, opts = {}) {
  try {
    // Reuse-Pfad genauso streng validieren wie den Fetch-Pfad (parseDesignSystem): ein partielles/
    // korruptes uiDesign (z. B. handeditiertes project.json) darf keine undefined-Palette erzeugen.
    const cached = project.uiDesign;
    let ds = (cached && cached.colors && cached.colors.background && cached.colors.text
      && (cached.colors.primary || cached.colors.cta)) ? cached : null;
    // reuseOnly: nur ein bereits gewähltes System anwenden, NIE neu holen — schützt Bestands-
    // projekte (ohne uiDesign) davor, nachträglich uipro-Farben zu bekommen, die nicht zur
    // alten, anders generierten Startseite passen.
    if (!ds && !opts.reuseOnly) { ds = await fetchDesignSystem(project, opts); if (ds) project.uiDesign = ds; }
    if (!ds) return dna;
    return { ...dna, ...toDnaOverride(ds) };
  } catch {
    return dna;
  }
}

/** Zusätzlicher Prompt-Block für die uipro-Extras, die die DNA-Form nicht abbildet. */
function designSystemPrompt(dna) {
  if (!dna || dna.source !== 'uipro') return '';
  const lines = ['## UI/UX PRO MAX — DATENGETRIEBENE DESIGN-DIREKTIVE (verbindlich)'];
  if (dna.palette && dna.palette.cta && dna.palette.cta !== dna.palette.accent) {
    lines.push(`CTA-Farbe (nur für primäre Buttons, bewusst kontrastreich): ${dna.palette.cta} — Akzent/Highlights: ${dna.palette.accent}.`);
  }
  if (dna.conversion) lines.push(`Conversion-Strategie: ${dna.conversion}`);
  if (Array.isArray(dna.antiPatterns) && dna.antiPatterns.length) {
    lines.push(`VERMEIDE strikt (Anti-Patterns für diesen Stil): ${dna.antiPatterns.join('; ')}.`);
  }
  return lines.join('\n');
}

// Universelle Profi-Regeln aus der uipro-SKILL.md („Common Rules" + Pre-Delivery-Checklist) —
// gelten für JEDE generierte Site, unabhängig vom gewählten Design-System.
const PROFESSIONAL_RULES = `## PROFI-UI-REGELN (UI/UX Pro Max — nicht verhandelbar)
Icons & Visuelles:
- KEINE Emojis als Icons. Nutze Inline-SVG-Icons (Heroicons/Lucide-Stil), einheitliche viewBox 24x24, konsistente Größe.
- Hover NIE über Scale-Transforms, die das Layout verschieben — nutze Farbe/Opacity/Shadow.
Interaktion:
- cursor-pointer auf ALLEN klick-/hoverbaren Elementen (Buttons, Karten, Links).
- Sichtbares Hover- UND Fokus-Feedback; Transitions 150–300ms (nie >500ms, nie instant).
Kontrast (Light Mode): Fließtext ≥ 4.5:1 (dunkles Slate #0F172A), Muted mind. #475569 — nie hellgrau-auf-weiß.
Layout: floatende/fixe Navbar mit Randabstand; Inhalt nicht hinter fixe Navbar rutschen lassen; konsistente max-width.
Barrierefreiheit: alt-Text auf sinntragenden Bildern, Labels an Formularfeldern, Farbe nie einziger Bedeutungsträger, prefers-reduced-motion respektieren.
Responsive sauber bei 375 / 768 / 1024 / 1440 px, kein horizontales Scrollen auf Mobile.`;

module.exports = {
  enrichDna, fetchDesignSystem, parseDesignSystem, toDnaOverride, buildQuery,
  designSystemPrompt, PROFESSIONAL_RULES, SEARCH_PY,
  _internal: { hexToRgb, rgbToHex, mix, luminance, weightsFromImport },
};
