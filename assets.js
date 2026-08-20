/**
 * assets.js — Orchestriert die Asset-Schicht: löst Fonts/Foto/Icons auf (resolveAssets)
 * und injiziert sie deterministisch & idempotent ins HTML (injectAssets).
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { recordAsset } = require('./licenses');
const { fontLink } = require('./assets-fonts');
const icons = require('./assets-icons');
const { fetchHeroPhoto, downloadTo } = require('./assets-photos');

/**
 * Löst Assets für ein Projekt auf (lädt Foto lokal). Wirft nie — Fallback = ohne Foto.
 * @returns {Promise<{assets:{fonts:string,heroPhoto:string|null,icon:Function}, records:Array<object>}>}
 */
async function resolveAssets(project, projectDir, dna) {
  let records = [];
  const assets = { fonts: fontLink(dna), heroPhoto: null, icon: icons.icon };
  if (assets.fonts) {
    records = recordAsset(records, {
      source: 'googlefonts', type: 'font',
      ref: `${(dna && dna.fonts && dna.fonts.heading) || '?'}/${(dna && dna.fonts && dna.fonts.body) || '?'}`
    });
  }

  const photo = await fetchHeroPhoto(project);
  if (photo) {
    try {
      const assetsDir = path.join(projectDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      await downloadTo(photo.url, path.join(assetsDir, photo.ref));
      assets.heroPhoto = `assets/${photo.ref}`;
      records = recordAsset(records, {
        source: photo.source, type: 'photo', ref: photo.ref, author: photo.author, sourceUrl: photo.sourceUrl
      });
    } catch (e) {
      console.warn('   ⚠️ Foto-Download übersprungen:', e.message);
    }
  }
  return { assets, records };
}

/**
 * Setzt das Hero-Foto deterministisch & idempotent. Reihenfolge:
 * 1. explizites [data-hero-img] (vom Generator markiert), sonst
 * 2. erstes <img> im <header>, sonst erstes <img> im Dokument, sonst
 * 3. CSS background-image auf <header> bzw. [data-hero].
 * Markiert das geänderte Element mit [data-hero-photo], damit ein zweiter Lauf
 * nicht doppelt anwendet. Wirft nie — fehlt ein Ziel, passiert nichts.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} heroPhoto relativer Asset-Pfad
 * @returns {void}
 */
function applyHeroPhoto($, heroPhoto) {
  if ($('[data-hero-photo]').length) return; // schon in einem früheren Lauf angewandt

  const explicit = $('[data-hero-img]').first();
  if (explicit.length) {
    explicit.attr('src', heroPhoto).attr('data-hero-photo', '');
    return;
  }

  const headerImg = $('header img').first();
  const target = headerImg.length ? headerImg : $('img').first();
  if (target.length) {
    target.attr('src', heroPhoto).attr('data-hero-photo', '');
    return;
  }

  const bgHost = $('header').first().length ? $('header').first() : $('[data-hero]').first();
  if (bgHost.length) {
    const existing = bgHost.attr('style') || '';
    const sep = existing && !/;\s*$/.test(existing) ? '; ' : (existing ? ' ' : '');
    bgHost.attr('style', `${existing}${sep}background-image:url('${heroPhoto}');background-size:cover;background-position:center`);
    bgHost.attr('data-hero-photo', '');
  }
}

/**
 * Injiziert Fonts (in <head>, idempotent) und das Hero-Foto (deterministischer
 * Fallback via applyHeroPhoto). Idempotent über data-Marker. Wirft nie.
 * @param {string} html
 * @param {{fonts?:string, heroPhoto?:string|null}} assets
 * @returns {{html:string}}
 */
function injectAssets(html, assets) {
  const $ = cheerio.load(html, { decodeEntities: false });
  if (assets.fonts && !/fonts\.googleapis\.com/.test(html)) {
    if ($('head').length) $('head').append(assets.fonts); else $.root().prepend(assets.fonts);
  }
  if (assets.heroPhoto) applyHeroPhoto($, assets.heroPhoto);
  return { html: $.html() };
}

module.exports = { resolveAssets, injectAssets };
