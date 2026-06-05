import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cwd = path.join(root, 'python/io-client');
const PYTHON = path.join(cwd, '.venv/bin/python3');
const demoScript = 'demo_g29.py';

test('demo_g29.py dry-run publishes 3 stub events and exits cleanly', () => {
  const stdout = execSync(`"${PYTHON}" "${demoScript}" --dry-run`, {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    cwd,
  });

  // Structure checks
  assert.match(stdout, /\[DEMO G29\] Stub mode/, 'must print stub mode banner');
  assert.match(stdout, /\[DEMO G29\] Event 1:/, 'must print event 1');
  assert.match(stdout, /\[DEMO G29\] Event 2:/, 'must print event 2');
  assert.match(stdout, /\[DEMO G29\] Event 3:/, 'must print event 3');
  assert.match(stdout, /\[DEMO G29\] Done -- 3 events published/, 'must print done line');

  // Payload field checks
  const eventLines = stdout.split('\n').filter(l => l.startsWith('[DEMO G29] Event '));
  assert.equal(eventLines.length, 3, 'exactly 3 event lines');

  for (const line of eventLines) {
    const jsonStr = line.substring(line.indexOf('{'));
    const payload = JSON.parse(jsonStr);

    assert.equal(payload.studyId, 'demo', 'studyId must be demo');
    assert.equal(payload.runId, 'demo', 'runId must be demo');
    assert.ok('steeringAngle' in payload, 'payload must contain steeringAngle');
    assert.ok('throttle' in payload, 'payload must contain throttle');
    assert.ok('brake' in payload, 'payload must contain brake');
    assert.ok('timestamp' in payload, 'payload must contain timestamp');
  }
});
