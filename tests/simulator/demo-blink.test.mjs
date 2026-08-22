import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Helper: resolve Python executable.
 * Tries 'python' first (Windows), then 'python3' (Linux/macOS).
 */
function findPython() {
  for (const cmd of ['python', 'python3']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch {
      // not found, try next
    }
  }
  return null;
}

const PYTHON = findPython();
const demoScript = path.join(root, 'python', 'io-client', 'demo_blink.py');
const cwd = path.join(root, 'python', 'io-client');

test('demo_blink.py dry-run publishes 3 stub events and exits cleanly', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const stdout = execSync(`${PYTHON} "${demoScript}" --dry-run`, {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    cwd,
  });

  // ── Structure checks ──────────────────────────────────────────────────────
  assert.match(stdout, /\[DEMO\] Stub mode/, 'must print stub mode banner');
  assert.match(stdout, /\[DEMO\] Event 1:/, 'must print event 1');
  assert.match(stdout, /\[DEMO\] Event 2:/, 'must print event 2');
  assert.match(stdout, /\[DEMO\] Event 3:/, 'must print event 3');
  assert.match(stdout, /\[DEMO\] Done -- 3 events published/, 'must print done line');

  // ── Payload field checks ──────────────────────────────────────────────────
  const eventLines = stdout.split('\n').filter(l => l.startsWith('[DEMO] Event '));
  assert.equal(eventLines.length, 3, 'exactly 3 event lines');

  for (const line of eventLines) {
    const jsonStr = line.substring(line.indexOf('{'));
    const payload = JSON.parse(jsonStr);

    assert.equal(payload.studyId, 'demo', 'studyId must be demo');
    assert.equal(payload.runId, 'demo', 'runId must be demo');
    assert.ok('blinkDetected' in payload, 'payload must contain blinkDetected');
    assert.ok('eyeAspectRatio' in payload, 'payload must contain eyeAspectRatio');
    assert.ok('timestamp' in payload, 'payload must contain timestamp');
  }
});
