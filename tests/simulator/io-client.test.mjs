import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';

test('io client discovers plugins and publishes degraded sensor health', async () => {
  const source = await readFile(path.join(root, 'python/io-client/scarline_io/__main__.py'), 'utf8');

  assert.match(source, /entry_points\(group="scarline_io\.drivers"\)/);
  assert.match(source, /DRIVER_FACTORIES/);
  assert.match(source, /publish_component_status/);
  assert.match(source, /publish_sensor_status/);
  assert.match(source, /Driver initialized in degraded mode/);
  assert.match(source, /commands\.io\.\*/);
  assert.match(source, /message\.process\(requeue=False\)/);
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
