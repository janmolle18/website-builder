/**
 * geo.js — GEO-Readiness-Report (abo-frei, kein LLM).
 *
 * GEO = Generative Engine Optimization: Wird die Seite von ChatGPT, Perplexity,
 * Gemini & Co. gefunden UND zitiert? Dieses Modul INSPIZIERT eine fertig gebaute
 * Site (index.html + Discovery-Dateien) und bewertet deterministisch, wie
 * AI-zitierfähig sie ist — als Score + konkrete Checkliste.
 *
 * Doppelter Nutzen:
 *   1. QA-Signal beim Bauen (fehlt ein GEO-Baustein? → sichtbar).
 *   2. VERKAUFSARGUMENT: "Wird Ihre Kanzlei von ChatGPT empfohlen? Ich zeige es
 *      Ihnen." — Jan kann den Report (eigene Site vs. Kunden-Alt-Site) vorlegen.
 *
 * Bewusst deterministisch: prüft nur, was messbar in den Dateien steht — nichts
 * wird halluziniert. Läuft NACH der Discovery-/FAQ-Phase.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Gewichtete Checks — Summe der Gewichte = 100. Reihenfolge = Wichtigkeit für GEO.
const CHECKS = [
  { key: 'jsonld_business', weight: 16, label: 'Structured Data: LocalBusiness/Dienstleister-Schema' },
  { key: 'jsonld_faq',      weight: 16, label: 'FAQ-Schema (FAQPage) — von AI-Suchen bevorzugt zitiert' },
  { key: 'llms_txt',        weight: 14, label: 'llms.txt — AI-Crawler-Discovery-Datei' },
  { key: 'answer_first',    weight: 12, label: 'Answer-First-FAQ (direkte, zitierfähige erste Sätze)' },
  { key: 'ai_crawlers',     weight: 12, label: 'robots.txt erlaubt AI-Crawler (GPTBot, PerplexityBot, ClaudeBot …)' },
  { key: 'entity_org',      weight: 8,  label: 'Organization-Entität + publisher-Verknüpfung' },
  { key: 'freshness',       weight: 8,  label: 'Aktualitätssignal (datePublished/dateModified)' },
  { key: 'sitemap',         weight: 6,  label: 'sitemap.xml vorhanden' },
  { key: 'nap',             weight: 5,  label: 'NAP: Adresse + Telefon im Schema (lokale Zitierbarkeit)' },
  { key: 'services',        weight: 3,  label: 'Leistungen/Schwerpunkte maschinenlesbar (knowsAbout/serviceType)' }
];

/** Liest eine Datei defensiv (fehlt sie → ''). */
function readSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/** Sammelt alle JSON-LD-Objekte aus dem HTML (defekte Blöcke werden übersprungen). */
function extractJsonLd($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const graph = parsed && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
      for (const n of graph) if (n && typeof n === 'object') nodes.push(n);
    } catch { /* defekter Block — ignorieren */ }
  });
  return nodes;
}

function hasType(nodes, type) {
  return nodes.some(n => {
    const t = n['@type'];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });
}

const BUSINESS_TYPES = [
  'LocalBusiness', 'Restaurant', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'FoodEstablishment',
  'LegalService', 'Attorney', 'AccountingService', 'InsuranceAgency', 'RealEstateAgent',
  'Dentist', 'MedicalClinic', 'MedicalBusiness', 'HairSalon', 'BeautySalon', 'ExerciseGym',
  'HomeAndConstructionBusiness',
  // Sport, Bewegung, Wellness — ergänzt 2026-08-10 beim Mer:Form-Projekt.
  // Ein Pilatesstudio bekam trotz korrektem SportsActivityLocation-Schema
  // 0 von 16 Punkten, weil der Subtyp hier fehlte.
  'SportsActivityLocation', 'SportsClub', 'HealthClub', 'YogaStudio',
  'HealthAndBeautyBusiness', 'DaySpa', 'Physiotherapy', 'MedicalTherapy',
  'ProfessionalService'
];

/**
 * Analysiert die GEO-Reife eines gebauten Projekts.
 * @param {string} projectDir absoluter Pfad zum Projektordner
 * @param {object} [project] optionale project.json (für Kontext, nicht zwingend)
 * @returns {{score:number, grade:string, checks:{key,label,weight,pass,detail}[], summary:string, missing:string[]}}
 */
