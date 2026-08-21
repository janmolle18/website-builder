/**
 * pages.js — Deterministische Unterseiten für mehrseitige Sites (Kanzlei & Co.)
 *
 * Ergänzt die Opus-generierte Startseite um echte Unterseiten OHNE teure LLM-Läufe:
 *   - anwaelte.html            Übersicht (Foto-Karten) → verlinkt Profile
 *   - anwaelte/<slug>.html     Profil: Foto, Bio, Schwerpunkte, Qualifikationen
 *   - rechtsgebiete.html       Karten je Schwerpunkt
 *   - kontakt.html             Kontaktdaten + echte OpenStreetMap-Karte
 *
 * Alles im DNA-Design (Palette/Fonts), gemeinsame Navigation + Footer (mit Recht/Analytics
 * werden separat injiziert). Leichte Scroll-Reveals (IntersectionObserver). Team-Fotos der
 * Alt-Seite werden lokal nach assets/team/ geladen.
 *
 * Doku: 20_PROJECTS/Website-Builder/APP_STATUS.md
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { applyPolish } = require('./polish');
const { jsonLdSafe } = require('./seo'); // </script>-sichere Serialisierung für <script>-Embeds
const { slugify } = require('./lib/slugify');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Branchen-Vokabular für Unterseiten-Beschriftung UND URL-Slugs. Der Builder war ursprünglich
 * kanzlei-zentriert („Rechtsgebiete"/„Anwälte & Team", URLs rechtsgebiete/anwaelte); auf Praxen/
 * Gastro/Dienstleistern liest sich das falsch — bis hin zu kaputten Links (Startseite verlinkt
 * „Leistungen" → leistungen.html, während die Datei rechtsgebiete.html hieß). Für Kanzlei liefert
 * `vocab` EXAKT die alten Labels UND Slugs (Rückwärtskompatibilität — Bestandsprojekte/-tests
 * unverändert); andere Branchen bekommen passende Labels + passende URL-Slugs (areasSlug/teamSlug).
 * Die internen Plan-Keys ('rechtsgebiete'/'anwaelte') bleiben als Logik-Anker bestehen.
 */
function vocab(project) {
  const cat = String((project && project.category) || '').toLowerCase();
  const is = (...ks) => ks.some(k => cat.includes(k));
  if (is('kanzlei', 'anwalt', 'anwält', 'notar', 'recht', 'jurist')) {
    return {
      areas: 'Rechtsgebiete', areasKicker: 'Kompetenz', areaKicker: 'Rechtsgebiet', areasSlug: 'rechtsgebiete',
      team: 'Anwälte & Team', teamKicker: 'Kanzlei', teamSlug: 'anwaelte',
      teamLead: 'Erfahrene Anwältinnen und Anwälte sowie unser Team, persönlich für Sie da.',
      cta: 'Erstberatung anfragen', who: 'Wer Sie berät', more: 'Weitere Rechtsgebiete',
      detail: a => `Wir beraten und vertreten Sie im ${a}. Für eine Einschätzung Ihres konkreten Anliegens vereinbaren Sie ein persönliches Erstgespräch.`,
      form: {
        title: 'Erstanfrage senden', lead: 'Schildern Sie uns kurz Ihr Anliegen. Wir melden uns zeitnah und unverbindlich.',
        topicLabel: 'Rechtsgebiet', topicPlaceholder: 'Rechtsgebiet (optional)', topicsFromSpecialties: true,
        msgLabel: 'Ihr Anliegen', submit: 'Erstanfrage senden',
      },
    };
  }
  if (is('physio', 'praxis', 'arzt', 'ärzt', 'zahn', 'therap', 'heilprakt', 'osteo', 'ergo', 'medizin', 'gesundheit', 'pflege', 'reha')) {
    return {
      areas: 'Leistungen', areasKicker: 'Behandlung', areaKicker: 'Leistung', areasSlug: 'leistungen',
      team: 'Team', teamKicker: 'Praxis', teamSlug: 'team',
      teamLead: 'Unser Team – persönlich und mit Zeit für Ihre Behandlung.',
      cta: 'Termin vereinbaren', who: 'Wer Sie behandelt', more: 'Weitere Leistungen',
      detail: a => `Für Ihre Behandlung im Bereich ${a} nehmen wir uns Zeit — individuell auf Ihre Beschwerden abgestimmt. Vereinbaren Sie gern einen Termin für ein persönliches Gespräch.`,
      form: {
        title: 'Termin anfragen', lead: 'Schildern Sie uns kurz Ihr Anliegen — wir melden uns zeitnah mit einem Terminvorschlag.',
        topicLabel: 'Behandlung', topicPlaceholder: 'Behandlung (optional)', topicsFromSpecialties: true,
        msgLabel: 'Ihr Anliegen', submit: 'Terminanfrage senden',
      },
    };
  }
  // Gastro erkennt auch Betriebsarten ohne „Restaurant" im Namen: Pizzeria, Trattoria,
  // Ristorante, Grill/Burger/Sushi/Döner, Bäckerei/Konditorei/Eiscafé, Catering …
  if (is('restaurant', 'cafe', 'café', 'bar', 'bistro', 'gastro', 'imbiss', 'pizz', 'trattoria', 'ristorante', 'osteria',
    'burger', 'grill', 'steak', 'sushi', 'döner', 'doner', 'kebab', 'brauhaus', 'taverne', 'wirtshaus', 'gasthof', 'gasthaus',
    'küche', 'kueche', 'catering', 'eis', 'bäcker', 'baecker', 'konditor', 'food')) {
    return {
      areas: 'Angebot', areasKicker: 'Küche', areaKicker: 'Angebot', areasSlug: 'angebot',
      team: 'Team', teamKicker: 'Unser Haus', teamSlug: 'team',
      teamLead: 'Die Menschen hinter unserem Haus.',
      cta: 'Tisch anfragen', who: 'Ihre Gastgeber', more: 'Mehr aus unserer Küche',
      detail: a => `Mehr zu „${a}" aus unserer Küche. Sprechen Sie uns an oder reservieren Sie direkt einen Tisch.`,
      menu: { label: 'Speisekarte', slug: 'speisekarte', kicker: 'Aus unserer Küche' },
      form: {
        title: 'Reservierung & Anfragen', lead: 'Ob Tischreservierung, Bestellung oder Feier — schreiben Sie uns kurz, wir melden uns schnell.',
        topicLabel: 'Anlass', topicPlaceholder: 'Anlass (optional)',
        topics: ['Tischreservierung', 'Bestellung / Abholung', 'Feier / Catering', 'Sonstiges'],
        msgLabel: 'Ihre Nachricht', submit: 'Anfrage senden',
      },
    };
  }
  return {
    areas: 'Leistungen', areasKicker: 'Angebot', areaKicker: 'Leistung', areasSlug: 'leistungen',
    team: 'Team', teamKicker: 'Über uns', teamSlug: 'team',
    teamLead: 'Unser Team – persönlich für Sie da.',
    cta: 'Kontakt aufnehmen', who: 'Ihre Ansprechpartner', more: 'Weitere Leistungen',
    detail: a => `Mehr zu unserer Leistung „${a}". Sprechen Sie uns gern für ein unverbindliches Erstgespräch an.`,
    form: {
      title: 'Anfrage senden', lead: 'Schildern Sie uns kurz Ihr Anliegen. Wir melden uns zeitnah.',
      topicLabel: 'Thema', topicPlaceholder: 'Thema (optional)', topicsFromSpecialties: true,
      msgLabel: 'Ihre Nachricht', submit: 'Anfrage senden',
    },
  };
}

/** Kurzer Teaser aus echtem Fließtext (an Wortgrenze gekürzt) — keine Erfindung. */
function teaser(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '').trim() + '…';
}
function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
}
function fontsHref(dna) {
  const f = (dna && dna.fonts) || { heading: 'Sora', body: 'Inter', headingWeights: '500;600', bodyWeights: '400;500' };
  const fam = (n, w) => `family=${encodeURIComponent(n)}:wght@${w || '400;600'}`;
  return `https://fonts.googleapis.com/css2?${fam(f.heading, f.headingWeights)}&${fam(f.body, f.bodyWeights)}&display=swap`;
}

// ── Foto-Download ───────────────────────────────────────────────────────────────

