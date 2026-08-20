/**
 * leistungen — branchen-agnostisches Leistungs-/Schwerpunkte-Grid vor dem Footer.
 * Nutzt ausschließlich echte project.specialties (ab 3 Einträgen). Keine erfundenen Inhalte.
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  id: 'leistungen',
  type: 'services',
  industries: ['*'],
  license: null, // reines Layout, keine externen Assets
  /** @param {object} project @returns {boolean} */
  match(project) { return Array.isArray(project.specialties) && project.specialties.length >= 3; },
  /** @param {object} project @param {object} dna @returns {string} */
  render(project, dna) {
    const p = (dna && dna.palette) || { bg: '#F5F4F1', surface: '#FFFFFF', text: '#16202B', muted: '#5A6470', accent: '#9C7A3C' };
    const items = project.specialties
      .filter(s => s != null && String(s).trim() !== '')
      .map(s => String(s).trim());
    if (items.length < 3) return ''; // nach Filterung doch zu wenig echte Einträge

    const cards = items.map(s => `      <li style="background:${p.surface};color:${p.text};border-top:3px solid ${p.accent};padding:1.4rem 1.5rem;border-radius:.5rem;font-weight:600;font-size:1.05rem;list-style:none">${esc(s)}</li>`).join('\n');

    return `<section data-block="leistungen" style="background:${p.bg};color:${p.text};padding:clamp(2.5rem,6vw,4.5rem) clamp(1.2rem,4vw,3rem)">
  <div style="max-width:64rem;margin:0 auto">
    <p style="text-transform:uppercase;letter-spacing:.12em;font-size:.8rem;color:${p.accent};margin:0 0 .6rem">Schwerpunkte</p>
    <h2 style="font-size:clamp(1.6rem,1.1rem+2vw,2.6rem);line-height:1.1;margin:0 0 2rem">Unsere Leistungen</h2>
    <ul style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));margin:0;padding:0">
${cards}
    </ul>
  </div>
</section>`;
  }
};
