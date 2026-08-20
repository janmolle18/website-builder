/**
 * assets-photos.js — Foto-Resolver (Pexels/Unsplash) + Download.
 * Keys via ENV (PEXELS_API_KEY / UNSPLASH_ACCESS_KEY). Ohne Key oder bei Fehler → null
 * (die Pipeline fällt sauber auf die bestehende DNA-/Hero-Logik zurück).
 */
const fs = require('fs');
const axios = require('axios');

/** @param {{category?:string,specialties?:string[],cuisine?:string}} project @returns {string} */
function keywordsFor(project) {
  return [project.category, (project.specialties || [])[0], project.cuisine]
    .filter(Boolean).join(' ').trim() || 'local business';
}

/** @returns {Promise<{source:string,url:string,author:string,sourceUrl:string,ref:string}|null>} */
async function searchPexels(query, key) {
  const res = await axios.get('https://api.pexels.com/v1/search', {
    headers: { Authorization: key },
    params: { query, per_page: 5, orientation: 'landscape' },
    timeout: 10000
  });
  const p = res.data && res.data.photos && res.data.photos[0];
  if (!p) return null;
  return { source: 'pexels', url: p.src.landscape, author: p.photographer, sourceUrl: p.url, ref: `pexels-${p.id}.jpg` };
}

/** @returns {Promise<{source:string,url:string,author:string,sourceUrl:string,ref:string}|null>} */
async function searchUnsplash(query, key) {
  const res = await axios.get('https://api.unsplash.com/search/photos', {
    headers: { Authorization: `Client-ID ${key}` },
    params: { query, per_page: 5, orientation: 'landscape' },
    timeout: 10000
  });
  const p = res.data && res.data.results && res.data.results[0];
  if (!p) return null;
  return { source: 'unsplash', url: p.urls.regular, author: p.user && p.user.name, sourceUrl: p.links && p.links.html, ref: `unsplash-${p.id}.jpg` };
}

/** Holt EIN passendes Hero-Foto-Meta oder null. Wirft nie. */
async function fetchHeroPhoto(project) {
  const query = keywordsFor(project);
  try {
    if (process.env.PEXELS_API_KEY) return await searchPexels(query, process.env.PEXELS_API_KEY);
    if (process.env.UNSPLASH_ACCESS_KEY) return await searchUnsplash(query, process.env.UNSPLASH_ACCESS_KEY);
  } catch (e) {
    console.warn('   ⚠️ Foto-Resolve fehlgeschlagen:', e.message);
  }
  return null;
}

/** Lädt eine Bild-URL nach destPath. @returns {Promise<void>} */
async function downloadTo(url, destPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  fs.writeFileSync(destPath, Buffer.from(res.data));
}

module.exports = { keywordsFor, fetchHeroPhoto, downloadTo, searchPexels, searchUnsplash };
