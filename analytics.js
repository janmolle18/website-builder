/**
 * analytics.js — Analyse + DSGVO-Consent (pro Projekt konfigurierbar)
 *
 * Baut ZWEI Wege ein (frei kombinierbar pro Projekt):
 *   1) Cookieless self-hosted (Plausible/Umami) — anonym, ohne Cookies → KEINE Einwilligung
 *      nötig (TTDSG). Läuft immer. Das ist die Basis, die als monatliches Reporting an
 *      den Kunden weiterverkauft wird.
 *   2) Google Analytics 4 via Consent Mode v2 — lädt ERST nach aktiver Einwilligung über
 *      den Cookie-Banner.
 *
 * Plus: ein seriöser, barrierearmer DSGVO-Cookie-Banner (Akzeptieren/Ablehnen, Link zur
 * Datenschutzerklärung), DNA-gestylt, Wahl in localStorage.
 *
 * Konfiguration pro Projekt: project.analytics = {
 *   plausible:{src,domain}, umami:{src,websiteId}, ga4:{id}, banner:true|false
 * }  — ENV-Defaults: ANALYTICS_PLAUSIBLE_SRC/_DOMAIN, ANALYTICS_UMAMI_SRC/_ID, GA4_MEASUREMENT_ID
 *
 * Bewusst deterministisch (kein LLM). Doku: 20_PROJECTS/Website-Builder/Analytics.md
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Host aus project.siteUrl (für Plausible-Domain als Default). */
function siteHost(project) {
  try { return new URL(project.siteUrl || project.url || '').host || ''; } catch { return ''; }
}

/** Konfiguration aus project.analytics + ENV-Defaults auflösen. */
function resolveConfig(project) {
  const a = project.analytics || {};
  const host = siteHost(project);

  const plSrc = (a.plausible && a.plausible.src) || process.env.ANALYTICS_PLAUSIBLE_SRC || '';
  const plDomain = (a.plausible && a.plausible.domain) || process.env.ANALYTICS_PLAUSIBLE_DOMAIN || host || '';
  const umSrc = (a.umami && a.umami.src) || process.env.ANALYTICS_UMAMI_SRC || '';
  const umId = (a.umami && a.umami.websiteId) || process.env.ANALYTICS_UMAMI_ID || '';
  const ga4 = (a.ga4 && a.ga4.id) || process.env.GA4_MEASUREMENT_ID || '';

  let cookieless = null;
  if (plSrc && plDomain) cookieless = { type: 'plausible', src: plSrc, domain: plDomain };
  else if (umSrc && umId) cookieless = { type: 'umami', src: umSrc, id: umId };

  // Cookie-Banner NUR, wenn ein einwilligungspflichtiges Tool (GA4) aktiv ist. Cookieless
  // (Plausible/Umami) und "keine Analytics" setzen keine Cookies → KEIN Banner (DSGVO-sauber,
  // kein irreführender Banner ohne Tracking).
  const banner = !!ga4;
  const enabled = !!(cookieless || ga4);
  return { cookieless, ga4, banner, enabled };
}

/** Cookieless-Snippet (lädt ohne Consent — anonym). */
function cookielessSnippet(c) {
  if (!c) return '';
  if (c.type === 'plausible') {
    return `<script defer data-domain="${esc(c.domain)}" src="${esc(c.src)}"></script>`;
  }
  return `<script defer src="${esc(c.src)}" data-website-id="${esc(c.id)}"></script>`;
}

/** Consent-Mode-v2-Bootstrap im <head> (nur wenn GA4 aktiv). Default: alles denied. */
function consentBootstrap(ga4) {
  if (!ga4) return '';
  return `<script data-consent-bootstrap>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});
gtag('js',new Date());
</script>`;
}