/** Lädt Team-Fotos lokal nach assets/team/ und annotiert team[].photoLocal. Idempotent. */
async function downloadTeamPhotos(projectDir, team = []) {
  const dir = path.join(projectDir, 'assets', 'team');
  fs.mkdirSync(dir, { recursive: true });
  for (const t of team) {
    if (!t || !t.photo) continue;
    const ext = (t.photo.match(/\.(jpg|jpeg|png)/i) || ['', 'jpg'])[1].toLowerCase();
    const rel = `assets/team/${t.slug}.${ext}`;
    try {
      const res = await axios.get(t.photo, { responseType: 'arraybuffer', timeout: 12000, headers: { 'User-Agent': UA } });
      fs.writeFileSync(path.join(projectDir, rel), res.data);
      t.photoLocal = rel;
    } catch { /* Foto optional → Initialen-Platzhalter */ }
  }
  return team;
}

// ── Geocoding für die Kontakt-Karte ─────────────────────────────────────────────

async function geocode(address) {
  if (!address) return null;
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'WebsiteBuilder/1.0 (kontakt-karte)' }, timeout: 10000
    });
    if (res.data && res.data[0]) return { lat: parseFloat(res.data[0].lat), lon: parseFloat(res.data[0].lon) };
  } catch { /* Karte fällt auf Link zurück */ }
  return null;
}

// ── Shared Shell ────────────────────────────────────────────────────────────────

function navHtml(project, active) {
  const name = esc(project.name || 'Website');
  const item = (href, label, key) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const links = planSubpages(project); // nur die real gebauten Unterseiten → keine toten Nav-Links
  return `<header class="nav">
  <a class="brand" href="../">${name}</a>
  <nav aria-label="Hauptnavigation">
    ${item('../', 'Start', 'home')}
    ${links.map(l => item('../' + l.href, esc(l.label), l.key)).join('\n    ')}
  </nav>
</header>`;
}

// Nav-Variante für Seiten im Projekt-Root (nicht im /anwaelte/-Unterordner)
function navHtmlRoot(project, active) {
  const name = esc(project.name || 'Website');
  const item = (href, label, key) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const links = planSubpages(project);
  return `<header class="nav">
  <a class="brand" href="./">${name}</a>
  <nav aria-label="Hauptnavigation">
    ${item('./', 'Start', 'home')}
    ${links.map(l => item('./' + l.href, esc(l.label), l.key)).join('\n    ')}
  </nav>
</header>`;
}

function footerHtml(project, depthPrefix = './') {
  const name = esc(project.name || '');
  const y = new Date().getFullYear();
  return `<footer class="ft">
  <div>© ${y} ${name}</div>
  <div class="ft-links">
    <a href="${depthPrefix}impressum.html">Impressum</a>
    <a href="${depthPrefix}datenschutz.html">Datenschutz</a>
  </div>
</footer>`;
}

