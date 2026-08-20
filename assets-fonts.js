/**
 * assets-fonts.js — DNA-Fonts → Google-Fonts <link> (OFL/Apache, self-host folgt später).
 */

/**
 * @param {{fonts?:{heading?:string,body?:string}}|null} dna
 * @returns {string} <link>-Tags oder ''
 */
function fontLink(dna) {
  const fams = [dna && dna.fonts && dna.fonts.heading, dna && dna.fonts && dna.fonts.body]
    .filter(f => typeof f === 'string' && f.trim());
  if (!fams.length) return '';
  const uniq = [...new Set(fams)];
  const q = uniq.map(f => `family=${encodeURIComponent(f.trim())}:wght@400;600;700`).join('&');
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`
  ].join('');
}

module.exports = { fontLink };
