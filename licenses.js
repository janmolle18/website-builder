/**
 * licenses.js — Resale-saubere Asset-Whitelist + Lizenz-Manifest.
 * Nur hier gelistete Quellen dürfen je verwendet werden. Jede genutzte Ressource
 * wird erfasst und als licenses.json + CREDITS.txt in den Projektordner geschrieben.
 */
const fs = require('fs');
const path = require('path');

/** @typedef {{name:string,licenseType:string,commercialOK:boolean,attributionRequired:boolean,url:string}} Source */
/** @type {Record<string, Source>} */
const SOURCES = {
  unsplash:    { name: 'Unsplash',     licenseType: 'Unsplash License', commercialOK: true, attributionRequired: false, url: 'https://unsplash.com' },
  pexels:      { name: 'Pexels',       licenseType: 'Pexels License',   commercialOK: true, attributionRequired: false, url: 'https://www.pexels.com' },
  lucide:      { name: 'Lucide',       licenseType: 'ISC',              commercialOK: true, attributionRequired: false, url: 'https://lucide.dev' },
  tabler:      { name: 'Tabler Icons', licenseType: 'MIT',              commercialOK: true, attributionRequired: false, url: 'https://tabler.io/icons' },
  googlefonts: { name: 'Google Fonts', licenseType: 'OFL/Apache-2.0',   commercialOK: true, attributionRequired: false, url: 'https://fonts.google.com' },
  undraw:      { name: 'unDraw',       licenseType: 'unDraw (CC0-artig)', commercialOK: true, attributionRequired: false, url: 'https://undraw.co' }
};

/** @param {string} sourceKey @returns {boolean} */
function isAllowed(sourceKey) {
  return Object.prototype.hasOwnProperty.call(SOURCES, sourceKey);
}

/**
 * Fügt einen Asset-Eintrag unveränderlich hinzu (gibt neues Array zurück).
 * @param {Array<object>} records
 * @param {{source:string,type:string,ref:string,author?:string,sourceUrl?:string}} record
 * @returns {Array<object>}
 */
function recordAsset(records, record) {
  if (!isAllowed(record.source)) throw new Error(`Quelle nicht auf Whitelist: ${record.source}`);
  return [...records, { ...record, license: SOURCES[record.source].licenseType }];
}

/**
 * Schreibt licenses.json + menschenlesbare CREDITS.txt in den Projektordner.
 * @param {string} projectDir @param {Array<object>} records
 * @returns {{manifestPath:string}}
 */
function writeLicenseManifest(projectDir, records) {
  const manifest = { generated: new Date().toISOString(), assets: records };
  const manifestPath = path.join(projectDir, 'licenses.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const lines = ['# Bild- und Asset-Nachweise', ''].concat(
    records.map(r => `- ${r.type}: ${r.ref}${r.author ? ` — ${r.author}` : ''} (${SOURCES[r.source].name}, ${r.license})${r.sourceUrl ? ` — ${r.sourceUrl}` : ''}`)
  );
  fs.writeFileSync(path.join(projectDir, 'CREDITS.txt'), lines.join('\n') + '\n');
  return { manifestPath };
}

module.exports = { SOURCES, isAllowed, recordAsset, writeLicenseManifest };
