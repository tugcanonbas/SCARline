import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('mock simulator supports deterministic YAML scenario catalogue and runtime events', async () => {
  const source = await readFile(path.join(root, 'python/mock-simulator/scarline_mock/__main__.py'), 'utf8');
  const scenarios = await readFile(path.join(root, 'python/mock-simulator/scenarios.yaml'), 'utf8');

  assert.match(source, /SCENARIO_CATALOGUE_PATH/);
  assert.match(source, /yaml\.safe_load/);
  assert.match(source, /MOCK_SCENARIO_SEED/);
  assert.match(source, /lane_invasion/);
  assert.match(source, /vehicle\.collision/);
  assert.match(source, /sensor\.camera/);
  assert.match(source, /sensor\.gnss/);
  assert.match(source, /sensor\.imu/);
  assert.match(source, /RECONNECT_DELAY_SECONDS/);

  for (const scenario of ['city_drive', 'highway', 'parking', 'stop_go', 'collision_course']) {
    assert.match(scenarios, new RegExp(`${scenario}:`));
  }
});
