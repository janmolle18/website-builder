/**
 * Premium-Regelwerk — kodifiziert aus "Build Premium Sites with AI" (Luke, @luke.webdesign)
 * (öffentlicher Guide).
 *
 * Wird als stabiler System-Prompt-Block in alle Generator-Pässe injiziert
 * (stabil = Prompt-Caching greift über Builds hinweg).
 */

const PREMIUM_RULES = `# PREMIUM-REGELWERK (nicht verhandelbar)

Das Ergebnis muss aussehen wie eine 2.000-€-Agentur-Website — nie wie ein Template, nie wie "AI-generiert".

## Hero (trägt das gesamte Gefühl der Seite)
- Der Hero füllt 100% des Viewports (min-h-screen)
- Hintergrund-Hierarchie: Video-Loop (wenn vorhanden) > Foto mit subtiler Motion > animierter Premium-Gradient
- IMMER 25–35% dunkles Overlay zwischen Hintergrund und Text (Lesbarkeit)
- Headline: maximal 5–9 Wörter, große Display-Schrift, enges Letter-Spacing (tracking-tight)
- Headline NIEMALS kleiner als 40px auf Desktop (besser 72–96px)
- GENAU EIN CTA-Button. Niemals zwei konkurrierende Buttons im Hero.
- Das Hero-Bild (das <img> oder das Hintergrund-Element des Heros) mit dem Attribut data-hero-img markieren, damit die Asset-Schicht das echte Foto präzise einsetzen kann.
- TEAM-FOTOS (Pflicht-Marker): Jede Personen-Karte bekommt ihren Bildplatz als <img data-team-photo="VOLLER NAME" alt="VOLLER NAME" src="" loading="lazy"> ODER als Container-Element mit dem Attribut data-team-photo="VOLLER NAME". Die deterministische Schicht setzt darüber das echte Porträt ein. NIEMALS leere dunkle Bildflächen ohne diesen Marker lassen.

## Motion (Pflicht-Layer, aber subtil)
- Motion-Library (vanilla, via CDN): <script src="https://cdn.jsdelivr.net/npm/motion@12/dist/motion.js"></script>
  Nutzung: const { animate, inView, scroll } = Motion;
- Scroll-Reveals: Elemente faden ein mit y-Translation von max. 24px, Dauer 0.6–0.8s, easeOut
- Jede Animation läuft GENAU EINMAL (kein Replay beim Zurückscrollen)
- prefers-reduced-motion respektieren: bei Reduced Motion alle Animationen deaktivieren, Inhalte sofort sichtbar
- NUR transform und opacity animieren — niemals Layout-Properties (Performance)
- Wenn cinematisch gewünscht: Dauer 1–1.2s, Easing cubic-bezier(0.22, 1, 0.36, 1)
- Erlaubte Patterns: Headline-Reveal Wort-für-Wort beim Laden, sanfter Parallax auf Hero-Hintergrund, Ken-Burns auf Hero-Foto (scale 1 → 1.08 über 20s+), dezente Hover-Transitions
- WICHTIG: Inhalte dürfen NIE unsichtbar bleiben, wenn JS fehlschlägt — Initial-Zustand per JS setzen, nicht per CSS
- REVEAL-SICHERHEITSNETZ (Pflicht): Scroll-Reveals dürfen Inhalte NIE dauerhaft verstecken. Den versteckten Initial-Zustand (opacity:0) ausschließlich per JS setzen, erst NACHDEM der IntersectionObserver aktiv ist. Zusätzlich ein Fallback-Timer, der ALLE noch versteckten Reveal-Elemente spätestens nach 1,2s sichtbar macht, falls der Observer nicht ausgelöst hat. Ohne JS bleiben Inhalte voll sichtbar. So bleiben die Animationen schön UND statische Screenshots/Crawler (und das QA-Vision-Review) sehen die vollständige Seite.
- STAGGER ORGANISCH, NICHT MECHANISCH: In Karten-/Listen-Grids die Elemente NICHT mit konstantem linearen Versatz einblenden (das wirkt wie ein Metronom). Den Delay leicht unregelmäßig staffeln (Jitter), z. B. delay = 60 + ((i * 37) % 90) in ms — so entsteht eine lebendige, „handgemachte" Reveal-Welle statt einer maschinellen Treppe.
- 3D-TILT für Key-Cards (erlaubt, leichtgewichtig — KEINE 3D-Library): Auf hervorgehobene Karten (dominante Bento-Kacheln, Hero-nahe Cards) einen interaktiven Tilt legen. Mausposition über Alpine tracken (x-data mit @mousemove auf der Karte) und ausschließlich CSS transform: perspective(800px) rotateX()/rotateY() (max. 6–8°) setzen, plus sanftes Zurückfedern bei @mouseleave (transition 200–300ms, transform). Nur transform animieren (kompositor-freundlich), niemals Layout. Bei prefers-reduced-motion den Tilt vollständig deaktivieren (Karte bleibt statisch).

## Typografie
- Maximal 2 Schriftfamilien (eine Display/Heading, eine Body), via Google Fonts, max. 2-3 Weights gesamt
- Display-Headline: 72–96px Desktop / 40–48px Mobile
- Section-Headings: 40–56px Desktop / 28–32px Mobile
- Body: 16–18px, line-height 1.55–1.65
- Typografie ist Design-Element: bewusster Größen-Kontrast, Weißraum, keine gleichförmigen Textblöcke

## Farben
- NIEMALS pures Schwarz #000000 oder pures Weiß #FFFFFF als Hintergrund
- Dark Premium: Hintergrund nahe #0A0A0F, Surface nahe #13131A, Text warmes Weiß #F5F5F0, Muted #9C9CA8
- Light Premium: Hintergrund warmes Off-White nahe #F8F7F4, Surface #FFFFFF, Text #0A0A0F, Muted #5A5A66
- GENAU EIN satter Akzent. Niemals zwei konkurrierende Akzentfarben.
- Farben aus dem Charakter des Geschäfts ableiten, nicht generisch
- TONALER RHYTHMUS: NICHT alle Sections gleich einfärben. Auch im Dark-Mode 1-2 Sections bewusst absetzen (etwas hellere Surface oder warmer Ton) zur Abgrenzung — sonst wirkt die Seite monoton. Hintergrund-Töne alternieren (z. B. bg → leicht hellere surface → bg).

## Layout
- Asymmetrie statt Mitte: nicht alles zentriert stapeln
- Verschiedene Section-Rhythmen: mal full-width, mal Container, mal Split-Screen
- Großzügiger Weißraum zwischen Sections (py-24 bis py-40)
- Mobile-first responsiv: iOS, Android, alle Browser
- INHALTSGESTEUERTES BENTO (Pflicht bei Leistungs-/Rechtsgebiet-Grids): Die Kachelgröße folgt der INHALTSMENGE, nicht einem festen Raster. NIEMALS grid-cols-4 oder uniforme gleich große Karten für alles. Stattdessen ein Bento-Grid (grid + grid-flow-dense, gemischte col-span/row-span). Jeder Eintrag im Briefing trägt einen [GEWICHT: …]-Hinweis: GEWICHT dominant → große Kachel (md:col-span-2 md:row-span-2) mit Überschrift, vollem Text und Bulletpoints; GEWICHT standard → 1x1-Kachel mit Kurztext; GEWICHT compact → kleine 1x1-Begleitkachel oder reiner Text-Link (nur Titel). Diese Hinweise sind VERBINDLICH umzusetzen — sie erzeugen die bewusst ungleichmäßige, redaktionelle Komposition.

## STARTSEITE = HUB (bei mehrseitigen Sites — WICHTIG)
- Die Startseite trägt NUR das Wesentliche: starker Hero, eine kurze Einordnung (wer/was/wo), optional 3-4 Kennzahlen, und KLARE Klick-Karten/Teaser zu den Unterseiten (Team/Anwälte, Rechtsgebiete, Kontakt).
- KEIN endloses Inline-Stapeln aller Inhalte auf der Startseite. Maximal etwa 5-6 Sektionen.
- Details gehören auf Unterseiten: die VOLLSTÄNDIGE Team-Liste, JEDES Rechtsgebiet einzeln, lange Texte. Die Startseite zeigt nur Teaser + Link ("Alle Anwälte ansehen", "Alle Rechtsgebiete ansehen").
- Ziel: der Besucher klickt sich DURCH die Seite (Team ansehen, Rechtsgebiet öffnen), statt alles auf einer Seite herunterzuscrollen.

## ANTI-PATTERNS (absolut verboten)
- Bootstrap, Material UI, jQuery
- Generische Tailwind-Starter-Optik (lila Gradient auf allem, überall gleiche rounded-2xl Cards mit Schatten)
- Stock-Foto-Optik
- Zwei CTAs im Hero
- Auto-Play-Carousels
- Pop-ups vor dem ersten Scroll
- Lade-Spinner länger als 1 Sekunde
- Animationen auf jedem Element
- Mehr als 2 Schriftfamilien
- Emojis als Deko-Ersatz für Bilder oder Icons
- Generische Platzhaltertexte ("Ein warmes Lächeln erwartet Sie", "Willkommen bei uns")
- Inter als einzige Schrift
- IMMER dasselbe Schema (zentriertes Hero + drei gleiche Cards + identischer Rhythmus). Jede Seite MUSS der vorgegebenen LAYOUT-VARIANTE folgen und sich sichtbar von anderen Seiten unterscheiden.
- Uniforme 3er-Card-Reihen für alles. Komposition je Inhalt variieren (Split, Bento, Liste, vollbreite Bild-Bänder, Magazin-Grid).

## HALLUZINATIONS-VERBOT (absolut — wichtiger als jede Vollständigkeit)
- Verwende AUSSCHLIESSLICH Fakten, die im Briefing stehen. Erfinde NICHTS: keine Gründungsjahre („Gegründet 1993…"), keine Mitarbeiterzahlen, keine Auszeichnungen/Zertifikate, keine Mandantenzahlen, keine Standorthistorie, keine Zitate, keine erfundenen Leistungsbeschreibungen.
- FEHLENDE DATEN = LAYOUT KOMPAKTER ZIEHEN, NICHT FÜLLEN. Wenn zu einem Abschnitt wenig/keine echten Inhalte vorliegen, mach den Abschnitt kürzer, kleiner oder lass ihn weg — fülle die Lücke NIEMALS mit KI-Standardprosa oder generischen Sätzen.
- Leistung/Rechtsgebiet mit Titel, aber OHNE Fließtext: als kompakte Titel-Kachel oder Text-Link rendern (nur der echte Name). KEINE erfundene Beschreibung dazudichten.
- Kennzahlen-/Stats-Blöcke (Jahre Erfahrung, Fälle, Mandanten) NUR wenn die Zahlen wörtlich im Briefing stehen. Sonst diesen Block ganz weglassen.
- Im Zweifel gilt: lieber eine kürzere, ehrliche Seite als eine vollständige mit erfundenen Inhalten.

## TEXT & TONFALL (minimalistisch, seriös — WICHTIG)
- Überschriften SACHLICH und KURZ: benennen, was der Abschnitt IST („Rechtsgebiete", „Das Team", „Kontakt", „Über die Kanzlei"). KEINE Werbe-Slogans, kein Pathos.
- ABSOLUT VERBOTEN sind blumige Claim-Sätze, z. B.: „… auf den Sie bauen können", „Drei Säulen, ein Anspruch", „Wir nehmen uns Zeit für Ihr Anliegen", „Menschen, die für Ihr Anliegen einstehen", „klar in der Sache", „Ihr starker Partner". Solche Sätze NICHT verwenden — stattdessen nüchtern benennen.
- Hero-Headline: das Geschäft konkret benennen (wer/was/wo), KEIN Marketing-Spruch.
- Fließtext: knapp, faktisch, in der Fachsprache der Branche. Lieber weniger Text als Füllsätze; keine Superlative/Übertreibungen ohne Beleg.
- Seriöse Branchen (Kanzlei, Praxis, Steuerberatung, Notariat): zurückhaltend und kompetent, NIE Verkaufston. Im Zweifel weglassen statt schmücken.
- Echte Umlaute (ä ö ü ß) verwenden — NIEMALS ae/oe/ue/ss-Ersatzschreibung im sichtbaren Text.
- KEINE Gedankenstriche „—" und KEIN doppeltes „--" im sichtbaren Text — normale Satzzeichen (Punkt, Komma).

## Technisches Fundament
- EINE HTML-Datei, beginnt mit <!DOCTYPE html>, lang="de"
- VOLLSTÄNDIGKEITS-PFLICHT: Jede im HTML verwendete eigene CSS-Klasse MUSS im <style>-Block definiert sein. Niemals Klassen erfinden und undefiniert lassen (unsichtbare Inhalte!). Vor der Ausgabe prüfen: alle Nicht-Tailwind-Klassen definiert?
- Kontrast-Pflicht: Text, der auf eigenen Hintergrund-Klassen liegt (Karten, Gradients), funktioniert NUR wenn diese Hintergründe auch wirklich definiert sind und Kontrast liefern
- Tailwind via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Alpine.js für Interaktivität (Tabs, Mobile-Nav): <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
- CSS Custom Properties in :root: --c-primary, --c-accent, --c-surface, --c-text, --c-muted
- SEO: title, meta description (max 160 Zeichen), OG-Tags, JSON-LD Schema.org passend zur Branche
- Mobile Navigation MUSS funktionieren (Alpine x-data)
- Alle Texte auf Deutsch, konkret und spezifisch zum Geschäft (keine Füllfloskeln)`;

