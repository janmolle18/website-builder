const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTransient } = require('../claude-cli');

test('isTransient: EPERM/interne CLI-Fehler sind transient (Retry statt Build-Abbruch)', () => {
  // Echtes Muster aus einem Kunden-Build: zwei CLI-Instanzen parallel.
  assert.ok(isTransient('claude CLI Exit 1: error: An internal error occurred (EPERM)'));
  assert.ok(isTransient('spawn EAGAIN'));
  assert.ok(isTransient('ECONNRESET'));
});

test('isTransient: Abo-/Session-Limits bleiben fatal', () => {
  assert.ok(!isTransient('You have hit your session limit'));
  assert.ok(!isTransient('429 rate limited'));
  assert.ok(!isTransient('Syntaxfehler im Prompt'));
});
