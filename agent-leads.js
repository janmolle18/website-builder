require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { callClaude } = require('./claude-cli');
const { auditProspect } = require('./prospect-audit');
const { applyScoring, qualifyLead } = require('./lead-scoring');
const { lookupPlace } = require('./places-lead-check');

const LEADS_FILE = path.join(__dirname, 'projects', 'leads.json');

// ── Verticals (Entscheidung 2026-07-03: Gastro bleibt drin, Kanzlei/Praxis dazu) ──
// Jeder Vertical bringt eigene OSM-Selektoren (Overpass) + die Kategorien, die er abdeckt.
// Fokus: Kanzlei/Steuerberater/Notar + Praxen; Gastro als zweites Standbein.
const VERTICALS = {
  gastro: {
    label: 'Gastro',
    selectors: [['amenity', 'restaurant|cafe|bar|fast_food|pub']],
    categories: ['restaurant', 'cafe', 'bar', 'fast_food', 'pub'],
  },
  kanzlei: {
    label: 'Kanzlei',
    // office=lawyer (Anwalt), office=tax_advisor (Steuerberater), office=notary (Notar)
    selectors: [['office', 'lawyer|tax_advisor|notary']],
    categories: ['lawyer', 'tax_advisor', 'notary'],
  },
  praxis: {
    label: 'Praxis',
    // amenity=doctors/dentist + healthcare=* (Arzt/Zahnarzt/Physio)
    selectors: [
      ['amenity', 'doctors|dentist'],
      ['healthcare', 'doctor|dentist|physiotherapist|psychotherapist'],
    ],
    categories: ['doctors', 'dentist', 'doctor', 'physiotherapist', 'psychotherapist'],
  },
};

const ALL_VERTICALS = Object.keys(VERTICALS);

/** Unbekannte/leere Vertical-Auswahl → sicher auf alle bekannten normalisieren. */
function normalizeVerticals(input) {
  const list = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(',') : []);
  const cleaned = list.map(v => String(v).trim().toLowerCase()).filter(v => VERTICALS[v]);
  return cleaned.length ? [...new Set(cleaned)] : [...ALL_VERTICALS];
}

function loadLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    console.error('leads.json unlesbar — leere Liste wird verwendet');
    return [];
  }
}

function saveLeads(leads) {
  fs.mkdirSync(path.dirname(LEADS_FILE), { recursive: true });
  const tmp = LEADS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 2), 'utf8');
  fs.renameSync(tmp, LEADS_FILE);
}

// ── OSM/Overpass ─────────────────────────────────────────────────────────────
async function geocodeCity(city) {
  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: city, format: 'json', limit: 1, countrycodes: 'de' },
    headers: { 'User-Agent': 'RestaurantBuilder/1.0' },
    timeout: 10000
  });
  if (!res.data.length) throw new Error(`Stadt nicht gefunden: ${city}`);
  const { boundingbox, display_name } = res.data[0];
  return {
    south: parseFloat(boundingbox[0]),
    north: parseFloat(boundingbox[1]),
    west: parseFloat(boundingbox[2]),
    east: parseFloat(boundingbox[3]),
    displayName: display_name
  };
}

const OVERPASS_ENDPOINTS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Overpass blockt Requests mit dem axios-Default-UA per WAF (HTTP 406).
// Ein beschreibender User-Agent (Overpass-Etikette) ist Pflicht, sonst kommen 0 Leads.
const OVERPASS_UA = 'RestaurantBuilder/1.0 (Lead-Scan; Kontakt: kontakt@restaurant-builder.local)';

/** Baut eine Overpass-Query, die alle gewählten Verticals in einer Union abfragt. */
function buildOverpassQuery(bbox, verticals) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const parts = [];
  for (const v of normalizeVerticals(verticals)) {
    for (const [key, valueAlt] of VERTICALS[v].selectors) {
      parts.push(`  node["${key}"~"^(${valueAlt})$"](${b});`);
      parts.push(`  way["${key}"~"^(${valueAlt})$"](${b});`);
    }
  }
  return `[out:json][timeout:60];\n(\n${parts.join('\n')}\n);\nout body center;`;
}

async function fetchElementsFromOverpass(bbox, verticals) {
  const query = buildOverpassQuery(bbox, verticals);
  let lastError;
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    if (i > 0) await new Promise(r => setTimeout(r, 3000)); // 3s Pause zwischen Versuchen
    try {
      const res = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_UA },
        timeout: 90000
      });
      return res.data.elements;
    } catch (e) {
      const status = e.response?.status;
      console.warn(`⚠️ Overpass ${endpoint} fehlgeschlagen: ${status || e.message}`);
      if (status === 429) await new Promise(r => setTimeout(r, 30000)); // 30s warten bei Rate Limit
      lastError = e;
    }
  }
  throw new Error(`Alle Overpass-Endpoints fehlgeschlagen: ${lastError.message}`);
}

