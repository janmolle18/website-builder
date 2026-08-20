const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInventory, classifyInventory, heuristicClassify,
  normalizeUrl, sameHost, parseSitemapXml, parseRobotsSitemaps
} = require('../site-inventory');

// ── normalizeUrl / sameHost ─────────────────────────────────────────────────────

test('normalizeUrl: dedupliziert www, index.html, Trailing-Slash, Hash', () => {
  const base = 'https://www.kanzlei.de/';
  const a = normalizeUrl('https://www.kanzlei.de/team/', base);
  assert.equal(a, normalizeUrl('https://kanzlei.de/team', base));
  assert.equal(a, normalizeUrl('/team/index.html', base));
  assert.equal(a, normalizeUrl('/team/#anker', base));
  assert.notEqual(a, normalizeUrl('/team/mueller/', base));
});

test('normalizeUrl: nicht-http und kaputte URLs → null', () => {
  assert.equal(normalizeUrl('mailto:a@b.de', 'https://x.de/'), null);
  assert.equal(normalizeUrl('ftp://x.de/datei', 'https://x.de/'), null);
});

test('sameHost: www-agnostisch', () => {
  assert.equal(sameHost('https://www.kanzlei.de/a', 'https://kanzlei.de/b'), true);
  assert.equal(sameHost('https://kanzlei.de/', 'https://andere.de/'), false);
});

// ── Sitemap-Parsing ─────────────────────────────────────────────────────────────

test('parseRobotsSitemaps findet Sitemap-Zeilen (case-insensitiv)', () => {
  const robots = 'User-agent: *\nDisallow:\nSitemap: https://x.de/sitemap.xml\nsitemap: https://x.de/sitemap2.xml';
  assert.deepEqual(parseRobotsSitemaps(robots), ['https://x.de/sitemap.xml', 'https://x.de/sitemap2.xml']);
});

test('parseSitemapXml: urlset UND sitemapindex', () => {
  const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://x.de/</loc></url><url><loc>https://x.de/team/</loc></url></urlset>`;
  assert.deepEqual(parseSitemapXml(urlset).pages, ['https://x.de/', 'https://x.de/team/']);
  assert.deepEqual(parseSitemapXml(urlset).sitemaps, []);

  const index = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://x.de/sitemap-pages.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(parseSitemapXml(index).sitemaps, ['https://x.de/sitemap-pages.xml']);
  assert.deepEqual(parseSitemapXml(index).pages, []);
});

// ── BFS-Crawl mit Fake-Fetcher (5-Seiten-Mini-Site, ohne Netz) ──────────────────

const SITE = {
  'https://kanzlei.de/': `<html><head><title>Kanzlei Muster</title></head><body>
    <h1>Willkommen</h1>
    <a href="/team/">Unser Team</a>
    <a href="/rechtsgebiete/">Rechtsgebiete</a>
    <a href="/impressum/">Impressum</a>
    <a href="https://extern.de/">Extern</a>
    <a href="/broschuere.pdf">PDF</a>
    <p>${'Inhalt '.repeat(50)}</p></body></html>`,
  'https://kanzlei.de/team': `<html><head><title>Team</title></head><body><h1>Team</h1>
    <a href="/team/anna-muster/">Anna Muster</a></body></html>`,
  'https://kanzlei.de/team/anna-muster': `<html><head><title>Anna Muster</title></head><body>
    <h1>Anna Muster</h1><p>Rechtsanwältin seit 2010.</p></body></html>`,
  'https://kanzlei.de/rechtsgebiete': `<html><head><title>Rechtsgebiete</title></head><body>
    <a href="/rechtsgebiete/arbeitsrecht/">Arbeitsrecht</a></body></html>`,
  'https://kanzlei.de/rechtsgebiete/arbeitsrecht': `<html><head><title>Arbeitsrecht</title></head><body>
    <h1>Arbeitsrecht</h1><p>Wir beraten umfassend.</p></body></html>`,
  'https://kanzlei.de/impressum': `<html><head><title>Impressum</title></head><body><h1>Impressum</h1></body></html>`
};

/** Fake-Fetcher: bedient die Mini-Site aus dem Speicher, normalisiert Trailing-Slash. */
function fakeFetcher(url) {
  const key = url.replace(/\/+$/, '') === 'https://kanzlei.de' ? 'https://kanzlei.de/' : url.replace(/\/+$/, '');
  const html = SITE[key] || SITE[key + '/'] || (key.endsWith('/') ? SITE[key.slice(0, -1)] : undefined);
  if (html === undefined) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
  return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
}

