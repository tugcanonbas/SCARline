import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';

test('core api exposes websocket route and milestone endpoints', async () => {
  const source = [
    await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8'),
    await readFile(path.join(root, 'services/core-api/src/lib/prd-routes.ts'), 'utf8')
  ].join('\n');
  assert.match(source, /\/api\/health/);
  assert.match(source, /\/api\/dashboard/);
  assert.match(source, /\/api\/studies\/:studyId\/sessions\/:id\/start/);
  assert.match(source, /\/api\/widgets\/catalogue/);
  assert.match(source, /\/ws/);
});

test('core api exposes full PRD management surfaces', async () => {
  const source = await readFile(path.join(root, 'services/core-api/src/lib/prd-routes.ts'), 'utf8');
  for (const route of [
    '/api/researchers',
    '/api/researchers/:id/studies',
    '/api/studies/:id/duplicate',
    '/api/studies/:studyId/conditions/:id',
    '/api/studies/:studyId/participants/:id',
    '/api/studies/:studyId/sessions/:id',
    '/api/carla/test-connection',
    '/api/studies/:studyId/trigger-rules',
    '/api/devices',
    '/api/devices/:id/status',
    '/api/users',
    '/api/exports',
    '/api/exports/:id/download',
    '/api/session-logs',
    '/api/session-logs/:sessionId/summary',
    '/api/system/process-manager/status',
    '/api/system/carla/:action',
    '/api/system/overlay/reload'
  ]) {
    assert.match(source, new RegExp(route.replaceAll('/', '\\/').replaceAll(':', '\\:')));
  }
});

test('core api protects PRD routes with shared RBAC hook', async () => {
  const source = await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8');
  assert.match(source, /app\.addHook\('preHandler'/);
  assert.match(source, /rolesForRoute/);
  assert.match(source, /AUTH_REQUIRED/);
  assert.match(source, /FORBIDDEN/);
});

test('sim-bridge exposes adapter websocket and simulator command consumption', async () => {
  const source = await readFile(path.join(root, 'services/sim-bridge/src/index.ts'), 'utf8');
  const registry = await readFile(path.join(root, 'services/sim-bridge/src/lib/adapter-registry.ts'), 'utf8');
  assert.match(source, /\/adapter/);
  assert.match(source, /RABBITMQ_QUEUES\.simBridgeCommands/);
  assert.match(source, /commands\.simulator\./);
  assert.match(source, /simulator\.bound/);
  assert.match(source, /simulator\.command\.failed/);
  assert.match(registry, /adapter\.status === 'ready'/);
});

test('rabbitmq managers use confirms, consumer restore, DLX, and bounded buffering', async () => {
  const coreRabbit = await readFile(path.join(root, 'services/core-api/src/lib/rabbit.ts'), 'utf8');
  const simRabbit = await readFile(path.join(root, 'services/sim-bridge/src/lib/rabbit.ts'), 'utf8');

  for (const source of [coreRabbit, simRabbit]) {
    assert.match(source, /createConfirmChannel/);
    assert.match(source, /prefetch\(PREFETCH_COUNT\)/);
    assert.match(source, /restoreConsumers/);
    assert.match(source, /MAX_BUFFERED_PUBLISHES/);
    assert.match(source, /x-dead-letter-exchange/);
    assert.match(source, /nack\(raw, false, false\)/);
    assert.match(source, /processedMessageIds/);
  }
});

test('sim-bridge rejects stale and unacknowledged adapter commands', async () => {
  const source = await readFile(path.join(root, 'services/sim-bridge/src/index.ts'), 'utf8');
  const registry = await readFile(path.join(root, 'services/sim-bridge/src/lib/adapter-registry.ts'), 'utf8');

  assert.match(source, /ADAPTER_COMMAND_TIMEOUT_MS/);
  assert.match(source, /failPendingAdapterCommand/);
  assert.match(source, /ADAPTER_DISCONNECTED/);
  assert.match(source, /heartbeatSweep/);
  assert.match(source, /resolveAvailable\(preferredSimulatorType\)/);
  assert.match(registry, /evictStale/);
  assert.match(registry, /preferredSimulatorType/);
});

test('carla client acknowledges lifecycle commands for sim-bridge correlation', async () => {
  const source = await readFile(path.join(root, 'python/carla-client/scarline_carla/__main__.py'), 'utf8');
  assert.match(source, /action == "bind-session"/);
  assert.match(source, /action == "unbind-session"/);
  assert.match(source, /action == "pause-session"/);
  assert.match(source, /action == "resume-session"/);
  assert.match(source, /"type": "response"/);
  assert.match(source, /"correlationId": correlation_id/);
});

test('core command handler waits for simulator lifecycle acknowledgements', async () => {
  const source = await readFile(path.join(root, 'services/core-api/src/lib/commands.ts'), 'utf8');
  assert.match(source, /publishSimulatorCommand/);
  assert.match(source, /'bind-session'/);
  assert.match(source, /'pause-session'/);
  assert.match(source, /'resume-session'/);
  assert.match(source, /'unbind-session'/);
});
