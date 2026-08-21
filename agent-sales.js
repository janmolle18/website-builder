/**
 * Agent 3: Vertriebs-Agent
 * Generiert personalisierte Kaltakquise-Mails und versendet sie
 * Trackt Status pro Lead in der Pipeline
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const { loadLeads, saveLeads } = require('./agent-leads');
const { callClaude } = require('./claude-cli');

// ── Mail-Transport ───────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// ── Mail-Generator via Claude ─────────────────────────────────────────────────

async function generateSalesMail(lead, websiteUrl = null) {
  const websiteIssues = lead.websiteIssues || 'keine Website';

  const prompt = `Du bist ein professioneller Website-Verkäufer aus Paderborn. Schreibe eine kurze, persönliche Kaltakquise-E-Mail an den Inhaber von "${lead.name}".

Fakten:
- Restaurant: ${lead.name}, ${lead.address}
- Bewertung: ${lead.rating}/5 Sterne (${lead.reviewCount} Google-Bewertungen)
- Website-Problem: ${websiteIssues}
- Angebot: Professionelle Restaurant-Website für einmalig 129€ + 19€/Monat Hosting

${websiteUrl ? `Du hast bereits eine KOSTENLOSE Demo-Website erstellt: ${websiteUrl}` : ''}

Regeln:
- Max 150 Wörter
- Direkt und freundlich, kein Verkäufer-Jargon
- Sprich den Inhaber persönlich an (ohne Namen, da unbekannt)
- Beziehe dich auf die ${lead.reviewCount} Google-Bewertungen als Stärke
- ${websiteUrl ? 'Erwähne die fertige Demo-Website als "Geschenk"' : 'Biete kostenlose Demo an'}
- Unterschrift: "${process.env.SENDER_NAME || 'Max Beispiel'}\n${process.env.SENDER_TAGLINE || 'Website-Agentur'}"

Format: Gib NUR die E-Mail zurück (mit Betreff in der ersten Zeile als "Betreff: ...")`;

  const text = (await callClaude({ prompt, model: 'claude-haiku-4-5-20251001' })).trim();

  // Betreff extrahieren
  const lines = text.split('\n');
  const subjectLine = lines.find(l => l.toLowerCase().startsWith('betreff:'));
  const subject = subjectLine
    ? subjectLine.replace(/^betreff:\s*/i, '').trim()
    : `Neue Website für ${lead.name}`;
  const body = lines.filter(l => !l.toLowerCase().startsWith('betreff:')).join('\n').trim();

  return { subject, body };
}

// ── Mail versenden ────────────────────────────────────────────────────────────

async function sendMail(to, subject, body) {
  const transport = createTransport();
  await transport.sendMail({
    from: `"${process.env.SENDER_NAME || 'Website-Agentur'}" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text: body,
    html: body.replace(/\n/g, '<br>')
  });
}

// ── Pipeline-Aktionen ─────────────────────────────────────────────────────────

/**
 * Kontaktiert einen Lead automatisch:
 * 1. Mail generieren
 * 2. Optional: Demo-Website generieren
 * 3. Mail versenden
 * 4. Status auf "contacted" setzen
 */
async function contactLead(leadId, options = {}) {
  const { sendEmail = false, websiteUrl = null, recipientEmail = null } = options;

  const leads = loadLeads();
  const lead = leads.find(l => l.id === leadId);
  if (!lead) throw new Error('Lead nicht gefunden');

  // Mail generieren
  const { subject, body } = await generateSalesMail(lead, websiteUrl);

  lead.lastMailSubject = subject;
  lead.lastMailBody = body;
  lead.lastContactAt = new Date().toISOString();

  if (sendEmail && recipientEmail) {
    await sendMail(recipientEmail, subject, body);
    lead.status = 'contacted';
    lead.contactEmail = recipientEmail;
    console.log(`📧 Mail gesendet an ${recipientEmail}: "${subject}"`);
  } else {
    lead.status = 'draft';
    console.log(`✍️ Mail-Entwurf erstellt für: ${lead.name}`);
  }

  saveLeads(leads);
  return { subject, body, lead };
}

/**
 * Aktualisiert den Pipeline-Status eines Leads
 */
function updateLeadStatus(leadId, status, note = '') {
  const leads = loadLeads();
  const lead = leads.find(l => l.id === leadId);
  if (!lead) throw new Error('Lead nicht gefunden');

  lead.status = status;
  if (note) lead.notes = (lead.notes || '') + `\n[${new Date().toLocaleDateString('de-DE')}] ${note}`;
  lead.updatedAt = new Date().toISOString();

  saveLeads(leads);
  return lead;
}

/**
 * Pipeline-Statistiken
 */
function getPipelineStats() {
  const leads = loadLeads();
  const stats = {
    total: leads.length,
    new: 0, draft: 0, contacted: 0,
    offer_sent: 0, won: 0, lost: 0,
    revenue: 0
  };
  leads.forEach(l => {
    stats[l.status] = (stats[l.status] || 0) + 1;
    if (l.status === 'won') stats.revenue += 129; // Einmalzahlung
  });
  return stats;
}

module.exports = { contactLead, updateLeadStatus, getPipelineStats, generateSalesMail };