function shell({ project, dna, active, depth = 0, title, main }) {
  const p = (dna && dna.palette) || { bg: '#F5F4F1', surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C' };
  const f = (dna && dna.fonts) || { heading: 'Fraunces', body: 'Inter' };
  const pre = depth ? '../' : './';
  const nav = depth ? navHtml(project, active) : navHtmlRoot(project, active);

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} – ${esc(project.name || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${esc(fontsHref(dna))}" rel="stylesheet">
<style>
  :root{--bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--accent:${p.accent};
    --fh:'${f.heading}',Georgia,serif;--fb:'${f.body}',system-ui,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--fb);line-height:1.7;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:1.5rem;
    padding:1.1rem clamp(1.2rem,4vw,3rem);background:color-mix(in oklab,var(--bg) 88%,transparent);
    backdrop-filter:blur(10px);border-bottom:1px solid color-mix(in oklab,var(--text) 10%,transparent)}
  .brand{font-family:var(--fh);font-weight:600;font-size:1.15rem;text-decoration:none}
  .nav nav{display:flex;gap:clamp(.8rem,2vw,1.8rem);flex-wrap:wrap}
  .nav nav a{text-decoration:none;color:var(--muted);font-size:.95rem;padding:.2rem 0;border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
  .nav nav a:hover,.nav nav a[aria-current]{color:var(--text);border-color:var(--accent)}
  main{max-width:1100px;margin:0 auto;padding:clamp(2.5rem,6vw,5rem) clamp(1.2rem,4vw,3rem)}
  .ph{font-family:var(--fh);font-size:.8rem;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin:0 0 .6rem}
  h1{font-family:var(--fh);font-weight:600;font-size:clamp(2rem,1.3rem+3vw,3.4rem);line-height:1.08;margin:0 0 1rem}
  h1::after{content:"";display:block;width:60px;height:2px;background:var(--accent);margin-top:1.2rem}
  .lead{font-size:1.12rem;color:color-mix(in oklab,var(--text) 86%,var(--muted));max-width:62ch}
  .grid{display:grid;gap:1.2rem;margin-top:2.5rem}
  .g3{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
  .g2{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .card{background:var(--surface);border:1px solid color-mix(in oklab,var(--text) 9%,transparent);border-radius:16px;
    padding:1.4rem;text-decoration:none;color:inherit;transition:transform .25s,box-shadow .25s,border-color .25s;display:block}
  a.card:hover{transform:translateY(-4px);box-shadow:0 20px 40px -22px rgba(0,0,0,.4);border-color:color-mix(in oklab,var(--accent) 50%,transparent)}
  .card h3{font-family:var(--fh);margin:.2rem 0 .4rem;font-size:1.2rem}
  .card .role{color:var(--accent);font-size:.9rem;margin-bottom:.5rem}
  .card p{margin:.3rem 0 0;color:var(--muted);font-size:.95rem}
  .avatar{width:100%;aspect-ratio:4/5;object-fit:cover;object-position:50% 25%;border-radius:12px;margin-bottom:1rem;background:color-mix(in oklab,var(--accent) 14%,var(--surface))}
  .avatar.ph-init{display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-size:2.4rem;color:var(--accent)}
  .chip{display:inline-block;margin:.2rem .35rem .2rem 0;padding:.3rem .7rem;border-radius:999px;font-size:.85rem;
    background:color-mix(in oklab,var(--accent) 12%,transparent);color:color-mix(in oklab,var(--text) 88%,var(--accent))}
  .profile{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:2.5rem;align-items:start}
  @media(max-width:680px){.profile{grid-template-columns:1fr}}
  .profile .avatar{aspect-ratio:4/5}
  .kv{margin:1.4rem 0;display:grid;gap:.5rem}
  .kv a{color:var(--accent)}
  .mapwrap{margin-top:2rem;border-radius:16px;overflow:hidden;border:1px solid color-mix(in oklab,var(--text) 10%,transparent)}
  .mapwrap iframe{display:block;width:100%;height:360px;border:0}
  .btn{display:inline-block;margin-top:1rem;background:var(--accent);color:#fff;text-decoration:none;padding:.7rem 1.3rem;border-radius:10px;font-weight:600}
  .back{display:inline-block;margin-top:2.5rem;color:var(--muted);text-decoration:none}
  .back:hover{color:var(--accent)}
  .form-card{background:var(--surface);border:1px solid color-mix(in oklab,var(--text) 9%,transparent);border-radius:18px;padding:clamp(1.4rem,3vw,2.2rem);margin-top:2.5rem;max-width:640px}
  .form-card h2{font-family:var(--fh);font-size:1.5rem;margin:0 0 .3rem}
  .form-card .sub{color:var(--muted);margin:0 0 1.5rem}
  .field{margin-bottom:1rem}
  .field label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.35rem}
  .field input,.field select,.field textarea{width:100%;padding:.75rem .9rem;border:1px solid color-mix(in oklab,var(--text) 18%,transparent);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
  .field textarea{min-height:130px;resize:vertical}
  .field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 22%,transparent)}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  @media(max-width:560px){.row2{grid-template-columns:1fr}}
  .consent{display:flex;gap:.6rem;align-items:flex-start;font-size:.85rem;color:var(--muted);margin:.4rem 0 1.2rem}
  .consent input{width:auto;margin-top:.2rem}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  .submit{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:.85rem 1.6rem;font:inherit;font-weight:600;cursor:pointer;transition:filter .2s}
  .submit:hover{filter:brightness(1.06)}.submit:disabled{opacity:.6;cursor:default}
  .form-msg{margin-top:1rem;padding:.8rem 1rem;border-radius:10px;font-size:.92rem;display:none}
  .form-msg.ok{display:block;background:color-mix(in oklab,#2e7d32 16%,transparent);color:#1b5e20}
  .form-msg.err{display:block;background:color-mix(in oklab,#c62828 14%,transparent);color:#b71c1c}
  .reveal{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}
  .reveal.in{opacity:1;transform:none}
  .ft{max-width:1100px;margin:3rem auto 0;padding:2rem clamp(1.2rem,4vw,3rem);display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;
    color:var(--muted);font-size:.9rem;border-top:1px solid color-mix(in oklab,var(--text) 10%,transparent)}
  .ft-links a{margin-left:1rem;color:var(--muted);text-decoration:none}.ft-links a:hover{color:var(--accent)}
  @media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}}
</style>
</head>
<body>
${nav}
<main>
${main}
</main>
${footerHtml(project, pre)}
<script>
(function(){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}})},{threshold:.12});
document.querySelectorAll('.reveal').forEach(function(el,i){el.style.transitionDelay=(Math.min(i,6)*60)+'ms';io.observe(el);});})();
</script>
</body>
</html>`;
}

// ── Einzelseiten ────────────────────────────────────────────────────────────────

function avatar(t) {
  if (t.photoLocal) {
    const src = t._depth ? '../' + t.photoLocal : t.photoLocal;
    return `<img class="avatar" src="${esc(src)}" alt="${esc(t.name)}" loading="lazy" width="300" height="375">`;
  }
  return `<div class="avatar ph-init" aria-hidden="true">${esc(initials(t.name))}</div>`;
}

/**
 * Hat die Person genug Inhalt für eine eigene Profilseite?
 * Mitarbeiter, die auf der Alt-Site nur als Karte standen (Name/Rolle/Foto, keine
 * Bio), bekommen KEINE dünne Einzelseite — sie erscheinen als Karte auf der Übersicht.
 */
function hasProfileContent(t) {
  return Boolean(t && ((t.bio && String(t.bio).trim().length >= 40) ||
    (Array.isArray(t.schwerpunkte) && t.schwerpunkte.length) ||
    (Array.isArray(t.qualifikationen) && t.qualifikationen.length)));
}

function renderAnwaelteOverview(project, dna) {
  const team = project.team || [];
  const v = vocab(project);
  const card = (t) => {
    const a = { ...t, _depth: false };
    const inner = `${avatar(a)}
      <h3>${esc(t.name)}</h3>
      <div class="role">${esc(t.role || '')}</div>
      ${t.schwerpunkte && t.schwerpunkte.length ? `<p>${esc(t.schwerpunkte.slice(0, 3).join(' · '))}</p>` : ''}`;
    return hasProfileContent(t)
      ? `<a class="card reveal" href="${v.teamSlug}/${esc(t.slug)}.html">${inner}</a>`
      : `<div class="card reveal">${inner}</div>`;
  };
  const withProfile = team.filter(hasProfileContent);
  const plain = team.filter(t => !hasProfileContent(t));
  // Zwei Gruppen nur, wenn es beide gibt: verlinkte Profile oben, das übrige Team darunter.
  const sections = (withProfile.length && plain.length)
    ? `<div class="grid g3">${withProfile.map(card).join('\n')}</div>
<h2 class="reveal" style="font-family:var(--fh);margin-top:3.5rem">Unser Team</h2>
<div class="grid g3">${plain.map(card).join('\n')}</div>`
    : `<div class="grid g3">${team.map(card).join('\n')}</div>`;
  const main = `<p class="ph reveal">${esc(v.teamKicker)}</p>
<h1 class="reveal">${esc(v.team)}</h1>
<p class="lead reveal">${esc(v.teamLead)}</p>
${sections}`;
  return shell({ project, dna, active: 'anwaelte', depth: 0, title: v.team, main });
}

function renderProfile(project, dna, t) {
  const a = { ...t, _depth: true };
  const v = vocab(project);
  const chips = (arr) => arr && arr.length ? `<div>${arr.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : '';
  const quals = t.qualifikationen && t.qualifikationen.length
    ? `<h3 style="font-family:var(--fh);margin-top:2rem">Qualifikationen</h3><ul>${t.qualifikationen.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : '';
  const main = `<div class="profile reveal">
  <div>${avatar(a)}</div>
  <div>
    <p class="ph">${esc(t.role || 'Team')}</p>
    <h1>${esc(t.name)}</h1>
    ${t.bio ? `<p class="lead">${esc(t.bio)}</p>` : ''}
    ${t.schwerpunkte && t.schwerpunkte.length ? `<h3 style="font-family:var(--fh);margin-top:2rem">Schwerpunkte</h3>${chips(t.schwerpunkte)}` : ''}
    ${quals}
  </div>
</div>
<a class="back" href="../${v.teamSlug}.html">&larr; Zurück zur Übersicht</a>`;
  return shell({ project, dna, active: 'anwaelte', depth: 1, title: t.name, main });
}

/** Slug für Rechtsgebiet-Namen ("Vertrags- & Werkvertragsrecht" → "vertrags-werkvertragsrecht"). */
function rgSlug(s) {
  return slugify(s);
}

/** Generische Info-Unterseite (Notare, Über-uns, Service, Aktuelles): Text + Unterabschnitte. */
function renderInfoPage(project, dna, page) {
  const toParas = (t, max) => String(t || '').split(/\n+/).map(s => s.trim()).filter(s => s.length > 30).slice(0, max);
  const intro = toParas(page.text, 10).map((p, i) => `<p class="${i === 0 ? 'lead ' : ''}reveal">${esc(p)}</p>`).join('\n');
  const subs = (page.subPages || []).map(sp => {
    const sParas = toParas(sp.text, 8).map(p => `<p class="reveal">${esc(p)}</p>`).join('\n');
    return sParas ? `<section class="reveal" style="margin-top:2.6rem"><h2>${esc(sp.title)}</h2>${sParas}</section>` : '';
  }).join('\n');
  const main = `<p class="ph reveal">${esc(page.label)}</p>
<h1 class="reveal">${esc(page.title || page.label)}</h1>
${intro}
${subs}
<a class="btn reveal" href="kontakt.html">Kontakt aufnehmen</a>`;
  return shell({ project, dna, active: page.key, depth: 0, title: page.title || page.label, main });
}

// ── Leistungs-Ebene (Übersicht + Detailseiten) — „Physio-Muster" ─────────────────
// Editoriales Layout nach einem handgebauten Referenzprojekt:
// nummerierte Übersichts-Liste, Detailseiten mit Brotkrümel/Lead/Chips/Foto/Team/FAQ/CTA.
// ALLE Inhalte stammen aus echten Projektdaten (specialtyDetails, faq, team, contact) —
// Sektionen ohne Daten werden ehrlich weggelassen, nichts wird erfunden.

/** Passendes specialtyDetail zu einem Gebiet (Name- oder Slug-Match). */
function areaDetail(project, area) {
  return (project.specialtyDetails || []).find(d => d &&
    (d.name === area || rgSlug(d.name || '') === rgSlug(area) || rgSlug(d.slug || '') === rgSlug(area))) || null;
}

/** Echte Absätze aus dem gescrapten Detailtext (keine Erfindung). */
function detParas(det) {
  if (!det || !det.text) return [];
  return String(det.text).split(/\n+/).map(s => s.trim()).filter(s => s.length > 30).slice(0, 8);
}

/** Für Vergleiche: Klammerzusätze weg („(MT / OMT)"), Kleinschreibung, Whitespace normalisiert. */
function normTopic(s) {
  return String(s || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * FAQ-Einträge, die zu diesem Gebiet gehören (Gebietsname kommt in Frage/Antwort vor).
 * Matcht eine Frage AUCH ein längeres Geschwister-Gebiet, gehört sie dorthin —
 * so landet „Was ist Krankengymnastik am Gerät?" nicht auf der Krankengymnastik-Seite.
 */
function areaFaq(project, area) {
  const target = normTopic(area);
  if (target.length < 4) return [];
  const siblings = (project.specialties || []).map(normTopic)
    .filter(s => s && s !== target && s.length > target.length);
  return (project.faq || []).filter(f => {
    const txt = normTopic(`${(f && f.q) || ''} ${(f && f.a) || ''}`);
    return txt.includes(target) && !siblings.some(s => txt.includes(s));
  }).slice(0, 4);
}

/**
 * Teammitglieder, deren Schwerpunkte/Qualifikationen zum Gebiet passen —
 * für die „Wer Sie behandelt/berät"-Sektion. Nur echte Übereinstimmungen.
 * @returns {{t:object, hits:string[]}[]}
 */
function areaTeam(project, area) {
  const target = normTopic(area);
  const contains = (long, short) => short.length >= 4 && long.includes(short);
  const out = [];
  for (const t of (project.team || [])) {
    if (!t || !t.name) continue;
    const skills = [...(t.schwerpunkte || []), ...(t.qualifikationen || [])].filter(Boolean);
    const hits = [...new Set(skills.filter(s => {
      const sn = normTopic(s);
      return contains(sn, target) || contains(target, sn);
    }))].slice(0, 4);
    if (hits.length) out.push({ t, hits });
  }
  return out.slice(0, 4);
}

/** Gemeinsame Stile der Leistungs-Ebene — nutzt die CSS-Variablen der shell(). */
function svcCss() {
  return `<style>
  .crumbs{font-size:.88rem;color:var(--muted);margin:0 0 2rem}
  .crumbs a{color:var(--muted);text-decoration:none}
  .crumbs a:hover{color:var(--accent)}
  .crumbs span[aria-hidden]{margin:0 .45rem;opacity:.6}
  .sec{margin-top:clamp(2.6rem,5vw,4rem)}
  .sec>h2{font-family:var(--fh);font-weight:600;font-size:clamp(1.4rem,1.1rem+1.2vw,1.9rem);line-height:1.15;margin:0 0 1.1rem}
  .svc-list{margin-top:2.6rem;display:grid;gap:.9rem}
  .svc-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1.2rem 1.6rem;align-items:center;text-decoration:none;
    min-width:0;background:var(--surface);border:1px solid color-mix(in oklab,var(--text) 9%,transparent);border-radius:18px;
    padding:1.4rem clamp(1.2rem,3vw,2rem);transition:border-color .25s,box-shadow .25s}
  .svc-row:hover{border-color:color-mix(in oklab,var(--accent) 55%,transparent);box-shadow:0 18px 40px -26px rgba(0,0,0,.45)}
  .svc-row .no{font-family:var(--fh);font-weight:600;font-size:clamp(1.6rem,1.2rem+1.6vw,2.4rem);line-height:1;
    color:color-mix(in oklab,var(--accent) 38%,transparent);min-width:2.2ch}
  .svc-row h2{font-family:var(--fh);font-weight:600;font-size:clamp(1.15rem,1rem+.8vw,1.5rem);line-height:1.15;margin:0 0 .3rem;overflow-wrap:break-word;hyphens:auto}
  .svc-row p{margin:0;color:var(--muted);font-size:.95rem;line-height:1.55;max-width:62ch;overflow-wrap:break-word}
  .svc-row .arr{color:var(--accent);transition:transform .25s}
  .svc-row:hover .arr{transform:translateX(4px)}
  @media(max-width:620px){.svc-row{grid-template-columns:minmax(0,1fr) auto}.svc-row .no{display:none}}
  .svc-photo{margin:2.2rem 0 0;border-radius:18px;overflow:hidden;border:1px solid color-mix(in oklab,var(--text) 10%,transparent)}
  .svc-photo img{display:block;width:100%;aspect-ratio:16/7;object-fit:cover}
  .who{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .who-card{display:flex;gap:1rem;align-items:flex-start;background:var(--surface);border:1px solid color-mix(in oklab,var(--text) 9%,transparent);border-radius:16px;padding:1.2rem 1.3rem}
  .who-badge{flex:none;width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-family:var(--fh);font-weight:600;
    font-size:1.15rem;color:var(--accent);background:color-mix(in oklab,var(--accent) 14%,var(--surface));border:1px solid color-mix(in oklab,var(--accent) 30%,transparent);overflow:hidden}
  .who-badge img{width:100%;height:100%;object-fit:cover;object-position:50% 25%}
  .who-card h3{font-family:var(--fh);font-weight:600;font-size:1.08rem;margin:0}
  .who-card .role{color:var(--muted);font-size:.88rem;margin:.15rem 0 .5rem}
  .who-card .chip{font-size:.78rem;padding:.22rem .6rem}
  .faq-i{border-bottom:1px solid color-mix(in oklab,var(--text) 12%,transparent)}
  .faq-i summary{cursor:pointer;list-style:none;padding:1rem 0;font-family:var(--fh);font-size:1.06rem;display:flex;justify-content:space-between;gap:1rem;align-items:center}
  .faq-i summary::-webkit-details-marker{display:none}
  .faq-i summary::after{content:"+";color:var(--accent);font-size:1.4rem;line-height:1;transition:transform .2s}
  .faq-i[open] summary::after{transform:rotate(45deg)}
  .faq-a{padding:0 0 1.1rem;color:color-mix(in oklab,var(--text) 84%,var(--muted));max-width:70ch;line-height:1.7}
  .cta-card{background:var(--text);color:#fff;border-radius:20px;padding:clamp(1.6rem,4vw,2.6rem);display:flex;flex-wrap:wrap;gap:1.2rem 2rem;align-items:center;justify-content:space-between}
  .cta-card h2{font-family:var(--fh);color:#fff;margin:0 0 .3rem;font-size:clamp(1.4rem,1.1rem+1.2vw,1.9rem)}
  .cta-card p{margin:0;color:rgba(255,255,255,.78);max-width:46ch}
  .cta-card .actions{display:flex;gap:.8rem;flex-wrap:wrap}
  .cta-card .btn{margin-top:0}
  .cta-card .btn.ghost{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3)}
  .more{display:flex;flex-wrap:wrap;gap:.6rem}
  .more a{text-decoration:none;font-size:.92rem;padding:.5rem 1rem;border-radius:999px;border:1px solid color-mix(in oklab,var(--text) 14%,transparent);
    background:var(--surface);transition:border-color .2s,color .2s}
  .more a:hover{border-color:var(--accent);color:var(--accent)}
  @media(prefers-reduced-motion:reduce){.svc-row,.svc-row .arr,.more a{transition:none}.svc-row:hover .arr{transform:none}}
</style>`;
}

/**
 * Abschluss-CTA: dunkle Karte mit echten Kontaktdaten (Telefon-Button + Kontaktseite).
 * Ohne Kontaktdaten kein leeres Karten-Gerippe — dann schlichter Button wie bisher.
 */
function ctaCardHtml(project, v, prefix) {
  const c = project.contact || {};
  if (!c.phone && !c.email && !c.address) {
    return `<a class="btn reveal" href="${prefix}kontakt.html">${esc(v.cta)}</a>`;
  }
  const tel = c.phone
    ? `<a class="btn" href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a>` : '';
  const sub = c.address
    ? `Rufen Sie uns an oder schreiben Sie uns. ${c.address}.`
    : 'Rufen Sie uns an oder schreiben Sie uns.';
  return `<section class="sec reveal" aria-label="${esc(v.cta)}">
  <div class="cta-card">
    <div>
      <h2>${esc(v.cta)}</h2>
      <p>${esc(sub)}</p>
    </div>
    <div class="actions">
      ${tel}
      <a class="btn ghost" href="${prefix}kontakt.html">Zur Kontaktseite</a>
    </div>
  </div>
</section>`;
}

/** Eigene Unterseite je Rechtsgebiet/Leistung — Physio-Muster, nur echte Daten. */
function renderRechtsgebietDetail(project, dna, area) {
  const v = vocab(project);
  const det = areaDetail(project, area);
  const paras = detParas(det);
  const lead = paras[0] || v.detail(area);
  const rest = paras.slice(1);
  const chips = (det && Array.isArray(det.chips) ? det.chips : []).filter(Boolean).slice(0, 6);
  const photo = det && det.photo && det.photo.src ? det.photo : null;
  const who = areaTeam(project, area);
  const faqs = areaFaq(project, area);
  const others = (project.specialties || []).filter(s => s && s !== area).slice(0, 8);

  const whoHtml = who.length ? `<section class="sec reveal" aria-labelledby="svc-who-titel">
  <h2 id="svc-who-titel">${esc(v.who)}</h2>
  <div class="who">${who.map(({ t, hits }) => `<div class="who-card">
      <div class="who-badge" aria-hidden="true">${t.photoLocal ? `<img src="../${esc(t.photoLocal)}" alt="" loading="lazy">` : esc(initials(t.name))}</div>
      <div>
        <h3>${esc(t.name)}</h3>
        ${t.role ? `<div class="role">${esc(t.role)}</div>` : ''}
        ${hits.map(q => `<span class="chip">${esc(q)}</span>`).join('')}
      </div>
    </div>`).join('\n')}</div>
  <a class="back" style="margin-top:1.2rem" href="../${v.teamSlug}.html">Mehr über unser Team &rarr;</a>
</section>` : '';

  const faqHtml = faqs.length ? `<section class="sec reveal" aria-labelledby="svc-faq-titel">
  <h2 id="svc-faq-titel">Häufige Fragen</h2>
  ${faqs.map(f => `<details class="faq-i">
    <summary>${esc(f.q)}</summary>
    <div class="faq-a">${esc(f.a)}</div>
  </details>`).join('\n  ')}
</section>` : '';

  const moreHtml = others.length ? `<section class="sec reveal" aria-labelledby="svc-more-titel">
  <h2 id="svc-more-titel">${esc(v.more)}</h2>
  <div class="more">
    ${others.map(o => `<a href="${esc(rgSlug(o))}.html">${esc(o)}</a>`).join('\n    ')}
  </div>
</section>` : '';

  const main = `${svcCss()}
<nav class="crumbs reveal" aria-label="Brotkrümelnavigation">
  <a href="../">Start</a><span aria-hidden="true">›</span><a href="../${v.areasSlug}.html">${esc(v.areas)}</a><span aria-hidden="true">›</span>${esc(area)}
</nav>
<p class="ph reveal">${esc(v.areaKicker)}</p>
<h1 class="reveal">${esc(area)}</h1>
<p class="lead reveal">${esc(lead)}</p>
${chips.length ? `<p class="reveal" style="margin:1.4rem 0 0">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</p>` : ''}
${photo ? `<figure class="svc-photo reveal"><img src="../${esc(photo.src)}" width="800" height="531" loading="lazy" alt="${esc(photo.alt || area)}"></figure>` : ''}
${rest.length ? `<section class="sec">${rest.map(p => `<p class="reveal">${esc(p)}</p>`).join('\n')}</section>` : ''}
${whoHtml}
${faqHtml}
${ctaCardHtml(project, v, '../')}
${moreHtml}
<a class="back" href="../${v.areasSlug}.html">&larr; Alle ${esc(v.areas)}</a>`;
  return shell({ project, dna, active: 'rechtsgebiete', depth: 1, title: area, main });
}

/** Übersichtsseite: editoriale nummerierte Liste mit echten Teasern (statt leerer Karten). */
function renderRechtsgebiete(project, dna) {
  const list = (project.specialties || []).filter(Boolean);
  const v = vocab(project);
  const arrow = '<svg class="arr" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';
  const rows = list.map((s, i) => {
    const det = areaDetail(project, s);
    const tz = detParas(det)[0] || '';
    return `<a class="svc-row reveal" href="${v.areasSlug}/${esc(rgSlug(s))}.html">
    <span class="no" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
    <span>
      <h2>${esc(s)}</h2>${tz ? `
      <p>${esc(teaser(tz, 150))}</p>` : ''}
    </span>
    ${arrow}
  </a>`;
  }).join('\n');
  const main = `${svcCss()}
<p class="ph reveal">${esc(v.areasKicker)}</p>
<h1 class="reveal">${esc(v.areas)}</h1>
<p class="lead reveal">${esc(project.description || `Unsere ${v.areas} im Überblick.`)}</p>
<div class="svc-list">${rows}
</div>
${ctaCardHtml(project, v, './')}`;
  return shell({ project, dna, active: 'rechtsgebiete', depth: 0, title: v.areas, main });
}

/** Anzahl echter Positionen in der Speisekarte (Seitenplan & Sanity-Checks). */
function countMenuItems(menu) {
  return (Array.isArray(menu) ? menu : []).reduce((s, c) => s + ((c && Array.isArray(c.items)) ? c.items.filter(it => it && it.name).length : 0), 0);
}

/**
 * Speisekarten-Seite (Gastro): vollständige Karte mit Kategorien, Einzelpreisen und
 * optionalen Größenpreisen (z. B. Pizza 24/30/40/60 cm via cat.sizes + item.prices).
 * Nur echte Daten — Positionen ohne Preis erscheinen ohne Preis, nichts wird erfunden.
 * project.menuNotes (z. B. Lieferkonditionen, Zusatzstoff-Hinweis) landen als Hinweis-Karte.
 */
function renderSpeisekarte(project, dna) {
  const v = vocab(project);
  const m = v.menu || { label: 'Speisekarte', slug: 'speisekarte', kicker: 'Aus unserer Küche' };
  const cats = (project.menu || []).filter(c => c && (c.items || []).some(it => it && it.name));
  const catId = (name, i) => 'mk-' + (rgSlug(String(name || '')) || 'kategorie-' + (i + 1));

  const css = `<style>
  .menu-toc{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.6rem}
  .menu-toc a{text-decoration:none;font-size:.88rem;padding:.32rem .8rem;border-radius:999px;color:var(--text);
    background:var(--surface);border:1px solid color-mix(in oklab,var(--text) 12%,transparent);transition:border-color .2s,color .2s}
  .menu-toc a:hover{border-color:color-mix(in oklab,var(--accent) 55%,transparent);color:var(--accent)}
  .cat-note{color:var(--muted);margin:.2rem 0 0;font-size:.92rem}
  .menu-items{display:grid;gap:1.05rem 2.6rem;margin-top:1.3rem}
  @media(min-width:920px){.menu-items{grid-template-columns:1fr 1fr}}
  .mi{min-width:0}
  .mi-head{display:flex;align-items:baseline;gap:.55rem}
  .mi-head h3{font-family:var(--fh);font-weight:600;font-size:1.02rem;line-height:1.3;margin:0}
  .mi-head .dots{flex:1;min-width:1.2rem;border-bottom:2px dotted color-mix(in oklab,var(--text) 24%,transparent);transform:translateY(-.28em)}
  .mi-price{font-weight:600;white-space:nowrap}
  .mi-desc{margin:.28rem 0 0;color:var(--muted);font-size:.92rem;line-height:1.5;max-width:62ch}
  .mi-sizes{display:flex;flex-wrap:wrap;gap:.4rem .5rem;margin-top:.55rem}
  .pz{background:color-mix(in oklab,var(--accent) 8%,transparent);border:1px solid color-mix(in oklab,var(--accent) 24%,transparent);
    border-radius:999px;padding:.18rem .62rem;font-size:.84rem;white-space:nowrap}
  .pz b{font-weight:600;opacity:.72;margin-right:.3rem}
  .menu-note{margin-top:clamp(2.4rem,4vw,3.2rem);background:var(--surface);border:1px solid color-mix(in oklab,var(--text) 9%,transparent);
    border-radius:18px;padding:1.3rem clamp(1.2rem,3vw,1.8rem)}
  .menu-note p{margin:.3rem 0;color:var(--muted);font-size:.92rem}
  .menu-note p:first-child{margin-top:0}.menu-note p:last-child{margin-bottom:0}
  </style>`;

  const toc = cats.length >= 4 ? `<nav class="menu-toc reveal" aria-label="Kategorien">
  ${cats.map((c, i) => `<a href="#${catId(c.category, i)}">${esc(c.category || `Kategorie ${i + 1}`)}</a>`).join('\n  ')}
</nav>` : '';

  const sections = cats.map((c, i) => {
    const sizes = Array.isArray(c.sizes) ? c.sizes.filter(Boolean) : [];
    const items = (c.items || []).filter(it => it && it.name).map(it => {
      const prices = Array.isArray(it.prices) ? it.prices.filter(Boolean) : [];
      const single = !prices.length && it.price
        ? `<span class="dots" aria-hidden="true"></span><span class="mi-price">${esc(it.price)}</span>` : '';
      const sized = prices.length ? `<div class="mi-sizes">${prices.map((p, j) =>
        `<span class="pz">${sizes[j] ? `<b>${esc(sizes[j])}</b>` : ''}${esc(p)}</span>`).join('')}</div>` : '';
      return `<div class="mi reveal">
      <div class="mi-head"><h3>${esc(it.name)}</h3>${single}</div>
      ${it.description ? `<p class="mi-desc">${esc(it.description)}</p>` : ''}
      ${sized}
    </div>`;
    }).join('\n');
    return `<section class="sec menu-cat" aria-labelledby="${catId(c.category, i)}">
  <h2 id="${catId(c.category, i)}" class="reveal">${esc(c.category || `Kategorie ${i + 1}`)}</h2>
  ${c.note ? `<p class="cat-note reveal">${esc(c.note)}</p>` : ''}
  <div class="menu-items">${items}</div>
</section>`;
  }).join('\n');

  const notes = (project.menuNotes || []).filter(Boolean);
  const notesHtml = notes.length ? `<aside class="menu-note reveal" aria-label="Hinweise">
  ${notes.map(n => `<p>${esc(n)}</p>`).join('\n  ')}
</aside>` : '';

  const main = `${svcCss()}${css}
<p class="ph reveal">${esc(m.kicker)}</p>
<h1 class="reveal">${esc(m.label)}</h1>
<p class="lead reveal">${esc(project.menuLead || `Frisch zubereitet — hier finden Sie unsere vollständige Karte.`)}</p>
${toc}
${sections}
${notesHtml}
${ctaCardHtml(project, v, './')}`;
  return shell({ project, dna, active: 'speisekarte', depth: 0, title: m.label, main });
}

/** Erstanfrage-Formular — öffnet das Mail-Programm des Besuchers (mailto, kein Backend/Cookie).
 *  Beschriftung/Themenauswahl kommen aus dem Branchen-Vokabular: Kanzlei fragt nach dem
 *  Rechtsgebiet, Gastro nach dem Anlass (Reservierung/Bestellung/Feier), Praxis nach der Behandlung. */
function inquiryForm(project) {
  const to = (project.contact && project.contact.email) || '';
  if (!to) return ''; // ohne Empfänger kein Formular (Kontaktdaten stehen separat)
  const f = vocab(project).form;
  const topics = f.topics || (f.topicsFromSpecialties ? (project.specialties || []) : []);
  const opts = [`<option value="">${esc(f.topicPlaceholder)}</option>`]
    .concat(topics.map(a => `<option>${esc(a)}</option>`)).join('');
  return `<form class="form-card reveal" id="inquiry" novalidate>
  <h2>${esc(f.title)}</h2>
  <p class="sub">${esc(f.lead)}</p>
  <div class="row2">
    <div class="field"><label for="iq-name">Name *</label><input id="iq-name" name="name" required maxlength="120" autocomplete="name"></div>
    <div class="field"><label for="iq-email">E-Mail *</label><input id="iq-email" name="email" type="email" required maxlength="160" autocomplete="email"></div>
  </div>
  <div class="row2">
    <div class="field"><label for="iq-phone">Telefon</label><input id="iq-phone" name="phone" maxlength="40" autocomplete="tel"></div>
    <div class="field"><label for="iq-area">${esc(f.topicLabel)}</label><select id="iq-area" name="area">${opts}</select></div>
  </div>
  <div class="field"><label for="iq-msg">${esc(f.msgLabel)} *</label><textarea id="iq-msg" name="message" required maxlength="5000"></textarea></div>
  <label class="consent"><input type="checkbox" id="iq-consent" required><span>Ich willige ein, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden (siehe <a href="datenschutz.html">Datenschutzerklärung</a>).</span></label>
  <button class="submit" type="submit">${esc(f.submit)}</button>
  <div class="form-msg" id="iq-box" role="status" aria-live="polite"></div>
</form>
<script>
(function(){
  var f=document.getElementById('inquiry'); if(!f) return;
  var TO=${jsonLdSafe(to)};
  var box=document.getElementById('iq-box');
  var g=function(id){return ((document.getElementById(id)||{}).value||'').trim();};
  function show(t,m){box.className='form-msg '+t;box.textContent=m;}
  function showOk(){
    box.className='form-msg ok';box.textContent='';
    box.appendChild(document.createTextNode('Ihr E-Mail-Programm öffnet sich. Falls nicht, schreiben Sie bitte an '));
    var a=document.createElement('a');a.href='mailto:'+TO;a.textContent=TO;
    box.appendChild(a);box.appendChild(document.createTextNode('.'));
  }
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var name=g('iq-name'),email=g('iq-email'),msg=g('iq-msg');
    if(!name||!email||!msg){show('err','Bitte Name, E-Mail und Nachricht ausfüllen.');return;}
    if(!document.getElementById('iq-consent').checked){show('err','Bitte stimmen Sie der Datenschutzerklärung zu.');return;}
    var body='Name: '+name+'\\nE-Mail: '+email+'\\nTelefon: '+g('iq-phone')+'\\n'+${jsonLdSafe(f.topicLabel)}+': '+g('iq-area')+'\\n\\n'+msg;
    window.location.href='mailto:'+TO+'?subject='+encodeURIComponent('Anfrage über die Website')+'&body='+encodeURIComponent(body);
    showOk();
  });
})();
</script>`;
}

function renderKontakt(project, dna, geo) {
  const c = project.contact || {};
  const addr = esc(c.address || '');
  const tel = c.phone ? `<div>Telefon: <a href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a></div>` : '';
  const mail = c.email ? `<div>E-Mail: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : '';
  const hours = c.hours ? `<div style="margin-top:.6rem;color:var(--muted)">${esc(c.hours).replace(/\n/g, '<br>')}</div>` : '';

  let map;
  if (geo) {
    const d = 0.004;
    const bbox = `${geo.lon - d}%2C${geo.lat - d}%2C${geo.lon + d}%2C${geo.lat + d}`;
    map = `<div class="mapwrap reveal"><iframe loading="lazy" title="Karte"
      src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${geo.lat}%2C${geo.lon}"></iframe></div>
      <a class="btn" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=17/${geo.lat}/${geo.lon}">Route planen</a>`;
  } else if (c.address) {
    map = `<a class="btn" target="_blank" rel="noopener" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(c.address)}">Auf der Karte ansehen</a>`;
  } else {
    map = '';
  }

  const main = `<p class="ph reveal">Kontakt</p>
<h1 class="reveal">So erreichen Sie uns</h1>
<div class="kv reveal">
  ${addr ? `<div>${addr}</div>` : ''}
  ${tel}${mail}${hours}
</div>
${inquiryForm(project)}
${map}`;
  return shell({ project, dna, active: 'kontakt', depth: 0, title: 'Kontakt', main });
}

