import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';

test('mock simulator supports deterministic YAML scenario catalogue and runtime events', async () => {
  const source = await readFile(path.join(root, 'python/mock-simulator/scarline_mock/__main__.py'), 'utf8');
  const scenarios = await readFile(path.join(root, 'python/mock-simulator/scenarios.yaml'), 'utf8');

  assert.match(source, /SCENARIO_CATALOGUE_PATH/);
  assert.match(source, /yaml\.safe_load/);
  assert.match(source, /MOCK_SCENARIO_SEED/);
  assert.match(source, /lane-invasion/);
  assert.match(source, /vehicle\.collision/);
  assert.match(source, /sensor\.camera-frame/);
  assert.match(source, /RECONNECT_DELAY_SECONDS/);

  for (const scenario of ['city_drive', 'highway', 'parking', 'stop_go', 'collision_course']) {
    assert.match(scenarios, new RegExp(`${scenario}:`));
  }
});
