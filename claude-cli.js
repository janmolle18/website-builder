/**
 * claude-cli.js — Claude über das Claude-Code-ABO statt der kostenpflichtigen API.
 *
 * Statt `@anthropic-ai/sdk` + ANTHROPIC_API_KEY (Pay-per-Token) rufen alle Agents
 * jetzt die lokale `claude` CLI im Headless-Modus (`claude -p`) auf. Dadurch laufen
 * sämtliche Claude-Aufrufe über den eingeloggten Abo-Account (Pro/Max) und zählen
 * gegen dessen Nutzungskontingent — es entsteht keine separate API-Rechnung mehr.
 *
 * Voraussetzung (einmalig):
 *   - `claude` CLI installiert und eingeloggt:  claude  →  /login
 *   - oder Server-Umgebung mit  CLAUDE_CODE_OAUTH_TOKEN  (claude setup-token)
 *
 * Overhead-Minimierung gegenüber einem nackten `claude -p`:
 *   - eigener System-Prompt ersetzt Claude Codes Default-Agent-Prompt
 *   - MCP-Server komplett aus       (--strict-mcp-config --mcp-config {})
 *   - keine User/Project-Settings    (--setting-sources "")
 *   - bei reinen Text-Calls keine Tools (--allowedTools "")
 *
 * Der Prompt wird über stdin übergeben (kein ARG_MAX-Limit bei großem HTML).
 */

const { spawn } = require('child_process');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// Generatorpässe erzeugen lange HTML-Dateien → großzügiges Timeout.
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '600000', 10); // 10 min
const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB — die JSON-Antwort enthält bei der Generierung die ganze HTML-Datei

const BASE_ARGS = [
  '-p',
  '--output-format', 'json',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--setting-sources', ''
];

// Claude Code ist von Haus aus ein Coding-Agent MIT Tools. Bei Aufgaben wie
// "baue HTML" würde das Modell sonst eine Datei SCHREIBEN (Write-Tool) statt
// den Text auszugeben → error_max_turns. Darum alle Tools hart blockieren.
// (Bekannte Tool-Namen — MultiEdit/SlashCommand würden nur Warnungen erzeugen.)
const BLOCK_TOOLS = 'Task Bash BashOutput KillBash Glob Grep Edit Write NotebookEdit WebFetch WebSearch TodoWrite ExitPlanMode';
const BLOCK_TOOLS_TEXT = 'Read ' + BLOCK_TOOLS; // Text-Calls brauchen auch Read nicht

// An jeden Text-System-Prompt angehängt: erzwingt reine Textausgabe ohne Tools.
const NO_TOOLS_SUFFIX =
  '\n\nWICHTIG: Du hast keinerlei Tools und keinen Dateizugriff. Antworte ausschließlich ' +
  'mit dem reinen, vollständigen Inhalt direkt in deiner Textantwort — niemals über ein ' +
  'Tool, niemals durch Schreiben in eine Datei.';

const VISION_SYSTEM_DEFAULT =
  'Du bist ein präziser visueller QA-Reviewer. Lade die genannten Bilddateien mit dem ' +
  'Read-Tool und antworte anschließend exakt im geforderten Format.';

/**
 * Voll-IDs auf CLI-Aliase abbilden (die CLI bevorzugt Aliase für "latest").
 * Unbekannte Strings werden unverändert durchgereicht.
 * @param {string} [model]
 * @returns {string|undefined}
 */
function resolveModel(model) {
  if (!model) return undefined;
  if (/opus/i.test(model)) return 'opus';
  if (/haiku/i.test(model)) return 'haiku';
  if (/sonnet/i.test(model)) return 'sonnet';
  return model;
}

/**
 * Startet die `claude` CLI, schreibt den Prompt nach stdin, sammelt stdout.
 * @returns {Promise<string>} rohes stdout (JSON-Zeile)
 */
