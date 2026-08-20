/**
 * pipeline-sync.js — Dashboard-Leads ↔ Markdown-Pipeline synchron halten.
 *
 * Idee: Die Lead-Suche im Dashboard und eine PIPELINE.md (z. B. in einem Notiz-Vault)
 * sollen EINE Quelle sein, damit man in beiden immer denselben Stand sieht.
 *
 * Richtung: Dashboard (leads.json) → Markdown-Datei. Die Leads werden in einen AUTO-Block
 * zwischen Markern geschrieben; alles außerhalb (manuell gepflegte Tabellen wie
 * „Gewonnen", „Verloren", „Wochenzähler") bleibt unangetastet.
 *
 * Ziel-Pfad: VAULT_PIPELINE_PATH aus .env, sonst ./data/PIPELINE.md. Abo-frei, kein LLM.
 */

const fs = require('fs');
const path = require('path');
const { loadLeads } = require('./agent-leads');

const DEFAULT_VAULT_PIPELINE = path.resolve(__dirname, "data/PIPELINE.md");

const START = '<!-- AUTO:dashboard-leads:start — via Builder-Sync, nicht manuell bearbeiten -->';
const END = '<!-- AUTO:dashboard-leads:end -->';

function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/** Bedarf/Qualifizierung eines Leads menschenlesbar (Audit bevorzugt, sonst Alt-Score). */
function needCell(lead) {
  if (lead.audit && lead.audit.verdict) {
    const icon = { qualified: '🔴 hoch', borderline: '🟡 mittel', skip: '⚪ solide' }[lead.audit.verdict] || lead.audit.verdict;
    return `${icon} (${lead.audit.needScore})`;
  }
  if (!lead.website) return '🔴 keine Website';
  if (typeof lead.score === 'number') return lead.score >= 3 ? `🔴 ${lead.score}` : lead.score >= 1 ? `🟡 ${lead.score}` : '⚪ ok';
  return '—';
}

/** Baut den Markdown-AUTO-Block aus den Leads. */
function buildBlock(leads) {
  const now = new Date().toLocaleString('de-DE');
  const rows = leads.map(l => {
    const stage = l.status || (l.projectId ? 'entwurf gebaut' : 'neu');
    const entwurf = l.projectId ? `[Entwurf](http://localhost:3000/projects/${esc(l.projectId)}/)` : '—';
    const site = l.website ? `[Ist-Site](${esc(l.website)})` : '—';
    return `| ${esc(l.name) || '—'} | ${esc(l.category || l.branche || '')} | ${esc(l.city || '')} | ${needCell(l)} | ${esc(stage)} | ${entwurf} | ${site} |`;
  }).join('\n');

  const qualified = leads.filter(l => (l.audit && l.audit.verdict === 'qualified') || !l.website || (typeof l.score === 'number' && l.score >= 3)).length;

  return [
    START,
    `## 🔄 Dashboard-Leads (auto-synchronisiert)`,
    ``,
    `> Stand: ${now} · ${leads.length} Leads im Dashboard · davon ${qualified} klar qualifiziert (Website-Bedarf hoch).`,
    `> Quelle: Builder-Dashboard → hier gespiegelt. Nicht in diesem Block editieren (wird überschrieben).`,
    ``,
    `| Lead | Branche | Ort | Website-Bedarf | Stage | Entwurf | Ist-Website |`,
    `|---|---|---|---|---|---|---|`,
    rows || `| _keine Leads im Dashboard_ | | | | | | |`,
    ``,
    END
  ].join('\n');
}

/**
 * Schreibt die Dashboard-Leads in den AUTO-Block der Vault-PIPELINE.md.
 * @param {{leads?:Array, vaultPath?:string}} opts
 * @returns {{written:boolean, path:string, leadCount:number}}
 */
function syncPipelineToVault(opts = {}) {
  const vaultPath = opts.vaultPath || process.env.VAULT_PIPELINE_PATH || DEFAULT_VAULT_PIPELINE;
  const leads = opts.leads || loadLeads();
  const block = buildBlock(leads);

  let content = '';
  try { content = fs.readFileSync(vaultPath, 'utf8'); }
  catch { throw new Error(`Vault-PIPELINE nicht gefunden: ${vaultPath} (VAULT_PIPELINE_PATH in .env setzen)`); }

  const s = content.indexOf(START);
  const e = content.indexOf(END);
  let next;
  if (s !== -1 && e !== -1 && e > s) {
    // Bestehenden AUTO-Block ersetzen (Rest der Datei bleibt).
    next = content.slice(0, s) + block + content.slice(e + END.length);
  } else {
    // Block noch nicht vorhanden → nach der „Aktive Leads"-Sektion oder am Ende anhängen.
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    next = content + sep + block + '\n';
  }
  if (next !== content) fs.writeFileSync(vaultPath, next);
  return { written: next !== content, path: vaultPath, leadCount: leads.length };
}

module.exports = { syncPipelineToVault, buildBlock, DEFAULT_VAULT_PIPELINE, START, END };