/** Primär-Kategorie eines OSM-Elements (z. B. 'lawyer', 'restaurant', 'dentist'). */
function categoryOf(tags = {}) {
  if (tags.office && /^(lawyer|tax_advisor|notary)$/.test(tags.office)) return tags.office;
  if (tags.amenity && /^(restaurant|cafe|bar|fast_food|pub|doctors|dentist)$/.test(tags.amenity)) return tags.amenity;
  if (tags.healthcare) return tags.healthcare;
  return tags.amenity || tags.office || tags.shop || '';
}

/** Kategorie → Vertical-Bucket. */
function verticalOf(category = '') {
  if (/^(lawyer|tax_advisor|notary)$/.test(category)) return 'kanzlei';
  if (/^(doctors|dentist|doctor|physiotherapist|psychotherapist)$/.test(category) || /health/.test(category)) return 'praxis';
  return 'gastro';
}

const VERTICAL_LABEL = { gastro: 'Gastro', kanzlei: 'Kanzlei', praxis: 'Praxis' };

/** OSM-Element → neutrales Business-Objekt (branchenübergreifend). */
function osmToBusiness(el) {
  const tags = el.tags || {};
  const lat = el.lat || el.center?.lat;
  const lon = el.lon || el.center?.lon;
  const street = tags['addr:street'] || '';
  const num = tags['addr:housenumber'] || '';
  const city = tags['addr:city'] || '';
  const postcode = tags['addr:postcode'] || '';
  const addressParts = [street + (num ? ' ' + num : ''), (postcode + (city ? ' ' + city : '')).trim()].filter(Boolean);
  const category = categoryOf(tags);
  const vertical = verticalOf(category);
  return {
    osmId: `${el.type}/${el.id}`,
    name: tags.name || '',
    address: addressParts.join(', '),
    phone: tags.phone || tags['contact:phone'] || '',
    email: tags.email || tags['contact:email'] || '',
    website: tags.website || tags['contact:website'] || null,
    cuisine: tags.cuisine || '',
    category,
    vertical,
    verticalLabel: VERTICAL_LABEL[vertical],
    openingHours: tags.opening_hours ? [tags.opening_hours] : [],
    city,
    lat,
    lon
  };
}

/** OSM-Elemente → deduplizierte, benannte Business-Liste (pure, testbar). */
function elementsToBusinesses(elements, { existingIds = new Set(), maxResults = 120 } = {}) {
  const seen = new Set();
  const out = [];
  for (const el of elements || []) {
    if (!el.tags?.name) continue;
    const biz = osmToBusiness(el);
    if (!biz.name || existingIds.has(biz.osmId) || seen.has(biz.osmId)) continue;
    seen.add(biz.osmId);
    out.push(biz);
    if (out.length >= maxResults) break;
  }
  return out;
}

