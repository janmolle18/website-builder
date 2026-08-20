const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncPipelineToVault, buildBlock, START, END } = require('../pipeline-sync');

const BASE = `---
title: Pipeline
---
# Pipeline

## Aktive Leads
(manuell)

## Gewonnen 🏆
| Kunde |
|---|
| — |

## Wochenzähler
| Woche |
|---|
| KW27 |
`;

function tmpPipeline() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')), 'PIPELINE.md');
  fs.writeFileSync(f, BASE);
  return f;
}

const LEADS = [
  { name: 'Kanzlei Alt', category: 'Kanzlei', city: 'Paderborn', website: '', score: 5 },
  { name: 'Praxis Neu', category: 'Arztpraxis', city: 'Paderborn', website: 'https://x.de', audit: { verdict: 'qualified', needScore: 62 }, projectId: 'praxis-neu-abc' }
];

test('buildBlock: Marker + Bedarfs-Spalte + Entwurf-Link', () => {
  const b = buildBlock(LEADS);
  assert.ok(b.startsWith(START) && b.endsWith(END));
  assert.match(b, /keine Website/);
  assert.match(b, /hoch \(62\)/);
  assert.match(b, /praxis-neu-abc/);
});

test('syncPipelineToVault: schreibt Auto-Block, erhält manuelle Sektionen', () => {
  const f = tmpPipeline();
  const r = syncPipelineToVault({ leads: LEADS, vaultPath: f });
  assert.equal(r.written, true);
  assert.equal(r.leadCount, 2);
  const c = fs.readFileSync(f, 'utf8');
  assert.ok(c.includes(START) && c.includes(END));
  assert.ok(c.includes('## Gewonnen 🏆'), 'manuelle Sektion erhalten');
  assert.ok(c.includes('## Wochenzähler'), 'Wochenzähler erhalten');
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('idempotent: zweiter Lauf ersetzt statt zu duplizieren', () => {
  const f = tmpPipeline();
  syncPipelineToVault({ leads: LEADS, vaultPath: f });
  syncPipelineToVault({ leads: LEADS.slice(0, 1), vaultPath: f });
  const c = fs.readFileSync(f, 'utf8');
  const count = c.split(START).length - 1;
  assert.equal(count, 1, 'nur ein Auto-Block');
  assert.ok(!c.includes('Praxis Neu'), 'alter Lead im Block ersetzt');
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('fehlender Vault-Pfad → klare Fehlermeldung', () => {
  assert.throws(() => syncPipelineToVault({ leads: [], vaultPath: '/nope/PIPELINE.md' }), /nicht gefunden/);
});