/** Banner + Consent-Logik vor </body>. */
function bannerBlock(cfg, dna, datenschutzHref) {
  if (!cfg.banner) {
    // Kein Banner, aber GA evtl. trotzdem nie ohne Consent — ohne Banner kein GA laden.
    return '';
  }
  const p = (dna && dna.palette) || { surface: '#ffffff', text: '#15161A', muted: '#5A5A66', accent: '#3B5BDB' };
  const ga4 = cfg.ga4 || '';

  return `
<div id="cc-banner" role="dialog" aria-live="polite" aria-label="Datenschutz-Einstellungen" hidden
  style="position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:9999;max-width:640px;margin:0 auto;
  background:${p.surface};color:${p.text};border:1px solid color-mix(in oklab,${p.text} 14%,transparent);
  border-radius:14px;padding:1.1rem 1.2rem;box-shadow:0 18px 50px -12px rgba(0,0,0,.35);font-family:inherit;font-size:.92rem;line-height:1.55">
  <p style="margin:0 0 .85rem">Wir nutzen anonyme Reichweitenmessung. Mit „Akzeptieren&#34; willigen Sie zusätzlich in
  statistische Analyse (Google Analytics) ein. Details in der
  <a href="${esc(datenschutzHref)}" style="color:${p.accent}">Datenschutzerklärung</a>.</p>
  <div style="display:flex;gap:.6rem;flex-wrap:wrap">
    <button id="cc-accept" type="button" style="cursor:pointer;border:0;border-radius:9px;padding:.6rem 1.1rem;
      font:inherit;font-weight:600;background:${p.accent};color:#fff">Akzeptieren</button>
    <button id="cc-reject" type="button" style="cursor:pointer;border:1px solid color-mix(in oklab,${p.text} 22%,transparent);
      border-radius:9px;padding:.6rem 1.1rem;font:inherit;background:transparent;color:${p.text}">Ablehnen</button>
  </div>
</div>
<script data-consent-banner>
(function(){
  var KEY='cc-consent-v1', GA=${JSON.stringify(ga4)};
  var b=document.getElementById('cc-banner');
  function loadGA(){
    if(!GA) return;
    if(window.__gaLoaded) return; window.__gaLoaded=true;
    var s=document.createElement('script'); s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+GA; document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];
    function gtag(){dataLayer.push(arguments);} window.gtag=window.gtag||gtag;
    gtag('config', GA, {anonymize_ip:true});
  }
  function grant(){ if(window.gtag){gtag('consent','update',{analytics_storage:'granted'});} loadGA(); }
  function hide(){ if(b){b.hidden=true;} }
  var saved=null; try{saved=localStorage.getItem(KEY);}catch(e){}
  if(saved==='granted'){ grant(); }
  else if(saved==='denied'){ /* nur cookieless, nichts laden */ }
  else if(b){ b.hidden=false; }
  var ok=document.getElementById('cc-accept'), no=document.getElementById('cc-reject');
  if(ok) ok.addEventListener('click',function(){try{localStorage.setItem(KEY,'granted');}catch(e){} grant(); hide();});
  if(no) no.addEventListener('click',function(){try{localStorage.setItem(KEY,'denied');}catch(e){} hide();});
})();
</script>`;
}

/**
 * Injiziert Analytics + Consent-Banner in die generierte index.html.
 * @param {string} html
 * @param {object} project   project.json (nutzt project.analytics, .siteUrl, .legal)
 * @param {object} [dna]     für Banner-Styling (Palette)
 * @returns {{html:string, audit:object}}
 */
function applyAnalytics(html, project, dna) {
  const cfg = resolveConfig(project);
  if (!cfg.enabled) return { html, audit: { enabled: false } };
  if (/data-consent-banner|data-consent-bootstrap/.test(html)) return { html, audit: { enabled: true, already: true } };

  // Datenschutz-Link: eigene Seite, wenn vorhanden, sonst Anker.
  const datenschutzHref = (project.legal && project.legal.datenschutz) ? 'datenschutz.html' : '#datenschutz';

  // <head>: Consent-Bootstrap (nur GA) + cookieless Snippet (immer).
  const headBlock = [consentBootstrap(cfg.ga4), cookielessSnippet(cfg.cookieless)].filter(Boolean).join('\n');
  let out = html;
  if (headBlock) {
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, headBlock + '\n</head>');
    else out = headBlock + '\n' + out;
  }

  // vor </body>: Banner + Consent-Logik.
  const body = bannerBlock(cfg, dna, datenschutzHref);
  if (body) {
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, body + '\n</body>');
    else out = out + body;
  }

  return {
    html: out,
    audit: {
      enabled: true,
      cookieless: cfg.cookieless ? cfg.cookieless.type : null,
      ga4: !!cfg.ga4,
      banner: cfg.banner
    }
  };
}

module.exports = { applyAnalytics, resolveConfig };
