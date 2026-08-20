/**
 * tickets.js — Erstanfragen als Tickets (Kontaktformular der generierten Sites)
 *
 * Eine Anfrage aus dem Website-Formular wird:
 *   1. validiert (Name/E-Mail/Nachricht, Honeypot gegen Bots, Längenlimits)
 *   2. als Ticket in projects/<id>/tickets.json gespeichert (Status: neu)
 *   3. per E-Mail benachrichtigt — NUR wenn SMTP konfiguriert ist (sonst graceful skip,
 *      Ticket bleibt erhalten). "Am Ende mit E-Mail verbinden": SMTP_* in .env setzen.
 *
 * Tickets werden im Dashboard (/tickets) abgearbeitet: neu → in_bearbeitung → erledigt.
 * Doku: 20_PROJECTS/Website-Builder/APP_STATUS.md
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const STATUSES = ['neu', 'in_bearbeitung', 'erledigt'];
const MAX = { name: 120, email: 160, phone: 40, area: 80, message: 5000 };

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}
// Mehrzeilige Nachricht: Zeilenumbrüche erhalten, sonstigen Whitespace normalisieren.
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** project.json eines Projekts laden. */
function loadProject(projectsRoot, projectId) {
  const file = path.join(projectsRoot, projectId, 'project.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// WICHTIG: Tickets liegen NICHT im Projektordner (der wird zum Kunden deployt!), sondern
// in einem separaten Builder-internen Ordner. So gehen Anfrage-Daten nie mit live.
const TICKETS_DIR = path.join(__dirname, '_tickets');

function ticketsFile(projectId) {
  return path.join(TICKETS_DIR, `${String(projectId).replace(/[^a-z0-9_-]/gi, '')}.json`);
}
function readTickets(projectId) {
  const f = ticketsFile(projectId);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function writeTickets(projectId, list) {
  fs.mkdirSync(TICKETS_DIR, { recursive: true });
  fs.writeFileSync(ticketsFile(projectId), JSON.stringify(list, null, 2));
}

/**
 * Validiert + speichert eine Anfrage als Ticket.
 * @returns {{ok:true, ticket:object} | {ok:false, error:string, code:number}}
 */
function saveInquiry(projectsRoot, projectId, body = {}) {
  if (body.website || body.company_url) return { ok: false, error: 'Spam erkannt', code: 400 }; // Honeypot
  const project = loadProject(projectsRoot, projectId);
  if (!project) return { ok: false, error: 'Projekt nicht gefunden', code: 404 };

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email);
  const message = cleanText(body.message, MAX.message);
  if (!name || !email || !message) return { ok: false, error: 'Name, E-Mail und Nachricht sind erforderlich.', code: 400 };
  if (!isEmail(email)) return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.', code: 400 };

  const ticket = {
    id: crypto.randomUUID(),
    projectId,
    name, email,
    phone: clean(body.phone, MAX.phone),
    area: clean(body.area, MAX.area),
    message,
    status: 'neu',
    createdAt: new Date().toISOString()
  };

  const list = readTickets(projectId);
  list.unshift(ticket);
  writeTickets(projectId, list);
  return { ok: true, ticket, project };
}

/** Alle Tickets projektübergreifend (aus dem separaten _tickets/-Ordner), neueste zuerst. */
function listAllTickets(projectsRoot) {
  if (!fs.existsSync(TICKETS_DIR)) return [];
  const out = [];
  for (const file of fs.readdirSync(TICKETS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const projectId = file.replace(/\.json$/, '');
    const project = loadProject(projectsRoot, projectId);
    for (const t of readTickets(projectId)) {
      out.push({ ...t, projectName: project ? project.name : projectId });
    }
  }
  return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Ticket-Status setzen. */
function updateTicketStatus(projectsRoot, projectId, ticketId, status) {
  if (!STATUSES.includes(status)) return { ok: false, error: 'Ungültiger Status' };
  const list = readTickets(projectId);
  const t = list.find(x => x.id === ticketId);
  if (!t) return { ok: false, error: 'Ticket nicht gefunden' };
  t.status = status;
  t.updatedAt = new Date().toISOString();
  writeTickets(projectId, list);
  return { ok: true, ticket: t };
}

/** SMTP-Transport, falls konfiguriert — sonst null. */
function transport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

/**
 * Benachrichtigungsmail zur Anfrage — an die Kanzlei (project.contact.email) und optional
 * an INQUIRY_NOTIFY_EMAIL (Agentur). Skippt sauber, wenn SMTP fehlt.
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendInquiryMail(project, ticket) {
  const tx = transport();
  if (!tx) return { sent: false, reason: 'SMTP nicht konfiguriert' };

  const to = [(project.contact && project.contact.email) || '', process.env.INQUIRY_NOTIFY_EMAIL || '']
    .filter(Boolean).join(', ');
  if (!to) return { sent: false, reason: 'kein Empfänger' };

  const subject = `Neue Erstanfrage über die Website – ${ticket.name}`;
  const text = [
    `Neue Anfrage für ${project.name}:`,
    ``,
    `Name:        ${ticket.name}`,
    `E-Mail:      ${ticket.email}`,
    ticket.phone ? `Telefon:     ${ticket.phone}` : '',
    ticket.area ? `Rechtsgebiet: ${ticket.area}` : '',
    ``,
    `Nachricht:`,
    ticket.message,
    ``,
    `— eingegangen ${new Date(ticket.createdAt).toLocaleString('de-DE')} · Ticket ${ticket.id}`
  ].filter(Boolean).join('\n');

  try {
    await tx.sendMail({
      from: `"Website-Anfrage" <${process.env.SMTP_USER}>`,
      to,
      replyTo: ticket.email,
      subject,
      text
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { saveInquiry, listAllTickets, updateTicketStatus, sendInquiryMail, STATUSES };