// ── Optionaler LLM-Pitch (default AUS: abo-frei + kein Kalt-Mail-Text, UWG §7) ──
async function analyzeLeadWithClaude(biz, audit) {
  const prompt = `Du bist ein Website-Verkäufer. Analysiere diesen Betrieb und schreibe einen kurzen, personalisierten Gesprächsaufhänger (max 3 Sätze) für einen LinkedIn-Erstkontakt (KEINE Kalt-Mail).

Betrieb: ${biz.name}
Branche: ${biz.verticalLabel} (${biz.category})
Adresse: ${biz.address}
Website-Befund: ${(audit.evidence || []).join('; ') || audit.pitchHook || 'unklar'}

Schreibe NUR den personalisierten Aufhänger (keine Anrede, kein Betreff). Beziehe dich spezifisch auf den Betrieb. Auf Deutsch.`;
  try {
    return (await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' })).trim();
  } catch (e) {
    console.warn(`⚠️ Claude-Aufhänger fehlgeschlagen für ${biz.name}: ${e.message}`);
    return null;
  }
}

/** Business + Audit → fertiges Lead-Objekt (Schema v2, Bucket/Score via lead-scoring). */
function toLead(biz, audit, city, pitchText = null) {
  return applyScoring({
    id: uuidv4(),
    schemaVersion: 2,
    osmId: biz.osmId,
    name: biz.name,
    address: biz.address,
    city: biz.city || city,
    phone: biz.phone,
    email: biz.email,
    website: biz.website,
    category: biz.category,
    branche: biz.verticalLabel,
    vertical: biz.vertical,
    verticalLabel: biz.verticalLabel,
    audit,                                   // { verdict, needScore, evidence, pitchHook, reachable, url, unverified? }
    types: [biz.category, biz.cuisine].filter(Boolean),
    cuisine: biz.cuisine,
    openingHours: biz.openingHours,
    googleMapsUrl: biz.lat ? `https://www.openstreetmap.org/#map=18/${biz.lat}/${biz.lon}` : '',
    status: 'new',
    pitchText,
    foundAt: new Date().toISOString(),
    region: city,
    source: 'osm',
    places: null,
    ansprechpartner: '',
    outreach: { channel: null, variant: null, sentAt: null, repliedAt: null, nextActionAt: null },
    activity: [],
    archived: false,
    archivedAt: null,
    archivedReason: null
  });
}

/**
 * Multi-Vertical-Lead-Suche: OSM-Betriebe finden → prospect-audit (abo-frei, konservativ)
 * → nur echter Website-Bedarf landet in der Pipeline.
 *
 * @param {object} options
 *   city, verticals (['gastro','kanzlei','praxis']), maxResults, onlyQualified (skip 'skip'),
 *   withPitch (LLM-Aufhänger, default false = abo-frei), onProgress
 * @param {object} deps  Test-Injektion: { geocode, fetchElements, audit, pitch }
 */
async function findLeads(options = {}, deps = {}) {
  const {
    city = 'Paderborn',
    verticals,
    maxResults = 120,
    onlyQualified = true,
    withPitch = false,
    onProgress = null
  } = options;

  const geocode = deps.geocode || geocodeCity;
  const fetchElements = deps.fetchElements || fetchElementsFromOverpass;
  const audit = deps.audit || auditProspect;
  const pitch = deps.pitch || analyzeLeadWithClaude;

  const wanted = normalizeVerticals(verticals);
  const verticalLabels = wanted.map(v => VERTICALS[v].label).join(' + ');
  console.log(`🔍 Starte Lead-Suche in ${city} (${verticalLabels})...`);

  if (onProgress) onProgress({ phase: 'geocode', message: `Suche ${city} auf der Karte...` });
  const bbox = await geocode(city);

  if (onProgress) onProgress({ phase: 'search', message: `Lade Betriebe in ${city} (${verticalLabels})...` });
  const elements = await fetchElements(bbox, wanted);

  const existingLeads = loadLeads();
  const existingIds = new Set(existingLeads.map(l => l.osmId).filter(Boolean));
  const businesses = elementsToBusinesses(elements, { existingIds, maxResults });

  console.log(`📍 ${businesses.length} neue Betriebe in ${city} gefunden. Prüfe Website-Bedarf...`);

  const newLeads = [];
  let skipped = 0;
  for (let i = 0; i < businesses.length; i++) {
    const biz = businesses[i];
    if (onProgress) onProgress({ phase: 'analyze', current: i + 1, total: businesses.length, name: biz.name, vertical: biz.vertical });
    try {
      const a = await audit({ name: biz.name, url: biz.website });
      // "Nur ansprechen, wenn Website wirklich schlecht/fehlt" → 'skip' aussortieren.
      if (onlyQualified && a.verdict === 'skip') { skipped++; continue; }
      const pitchText = withPitch ? await pitch(biz, a) : null;
      const lead = toLead(biz, a, city, pitchText);
      newLeads.push(lead);
      console.log(`  ✅ ${biz.verticalLabel}: ${lead.name} — ${a.verdict} (Bedarf ${a.needScore})`);
    } catch (e) {
      console.error(`  ❌ Fehler bei ${biz.name}:`, e.message);
    }
  }

  const allLeads = [...existingLeads, ...newLeads];
  saveLeads(allLeads);
  console.log(`\n✅ ${newLeads.length} neue Leads mit Bedarf (${skipped} solide Seiten aussortiert). Gesamt: ${allLeads.length}`);
  return { newLeads, totalLeads: allLeads.length, skipped, verticals: wanted };
}

module.exports = {
  findLeads, loadLeads, saveLeads,
  // Exporte für Tests / Wiederverwendung:
  VERTICALS, ALL_VERTICALS, normalizeVerticals, buildOverpassQuery,
  categoryOf, verticalOf, osmToBusiness, elementsToBusinesses, toLead
};
