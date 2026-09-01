import assert from 'node:assert/strict';
import test from 'node:test';

import { SingleFlightCache } from '../src/lib/server/single-flight';

test('shares one refresh result across concurrent and immediately following requests', async () => {
  const flights = new SingleFlightCache<string>(2_000);
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const operation = () => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  };

  const first = flights.run('refresh-token-hash', operation);
  const concurrent = flights.run('refresh-token-hash', operation);
  assert.equal(first, concurrent);
  assert.equal(calls, 1);

  release?.('rotated-session');
  assert.equal(await first, 'rotated-session');
  assert.equal(await flights.run('refresh-token-hash', operation), 'rotated-session');
  assert.equal(calls, 1);
});

test('does not combine refreshes for different authentication sessions', async () => {
  const flights = new SingleFlightCache<number>(2_000);
  let calls = 0;
  const operation = async () => ++calls;

  assert.equal(await flights.run('session-a', operation), 1);
  assert.equal(await flights.run('session-b', operation), 2);
});
