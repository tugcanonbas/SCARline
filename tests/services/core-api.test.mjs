import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  const apiSource = await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8');
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
    '/api/system/overlay/reload',
    '/api/system/overlay/displays',
    '/api/system/overlay/windows/close'
  ]) {
    assert.match(source, new RegExp(route.replaceAll('/', '\\/').replaceAll(':', '\\:')));
  }
  assert.match(apiSource, /\/api\/studies\/:studyId\/researchers/);
  assert.match(apiSource, /\/api\/studies\/:studyId\/layouts\/:id/);
  assert.match(apiSource, /app\.delete\('\/api\/studies\/:studyId\/layouts\/:id'/);
  assert.match(apiSource, /heart_rate/);
  assert.match(apiSource, /eye_tracker/);
});

test('core api export pipeline creates durable async artifacts', async () => {
  const source = await readFile(path.join(root, 'services/core-api/src/lib/prd-routes.ts'), 'utf8');
  assert.match(source, /processExportJob/);
  assert.match(source, /resumeExportJobs/);
  assert.match(source, /writeExportArtifact/);
  assert.match(source, /createStoredZip/);
  assert.match(source, /EXPORT_NOT_READY/);
  assert.match(source, /EXPORT_ARTIFACT_MISSING/);
  assert.match(source, /export\.progress/);
  assert.match(source, /requested_by/);
});

test('core api persists lifecycle audit and session summaries', async () => {
  const apiSource = await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8');
  const prdSource = await readFile(path.join(root, 'services/core-api/src/lib/prd-routes.ts'), 'utf8');
  const dataSource = await readFile(path.join(root, 'services/core-api/src/lib/data.ts'), 'utf8');

  assert.match(dataSource, /INSERT INTO activity_log/);
  assert.match(dataSource, /INSERT INTO session_summaries/);
  assert.match(apiSource, /last_login_at = NOW\(\)/);
  assert.match(apiSource, /password_reset_required/);
  assert.match(apiSource, /auth\.login_succeeded/);
  assert.match(apiSource, /study\.researcher_assigned/);
  assert.match(apiSource, /layout\.deleted/);
  assert.match(prdSource, /export\.queued/);
  assert.match(prdSource, /refreshSessionSummary/);
});

test('core api protects PRD routes with shared RBAC hook', async () => {
  const source = await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8');
  assert.match(source, /app\.addHook\('preHandler'/);
  assert.match(source, /rolesForRoute/);
  assert.match(source, /AUTH_REQUIRED/);
  assert.match(source, /FORBIDDEN/);
  assert.match(source, /path === '\/api\/system\/ready'/);
  assert.match(source, /path === '\/api\/system\/shutdown'/);
  assert.match(source, /path\.startsWith\('\/api\/devices'\)[\s\S]*return \['admin', 'researcher'\]/);
  assert.match(source, /path\.startsWith\('\/api\/researchers'\)[\s\S]*return \['admin', 'researcher'\]/);
  assert.match(source, /path\.endsWith\('\/notes'\)[\s\S]*return \['admin', 'researcher', 'operator'\]/);
});

test('sim-bridge exposes adapter websocket and simulator command consumption', async () => {
  const source = await readFile(path.join(root, 'services/sim-bridge/src/index.ts'), 'utf8');
  const registry = await readFile(path.join(root, 'services/sim-bridge/src/lib/adapter-registry.ts'), 'utf8');
  assert.match(source, /\/adapter/);
  assert.match(source, /bridgeCompatibility/);
  assert.match(source, /SIM_BRIDGE_WEBSOCKET_PATHS/);
  assert.match(source, /connection as \{ socket: AdapterSocket \}/);
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
  assert.match(source, /vehicle\.lane_invasion/);
  assert.match(source, /world\.snapshot/);
  assert.match(source, /sensor\.camera/);
  assert.match(source, /sensor\.gnss/);
  assert.match(source, /sensor\.imu/);
  assert.match(source, /heartbeat_loop/);
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

test('core api hardens realtime scoping, component status, triggers, and outbox', async () => {
  const api = await readFile(path.join(root, 'services/core-api/src/lib/api.ts'), 'utf8');
  const events = await readFile(path.join(root, 'services/core-api/src/lib/events.ts'), 'utf8');
  const commands = await readFile(path.join(root, 'services/core-api/src/lib/commands.ts'), 'utf8');
  const schema = await readFile(path.join(root, 'infra/database/schema.sql'), 'utf8');
  const prd = await readFile(path.join(root, 'services/core-api/src/lib/prd-routes.ts'), 'utf8');

  assert.match(api, /x-scarline-internal-token/);
  assert.match(api, /SCARLINE_INTERNAL_API_TOKEN/);
  assert.match(api, /Session must be running to trigger widgets/);
  assert.match(api, /widget_instances/);
  assert.match(api, /simulationStatus\?\.status === 'running'/);
  assert.match(events, /wsHub\.broadcast\('widget\.updates', \{\s*studyId:/);
  assert.match(events, /ON CONFLICT \(message_id\) DO NOTHING/);
  assert.match(commands, /event_outbox/);
  assert.match(commands, /publishPendingOutbox/);
  assert.match(schema, /message_id UUID UNIQUE/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS event_outbox/);
  assert.match(prd, /EXPORT_SCOPE_MISMATCH/);
  assert.match(prd, /payload\.clickThrough \?\? false/);
  assert.match(prd, /\/api\/system\/overlay\/windows\/update/);
  assert.match(prd, /\/api\/system\/overlay\/windows\/close/);
  assert.match(prd, /\/api\/system\/overlay\/displays/);
  assert.match(prd, /selectOverlayDisplay/);
  assert.match(prd, /selectedDisplay\.bounds\.x \+/);
  assert.match(prd, /loadWidgetMetadataMap/);
  assert.match(prd, /preferredWidth/);
  assert.match(prd, /minWidth/);
});
