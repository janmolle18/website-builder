/**
 * places-lead-check.js — Google Places API (New) als Verifikations-Quelle für Leads.
 *
 * Zweck: OSM sagt oft „keine Website", obwohl nur der Tag fehlt. Ein Text-Search-Call
 * pro Lead liefert Website, Reviews, Rating, Betriebsstatus, Telefon — die Bedarfs-
 * und Aktivitätssignale für lead-scoring.js.
 *
 * Kosten-Schutz (Budget-Regel: 0 € bis Kunde #1 → Free-Tier reicht locker):
 *   - genau EIN searchText-Call pro Lead (FieldMask hält die SKU schlank)
 *   - Monatszähler in projects/places-usage.json, Abbruch bei PLACES_MONTHLY_CAP (Default 1000)
 *   - Kill-Switch: PLACES_LOOKUP=off → alle Lookups werden zu No-Ops
 *   - Fehler werfen nie in den Scan hinein: immer { ok:false, reason }
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const USAGE_FILE = path.join(__dirname, 'projects', 'places-usage.json');
const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.nationalPhoneNumber';
const DEFAULT_CAP = 1000;

function currentMonth(now) { return now.toISOString().slice(0, 7); }

function loadUsage(file, now) {
  try {
    const usage = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (usage.month === currentMonth(now) && Number.isFinite(usage.count)) return usage;
  } catch { /* fehlt/korrupt → frisch starten */ }
  return { month: currentMonth(now), count: 0 };
}

function saveUsage(file, usage) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(usage, null, 2), 'utf8');
}

/**
 * Sucht einen Betrieb per Places Text Search. Liefert bis zu 3 Kandidaten —
 * das Namens-Matching übernimmt lead-scoring.buildPlacesField.
 *
 * @param {{name:string, address?:string, city?:string}} query
 * @param {object} deps  Test-/Betriebs-Injektion:
 *   apiKey, post (axios.post-kompatibel), usageFile, cap, now, enabled
 * @returns {Promise<{ok:true, candidates:Array}|{ok:false, reason:string}>}
 */
async function lookupPlace(query, deps = {}) {
  const {
    apiKey = process.env.GOOGLE_PLACES_API_KEY,
    post = axios.post,
    usageFile = USAGE_FILE,
    cap = parseInt(process.env.PLACES_MONTHLY_CAP, 10) || DEFAULT_CAP,
    now = new Date(),
    enabled = process.env.PLACES_LOOKUP !== 'off'
  } = deps;

  if (!enabled) return { ok: false, reason: 'Lookup deaktiviert (PLACES_LOOKUP=off)' };
  if (!apiKey) return { ok: false, reason: 'GOOGLE_PLACES_API_KEY fehlt in .env' };

  const usage = loadUsage(usageFile, now);
  if (usage.count >= cap) return { ok: false, reason: `Places-Monats-Cap erreicht (${cap}) — PLACES_MONTHLY_CAP erhöhen oder nächsten Monat abwarten` };

  const textQuery = [query.name, query.address || '', query.city || ''].filter(Boolean).join(', ');

  // Zähler VOR dem Request: jeder Versuch zählt gegen das Kontingent.
  saveUsage(usageFile, { ...usage, count: usage.count + 1 });

  try {
    const res = await post(SEARCH_URL,
      { textQuery, languageCode: 'de', regionCode: 'DE', pageSize: 3 },
      {
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
        timeout: 12000
      });
    const candidates = (res.data?.places || []).map(p => ({
      placeId: p.id || null,
      name: p.displayName?.text || '',
      website: p.websiteUri || null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? 0,
      businessStatus: p.businessStatus || null,
      phone: p.nationalPhoneNumber || ''
    }));
    return { ok: true, candidates };
  } catch (e) {
    const status = e.response?.status;
    const detail = e.response?.data?.error?.message || '';
    const reason = status ? `HTTP ${status}${detail ? `: ${detail}` : ''}` : (e.code || e.message);
    return { ok: false, reason };
  }
}

module.exports = { lookupPlace, FIELD_MASK, USAGE_FILE };
