const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyPolish, darkInk, relLum } = require('../polish');
const { resolveBaseUrl, buildTitle, shortBrand } = require('../seo');

const DNA = { palette: { primary: '#0E1116', surface: '#161B22', text: '#ECECEA', muted: '#9BA4AF', accent: '#C9A24B' } };

// ── resolveBaseUrl: nie localhost in der Auslieferung ─────────────────────────────

test('resolveBaseUrl nutzt die echte Kundendomain statt localhost', () => {
  const url = resolveBaseUrl({ id: 'x', sourceUrl: 'https://www.example.de' }, 3010);
  assert.equal(url, 'https://www.example.de/');
  assert.doesNotMatch(url, /localhost/);
});

test('resolveBaseUrl bevorzugt explizite siteUrl', () => {
  assert.equal(resolveBaseUrl({ id: 'x', siteUrl: 'https://neu.de', sourceUrl: 'https://alt.de' }), 'https://neu.de/');
});

test('resolveBaseUrl fällt nur ohne jede Domain auf localhost zurück', () => {
  assert.match(resolveBaseUrl({ id: 'x' }, 3010), /^http:\/\/localhost:3010\//);
});

// ── buildTitle: kein abgeschnittener „…in…"-Titel mehr ────────────────────────────

test('buildTitle schneidet nicht mitten im Wort ab und schreibt Kategorie groß', () => {
  const t = buildTitle('Dr. Weber & Mustermann PartGmbB Rechtsanwälte', 'kanzlei', 'Paderborn', 60);
  assert.ok(t.length <= 60, `Title zu lang: ${t.length}`);
  assert.doesNotMatch(t, /…$/);
  assert.doesNotMatch(t, /\bin\s*…?$/);
  assert.match(t, /Kanzlei/);
  assert.match(t, /Paderborn/);
});

test('shortBrand entfernt Rechtsform-Rauschen', () => {
  assert.equal(shortBrand('Müller GmbH'), 'Müller');
  assert.equal(shortBrand('Dr. Weber & Mustermann PartGmbB Rechtsanwälte'), 'Dr. Weber & Mustermann Rechtsanwälte');
});

// ── Farb-Helfer ───────────────────────────────────────────────────────────────────

test('darkInk wählt die dunkelste Palettenfarbe (lesbar auf Weiß)', () => {
  assert.equal(darkInk(DNA.palette), '#0E1116');
  assert.ok(relLum('#0E1116') < relLum('#ECECEA'));
});

// ── applyPolish: idempotent, deckt alle Querschnitts-Fixes ab ─────────────────────

const PROJECT = { name: 'Kanzlei Test', category: 'kanzlei', contact: { phone: '05251 1054-0' } };

function baseHtml() {
  return `<!doctype html><html lang="de"><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>.hero-bg{background-image:url('https://cdn.test/hero.jpg')}</style>
    </head><body>
    <header><nav><a href="/">Start</a></nav></header>
    <main><img src="https://cdn.test/a.jpg" class="w-full aspect-[4/3]"></main>
    <section data-block="cta-band" style="background:#C9A24B">
      <h2 style="color:#fff">Jetzt kanzlei anfragen</h2>
      <a href="tel:052511054" style="background:#fff;color:#ECECEA">05251 1054-0</a>
    </section>
    <footer>x</footer></body></html>`;
}

test('applyPolish setzt favicon, Skip-Link, nav-aria, Hero-Preload', () => {
  const { html, steps } = applyPolish(baseHtml(), { project: PROJECT, dna: DNA });
  assert.match(html, /rel="icon"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<nav[^>]*aria-label/);
  assert.match(html, /rel="preload" as="image"[^>]*hero\.jpg/);
  assert.ok(steps.includes('favicon') && steps.includes('skip-link') && steps.includes('hero-preload'));
});

test('applyPolish ergänzt Bildmaße aus aspect-Klasse (CLS)', () => {
  const { html } = applyPolish(baseHtml(), { project: PROJECT, dna: DNA });
  assert.match(html, /<img[^>]*width="1200"[^>]*height="900"|<img[^>]*height="900"[^>]*width="1200"/);
});

test('applyPolish macht den CTA-Button lesbar und schreibt die Kategorie groß', () => {
  const { html } = applyPolish(baseHtml(), { project: PROJECT, dna: DNA });
  assert.match(html, /background:#fff;color:#0E1116/);
  assert.doesNotMatch(html, /color:#ECECEA/);
  assert.match(html, /Jetzt Kanzlei anfragen/);
});

test('applyPolish ist idempotent (zweiter Lauf ändert nichts Wesentliches)', () => {
  const first = applyPolish(baseHtml(), { project: PROJECT, dna: DNA }).html;
  const second = applyPolish(first, { project: PROJECT, dna: DNA }).html;
  assert.equal((second.match(/rel="icon"/g) || []).length, 1);
  assert.equal((second.match(/class="skip-link"/g) || []).length, 1);
  assert.equal((second.match(/rel="preload" as="image"/g) || []).length, 1);
});

// ── I3: Ladestrategie (Hero eager+priorisiert, Rest lazy, deterministisch) ─────────

function heroImgHtml() {
  return `<!doctype html><html lang="de"><head>
    <meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
    <header><nav aria-label="x"><img src="logo.png" class="logo object-cover" width="120" height="40"></nav></header>
    <section class="hero"><img src="hero.jpg" class="hero-image" data-hero-photo width="1600" height="900"></section>
    <main>
      <img src="team-1.jpg" class="avatar" width="300" height="375">
      <img src="team-2.jpg" class="avatar" width="300" height="375" loading="lazy">
    </main>
    <footer>x</footer></body></html>`;
}

test('applyPolish (I3): Content-<img> ohne loading bekommt lazy', () => {
  const { html, steps } = applyPolish(baseHtml(), { project: PROJECT, dna: DNA });
  assert.match(html, /<img[^>]*src="https:\/\/cdn\.test\/a\.jpg"[^>]*loading="lazy"|<img[^>]*loading="lazy"[^>]*a\.jpg/);
  assert.ok(steps.some(s => s.startsWith('loading:')), 'loading-Schritt fehlt');
});

test('applyPolish (I3): Hero-<img> wird eager + fetchpriority, NICHT lazy', () => {
  const { html } = applyPolish(heroImgHtml(), { project: PROJECT, dna: DNA });
  const hero = html.match(/<img[^>]*class="hero-image"[^>]*>/)[0];
  assert.match(hero, /loading="eager"/, 'Hero nicht eager');
  assert.match(hero, /fetchpriority="high"/, 'Hero ohne fetchpriority');
  assert.doesNotMatch(hero, /loading="lazy"/);
});

test('applyPolish (I3): KEIN preload-<link> fürs Hero-<img> (Doppel-Download mit AVIF-<picture> vermeiden)', () => {
  const { html } = applyPolish(heroImgHtml(), { project: PROJECT, dna: DNA });
  assert.doesNotMatch(html, /rel="preload"[^>]*hero\.jpg/);
});

test('applyPolish (I3): Above-Fold-Logo im header wird eager, nicht lazy', () => {
  const { html } = applyPolish(heroImgHtml(), { project: PROJECT, dna: DNA });
  const logo = html.match(/<img[^>]*class="logo object-cover"[^>]*>/)[0];
  assert.doesNotMatch(logo, /loading="lazy"/, 'Logo darf nicht lazy sein');
  assert.match(logo, /loading="eager"/);
});

test('applyPolish (I3): bestehendes loading="lazy" bleibt, Content-Bilder lazy', () => {
  const { html } = applyPolish(heroImgHtml(), { project: PROJECT, dna: DNA });
  const t1 = html.match(/<img[^>]*src="team-1\.jpg"[^>]*>/)[0];
  const t2 = html.match(/<img[^>]*src="team-2\.jpg"[^>]*>/)[0];
  assert.match(t1, /loading="lazy"/, 'team-1 sollte lazy sein');
  assert.match(t2, /loading="lazy"/, 'team-2 (schon lazy) bleibt lazy');
});

test('applyPolish (I3): idempotent — zweiter Lauf ändert loading nicht', () => {
  const first = applyPolish(heroImgHtml(), { project: PROJECT, dna: DNA }).html;
  const second = applyPolish(first, { project: PROJECT, dna: DNA }).html;
  assert.equal((second.match(/loading="eager"/g) || []).length, (first.match(/loading="eager"/g) || []).length);
  assert.equal((second.match(/fetchpriority="high"/g) || []).length, (first.match(/fetchpriority="high"/g) || []).length);
  assert.equal(first, second, 'zweiter Lauf sollte HTML nicht verändern');
});

test('applyPolish (I3): echter Hero-Marker data-hero-img wird als Hero erkannt (nicht nur Klasse)', () => {
  const html = `<!doctype html><html><head><title>x</title></head><body>
    <section><img src="h.jpg" data-hero-img width="1600" height="900" class="w-full"></section>
    <main><img src="c.jpg" class="avatar"></main></body></html>`;
  const out = applyPolish(html, { project: PROJECT, dna: DNA }).html;
  const hero = out.match(/<img[^>]*data-hero-img[^>]*>/)[0];
  assert.match(hero, /loading="eager"/, 'data-hero-img nicht eager');
  assert.match(hero, /fetchpriority="high"/, 'data-hero-img ohne fetchpriority');
  const content = out.match(/<img[^>]*src="c\.jpg"[^>]*>/)[0];
  assert.match(content, /loading="lazy"/, 'Content sollte lazy sein');
});

test('applyPolish (I3): object-cover-Logo wird NICHT als Hero fehlerkannt', () => {
  // Logo steht VOR dem echten Hero im DOM und trägt "object-cover" → darf HERO_RE nicht triggern.
  const { html } = applyPolish(heroImgHtml(), { project: PROJECT, dna: DNA });
  const logo = html.match(/<img[^>]*class="logo object-cover"[^>]*>/)[0];
  assert.doesNotMatch(logo, /fetchpriority="high"/, 'Logo fälschlich als Hero priorisiert');
  const hero = html.match(/<img[^>]*class="hero-image"[^>]*>/)[0];
  assert.match(hero, /fetchpriority="high"/, 'echter Hero muss priorisiert sein');
});