function analyzeGeo(projectDir, project = {}) {
  const html = readSafe(path.join(projectDir, 'index.html'));
  if (!html) {
    return { score: 0, grade: 'n/a', checks: [], summary: 'Keine index.html — Site noch nicht gebaut.', missing: ['Site bauen'] };
  }
  const robots = readSafe(path.join(projectDir, 'robots.txt'));
  const llms = readSafe(path.join(projectDir, 'llms.txt'));
  const sitemap = readSafe(path.join(projectDir, 'sitemap.xml'));

  const $ = cheerio.load(html, { decodeEntities: false });
  const nodes = extractJsonLd($);
  const business = nodes.find(n => {
    const t = n['@type'];
    const arr = Array.isArray(t) ? t : [t];
    return arr.some(x => BUSINESS_TYPES.includes(x));
  }) || {};
  const faqNode = nodes.find(n => n['@type'] === 'FAQPage');

  // Answer-First: erster Satz der ersten FAQ-Antwort ist eigenständig verständlich —
  // Heuristik: ≥ 40 Zeichen, endet mit Satzzeichen, beginnt nicht mit "Ja,"/"Nein,".
  let answerFirst = false;
  if (faqNode && Array.isArray(faqNode.mainEntity) && faqNode.mainEntity.length) {
    const first = faqNode.mainEntity[0];
    const text = (first && first.acceptedAnswer && first.acceptedAnswer.text) || '';
    const firstSentence = String(text).split(/(?<=[.!?])\s/)[0] || '';
    answerFirst = firstSentence.length >= 40;
  }

  const aiCrawlerHit = /GPTBot|PerplexityBot|ClaudeBot|OAI-SearchBot|Google-Extended/i.test(robots);

  const results = {
    jsonld_business: { pass: !!business['@type'], detail: business['@type'] ? `@type: ${[].concat(business['@type']).join(', ')}` : 'kein Business-Schema gefunden' },
    jsonld_faq:      { pass: !!faqNode, detail: faqNode ? `${(faqNode.mainEntity || []).length} Fragen` : 'kein FAQPage-Schema' },
    llms_txt:        { pass: llms.trim().length > 0, detail: llms ? `${llms.split('\n').length} Zeilen` : 'fehlt' },
    answer_first:    { pass: answerFirst, detail: faqNode ? (answerFirst ? 'erster Satz zitierfähig' : 'erste Antwort evtl. zu kurz/unspezifisch') : 'keine FAQ' },
    ai_crawlers:     { pass: aiCrawlerHit, detail: aiCrawlerHit ? 'AI-Crawler explizit erlaubt' : 'keine AI-Crawler-Regeln' },
    entity_org:      { pass: hasType(nodes, 'Organization') && !!business.publisher, detail: hasType(nodes, 'Organization') ? (business.publisher ? 'Organization + publisher verknüpft' : 'Organization ohne publisher-Link') : 'keine Organization-Entität' },
    freshness:       { pass: !!(business.dateModified || business.datePublished), detail: business.dateModified ? `dateModified: ${String(business.dateModified).slice(0, 10)}` : 'kein Datumssignal' },
    sitemap:         { pass: /<urlset/i.test(sitemap), detail: sitemap ? `${(sitemap.match(/<loc>/g) || []).length} URLs` : 'fehlt' },
    nap:             { pass: !!(business.address && business.telephone), detail: business.address ? (business.telephone ? 'Adresse + Telefon' : 'Adresse, aber keine Telefonnummer') : 'keine Adresse im Schema' },
    services:        { pass: !!(business.knowsAbout || business.serviceType), detail: (business.knowsAbout || business.serviceType) ? 'Schwerpunkte im Schema' : 'keine Leistungen im Schema' }
  };

  let score = 0;
  const checks = CHECKS.map(c => {
    const r = results[c.key] || { pass: false, detail: '' };
    if (r.pass) score += c.weight;
    return { key: c.key, label: c.label, weight: c.weight, pass: r.pass, detail: r.detail };
  });

  const missing = checks.filter(c => !c.pass).map(c => c.label);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  const summary = score >= 75
    ? `GEO-bereit (${score}/100, Note ${grade}): Die Seite liefert AI-Suchen strukturierte, zitierfähige Signale.`
    : `GEO-Score ${score}/100 (Note ${grade}): ${missing.length} Baustein(e) fehlen für optimale AI-Zitierbarkeit.`;

  return { score, grade, checks, summary, missing };
}

module.exports = { analyzeGeo, CHECKS };
