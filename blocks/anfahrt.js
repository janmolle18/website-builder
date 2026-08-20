/**
 * anfahrt — branchen-agnostischer Anfahrts-Streifen vor dem Footer.
 * Zeigt die echte Adresse und verlinkt auf Google Maps. Keine erfundenen Inhalte.
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  id: 'anfahrt',
  type: 'location',
  industries: ['*'],
  license: null, // reines Layout, externer Maps-Link, keine eingebetteten Assets
  /** @param {object} project @returns {boolean} */
  match(project) { return !!(project.contact && project.contact.address); },
  /** @param {object} project @param {object} dna @returns {string} */
  render(project, dna) {
    const p = (dna && dna.palette) || { surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C' };
    const address = String(project.contact.address).replace(/\s+/g, ' ').trim();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    return `<section data-block="anfahrt" style="background:${p.surface};color:${p.text};padding:clamp(2.5rem,6vw,4.5rem) clamp(1.2rem,4vw,3rem)">
  <div style="max-width:42rem;margin:0 auto;text-align:center">
    <p style="text-transform:uppercase;letter-spacing:.12em;font-size:.8rem;color:${p.accent};margin:0 0 .6rem">Anfahrt</p>
    <h2 style="font-size:clamp(1.6rem,1.1rem+2vw,2.6rem);line-height:1.1;margin:0 0 1rem">So finden Sie uns</h2>
    <p style="font-size:clamp(1.05rem,1rem+.3vw,1.25rem);color:${p.muted};margin:0 0 1.6rem">${esc(address)}</p>
    <a href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${p.accent};color:#fff;padding:.95rem 1.9rem;border-radius:999px;font-weight:600;text-decoration:none">Route auf Google Maps</a>
  </div>
</section>`;
  }
};
