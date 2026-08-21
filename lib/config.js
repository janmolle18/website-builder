/**
 * lib/config.js — Laufzeit-Einstellungen, die Server UND Build-Pipeline brauchen.
 *
 * Der Port steht hier und nicht in server.js, damit die Pipeline die
 * Vorschau-URLs (QA, Vergleich, Freigabe-Link) bilden kann, ohne den Server
 * zu importieren — sonst gäbe es einen Zyklus.
 */

const PORT = process.env.PORT || 3000;

module.exports = { PORT };
