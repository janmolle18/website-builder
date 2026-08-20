/**
 * faq.js — FAQ-Sektion + FAQPage-Schema (SEO + GEO)
 *
 * FAQ ist einer der stärksten Hebel für lokale Anwalts-/Dienstleister-Sites:
 *   - SEO: FAQPage-JSON-LD → Rich Results / mehr SERP-Fläche
 *   - GEO: LLMs/AI-Suchen zitieren strukturierte FAQ-Inhalte bevorzugt
 *
 * generateFaq erzeugt sachliche, ALLGEMEIN gültige Fragen/Antworten (keine erfundenen
 * Preise/Fristen) per Haiku über das Abo. Die Sektion ist deterministisch (DNA-gestylt,
 * natives <details>-Accordion, ohne JS nutzbar). Wird NACH der QA injiziert (überlebt
 * Auto-Fixes) und das Schema in den <head> geschrieben. Idempotent (data-faq).
 *
 * Doku: 20_PROJECTS/Website-Builder/SEO.md
 */

const cheerio = require('cheerio');
const { callClaude } = require('./claude-cli');
const { jsonLdSafe } = require('./seo'); // </script>-sichere JSON-LD-Serialisierung

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Erzeugt sachliche FAQs für ein Projekt (branchenübergreifend). Antworten bewusst
 * allgemein gültig — keine erfundenen Preise/Fristen/Zusagen.
 * @returns {Promise<{q:string,a:string}[]>}
 */
async function generateFaq(project) {
  const prompt = `Erstelle 12 häufige Fragen (FAQ) mit Antworten für die Website von "${project.name}" (${project.category || 'lokales Unternehmen'}).
Zielgruppe: potenzielle Mandanten/Kunden.
${(project.specialties || []).length ? `Schwerpunkte: ${project.specialties.join(', ')}.` : ''}

REGELN:
- ANSWER-FIRST: Der ERSTE Satz jeder Antwort ist eine direkte, in sich verständliche, zitierfähige Antwort auf die Frage (auch ohne die Frage lesbar). Erst danach optionaler Kontext (max. 2 weitere Sätze).
- Antworten sachlich, seriös, ALLGEMEIN gültig. KEINE erfundenen Preise, Fristen, Erfolgsquoten oder kanzleispezifischen Zusagen.
- Wo Details variieren (z. B. Kosten), auf ein persönliches Erstgespräch/Kontakt verweisen.
- Deutsch, echte Umlaute (ä ö ü ß), KEINE Gedankenstriche und kein "--".
- Jede Antwort 1 bis 3 Sätze.

Antworte NUR mit einem JSON-Array (kein Markdown):
[{"q":"Frage?","a":"Direkte Antwort im ersten Satz. Optionaler Kontext."}]`;

  try {
    const txt = await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' });
    const m = txt.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      return arr.filter(x => x && x.q && x.a).map(x => ({ q: String(x.q).trim(), a: String(x.a).trim() })).slice(0, 14);
    }
  } catch (e) {
    console.warn('   ⚠️ FAQ-Generierung fehlgeschlagen:', e.message);
  }
  return [];
}

/** FAQPage-JSON-LD (schema.org) aus den FAQs. */
function faqJsonLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(x => ({
      '@type': 'Question',
      name: x.q,
      acceptedAnswer: { '@type': 'Answer', text: x.a }
    }))
  };
}

/** Deterministische, DNA-gestylte FAQ-Sektion (natives <details>-Accordion). */
function renderFaqSection(project, dna) {
  const faq = project.faq || [];
  if (!faq.length) return '';
  const p = (dna && dna.palette) || { bg: '#F5F4F1', surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C' };
  const f = (dna && dna.fonts) || { heading: 'Fraunces', body: 'Inter' };

  const items = faq.map(x => `<details class="faq-i">
    <summary>${esc(x.q)}</summary>
    <div class="faq-a">${esc(x.a)}</div>
  </details>`).join('\n');

  return `<section data-faq style="background:${p.bg};padding:clamp(3rem,7vw,6rem) clamp(1.2rem,4vw,3rem)">
  <style>
    [data-faq] .faq-wrap{max-width:820px;margin:0 auto}
    [data-faq] .faq-k{font-family:'${f.heading}',serif;letter-spacing:.18em;text-transform:uppercase;color:${p.accent};font-size:.8rem;margin:0 0 .6rem}
    [data-faq] h2{font-family:'${f.heading}',serif;font-weight:600;font-size:clamp(1.8rem,1.2rem+2vw,2.8rem);line-height:1.1;margin:0 0 2rem;color:${p.text}}
    [data-faq] .faq-i{border-bottom:1px solid color-mix(in oklab,${p.text} 12%,transparent)}
    [data-faq] .faq-i summary{cursor:pointer;list-style:none;padding:1.1rem 0;font-family:'${f.heading}',serif;font-size:1.12rem;color:${p.text};display:flex;justify-content:space-between;gap:1rem;align-items:center}
    [data-faq] .faq-i summary::-webkit-details-marker{display:none}
    [data-faq] .faq-i summary::after{content:"+";color:${p.accent};font-size:1.4rem;line-height:1;transition:transform .2s}
    [data-faq] .faq-i[open] summary::after{transform:rotate(45deg)}
    [data-faq] .faq-a{padding:0 0 1.2rem;color:color-mix(in oklab,${p.text} 84%,${p.muted});max-width:70ch;line-height:1.7}
  </style>
  <div class="faq-wrap">
    <p class="faq-k">FAQ</p>
    <h2>Häufige Fragen</h2>
    ${items}
  </div>
</section>`;
}

/**
 * Injiziert die FAQ-Sektion (vor dem Footer) + FAQPage-JSON-LD (in den <head>).
 * @returns {{html:string, injected:boolean}}
 */
function injectFaq(html, project, dna) {
  const faq = project.faq || [];
  if (!faq.length) return { html, injected: false };

  const $ = cheerio.load(html, { decodeEntities: false });
  let changed = false;

  // Sektion vor dem Footer einsetzen — nur wenn noch keine vorhanden ist.
  if (!$('[data-faq]').length) {
    const section = renderFaqSection(project, dna);
    const footer = $('footer').first();
    if (footer.length) footer.before(section);
    else if ($('main').length) $('main').first().append(section);
    else $('body').append(section);
    changed = true;
  }

  // FAQPage-Schema IMMER sicherstellen (idempotent): vorhandenes FAQPage-Script
  // entfernen, dann frisch setzen. Pflicht, weil applySEO ALLE ld+json strippt und
  // neu schreibt — ohne dieses Re-Injizieren ginge das FAQ-Schema bei jedem
  // erneuten Lauf verloren, sobald die Sektion bereits existierte.
  $('script[type="application/ld+json"]').each((i, el) => {
    if (/"FAQPage"/.test($(el).text())) { $(el).remove(); }
  });
  const ld = `<script type="application/ld+json">\n${jsonLdSafe(faqJsonLd(faq))}\n</script>`;
  if ($('head').length) $('head').append(ld);
  else $.root().prepend(ld);

  return { html: $.html(), injected: true };
}

module.exports = { generateFaq, renderFaqSection, faqJsonLd, injectFaq };