// ── Echte Team-Fotos in die Opus-Startseite erzwingen (deterministisch) ──────────

function lastName(name = '') {
  const p = String(name).replace(/^(Dr\.?|Prof\.?|RA|RAin)\s*/i, '').trim().split(/\s+/);
  return p[p.length - 1] || '';
}

/**
 * Ersetzt Initialen-Monogramme der generierten Startseite durch die echten Fotos.
 * Der Generator nutzt für Platzhalter `.team-initials`; je Monogramm wird über den
 * Personennamen in der umgebenden Karte die passende Person gematcht und — falls ein
 * lokales Foto existiert — das Monogramm durch ein <img> ersetzt (Boxgröße bleibt).
 * Läuft NACH der QA (überlebt damit die Auto-Fix-Pässe). Idempotent.
 * @returns {{html:string, replaced:number}}
 */
function applyTeamPhotos(html, project) {
  const all = (project.team || []).filter(t => t && t.name);
  if (!all.length) return { html, replaced: 0 };

  const $ = cheerio.load(html, { decodeEntities: false });

  // Monogramm → Person (eindeutig). null = mehrdeutig (gleiche Initialen).
  const byInitials = new Map();
  for (const t of all) {
    const k = initials(t.name);
    byInitials.set(k, byInitials.has(k) ? null : t);
  }

  // Kandidaten: Elemente mit "initial" in der Klasse ODER Blatt-Elemente, deren Text
  // exakt ein Team-Monogramm ist (robust gegen die jeweilige Generator-Klassenbenennung).
  const candidates = new Set($('[class*="initial"], .team-initials, .ph-init').toArray());
  $('div, span, p, strong, b').each((i, el) => {
    const $el = $(el);
    const txt = $el.text().trim();
    if (/^[A-ZÄÖÜ]{2,3}$/.test(txt) && byInitials.has(txt) && $el.children().length === 0) candidates.add(el);
  });

  let replaced = 0;

  // 0) Explizite Marker data-team-photo="Voller Name" (vom Generator gesetzt) → exakter Treffer.
  $('[data-team-photo]').each((i, el) => {
    const $el = $(el);
    if ($el.attr('data-photo')) return;
    const want = ($el.attr('data-team-photo') || '').trim();
    const member = all.find(m => m.name === want)
      || all.find(m => want && (m.name.includes(want) || (lastName(m.name) && want.includes(lastName(m.name)))));
    if (!member || !member.photoLocal) return;
    $el.html(`<img src="${esc(member.photoLocal)}" alt="${esc(member.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block;border-radius:inherit">`);
    $el.attr('data-photo', '1');
    replaced++;
  });

  for (const el of candidates) {
    const $el = $(el);
    if ($el.attr('data-photo')) continue;
    // 1) Person über den umgebenden Kartentext, 2) sonst über das Monogramm selbst.
    let member = null;
    for (const node of [el, ...$el.parents().toArray()]) {
      const txt = $(node).text();
      const hits = all.filter(t => txt.includes(t.name) || txt.includes(lastName(t.name)));
      if (hits.length) { member = hits.sort((a, b) => b.name.length - a.name.length)[0]; break; }
    }
    if (!member) member = byInitials.get($el.text().trim()) || null;
    if (!member || !member.photoLocal) continue;

    $el.html(`<img src="${esc(member.photoLocal)}" alt="${esc(member.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block;border-radius:inherit">`);
    $el.attr('data-photo', '1');
    replaced++;
  }

  return { html: $.html(), replaced };
}

