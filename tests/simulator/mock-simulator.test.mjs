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
  assert.match(source, /MOCK_HEALTH_PORT/);
  assert.match(source, /health_server/);
  assert.match(source, /spawn-vehicle/);
  assert.match(source, /simulationTime/);
  assert.match(source, /telemetryRate/);
  assert.match(source, /activeSession/);
  assert.match(source, /sensor\.depth/);
  assert.match(source, /sensor\.lidar/);
  assert.match(source, /sensor\.radar/);

  for (const scenario of [
    'city_drive',
    'highway_cruise',
    'rainy_city',
    'night_drive',
    'stop_and_go',
    'parking_scenario',
    'sensor_test',
    'widget_test',
    'stress_test',
    'custom_template'
  ]) {
    assert.match(scenarios, new RegExp(`${scenario}:`));
  }
});
