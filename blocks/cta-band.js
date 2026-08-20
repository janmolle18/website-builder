/**
 * cta-band — branchen-agnostischer Call-to-Action-Streifen vor dem Footer.
 * Nutzt vorhandene Daten (Name/Kategorie/Telefon), keine erfundenen Inhalte.
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Dunkelste Hex-Farbe der Palette (WCAG-Luminanz) — lesbar auf Weiß. */
function darkestHex(palette) {
  const lum = (hex) => {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => {
      let v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hexes = Object.values(palette || {})
    .filter(v => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v));
  const dark = hexes.map(h => [h, lum(h)]).filter(x => x[1] < 0.3).sort((a, b) => a[1] - b[1]);
  return dark.length ? dark[0][0] : null;
}

module.exports = {
  id: 'cta-band',
  type: 'cta',
  industries: ['*'],
  license: null, // reines Layout, keine externen Assets
  /** @param {object} project @returns {boolean} */
  match(project) { return !!(project.contact && project.contact.phone); },
  /** @param {object} project @param {object} dna @returns {string} */
  render(project, dna) {
    const p = (dna && dna.palette) || { accent: '#9C7A3C', text: '#16202B' };
    const tel = String(project.contact.phone).replace(/\s+/g, ' ').trim();
    const telHref = tel.replace(/[^+\d]/g, '');
    // Button steht auf weißem Grund → Textfarbe MUSS dunkel sein (sonst Weiß-auf-Weiß
    // bei dunklen Paletten, wo p.text hell ist). Dunkelste Palettenfarbe wählen.
    const onWhite = darkestHex(p) || '#16202B';
    const cat = project.category
      ? project.category.charAt(0).toUpperCase() + project.category.slice(1)
      : '';
    const label = cat ? `Jetzt ${esc(cat)} anfragen` : 'Jetzt Kontakt aufnehmen';
    return `<section data-block="cta-band" style="background:${p.accent};padding:clamp(2.5rem,6vw,4.5rem) clamp(1.2rem,4vw,3rem);text-align:center">
  <h2 style="color:#fff;font-size:clamp(1.6rem,1.1rem+2vw,2.6rem);line-height:1.1;margin:0 0 1.2rem">${label}</h2>
  <a href="tel:${esc(telHref)}" style="display:inline-block;background:#fff;color:${onWhite};padding:.95rem 1.9rem;border-radius:999px;font-weight:600;text-decoration:none">${esc(tel)}</a>
</section>`;
  }
};