test('buildInventory: findet alle Unterseiten per BFS, ohne extern/PDF', async () => {
  const inv = await buildInventory('https://kanzlei.de/', { fetcher: fakeFetcher, maxPages: 20 });
  const paths = inv.map(e => e.path).sort();
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/team'));
  assert.ok(paths.includes('/team/anna-muster'));
  assert.ok(paths.includes('/rechtsgebiete/arbeitsrecht'));
  assert.ok(!paths.some(p => p.includes('broschuere')));   // PDF übersprungen
  assert.ok(!inv.some(e => e.url.includes('extern.de')));  // fremder Host übersprungen
});

test('buildInventory: Linktexte und Titel werden erfasst', async () => {
  const inv = await buildInventory('https://kanzlei.de/', { fetcher: fakeFetcher, maxPages: 20 });
  const anna = inv.find(e => e.path === '/team/anna-muster');
  assert.equal(anna.title, 'Anna Muster');
  assert.ok(anna.linkTexts.includes('Anna Muster'));
  assert.equal(anna.depth, 2);
});

test('buildInventory: maxPages wird respektiert', async () => {
  const inv = await buildInventory('https://kanzlei.de/', { fetcher: fakeFetcher, maxPages: 2, concurrency: 1 });
  assert.ok(inv.length <= 2);
});

test('buildInventory: robots.txt-Sitemap wird als Seed genutzt', async () => {
  const withSitemap = (url) => {
    if (url.endsWith('/robots.txt')) return Promise.resolve({ status: 200, headers: {}, data: 'Sitemap: https://kanzlei.de/sitemap.xml' });
    if (url.endsWith('/sitemap.xml')) return Promise.resolve({
      status: 200, headers: { 'content-type': 'application/xml' },
      data: `<urlset><url><loc>https://kanzlei.de/rechtsgebiete/arbeitsrecht/</loc></url></urlset>`
    });
    return fakeFetcher(url);
  };
  // Homepage ohne Links: Arbeitsrecht ist NUR über die Sitemap auffindbar
  const site = { ...SITE, 'https://kanzlei.de/': '<html><head><title>Leer</title></head><body>Kein Link</body></html>' };
  const fetcher = (url) => {
    if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) return withSitemap(url);
    const key = url.replace(/\/+$/, '') || url;
    const html = site[key] || site[key + '/'] || (url === 'https://kanzlei.de/' ? site['https://kanzlei.de/'] : undefined);
    if (html === undefined) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://kanzlei.de/', { fetcher, maxPages: 20 });
  const arb = inv.find(e => e.path === '/rechtsgebiete/arbeitsrecht');
  assert.ok(arb, 'Sitemap-Seite muss im Inventar sein');
  assert.equal(arb.source, 'sitemap');
});

// ── Klassifizierung (Heuristik, ohne Claude) ────────────────────────────────────

test('heuristicClassify: eindeutige Typen', () => {
  assert.equal(heuristicClassify({ path: '/' }).type, 'home');
  assert.equal(heuristicClassify({ path: '/impressum' }).type, 'legal-impressum');
  assert.equal(heuristicClassify({ path: '/datenschutz' }).type, 'legal-datenschutz');
  assert.equal(heuristicClassify({ path: '/kontakt' }).type, 'contact');
});

test('heuristicClassify: Team-Übersicht vs. Personen-Profil', () => {
  assert.equal(heuristicClassify({ path: '/rechtsanwaelte' }).type, 'team-overview');
  assert.equal(heuristicClassify({ path: '/rechtsanwaelte/thomas-wilmes' }).type, 'team-profile');
  assert.equal(heuristicClassify({ path: '/team/anna-muster.html' }).type, 'team-profile');
});

test('heuristicClassify: Rechtsgebiete-Übersicht vs. Detailseite', () => {
  assert.equal(heuristicClassify({ path: '/rechtsgebiete' }).type, 'practice-area-overview');
  assert.equal(heuristicClassify({ path: '/rechtsgebiete/arbeitsrecht' }).type, 'practice-area');
  assert.equal(heuristicClassify({ path: '/leistungen/steuerberatung' }).type, 'practice-area');
});

test('classifyInventory ohne Claude: nutzt Heuristik für alle Einträge', async () => {
  const inv = [
    { path: '/', title: 'Home', linkTexts: [] },
    { path: '/team/anna-muster', title: 'Anna Muster', linkTexts: ['Anna Muster'] },
    { path: '/irgendwas', title: 'Sonstiges', linkTexts: [] }
  ];
  const out = await classifyInventory(inv, { useClaude: false });
  assert.equal(out.length, 3);
  assert.equal(out[0].type, 'home');
  assert.equal(out[1].type, 'team-profile');
  assert.equal(out[2].type, 'other');
  // Eingabe darf nicht mutiert werden
  assert.equal(inv[0].type, undefined);
});

