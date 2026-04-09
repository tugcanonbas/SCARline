import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';

test('core api exposes websocket route and milestone endpoints', async () => {
  const source = await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8');
  assert.match(source, /\/api\/health/);
  assert.match(source, /\/api\/dashboard/);
  assert.match(source, /\/api\/studies\/:studyId\/sessions\/:id\/start/);
  assert.match(source, /\/api\/widgets\/catalogue/);
  assert.match(source, /\/ws/);
});

test('sim-bridge exposes adapter websocket and simulator command consumption', async () => {
  const source = await readFile(path.join(root, 'services/sim-bridge/src/index.ts'), 'utf8');
  assert.match(source, /\/adapter/);
  assert.match(source, /RABBITMQ_QUEUES\.simBridgeCommands/);
  assert.match(source, /commands\.simulator\./);
});
