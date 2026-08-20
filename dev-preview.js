// Verifikations-Server auf Alt-Port — läuft parallel zu einer bereits laufenden
// Session auf :3000, ohne sie zu stören. PORT wird VOR dotenv gesetzt (dotenv
// überschreibt bestehende process.env-Werte nicht), daher greift 3100.
process.env.PORT = process.env.PORT || '3100';
require('./server.js');