// ── Vollständigkeits-Garantien: Charset, Frames, Query-Nav, base-href, Redirect ──
// Alte Praxis-/Kanzlei-Sites sind Latin-1, nutzen Framesets, TYPO3-?id=-Navigation
// oder <base href> — der Crawl muss ALLE Unterseiten trotzdem finden.

test('buildInventory: dekodiert ISO-8859-1 via Content-Type-Header (kein Mojibake)', async () => {
  const latin1 = (s) => Buffer.from(s, 'latin1');
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({
      status: 200,
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      data: latin1('<html><head><title>Über uns - Praxis Müller</title></head><body><h1>Wärme- und Kältetherapie</h1></body></html>')
    });
  };
  const inv = await buildInventory('https://praxis.de/', { fetcher, maxPages: 1 });
  assert.equal(inv[0].title, 'Über uns - Praxis Müller');
  assert.equal(inv[0].h1, 'Wärme- und Kältetherapie');
});

test('buildInventory: dekodiert ISO-8859-1 via <meta charset> ohne Header-Angabe', async () => {
  const latin1 = (s) => Buffer.from(s, 'latin1');
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: latin1('<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Krankengymnastik für Sie</title></head><body><h1>Schön, dass Sie da sind</h1></body></html>')
    });
  };
  const inv = await buildInventory('https://praxis.de/', { fetcher, maxPages: 1 });
  assert.equal(inv[0].title, 'Krankengymnastik für Sie');
  assert.equal(inv[0].h1, 'Schön, dass Sie da sind');
});