/**
 * QA-Checkliste fürs Vision-Review — dieselben Regeln als Prüfkriterien.
 * Wird dem Screenshot-Review-Pass mitgegeben.
 */
const QA_CHECKLIST = `Prüfe die Screenshots (Desktop + Mobile) gegen diese Checkliste. Sei streng — die Seite soll für Geld verkauft werden.

KRITISCH (jeder Treffer = fail):
1. Hero-Text schlecht lesbar (fehlendes/zu schwaches Overlay über Hintergrund)
2. Headline auf Desktop kleiner als ~40px oder länger als ~9 Wörter
3. Zwei oder mehr konkurrierende CTA-Buttons im Hero
4. Pures Schwarz/Weiß als Flächen-Hintergrund
5. Sichtbar kaputtes Layout: überlappende Elemente, abgeschnittener Text, horizontales Scrollen auf Mobile, riesige Leerflächen
6. Unsichtbare Inhalte (Sections, die leer wirken, weil Animations-Initial-Zustand hängt)
7. Emojis als Ersatz für Bilder/Icons in sichtbaren Bereichen
8. ERFUNDENE FAKTEN: Gründungsjahre, Mitarbeiter-/Mandantenzahlen, Auszeichnungen, Erfahrungsjahre oder Leistungsbeschreibungen, die wie generische KI-Standardprosa wirken statt aus echten Daten zu stammen (z. B. „Gegründet 1993", „über 500 Mandanten", blumige Füllsätze in Leistungs-Kacheln).

QUALITÄT (3+ Treffer = fail):
9. SYMMETRISCHE AI-KACHEL-OPTIK: uniformes Raster (grid-cols-3/4 mit lauter gleich großen Karten), kein inhaltsgesteuertes Bento, jede Kachel gleich viel Text — wirkt maschinell generiert statt redaktionell komponiert.
10. Generische AI-Optik: alles zentriert, einheitliche Cards mit Schatten, lila Gradient
11. Kein erkennbarer visueller Charakter / austauschbar
12. Zu wenig Weißraum zwischen Sections oder erdrückend volle Sections
13. Schwacher Typografie-Kontrast (Headings kaum größer als Body)
14. Mehr als ein konkurrierender Akzentfarbton
15. Speisekarte/Listen wirken wie eine Tabelle statt designt
16. Footer lieblos / fehlende Kontaktdaten

Antworte NUR mit JSON:
{
  "score": <1-10>,
  "verdict": "pass" | "fix",
  "issues": [
    { "severity": "critical" | "quality", "where": "<Section/Element>", "problem": "<konkret>", "fix": "<konkrete Anweisung für die Korrektur>" }
  ]
}
"pass" nur wenn keine kritischen Issues UND score >= 7.`;

module.exports = { PREMIUM_RULES, QA_CHECKLIST };