/**
 * Korrigiert die Profil-Links der Startseiten-Team-Teaser. Jede Karte, die auf
 * `anwaelte/<slug>.html` zeigt, wird über ihren Personennamen der echten Person
 * zugeordnet und auf deren KANONISCHEN Slug (team[].slug) umgebogen.
 *
 * Behebt Slug-Drift (z. B. ü→"u" vs. ü→"ue"), durch den die Startseite auf
 * veraltete Profil-Dateien zeigte. Voller Name schlägt Nachname — so landen die
 * zwei „Mustermann"-Karten (Christine/Heinrich) garantiert beim richtigen Profil.
 * Idempotent.
 * @returns {{html:string, fixed:number}}
 */
function fixTeamProfileLinks(html, project) {
  const all = (project.team || []).filter(t => t && t.name && t.slug);
  if (!all.length) return { html, fixed: 0 };

  const $ = cheerio.load(html, { decodeEntities: false });
  let fixed = 0;

  $('a[href*="anwaelte/"]').each((i, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    // Nur Einzelprofil-Links (…/anwaelte/<slug>.html), nicht die Übersicht (anwaelte.html).
    if (!/anwaelte\/[a-z0-9-]+\.html(?:[?#]|$)/i.test(href)) return;

    const txt = $a.text();
    // 1) Voller Name (eindeutig). 2) sonst NUR eindeutiger Nachname (keine Rateversuche).
    let member = all.find(t => txt.includes(t.name));
    if (!member) {
      const byLast = all.filter(t => lastName(t.name) && txt.includes(lastName(t.name)));
      if (byLast.length === 1) member = byLast[0];
    }
    if (!member) return;

    const prefix = href.slice(0, href.indexOf('anwaelte/'));
    // Personen ohne eigene Profilseite (Karten-Mitarbeiter) → auf die Übersicht,
    // damit kein Link ins Leere zeigt.
    const target = hasProfileContent(member)
      ? `${prefix}anwaelte/${member.slug}.html`
      : `${prefix}anwaelte.html`;
    if (href !== target) { $a.attr('href', target); fixed++; }
  });

  return { html: $.html(), fixed };
}

/**
 * Ergänzt die modell-generierte Startseiten-Navigation um die Extra-Bereiche
 * (Notare/Über-uns/Service/Aktuelles), damit ALLE Menüpunkte schon auf der Startseite
 * erscheinen — nicht erst auf den Unterseiten. Klont die nav-link-Klasse, idempotent.
 * @returns {{html:string, added:number}}
 */
function applyHomepageNav(html, project) {
  const extra = project.extraPages || [];
  if (!extra.length) return { html, added: 0 };
  const $ = cheerio.load(html, { decodeEntities: false });
  let added = 0;
  // An jedem "Kontakt"-Nav-Link orientieren (Desktop- + Mobile-Nav), Extra-Links davor einfügen.
  $('a').each((i, el) => {
    const $el = $(el);
    const cls = $el.attr('class') || '';
    if (!/(^|\s)nav-link(\s|$)/.test(cls)) return;
    if (!/kontakt/i.test($el.text())) return;
    if ($el.attr('data-extra-after')) return;
    const click = $el.attr('@click') ? ` @click="${$el.attr('@click')}"` : '';
    for (const p of extra) {
      $el.before(`<a href="${p.key}.html" class="${cls}"${click} data-extra-nav>${esc(p.label)}</a>\n        `);
      added++;
    }
    $el.attr('data-extra-after', '1');
  });
  return { html: $.html(), added };
}

/**
 * Ersetzt eine erfundene/falsch gruppierte „Rechtsgebiete"-Section der Opus-Startseite
 * durch GLEICHWERTIGE Teaser-Kacheln ALLER echten Schwerpunkte (deterministisch, ohne LLM,
 * „Physio-Muster"): responsive 1/2/3-Spalten-Grid, je Kachel Titel + echter Teaser aus
 * specialtyDetails (keine Erfindung — ohne Text nur der Titel) + „Mehr →" auf verlinkten
 * Kacheln. Hover nur Border/Schatten (kein Transform), reduced-motion-sicher. Verlinkt nur
 * real existierende Detailseiten. Findet die Section mit den meisten Treffern echter
 * Schwerpunkte (Team-Section ausgenommen). Läuft NACH der QA. Idempotent (data-areas-grid).
 * @returns {{html:string, changed:boolean}}
 */
function applyRechtsgebiete(html, project, dna) {
  const areas = (project.specialties || []).filter(Boolean);
  if (areas.length < 3 || !/<section/i.test(html)) return { html, changed: false };

  const $ = cheerio.load(html, { decodeEntities: false });
  let best = null, bestScore = 0;
  // Existiert schon ein Bento (früherer Build)? Dann DIESES neu rendern — so schlägt ein
  // Vokabular-/Datenwechsel auch bei erneuten Läufen durch, statt das alte Bento stehen zu lassen
  // oder ein zweites anzulegen. Etwaige doppelte Bentos (aus einem früheren fehlerhaften Lauf) entfernen.
  const grids = $('[data-areas-grid]').toArray();
  if (grids.length) {
    best = $(grids[0]).closest('section')[0] || $(grids[0]).parent()[0] || grids[0];
    bestScore = 3;
    for (let k = 1; k < grids.length; k++) {
      const sec = $(grids[k]).closest('section');
      (sec.length ? sec : $(grids[k])).remove();
    }
  } else {
    $('section').each((i, el) => {
      const $el = $(el);
      if ($el.find('.team-initials, [data-team-teaser]').length) return; // Team-Section aus
      const txt = $el.text();
      const hits = areas.filter(a => txt.includes(a)).length;
      if (hits > bestScore) { bestScore = hits; best = el; }
    });
  }
  if (!best || bestScore < 3) return { html, changed: false };

  const p = (dna && dna.palette) || { surface: '#fff', text: '#16202b', muted: '#5a6470', accent: '#9c7a3c' };
  const f = (dna && dna.fonts) || { heading: 'Fraunces', body: 'Inter' };
  const v = vocab(project);

  // Echte Detailtexte je Gebiet (für Gewicht + Teaser) — kein Erfinden.
  const detailByName = new Map();
  for (const d of (project.specialtyDetails || [])) {
    if (d && d.name) detailByName.set(rgSlug(d.name), d);
  }
  // Verlinke nur auf real existierende Detailseiten (sonst 404 → reine Kachel).
  const subs = new Set(project.subpages || []);

  // Gleichwertige Kacheln (Physio-Muster): Titel + echter Teaser, „Mehr →" nur auf Links.
  const tiles = areas.map(a => {
    const det = detailByName.get(rgSlug(a));
    const slug = rgSlug(a);
    const href = subs.has(`${v.areasSlug}/${slug}.html`) ? `${v.areasSlug}/${slug}.html` : null;
    const tz = det && det.text ? `<p>${esc(teaser(det.text, 110))}</p>` : '';
    const go = href ? '<span class="rg-go" aria-hidden="true">Mehr &rarr;</span>' : '';
    const inner = `<h3>${esc(a)}</h3>${tz}${go}`;
    return href
      ? `<a class="rg-tile" href="${esc(href)}">${inner}</a>`
      : `<div class="rg-tile">${inner}</div>`;
  }).join('');

  const inner = `<div data-areas-grid>
  <style>
    [data-areas-grid]{max-width:1100px;margin:0 auto;padding:0 clamp(1.2rem,4vw,3rem)}
    [data-areas-grid] .rg-kicker{font-family:'${f.heading}',serif;letter-spacing:.18em;text-transform:uppercase;color:${p.accent};font-size:.8rem;margin:0 0 .6rem}
    [data-areas-grid] h2{font-family:'${f.heading}',serif;font-weight:600;font-size:clamp(1.8rem,1.2rem+2vw,2.8rem);line-height:1.1;margin:0 0 1.6rem}
    [data-areas-grid] .rg-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:.8rem}
    @media(min-width:640px){[data-areas-grid] .rg-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:960px){[data-areas-grid] .rg-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    [data-areas-grid] .rg-tile{background:${p.surface};border:1px solid color-mix(in oklab,${p.text} 10%,transparent);border-radius:14px;padding:1.2rem 1.3rem;text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:.45rem;transition:border-color .25s,box-shadow .25s}
    [data-areas-grid] a.rg-tile:hover{border-color:color-mix(in oklab,${p.accent} 55%,transparent);box-shadow:0 18px 36px -24px rgba(0,0,0,.4)}
    [data-areas-grid] .rg-tile h3{font-family:'${f.heading}',serif;font-weight:600;font-size:1.15rem;margin:0}
    [data-areas-grid] .rg-tile p{margin:0;color:${p.muted};font-size:.92rem;line-height:1.5}
    [data-areas-grid] .rg-go{margin-top:auto;padding-top:.5rem;color:${p.accent};font-weight:600;font-size:.92rem;transition:transform .25s;align-self:flex-start}
    [data-areas-grid] a.rg-tile:hover .rg-go{transform:translateX(4px)}
    @media(prefers-reduced-motion:reduce){[data-areas-grid] .rg-tile,[data-areas-grid] .rg-go{transition:none}}
  </style>
  <p class="rg-kicker">${esc(v.areasKicker)}</p>
  <h2>Unsere ${esc(v.areas)}</h2>
  <div class="rg-grid">${tiles}</div>
  <a class="rg-all" href="${v.areasSlug}.html" style="display:inline-block;margin-top:1.6rem;color:${p.accent};text-decoration:none;font-weight:600">Alle ${esc(v.areas)} ansehen &rarr;</a>
</div>`;
  $(best).html(inner);
  // changed nur, wenn sich wirklich etwas geändert hat (cheerio load→serialize ist stabil) —
  // so bleibt ein erneuter Lauf mit gleichen Daten idempotent (changed:false), ein Vokabular-/
  // Datenwechsel schlägt aber durch (changed:true).
  const out = $.html();
  return { html: out, changed: out !== html };
}

// ── Größenabhängige Planung (generisch) ─────────────────────────────────────────

/**
 * Entscheidet datengetrieben, welche Unterseiten ein Projekt bekommt — je nach
 * vorhandenem Inhalt/Größe. Kleines Projekt → wenige/keine Unterseiten (One-Pager);
 * reiches Projekt → volle Mehrseitigkeit. Generisch, nicht branchenspezifisch.
 * @returns {{key:string,href:string,label:string}[]} Navigations-Einträge der Unterseiten
 */
function planSubpages(project) {
  const team = project.team || [];
  const specials = project.specialties || [];
  const c = project.contact || {};
  const plan = [];
  const v = vocab(project);
  // Gastro mit echter Speisekarte: eigene Seite, prominent direkt nach Start.
  const hasMenuPage = !!(v.menu && countMenuItems(project.menu) >= 4);
  if (hasMenuPage) plan.push({ key: 'speisekarte', href: `${v.menu.slug}.html`, label: v.menu.label });
  // Schon ab 2 Gebieten lohnt eine eigene Seite — vor allem wenn tiefe Fachtexte
  // (specialtyDetails) von der Alt-Site existieren; die dürfen nicht verfallen.
  // Trägt eine Gastro-Site ihre Inhalte in der Speisekarte, wären „Angebot"-Seiten
  // ohne echte Texte nur leere Hüllen — dann nur bei ausreichend Fachtext bauen.
  const deepAreas = (project.specialtyDetails || []).filter(d => d && String(d.text || '').trim().length >= 120);
  const wantAreas = hasMenuPage
    ? deepAreas.length >= 2
    : (specials.length >= 2 || (project.specialtyDetails || []).length >= 2);
  if (wantAreas) plan.push({ key: 'rechtsgebiete', href: `${v.areasSlug}.html`, label: v.areas });
  if (team.length >= 1) plan.push({ key: 'anwaelte', href: `${v.teamSlug}.html`, label: v.team });
  for (const p of (project.extraPages || [])) plan.push({ key: p.key, href: `${p.key}.html`, label: p.label });
  // „Über uns" aus dem gescrapten About-Text (nur wenn genug Text da ist und keine extraPage das abdeckt).
  const hasAboutExtra = (project.extraPages || []).some(p => /ueber|about/i.test(p.key || ''));
  if (!hasAboutExtra && project.about && String(project.about).trim().length >= 120) plan.push({ key: 'ueber-uns', href: 'ueber-uns.html', label: 'Über uns' });
  if (c.address || c.phone || c.email) plan.push({ key: 'kontakt', href: 'kontakt.html', label: 'Kontakt' });
  return plan;
}

// ── Orchestrierung ──────────────────────────────────────────────────────────────

/**
 * Entfernt Dateien eines alten URL-Slugs, wenn die Branche jetzt einen anderen nutzt (z. B.
 * Vokabular-Fix: rechtsgebiete.html/-Ordner weg, sobald leistungen.html der kanonische ist).
 * Fail-safe (fehlt nichts → no-op).
 */
function removeLegacySlug(projectDir, oldSlug, newSlug) {
  if (!oldSlug || oldSlug === newSlug) return;
  try { fs.rmSync(path.join(projectDir, `${oldSlug}.html`), { force: true }); } catch { /* egal */ }
  try { fs.rmSync(path.join(projectDir, oldSlug), { recursive: true, force: true }); } catch { /* egal */ }
}

/**
 * Baut die laut planSubpages vorgesehenen Unterseiten ins Projektverzeichnis.
 * Team-Fotos müssen vorher per downloadTeamPhotos geladen sein (photoLocal gesetzt).
 * @returns {Promise<{pages:string[]}>}
 */
async function buildSubpages(projectDir, project, dna) {
  const written = [];
  const plan = planSubpages(project).map(p => p.key);
  const team = project.team || [];
  const v = vocab(project);

  // Jede Unterseite läuft durch die Politur-Schicht (favicon, Skip-Link, Bildmaße,
  // nav-aria) — damit gelten dieselben A11y/Performance-Garantien wie auf der Startseite.
  const write = (rel, html) => {
    let out = html;
    try { out = applyPolish(html, { project, dna, projectDir }).html; }
    catch (e) { console.warn(`⚠️ Politur übersprungen (${rel}):`, e.message); }
    fs.writeFileSync(path.join(projectDir, rel), out);
    written.push(rel);
  };

  if (plan.includes('speisekarte')) {
    write(`${(v.menu && v.menu.slug) || 'speisekarte'}.html`, renderSpeisekarte(project, dna));
  }

  if (plan.includes('rechtsgebiete')) {
    write(`${v.areasSlug}.html`, renderRechtsgebiete(project, dna));
    const rgDir = path.join(projectDir, v.areasSlug);
    fs.mkdirSync(rgDir, { recursive: true });
    for (const s of (project.specialties || [])) {
      const slug = rgSlug(s);
      if (!slug) continue;
      write(path.join(v.areasSlug, `${slug}.html`), renderRechtsgebietDetail(project, dna, s));
    }
    removeLegacySlug(projectDir, 'rechtsgebiete', v.areasSlug);
  } else {
    // Areas nicht (mehr) geplant — z. B. Gastro, wo die Speisekarte das Angebot ersetzt,
    // oder eine korrigierte Branche: Altbestand aller bekannten Areas-Slugs entfernen,
    // sonst bleiben verwaiste Seiten mit veralteten Texten erreichbar.
    for (const slug of ['rechtsgebiete', 'leistungen', 'angebot']) removeLegacySlug(projectDir, slug, null);
  }

  if (plan.includes('anwaelte') && team.length) {
    write(`${v.teamSlug}.html`, renderAnwaelteOverview(project, dna));
    const profDir = path.join(projectDir, v.teamSlug);
    fs.mkdirSync(profDir, { recursive: true });
    for (const t of team.filter(hasProfileContent)) {
      write(path.join(v.teamSlug, `${t.slug}.html`), renderProfile(project, dna, t));
    }
    // Verwaiste Profil-Dateien aus früheren Builds (Slug-Drift, z. B. ü→ue) entfernen,
    // damit pro Person genau EIN kanonisches Profil existiert.
    try {
      const keep = new Set(team.filter(t => t && t.slug && hasProfileContent(t)).map(t => `${t.slug}.html`));
      for (const f of fs.readdirSync(profDir)) {
        if (f.endsWith('.html') && !keep.has(f)) {
          fs.unlinkSync(path.join(profDir, f));
          console.log(`🧹 Verwaistes Profil entfernt: ${v.teamSlug}/${f}`);
        }
      }
    } catch (e) { console.warn('⚠️ Profil-Cleanup übersprungen:', e.message); }
    removeLegacySlug(projectDir, 'anwaelte', v.teamSlug);
  }

  if (plan.includes('kontakt')) {
    const geo = await geocode((project.contact || {}).address);
    write('kontakt.html', renderKontakt(project, dna, geo));
  }

  // „Über uns" aus dem gescrapten About-Text (Bedingung steckt in planSubpages) — ohne diese Seite
  // wäre der von der Startseite verlinkte „Über uns"-Nav-Punkt tot.
  if (plan.includes('ueber-uns')) {
    write('ueber-uns.html', renderInfoPage(project, dna, { key: 'ueber-uns', label: 'Über uns', title: 'Über uns', text: project.about }));
  }

  for (const p of (project.extraPages || [])) {
    write(`${p.key}.html`, renderInfoPage(project, dna, p));
  }

  return { pages: written };
}

module.exports = { downloadTeamPhotos, buildSubpages, planSubpages, applyTeamPhotos, fixTeamProfileLinks, applyRechtsgebiete, renderRechtsgebiete, renderRechtsgebietDetail, renderSpeisekarte, countMenuItems, applyHomepageNav, hasProfileContent, renderAnwaelteOverview, inquiryForm, vocab };
