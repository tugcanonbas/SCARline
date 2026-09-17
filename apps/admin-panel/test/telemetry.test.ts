import assert from 'node:assert/strict';
import test from 'node:test';
import { appendTelemetryReading, telemetryNumber } from '../src/lib/telemetry';

test('retains actual timing and zero values, gaps invalid readings, and ignores old deliveries', () => {
  const at = Date.now();
  let values = appendTelemetryReading([], 0, new Date(at - 1000).toISOString());
  values = appendTelemetryReading(values, undefined, new Date(at - 870).toISOString());
  values = appendTelemetryReading(values, 12, new Date(at).toISOString());
  assert.deepEqual(values.map((point) => point.value), [0, null, 12]);
  assert.equal(values[1]!.timestamp - values[0]!.timestamp, 130);
  assert.deepEqual(appendTelemetryReading(values, 99, new Date(at - 3000).toISOString()), values);
  assert.deepEqual(appendTelemetryReading(values, 99, 'invalid'), values);
  assert.equal(telemetryNumber(''), null);
  assert.equal(telemetryNumber(Infinity), null);
});
