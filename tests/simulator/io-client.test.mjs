import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('io client discovers plugins and publishes degraded sensor health', async () => {
  const source = await readFile(path.join(root, 'python/io-client/scarline_io/__main__.py'), 'utf8');

  assert.match(source, /entry_points\(group="scarline_io\.drivers"\)/);
  assert.match(source, /DRIVER_FACTORIES/);
  assert.match(source, /publish_component_status/);
  assert.match(source, /publish_sensor_status/);
  assert.match(source, /publish_driver_status_event/);
  assert.match(source, /refresh_health_sensors/);
  assert.match(source, /health_sensor_entry/);
  assert.match(source, /activeSession/);
  assert.match(source, /"sensors": \[\]/);
  assert.match(source, /io\.driver_status/);
  assert.match(source, /configSchema/);
  assert.match(source, /degraded/);
  assert.match(source, /Driver initialized in degraded mode/);
  assert.match(source, /commands\.io\.\*/);
  assert.match(source, /message\.process\(requeue=False\)/);
  assert.match(source, /IO_HEALTH_PORT/);
  assert.match(source, /health_server/);
  assert.match(source, /for configured_sensor in configured_sensors/);
  assert.match(source, /driver\.initialize\(configured_sensor\)/);
});

test('io client includes baseline optional sensor interfaces', async () => {
  for (const driverPath of [
    'python/io-client/scarline_io/drivers/eye_tracker.py',
    'python/io-client/scarline_io/drivers/heart_rate.py'
  ]) {
    const source = await readFile(path.join(root, driverPath), 'utf8');
    assert.match(source, /class .*Driver\(SensorDriver\)/);
    assert.match(source, /baseline-unavailable/);
    await access(path.join(root, driverPath));
  }
});