test('buildInventory: findet Unterseiten hinter <frameset>/<iframe> (alte Sites)', async () => {
  const pages = {
    'https://alt.de/': '<html><frameset cols="200,*"><frame src="nav.html"><frame src="haupt.html"></frameset></html>',
    'https://alt.de/nav.html': '<html><body><a href="leistungen.html">Leistungen</a></body></html>',
    'https://alt.de/haupt.html': '<html><body><h1>Willkommen</h1><iframe src="karte.html"></iframe></body></html>',
    'https://alt.de/leistungen.html': '<html><head><title>Leistungen</title></head><body><h1>Leistungen</h1></body></html>',
    'https://alt.de/karte.html': '<html><body><h1>Anfahrt</h1></body></html>'
  };
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    const html = pages[url] || pages[url.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://alt.de/', { fetcher, maxPages: 20 });
  const paths = inv.map(e => e.path);
  assert.ok(paths.includes('/nav.html'), 'Frame-Quelle gecrawlt');
  assert.ok(paths.includes('/leistungen.html'), 'Link IN einem Frame gefunden');
  assert.ok(paths.includes('/karte.html'), 'iframe-Quelle gecrawlt');
});

test('buildInventory: folgt TYPO3-Query-Navigation (?id=) und strippt Tracking-Params', async () => {
  const pages = {
    'https://t3.de/': '<html><body><a href="/index.php?id=2&utm_source=alt">Team</a> <a href="/index.php?id=3">Leistungen</a></body></html>',
    'https://t3.de/index.php?id=2': '<html><head><title>Team</title></head><body><h1>Team</h1></body></html>',
    'https://t3.de/index.php?id=3': '<html><head><title>Leistungen</title></head><body><h1>Leistungen</h1></body></html>'
  };
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    const key = url.replace(/&utm_source=[^&]*/, '');
    const html = pages[key] || pages[key.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://t3.de/', { fetcher, maxPages: 20 });
  const titles = inv.map(e => e.title).sort();
  assert.ok(titles.includes('Team'), 'Query-Seite ?id=2 gecrawlt');
  assert.ok(titles.includes('Leistungen'), 'Query-Seite ?id=3 gecrawlt');
  assert.ok(!inv.some(e => e.url.includes('utm_source')), 'Tracking-Param gestrippt');
});

test('buildInventory: respektiert <base href> bei relativen Links', async () => {
  const pages = {
    'https://k.de/': '<html><head><base href="https://k.de/unter/"></head><body><a href="seite.html">Seite</a></body></html>',
    'https://k.de/unter/seite.html': '<html><head><title>Unterseite</title></head><body><h1>Unterseite</h1></body></html>'
  };
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    const html = pages[url] || pages[url.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://k.de/', { fetcher, maxPages: 10 });
  assert.ok(inv.some(e => e.path === '/unter/seite.html'), 'Link relativ zur <base href> aufgelöst');
});

test('buildInventory: Seed-Redirect auf anderen Host wird re-basiert (alte-domain → neue-domain)', async () => {
  const pages = {
    'https://neu.de/': '<html><head><title>Neu</title></head><body><a href="/team.html">Team</a></body></html>',
    'https://neu.de/team.html': '<html><head><title>Team</title></head><body><h1>Team</h1></body></html>'
  };
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    if (url.replace(/\/$/, '') === 'https://alt.de') {
      return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: pages['https://neu.de/'], finalUrl: 'https://neu.de/' });
    }
    const html = pages[url] || pages[url.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://alt.de/', { fetcher, maxPages: 10 });
  assert.ok(inv.some(e => e.title === 'Team'), 'Unterseite des Redirect-Ziels gecrawlt');
});

test('normalizeUrl: Tracking-Parameter fliegen aus dem Dedup-Schlüssel', () => {
  const base = 'https://x.de/';
  assert.equal(
    normalizeUrl('/seite?utm_source=nl&id=5', base),
    normalizeUrl('/seite?id=5', base)
  );
  assert.equal(normalizeUrl('/seite?utm_source=nl', base), normalizeUrl('/seite', base));
});

test('buildInventory: canonical-Duplikate (TYPO3 ?it=…-Zweit-URLs) kollabieren auf die saubere URL', async () => {
  const profil = '<html><head><title>Anna Muster</title><link rel="canonical" href="https://k.de/team/anna"></head><body><h1>Anna Muster</h1></body></html>';
  const pages = {
    'https://k.de/': '<html><body><a href="/team/anna">Anna</a> <a href="/index.php?it=team%2Fanna%2F">Anna (Query)</a></body></html>',
    'https://k.de/team/anna': profil,
    'https://k.de/index.php?it=team%2Fanna%2F': profil
  };
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    const html = pages[url] || pages[url.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://k.de/', { fetcher, maxPages: 20 });
  const annas = inv.filter(e => e.title === 'Anna Muster');
  assert.equal(annas.length, 1, 'Duplikat via canonical erkannt: ' + annas.map(e => e.path).join(', '));
  assert.equal(annas[0].path, '/team/anna', 'die KANONISCHE URL bleibt im Inventar');
});

test('buildInventory: kaputtes Homepage-canonical (alle Seiten → /) verwirft KEINE Unterseiten', async () => {
  const canonHome = (title) => `<html><head><title>${title}</title><link rel="canonical" href="https://k.de/"></head><body><h1>${title}</h1></body></html>`;
  const pages = {
    'https://k.de/': '<html><body><a href="/team">Team</a></body></html>',
    'https://k.de/team': canonHome('Team')
  };
  const fetcher = (url) => {
    if (/robots|sitemap/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    const html = pages[url] || pages[url.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://k.de/', { fetcher, maxPages: 20 });
  assert.ok(inv.some(e => e.path === '/team'), 'Unterseite bleibt trotz fehlkonfiguriertem canonical');
});

test('normalizeUrl: http- und https-Variante derselben Seite haben EINEN Dedup-Schlüssel', () => {
  const base = 'https://x.de/';
  assert.equal(normalizeUrl('http://x.de/team', base), normalizeUrl('https://x.de/team', base));
  assert.equal(normalizeUrl('http://www.x.de/team/', base), normalizeUrl('https://x.de/team', base));
});

test('buildInventory: Query-Zweit-URL mit IDENTISCHEM Inhalt fällt weg (auch ohne brauchbares canonical)', async () => {
  // Wie TYPO3-Sites, deren ?it=-Variante ein kaputtes canonical (auf die Homepage) trägt:
  // gleicher Inhalt unter sauberem Pfad UND Query-URL → nur der saubere Pfad bleibt.
  const profil = '<html><head><title>Heinrich Muster</title><link rel="canonical" href="https://k.de/"></head><body><h1>Heinrich Muster</h1><p>Fachanwalt für Arbeitsrecht.</p></body></html>';
  const pages = {
    'https://k.de/': '<html><body><a href="/team/heinrich">Heinrich</a> <a href="/index.php?it=team%2Fheinrich%2F">Heinrich (Query)</a> <a href="/kontakt">Kontakt</a></body></html>',
    'https://k.de/team/heinrich': profil,
    'https://k.de/index.php?it=team%2Fheinrich%2F': profil,
    'https://k.de/kontakt': '<html><head><title>Kontakt</title></head><body><h1>Kontakt</h1></body></html>'
  };
  const fetcher = (url) => {
    if (/robots|sitemap\.xml/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    const html = pages[url] || pages[url.replace(/\/$/, '')];
    if (!html) { const e = new Error('404'); e.response = { status: 404 }; return Promise.reject(e); }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: html });
  };
  const inv = await buildInventory('https://k.de/', { fetcher, maxPages: 20 });
  const heinrichs = inv.filter(e => e.title === 'Heinrich Muster');
  assert.equal(heinrichs.length, 1, 'Inhalts-Dublette erkannt: ' + heinrichs.map(e => e.path).join(', '));
  assert.equal(heinrichs[0].path, '/team/heinrich', 'der saubere Pfad gewinnt');
  assert.ok(inv.some(e => e.path === '/kontakt'), 'andere Seiten unberührt');
});