function runClaude(args, stdinText, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    // Abo-only: ANTHROPIC_API_KEY aus dem Kind-Environment entfernen, damit die CLI
    // IMMER die Abo-/OAuth-Anmeldung nutzt (CLAUDE_CODE_OAUTH_TOKEN bzw. eingeloggter
    // Account) und nie versehentlich auf einen alten/ungültigen API-Key zurückfällt.
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    const child = spawn(CLAUDE_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let size = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BUFFER) {
        child.kill('SIGKILL');
        clearTimeout(timer);
        return reject(new Error('claude CLI: Antwort überschreitet maxBuffer'));
      }
      stdout += chunk;
    });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`claude CLI nicht startbar (${CLAUDE_BIN}): ${err.message}. Ist Claude Code installiert und eingeloggt?`));
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`claude CLI Timeout nach ${timeout}ms`));
      if (code !== 0) {
        return reject(new Error(`claude CLI Exit ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
      resolve(stdout);
    });

    if (stdinText != null) child.stdin.write(stdinText);
    child.stdin.end();
  });
}

// Transiente Fehler (Netzwerk/Socket/Timeout) → erneut versuchen. NICHT bei Abo-Limit
// (das hilft sofort nicht) und nicht bei echten inhaltlichen Fehlern.
// EPERM/"internal error": CLI-interne Races (z. B. zwei Instanzen auf denselben
// Statusdateien, Keychain-Zugriff) — beim nächsten Versuch fast immer weg.
const TRANSIENT = /socket|closed unexpectedly|ECONNRESET|ETIMEDOUT|ENETUNREACH|network|fetch failed|terminated|aborted|Timeout nach|502|503|504|overloaded|error_max_turns|max_turns|EPERM|EAGAIN|internal error occurred/i;
function isTransient(msg) {
  const s = String(msg || '');
  if (/session limit|hit your (session|usage)|429/i.test(s)) return false;
  return TRANSIENT.test(s);
}

/** runClaude + parseResult mit Retry bei transienten Fehlern (Backoff). */
async function runWithRetry(args, stdin, opts, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return parseResult(await runClaude(args, stdin, opts));
    } catch (e) {
      lastErr = e;
      if (i < attempts && isTransient(e.message)) {
        const wait = 2000 * i;
        console.warn(`⚠️ claude CLI transient (Versuch ${i}/${attempts}), neuer Versuch in ${wait}ms: ${String(e.message).slice(0, 120)}`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** JSON-Envelope der CLI parsen und das `result`-Feld zurückgeben. */
function parseResult(stdout) {
  const trimmed = stdout.trim();
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}$/);
    if (!match) throw new Error('claude CLI: keine JSON-Antwort: ' + trimmed.slice(0, 300));
    json = JSON.parse(match[0]);
  }
  if (json.is_error || json.subtype !== 'success') {
    throw new Error('claude CLI meldet Fehler: ' + (json.result || json.subtype || 'unbekannt'));
  }
  return typeof json.result === 'string' ? json.result : '';
}

/**
 * Reiner Text-Aufruf (Klassifizierung, Strukturierung, Copy, HTML-Generierung).
 * @param {object} p
 * @param {string} [p.system]   System-Prompt (ersetzt Claude Codes Default)
 * @param {string} p.prompt     User-Prompt (über stdin)
 * @param {string} [p.model]    Modell-ID oder -Alias
 * @param {number} [p.maxTurns] Default 1 (Single-Shot, keine Tools)
 * @param {number} [p.timeout]
 * @returns {Promise<string>}
 */
async function callClaude({ system, prompt, model, maxTurns = 1, timeout } = {}) {
  if (!prompt) throw new Error('callClaude: prompt fehlt');
  const args = [...BASE_ARGS, '--max-turns', String(maxTurns), '--disallowedTools', BLOCK_TOOLS_TEXT];
  const m = resolveModel(model);
  if (m) args.push('--model', m);
  // System-Prompt immer setzen (ersetzt Claude Codes Default → weniger Overhead)
  // und mit dem No-Tools-Hinweis ergänzen.
  args.push('--system-prompt', (system || '') + NO_TOOLS_SUFFIX);
  return runWithRetry(args, prompt, { timeout });
}

/**
 * Vision-Aufruf: Bilder werden als Dateipfade übergeben und von Claude per
 * Read-Tool geladen (keine base64-Inlinekodierung nötig).
 * @param {object} p
 * @param {string} [p.system]
 * @param {string} p.prompt
 * @param {string[]} p.imagePaths  absolute Pfade zu den Bildern
 * @param {string} [p.model]
 * @param {string} [p.addDir]      Verzeichnis, das Claude lesen darf
 * @param {number} [p.maxTurns]    Default 6 (Read-Schritte + Antwort)
 * @returns {Promise<string>}
 */
async function callClaudeVision({ system, prompt, imagePaths = [], model, addDir, maxTurns = 6, timeout } = {}) {
  if (!prompt) throw new Error('callClaudeVision: prompt fehlt');
  const args = [
    ...BASE_ARGS,
    '--max-turns', String(maxTurns),
    '--allowedTools', 'Read',          // nur Lesen erlaubt (Bilder)
    '--disallowedTools', BLOCK_TOOLS,  // Schreiben/Ausführen hart blockiert
    '--permission-mode', 'acceptEdits'
  ];
  const m = resolveModel(model);
  if (m) args.push('--model', m);
  if (addDir) args.push('--add-dir', addDir);
  args.push('--system-prompt', system || VISION_SYSTEM_DEFAULT);

  const readInstr = imagePaths.length
    ? `Lies zuerst diese Bilddatei(en) mit dem Read-Tool, bevor du antwortest:\n${imagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n`
    : '';

  return runWithRetry(args, readInstr + prompt, { timeout });
}

module.exports = { callClaude, callClaudeVision, resolveModel, isTransient };
