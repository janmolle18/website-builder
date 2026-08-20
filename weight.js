/**
 * weight.js — Inhaltsgesteuerte Gewichtung für das Bento-Grid (rein deterministisch).
 *
 * Eine Quelle der Wahrheit für „wie groß wird die Kachel?", genutzt von:
 *   - generator.js  ([GEWICHT: …]-Hinweise im Briefing für den Opus-Pass)
 *   - pages.js      (deterministisches Bento der Startseiten-Rechtsgebiete, OHNE LLM)
 *
 * So driften die Schwellen nicht auseinander und die Optik bleibt konsistent.
 */

const WEIGHT_DOMINANT_CHARS = 400; // viel Fließtext → dominante Kachel
const WEIGHT_DOMINANT_ITEMS = 5;   // viele Unterpunkte → dominante Kachel
const WEIGHT_COMPACT_CHARS = 60;   // (fast) kein Text → kompakte Titel-Kachel

/**
 * Gewichtet eine Kategorie nach Inhaltsmenge. Keine Erfindung — nur Messung.
 * @param {{fullText?:string, description?:string, text?:string, items?:Array}} cat
 * @returns {'dominant'|'standard'|'compact'}
 */
function weighText(cat = {}) {
  const textLen = String(cat.fullText || cat.text || cat.description || '').trim().length;
  const items = Array.isArray(cat.items) ? cat.items : [];
  const itemTextLen = items.reduce((n, it) => n + String(it.description || '').length, 0);
  const volume = textLen + itemTextLen;

  if (volume < WEIGHT_COMPACT_CHARS && items.length <= 1) return 'compact';
  if (volume >= WEIGHT_DOMINANT_CHARS || items.length >= WEIGHT_DOMINANT_ITEMS) return 'dominant';
  return 'standard';
}

module.exports = { weighText, WEIGHT_DOMINANT_CHARS, WEIGHT_DOMINANT_ITEMS, WEIGHT_COMPACT_CHARS };
