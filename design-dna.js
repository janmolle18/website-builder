/**
 * Referenz-DNA-Bibliothek — automatisierte Entsprechung von Lukes "Phase 1: Reference".
 *
 * Statt dass ein Mensch 20 Minuten Pinterest/Behance/Dribbble durchsucht, liegt hier
 * pro Branche × Vibe eine kuratierte Design-DNA: Palette, Typo-Paar, Hero-Pattern,
 * Section-Rhythmus und 2–3 Micro-Details (die "gestohlenen" Referenz-Details aus Runde 3).
 *
 * Entscheidung Jan 2026-06-10: branchenübergreifend von Anfang an (nicht nur Restaurants).
 * Alle Fonts sind über Google Fonts ladbar (Output ist eine HTML-Datei ohne Build-Step).
 */

const DNA = {
  // ── GASTRONOMIE ─────────────────────────────────────────────────────────────
  'resto-elegant-dark': {
    branches: ['restaurant', 'bar'],
    match: /fine.?dining|gehoben|exklusiv|premium|gourmet|steak|sushi|weinbar|cocktail/,
    name: 'Elegant Dark',
    vibe: 'luxuriös, stimmungsvoll, exklusiv — Fine Dining nach Einbruch der Dunkelheit',
    mode: 'dark',
    palette: { bg: '#0B0A08', surface: '#15130F', text: '#F5F1E8', muted: '#9C9588', accent: '#C9A961' },
    fonts: { heading: 'Cormorant Garamond', body: 'Manrope', headingWeights: '500;600', bodyWeights: '400;600' },
    heroPattern: 'Vollbild-Hintergrund, Text unten links ausgerichtet (nicht zentriert), viel Negativraum oben',
    sectionRhythm: 'Vollbild-Hero → schmaler Intro-Text mit großem Zitat → Split-Screen Über-uns → full-width Speisekarte → Galerie-Strip → Kontakt dunkel',
    microDetails: [
      'Hauchdünne goldene Trennlinien (1px, 40% Opacity) zwischen Sections',
      'Preise in der Akzentfarbe mit Tabular-Ziffern, per Punktlinie mit dem Gericht verbunden',
      'Headline-Wörter faden nacheinander ein (80ms Versatz)'
    ]
  },
  'resto-fresh-minimal': {
    branches: ['restaurant', 'cafe', 'bakery'],
    match: /café|cafe|brunch|frühstück|vegan|vegetarisch|bio|healthy|bowl|juice|bäcker|konditorei/,
    name: 'Fresh Minimal',
    vibe: 'frisch, hell, editorial — Morgenlicht im Lieblingscafé',
    mode: 'light',
    palette: { bg: '#F8F6F1', surface: '#FFFFFF', text: '#1A1A14', muted: '#6B6A5E', accent: '#3D6B35' },
    fonts: { heading: 'Fraunces', body: 'Inter', headingWeights: '500;600', bodyWeights: '400;500' },
    heroPattern: 'Split-Screen: links riesige Serif-Headline + CTA, rechts Foto/Visual randlos bis zur Kante',
    sectionRhythm: 'Split-Hero → Marquee mit Spezialitäten → asymmetrisches Über-uns (Bild versetzt) → Karte als Grid mit viel Luft → Öffnungszeiten groß → heller Footer',
    microDetails: [
      'Kursive Serif-Akzente in Headlines (einzelne Wörter italic)',
      'Unterstreichungen, die bei Hover von links nach rechts wachsen',
      'Sanfte Ken-Burns-Bewegung auf allen Fotos'
    ]
  },
  'resto-bold-street': {
    branches: ['restaurant'],
    match: /burger|pizza|döner|asiatisch|street|fast|take.?away|wok|taco|ramen|grill.?haus/,
    name: 'Bold Street',
    vibe: 'laut, urban, appetitanregend — Neonlicht und Pappkarton',
    mode: 'dark',
    palette: { bg: '#0F0D0A', surface: '#1A1611', text: '#F7F3EC', muted: '#A39A8C', accent: '#FF5C1F' },
    fonts: { heading: 'Archivo Black', body: 'Inter', headingWeights: '400', bodyWeights: '400;600' },
    heroPattern: 'Riesige Headline (Uppercase, fast viewport-breit) ÜBER dem angeschnittenen Hero-Foto, Foto läuft hinter dem Text weiter',
    sectionRhythm: 'Typo-Hero → dicker Bestell-Banner → Karte als kräftige Kacheln → Über-uns kurz und frech → Footer mit großem Logo',
    microDetails: [
      'Headline-Wörter mit leichtem Versatz/Rotation (1-2°) für Sticker-Optik',
      'Hover auf Karten-Kacheln: Foto zoomt, Preis-Badge kippt leicht',
      'Akzentfarbene Marquee-Laufzeile mit Spezialitäten zwischen Sections'
    ]
  },
  'resto-warm-rustic': {
    branches: ['restaurant'],
    match: /landgasthof|gasthaus|traditionell|deutsch|heimat|rustikal|grill|bbq|brauhaus|wirtshaus/,
    name: 'Warm Rustic',
    vibe: 'gemütlich, authentisch, handwerklich — Holztisch und Kaminfeuer',
    mode: 'light',
    palette: { bg: '#F6F1E8', surface: '#FFFDF8', text: '#2B2218', muted: '#7A6E5D', accent: '#A0522D' },
    fonts: { heading: 'Lora', body: 'Source Sans 3', headingWeights: '500;600', bodyWeights: '400;600' },
    heroPattern: 'Vollbild-Foto mit warmem Overlay, Text zentriert-niedrig, darunter einladende Bogen-Kante zur nächsten Section',
    sectionRhythm: 'Foto-Hero → Geschichte des Hauses mit großem Zitat → Karte klassisch zweispaltig → Stuben/Galerie → Anfahrt + Zeiten',
    microDetails: [
      'Leicht strukturierter Papier-Hintergrund (subtiles CSS-Noise)',
      'Handgezeichnete dünne Trennornamente (SVG-Linien) zwischen Karten-Kategorien',
      'Warme Schatten (braun getönt statt grau)'
    ]
  },
  'resto-mediterran': {
    branches: ['restaurant'],
    match: /griechisch|italienisch|spanisch|mediterran|tapas|pasta|trattoria|taverna|osteria/,
    name: 'Mediterran',
    vibe: 'sonnig, entspannt, genussvoll — Nachmittag an der Küste',
    mode: 'light',
    palette: { bg: '#FAF7F0', surface: '#FFFFFF', text: '#1E2A38', muted: '#64707E', accent: '#1F5F8B' },
    fonts: { heading: 'Cormorant Garamond', body: 'Raleway', headingWeights: '500;600', bodyWeights: '400;500' },
    heroPattern: 'Vollbild-Foto, Headline groß zentriert mit viel Tracking, darunter ein einzelnes Schmuckelement',
    sectionRhythm: 'Foto-Hero → Antipasti-Intro mit Bildern inline → Karte mit Tab-Navigation → Wein/Spezialitäten-Highlight quer → Galerie → Kontakt',
    microDetails: [
      'Dünne Doppellinien als Section-Rahmen (klassische Speisekarten-Optik)',
      'Bilder mit sanft abgerundeten Bögen oben (Arch-Form)',
      'Dezente Wellen-Trennlinie (SVG) zwischen hellen Sections'
    ]
  },

  // ── BEAUTY & KÖRPER ─────────────────────────────────────────────────────────
  'beauty-editorial': {
    branches: ['friseur', 'beauty', 'kosmetik', 'nagelstudio', 'barbershop'],
    match: /friseur|salon|barber|beauty|kosmetik|nagel|lashes|brows|makeup|haar/,
    name: 'Beauty Editorial',
    vibe: 'editorial, selbstbewusst, Magazin-Cover — Vogue für den Salon',
    mode: 'light',
    palette: { bg: '#F7F4F0', surface: '#FFFFFF', text: '#191613', muted: '#6E675F', accent: '#B0654A' },
    fonts: { heading: 'Fraunces', body: 'Manrope', headingWeights: '400;600', bodyWeights: '400;500' },
    heroPattern: 'Riesige Editorial-Headline (Serif, 2 Zeilen, Wörter versetzt), Foto asymmetrisch rechts überlappend',
    sectionRhythm: 'Typo-Hero → Leistungen als nummerierte Editorial-Liste (01/02/03) → Team mit großen Portraits → Preisliste minimalistisch → Termin-CTA vollflächig → Footer',
    microDetails: [
      'Nummerierte Leistungen mit riesigen Ziffern in 8% Opacity dahinter',
      'Portraits in schmalen Hochformat-Crops mit Hover-Zoom',
      'Termin-Button mit sanftem Puls-Glow in Akzentfarbe'
    ]
  },
  'fitness-energy': {
    branches: ['fitness', 'sport', 'yoga', 'physio'],
    match: /fitness|gym|crossfit|yoga|pilates|personal.?train|physio|sport|kampfsport|tanz/,
    name: 'Fitness Energy',
    vibe: 'kraftvoll, fokussiert, vorwärts — Halle um 6 Uhr morgens',
    mode: 'dark',
    palette: { bg: '#0A0B0D', surface: '#13151A', text: '#F2F4F7', muted: '#8B919C', accent: '#C8F231' },
    fonts: { heading: 'Space Grotesk', body: 'Inter', headingWeights: '500;700', bodyWeights: '400;600' },
    heroPattern: 'Vollbild-Video/Foto mit hartem Kontrast-Overlay, Headline Uppercase links unten, daneben vertikale Info-Leiste',
    sectionRhythm: 'Action-Hero → Zahlen-Banner (Mitglieder/Kurse/Fläche) → Kurse als horizontaler Scroll-Strip → Trainer-Grid → Preise klar → Probetraining-CTA',
    microDetails: [
      'Zahlen zählen beim Einscrollen hoch (Count-up)',
      'Akzent-Linie wandert beim Scrollen an der Seite mit (Scroll-Progress)',
      'Kurs-Karten mit diagonal angeschnittenen Foto-Kanten'
    ]
  },

  // ── GESUNDHEIT ──────────────────────────────────────────────────────────────
  'praxis-calm': {
    branches: ['zahnarzt', 'arzt', 'praxis', 'therapie'],
    match: /zahn|arzt|praxis|ortho|derma|augen|kinderarzt|therapie|heilpraktik|tierarzt|apotheke/,
    name: 'Praxis Calm',
    vibe: 'ruhig, vertrauenswürdig, modern — Praxis ohne Wartezimmer-Tristesse',
    mode: 'light',
    palette: { bg: '#F7F8F7', surface: '#FFFFFF', text: '#16201E', muted: '#5E6B68', accent: '#2C7A6B' },
    fonts: { heading: 'Sora', body: 'Inter', headingWeights: '500;600', bodyWeights: '400;500' },
    heroPattern: 'Split-Screen: links ruhige Headline + Termin-CTA + Telefon prominent, rechts großzügiges Foto mit organisch abgerundeter Innenkante',
    sectionRhythm: 'Split-Hero → Leistungen als klare Karten (max 6) → Praxis-Rundgang Galerie → Team mit Qualifikationen → Öffnungszeiten + Kontakt als ruhiges Grid → Footer mit Notfall-Hinweis',
    microDetails: [
      'Sanfte organische Blob-Form (eine!) als Hintergrund-Akzent im Hero',
      'Öffnungszeiten mit "heute"-Zeile hervorgehoben',
      'Leistungs-Icons als dünne Linien-Icons (keine Emojis), einheitlicher Stroke'
    ]
  },

  // ── HANDWERK & DIENSTLEISTUNG ───────────────────────────────────────────────
  'handwerk-solid': {
    branches: ['handwerk', 'bau', 'elektro', 'sanitär', 'maler', 'dachdecker', 'tischler', 'garten'],
    match: /handwerk|bau|elektro|sanitär|heizung|maler|dach|tischler|schreiner|garten|landschaft|umzug|gebäude|reinigung|kfz|werkstatt|auto/,
    name: 'Handwerk Solid',
    vibe: 'ehrlich, präzise, verlässlich — Meisterbetrieb mit Stolz',
    mode: 'light',
    palette: { bg: '#F6F5F2', surface: '#FFFFFF', text: '#181A1B', muted: '#5F6468', accent: '#D97B29' },
    fonts: { heading: 'Archivo', body: 'Inter', headingWeights: '600;700', bodyWeights: '400;600' },
    heroPattern: 'Vollbild-Foto von echter Arbeit mit dunklem Overlay, Headline kräftig links, darunter Vertrauens-Leiste (Meisterbetrieb · seit 19XX · Region)',
    sectionRhythm: 'Foto-Hero → Leistungen als robuste Kacheln mit Foto → Referenz-Projekte Vorher/Nachher → Ablauf in 3 Schritten → Team/Über-uns → Kontakt mit großem Telefon-CTA',
    microDetails: [
      'Akzentfarbene eckige Markierung an Section-Headings (kein rounded)',
      'Vorher/Nachher-Bilder mit verschiebbarem Regler oder Hover-Übergang',
      '3-Schritte-Ablauf mit verbindender Linie, die beim Scrollen wächst'
    ]
  },

  // ── KANZLEI & PROFESSIONELLE DIENSTLEISTER ──────────────────────────────────
  'kanzlei-kontor': {
    branches: ['anwalt', 'kanzlei', 'notar', 'steuerberater', 'beratung', 'versicherung', 'makler', 'finanzen'],
    match: /anwalt|kanzlei|recht|jurist|notar|steuerberat|wirtschaftsprüf|unternehmensberat|versicherung|makler|immobilien|finanz|consulting/,
    name: 'Kanzlei Kontor',
    vibe: 'autoritär, diskret, etabliert — Vertrauen und Kompetenz ohne Prunk, hanseatische Zurückhaltung',
    mode: 'light',
    palette: { bg: '#F5F4F1', surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C' },
    fonts: { heading: 'Fraunces', body: 'Inter', headingWeights: '400;600', bodyWeights: '400;500' },
    heroPattern: 'Ruhiger, autoritativer Hero: große Serif-Headline mit dem Kanzlei-Versprechen, darunter Standort + Telefon-CTA; rechts ein zurückhaltendes Foto (Kanzlei/Stadt) mit feiner Rahmung statt verspielter Formen',
    sectionRhythm: 'Hero → Rechtsgebiete/Leistungen als klares Karten-Grid (kein Schnickschnack) → Über die Kanzlei (Haltung, Erfahrung) → Team/Anwälte mit Schwerpunkten und Qualifikationen → Ablauf/Erstberatung → Kontakt mit Adresse, Karte-Hinweis, Telefon prominent → Footer mit Impressum-Hinweis',
    microDetails: [
      'Dünne goldene Trennlinie (1px) als wiederkehrendes Autoritäts-Element unter Section-Headings',
      'Rechtsgebiete als Liste mit feinen Linien-Icons, einheitlicher Stroke, keine Emojis',
      'Serifen-Headlines mit großzügigem Zeilenabstand; Fließtext eng geführt (max-w) für seriöse Lesbarkeit'
    ]
  },

  // ── KANZLEI, DUNKLE VARIANTE (nur per dnaKey-Pin, matcht nicht automatisch) ──
  'kanzlei-noir': {
    branches: [], // bewusst leer: nie Auto-Auswahl, nur via project.dnaKey = 'kanzlei-noir'
    match: /.^/,
    name: 'Kanzlei Noir',
    vibe: 'dunkel, edel, seriös — hochwertige Wirtschafts-/Strafverteidiger-Kanzlei, ruhiger Luxus, maximale Autorität',
    mode: 'dark',
    palette: { bg: '#0E1116', surface: '#161B22', text: '#ECECEA', muted: '#9BA4AF', accent: '#C9A24B' },
    fonts: { heading: 'Fraunces', body: 'Inter', headingWeights: '400;600', bodyWeights: '400;500' },
    heroPattern: 'Vollbild-Hero auf tiefem Dunkel (kein reines Schwarz): sehr große Serif-Headline mit dem Kanzlei-Versprechen, darunter Standort + prominenter Telefon-CTA in Gold; Hintergrund ein edel abgedunkeltes Foto oder feine Linien-Textur mit 30-45% Overlay, hoher, ruhiger Kontrast',
    sectionRhythm: 'Hero → Rechtsgebiete als ruhiges Karten-Grid auf dunklen Surface-Flächen → Über die Kanzlei (Haltung, Erfahrung) → Team/Anwälte mit Schwerpunkten und Qualifikationen → Ablauf/Erstberatung → Kontakt mit Adresse und prominenter Telefonnummer → Footer mit Impressum-Hinweis',
    microDetails: [
      'Dünne goldene 1px-Trennlinie unter Section-Headings; Surface-Karten nur minimal heller als der Hintergrund (#161B22 auf #0E1116), sehr dezenter 1px-Rand, kein Schlagschatten-Kitsch',
      'SLIDE-IN beim Scrollen: Inhalte gleiten von unten bzw. seitlich ein (transform translateY/translateX 24-40px + opacity 0→1, 0.6-0.9s, cubic-bezier(0.16,1,0.3,1)), pro Sektion gestaffelt 80-120ms; ausschließlich transform/opacity, einmalig (once), prefers-reduced-motion respektieren',
      'Hero-Headline als zeilenweiser Reveal beim Laden; Hintergrundbild sehr langsam (20s+) und subtil parallax',
      'Gold-Akzent sparsam und elegant (Heading-Linien, CTA, aktive Nav) auf dem Dunkel — hoher Kontrast, niemals neon, keine zweite Akzentfarbe'
    ]
  },

  // ── FALLBACK ────────────────────────────────────────────────────────────────
  'modern-local': {
    branches: ['*'],
    match: /.^/, // matcht nie über Regex — nur als Fallback
    name: 'Modern Local',
    vibe: 'zeitgemäß, freundlich, klar — der Laden um die Ecke, professionell aufgetreten',
    mode: 'light',
    palette: { bg: '#F8F7F4', surface: '#FFFFFF', text: '#15161A', muted: '#5A5A66', accent: '#3B5BDB' },
    fonts: { heading: 'Sora', body: 'Inter', headingWeights: '500;600', bodyWeights: '400;500' },
    heroPattern: 'Großzügige Headline links, Visual rechts, eine klare Akzentfläche',
    sectionRhythm: 'Hero → Angebot/Leistungen → Über-uns asymmetrisch → Galerie/Referenzen → Kontakt + Zeiten → Footer',
    microDetails: [
      'Eine wiederkehrende geometrische Akzentform (Linie oder Kreis), konsequent eingesetzt',
      'Hover-Übergänge auf allen interaktiven Elementen (150–250ms)',
      'Section-Headings mit kleinem Kicker-Label darüber (Uppercase, Akzentfarbe)'
    ]
  }
};

/**
 * Branche aus Lead/Projekt-Daten erkennen (Google-Places-Types + Kategorie + Beschreibung).
 */
function detectBranch(project) {
  const haystack = [project.category, project.description, project.cuisine, (project.types || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();

  if (/anwalt|kanzlei|recht|jurist|notar|steuerberat|wirtschaftsprüf|unternehmensberat|versicherung|makler|immobilien|consulting/.test(haystack)) return 'kanzlei';
  if (/friseur|salon|barber|beauty|kosmetik|nagel|hair/.test(haystack)) return 'friseur';
  if (/zahn|arzt|praxis|dental|doctor|physio|therapie|apotheke|tierarzt/.test(haystack)) return 'praxis';
  if (/fitness|gym|yoga|sport|crossfit|tanz/.test(haystack)) return 'fitness';
  if (/handwerk|elektro|sanitär|maler|dach|bau|tischler|garten|kfz|werkstatt|reinigung/.test(haystack)) return 'handwerk';
  if (/café|cafe|coffee|bäcker|bakery|konditorei/.test(haystack)) return 'cafe';
  if (/bar|pub|lounge|cocktail/.test(haystack)) return 'bar';
  return 'restaurant'; // bisheriger Kern bleibt Default
}

/**
 * DNA auswählen: erst Beschreibungs-Match innerhalb der Branche,
 * dann erste DNA der Branche, dann Fallback. Deterministischer Hash
 * sorgt dafür, dass gleiche Inputs gleiche DNA bekommen, verschiedene
 * Geschäfte aber variieren.
 */
// ── Layout-Varianten (gegen Einheitsbrei: jede Seite bekommt deterministisch eine) ──
const LAYOUT_VARIANTS = [
  { key: 'split-editorial', prompt: 'Hero als Split-Screen: Headline + Standort/CTA links, großes randabfallendes Foto rechts. Folgesektionen im editorialen 2-Spalten-Wechsel (Text/Bild alternierend), bewusst asymmetrisch.' },
  { key: 'fullbleed-immersive', prompt: 'Vollflächiger Foto-Hero (min-h-screen) mit 30-40% Overlay, Headline groß unten-links. Danach abwechselnd vollbreite Bild-Bänder und schmale Text-Container.' },
  { key: 'minimal-typographic', prompt: 'Sehr reduzierter Hero: riesige Display-Typo auf ruhiger Farbfläche, KEIN großes Bild oben. Bilder erst weiter unten, sehr viel Weißraum, klare feine Linien.' },
  { key: 'sidebar-anchored', prompt: 'Hero mit schmaler seitlicher Meta-Spalte (Standort, Telefon, Kerndaten) und Hauptinhalt daneben; markante vertikale Trennlinie als wiederkehrendes Element.' },
  { key: 'stacked-hub', prompt: 'Kompakter Hero, direkt darunter große, bild-getriebene Klick-Karten als Hub zu den Unterseiten (Team, Rechtsgebiete, Kontakt). Startseite bleibt bewusst kurz.' },
  { key: 'magazine-bento', prompt: 'Magazin-/Bento-Grid mit unterschiedlich großen Kacheln (Foto + Kurztext), bewusst ungleichmäßiges Raster statt uniformer 3er-Cards.' }
];

/** Deterministische, projektspezifische Layout-Variante (gegen Einheitsbrei). @param {object} project @returns {{key:string,prompt:string}} */
function pickVariant(project) {
  const seed = String((project && project.name) || '').split('').reduce((a, c) => a + c.charCodeAt(0), 7);
  return LAYOUT_VARIANTS[seed % LAYOUT_VARIANTS.length];
}

function selectDNA(project) {
  return { ..._selectDNA(project), variant: pickVariant(project) };
}
function _selectDNA(project) {
  // Expliziter Pin: erzwingt eine bestimmte DNA pro Projekt (z. B. dunkle Variante 'kanzlei-noir').
  // So bekommt nur dieses Projekt die Variante, die Auto-Vielfalt über alle anderen bleibt erhalten.
  if (project.dnaKey && DNA[project.dnaKey]) {
    return { key: project.dnaKey, branch: detectBranch(project), ...DNA[project.dnaKey] };
  }
  const branch = detectBranch(project);
  const haystack = [project.description, project.category, project.cuisine, project.atmosphere]
    .filter(Boolean).join(' ').toLowerCase();

  const candidates = Object.entries(DNA).filter(([, d]) =>
    d.branches.includes(branch) || d.branches.includes('*'));

  // 1. Inhaltlicher Match
  for (const [key, d] of candidates) {
    if (d.match.test(haystack)) return { key, branch, ...d };
  }

  // 2. Branchen-DNA (ohne Fallback-Eintrag), per Namens-Hash gewählt für Varianz
  const branchOnly = candidates.filter(([key]) => key !== 'modern-local');
  if (branchOnly.length) {
    const hash = (project.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const [key, d] = branchOnly[hash % branchOnly.length];
    return { key, branch, ...d };
  }

  return { key: 'modern-local', branch, ...DNA['modern-local'] };
}

/** DNA als Prompt-Block formatieren (für die Generator-Pässe). */
function dnaToPrompt(dna) {
  return `## DESIGN-DNA: ${dna.name}
Vibe: ${dna.vibe}
Modus: ${dna.mode === 'dark' ? 'Dark Premium' : 'Light Premium'}
Palette: Hintergrund ${dna.palette.bg} · Surface ${dna.palette.surface} · Text ${dna.palette.text} · Muted ${dna.palette.muted} · Akzent ${dna.palette.accent} (der EINE Akzent)
Fonts (Google Fonts): Heading "${dna.fonts.heading}" (Weights ${dna.fonts.headingWeights}) + Body "${dna.fonts.body}" (Weights ${dna.fonts.bodyWeights}) — keine weiteren
Hero-Pattern: ${dna.heroPattern}
Section-Rhythmus: ${dna.sectionRhythm}
Micro-Details (alle drei einbauen — das sind die "gestohlenen" Referenz-Details):
${dna.microDetails.map((m, i) => `${i + 1}. ${m}`).join('\n')}${dna.variant ? `\n\nLAYOUT-VARIANTE (verbindlich — macht GENAU DIESE Seite einzigartig, nicht das Standard-Schema): ${dna.variant.prompt}` : ''}`;
}

module.exports = { selectDNA, dnaToPrompt, pickVariant, LAYOUT_VARIANTS };
