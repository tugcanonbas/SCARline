import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  readWidgetAsset,
  readWidgetComponentAsset,
  WidgetAssetNotFoundError
} from '../src/lib/server/widget-assets';
import {
  applyCarlaOverrides,
  materializeAdminTriggerRules,
  saveAndApplySimulatorTemplate
} from '../src/lib/server/condition-configuration';
import { getBootstrapState } from '../src/lib/server/bootstrap';
import { appendTelemetrySample, telemetryNumber } from '../src/lib/telemetry';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

async function source(path: string) {
  return readFile(`${appRoot}/${path}`, 'utf8');
}

test('keeps the frozen admin stylesheet intact', async () => {
  const current = await source('src/app.css');
  assert.equal(
    createHash('sha256').update(current).digest('hex'),
    'e4d51c7ff8fa2fafb407dd0640c735430f43ac830af534c53c7864cd5e320e55'
  );
});

test('uses hardened cookie and WebSocket authentication paths', async () => {
  const [auth, realtime, ticketRoute, serializedPages, allSources] = await Promise.all([
    source('src/lib/server/auth.ts'),
    source('src/lib/stores/realtime.ts'),
    source('src/routes/api/realtime/ticket/+server.ts'),
    Promise.all([
      source('src/routes/dashboard/+page.server.ts'),
      source('src/routes/dashboard/+page.svelte'),
      source('src/routes/user-studies/[id]/active-study/+page.server.ts'),
      source('src/routes/user-studies/[id]/active-study/+page.svelte'),
      source('src/routes/user-studies/[id]/participant-view/+page.server.ts'),
      source('src/routes/user-studies/[id]/participant-view/+page.svelte')
    ]).then((files) => files.join('\n')),
    Promise.all([
      source('src/routes/user-studies/[id]/active-study/+page.svelte'),
      source('src/routes/user-studies/[id]/participant-view/+page.svelte')
    ]).then((files) => files.join('\n'))
  ]);
  assert.match(auth, /httpOnly:\s*true/);
  assert.match(auth, /sameSite:\s*'strict'/);
  assert.match(auth, /secure:\s*true/);
  assert.match(auth, /delete\(ACCESS_TOKEN_COOKIE_NAME, ACCESS_COOKIE_OPTIONS\)/);
  assert.match(auth, /delete\(REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_OPTIONS\)/);
  assert.match(realtime, /scarline\.user-ticket\./);
  assert.match(realtime, /requestRealtimeTicket\(\)/);
  assert.match(realtime, /void openSocket\(\)/);
  assert.doesNotMatch(realtime, /scarline\.access-token\./);
  assert.doesNotMatch(realtime, /\?token=/);
  assert.match(ticketRoute, /request\.headers\.get\('origin'\) !== url\.origin/);
  assert.match(ticketRoute, /cache-control': 'no-store, private'/);
  assert.doesNotMatch(serializedPages, /token:\s*locals\.accessToken/);
  assert.doesNotMatch(serializedPages, /accessToken:\s*locals\.accessToken/);
  assert.doesNotMatch(serializedPages, /data\.(?:token|accessToken)/);
  assert.doesNotMatch(serializedPages, /authorization:\s*`Bearer/);
  assert.doesNotMatch(allSources, /127\.0\.0\.1:4097/);
  assert.doesNotMatch(allSources, /searchParams\.set\(["']token/);
});

test('keeps Observer first-class and adds the approved password screen', async () => {
  const [layout, users, password] = await Promise.all([
    source('src/routes/+layout.svelte'),
    source('src/routes/settings/users/+page.svelte'),
    source('src/routes/change-password/+page.svelte')
  ]);
  assert.match(layout, /"observer"/);
  assert.match(users, /value=\{role\}/);
  assert.match(password, /PageHeader/);
  assert.match(password, /SurfaceCard/);
  assert.doesNotMatch(`${layout}\n${users}`, /viewer/);
});

test('serves widget previews with a sandbox runtime and metadata defaults', async () => {
  const participantView = await source('src/routes/user-studies/[id]/participant-view/+page.svelte');
  assert.match(participantView, /appPath\(`\/overlay\/assets\/\$\{widgetId\}\/\$\{entry\}`\)/);
  assert.match(participantView, /system\/widgets\/refresh/);
  assert.match(participantView, /widgetRevision \+= 1/);

  const catalogue = await source('src/lib/components/admin/participant-view/ParticipantLayoutCatalogue.svelte');
  assert.match(catalogue, /Refresh Widgets/);
  assert.match(catalogue, /refreshingWidgets/);

  const preview = await readWidgetComponentAsset('time', 'index.html', true);
  const html = Buffer.from(preview.body).toString('utf8');
  assert.equal(preview.contentType, 'text/html; charset=utf-8');
  assert.match(html, /data-scarline-preview-runtime/);
  assert.match(html, /window\.SCARline/);
  assert.match(html, /system\.time_label/);
  assert.match(html, /scarline\.widget\.ready/);

  const stylesheet = await readWidgetAsset('dist.css');
  assert.equal(stylesheet.contentType, 'text/css; charset=utf-8');
  await assert.rejects(
    () => readWidgetAsset('../config.yml'),
    WidgetAssetNotFoundError
  );
});

test('rejects widget asset symlinks that escape the configured widget directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scarline-admin-widgets-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'scarline-admin-outside-'));
  await mkdir(path.join(root, 'components', 'example'), { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'components', 'example', 'escape.txt'));
  const previous = process.env.SCARLINE_WIDGETS_DIRECTORY;
  process.env.SCARLINE_WIDGETS_DIRECTORY = root;
  try {
    await assert.rejects(
      () => readWidgetAsset('components/example/escape.txt'),
      WidgetAssetNotFoundError
    );
  } finally {
    if (previous === undefined) delete process.env.SCARLINE_WIDGETS_DIRECTORY;
    else process.env.SCARLINE_WIDGETS_DIRECTORY = previous;
  }
});

test('materializes independent condition simulator overrides from the shared template', () => {
  const template = {
    weatherPreset: 'ClearNoon',
    trafficConfig: { npcVehicleCount: 10, speedDifference: 0, speedLimitOverride: null },
    pedestrianConfig: { pedestrianCount: 5 }
  };
  const configured = applyCarlaOverrides(template, {
    weather: 'HardRainNoon',
    trafficDensity: 25,
    pedestrianDensity: 30,
    speedLimitOverride: 45
  });
  assert.deepEqual(configured.trafficConfig, {
    npcVehicleCount: 25,
    speedDifference: 0,
    speedLimitOverride: 45
  });
  assert.deepEqual(configured.pedestrianConfig, { pedestrianCount: 30 });
  assert.equal(configured.weatherPreset, 'HardRainNoon');
  assert.equal(template.weatherPreset, 'ClearNoon');
});

test('saves CARLA defaults without replacing an active mock simulator', async () => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const studyId = '50523e28-b25a-49e3-bfbb-c558582c93f7';
  const conditionId = '440bd5d9-c6a0-41a9-99b1-03ccca42df3d';
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname.endsWith(`/studies/${studyId}`) && method === 'GET') {
      return Response.json({ data: { id: studyId, metadata: {} } });
    }
    if (url.pathname.endsWith(`/studies/${studyId}/conditions`) && method === 'GET') {
      return Response.json({ data: [{ id: conditionId, metadata: {}, archivedAt: null }] });
    }
    if (url.pathname.endsWith('/components/status') && method === 'GET') {
      return Response.json({ data: [{ component: 'sim-bridge', available: true, adapters: ['mock'] }] });
    }
    if (url.pathname.endsWith(`/conditions/${conditionId}/simulator`) && method === 'GET') {
      return Response.json({ data: { simulatorType: 'mock', configuration: { seed: 17 } } });
    }
    if (url.pathname.endsWith(`/studies/${studyId}`) && method === 'PATCH') {
      return Response.json({ data: { id: studyId, metadata: body.metadata } });
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };

  await saveAndApplySimulatorTemplate(
    fakeFetch as typeof globalThis.fetch,
    { apiBase: 'http://core.test/api/v1', accessToken: 'token' } as Parameters<typeof saveAndApplySimulatorTemplate>[1],
    studyId,
    { map: 'Town03' }
  );

  const metadataPatch = requests.find((request) => request.method === 'PATCH');
  assert.deepEqual(metadataPatch?.body, {
    metadata: { configurationTemplates: { simulator: { map: 'Town03' } } }
  });
  assert.equal(requests.some((request) => request.method === 'PUT' && request.path.endsWith('/simulator')), false);
});

test('uses the active Mock adapter when Simulator Setup materializes a condition', async () => {
  const requests: Array<{ method: string; path: string; body: any }> = [];
  const studyId = '50523e28-b25a-49e3-bfbb-c558582c93f7';
  const conditionId = '440bd5d9-c6a0-41a9-99b1-03ccca42df3d';
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname.endsWith(`/studies/${studyId}`) && method === 'GET') {
      return Response.json({ data: { id: studyId, metadata: {} } });
    }
    if (url.pathname.endsWith(`/studies/${studyId}/conditions`) && method === 'GET') {
      return Response.json({ data: [{ id: conditionId, metadata: {}, archivedAt: null }] });
    }
    if (url.pathname.endsWith('/components/status') && method === 'GET') {
      return Response.json({ data: [{ component: 'sim-bridge', available: true, adapters: ['mock'] }] });
    }
    if (url.pathname.endsWith(`/conditions/${conditionId}/simulator`) && method === 'GET') {
      return Response.json({ data: { simulatorType: 'carla', configuration: { map: 'Town01' } } });
    }
    if (url.pathname.endsWith(`/studies/${studyId}`) && method === 'PATCH') {
      return Response.json({ data: { id: studyId, metadata: body.metadata } });
    }
    if (url.pathname.endsWith(`/conditions/${conditionId}/simulator`) && method === 'PUT') {
      return Response.json({ data: { simulatorType: body.simulatorType, configuration: body.configuration } });
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };

  await saveAndApplySimulatorTemplate(
    fakeFetch as typeof globalThis.fetch,
    { apiBase: 'http://core.test/api/v1', accessToken: 'token' } as Parameters<typeof saveAndApplySimulatorTemplate>[1],
    studyId,
    { map: 'Town03' }
  );

  const simulatorUpdate = requests.find((request) => request.method === 'PUT' && request.path.endsWith('/simulator'));
  assert.equal(simulatorUpdate?.body.simulatorType, 'mock');
  assert.equal(simulatorUpdate?.body.configuration.map, 'Town03');
});

test('uses named save actions on pages that also expose study transitions', async () => {
  const [simulatorPage, simulatorServer, participantServer] = await Promise.all([
    source('src/routes/user-studies/[id]/carla-config/+page.svelte'),
    source('src/routes/user-studies/[id]/carla-config/+page.server.ts'),
    source('src/routes/user-studies/[id]/participant-view/+page.server.ts')
  ]);
  assert.match(simulatorPage, /action="\?\/saveSimulator"/);
  assert.match(simulatorServer, /saveSimulator:/);
  assert.doesNotMatch(simulatorServer, /\bdefault:/);
  assert.doesNotMatch(participantServer, /\bdefault:/);
});

test('confirms Simulator Setup saves without a full-page form refresh', async () => {
  const [simulatorPage, simulatorServer] = await Promise.all([
    source('src/routes/user-studies/[id]/carla-config/+page.svelte'),
    source('src/routes/user-studies/[id]/carla-config/+page.server.ts')
  ]);
  assert.match(simulatorPage, /use:enhance/);
  assert.match(simulatorPage, /Saving…/);
  assert.match(simulatorPage, /InlineNotice/);
  assert.match(simulatorServer, /Simulator configuration saved\./);
  assert.match(simulatorServer, /Retry saving\./);
});

test('keeps Participant View styling while using the transactional autosave path', async () => {
  const [participantView, participantServer, layouts, updateRoute] = await Promise.all([
    source('src/routes/user-studies/[id]/participant-view/+page.svelte'),
    source('src/routes/user-studies/[id]/participant-view/+page.server.ts'),
    source('src/lib/server/layouts.ts'),
    source('src/routes/api/system/overlay/windows/update/+server.ts')
  ]);
  assert.match(participantView, /window\.setTimeout\(\(\) => void saveLayout\(false\), 900\)/);
  assert.match(participantView, /expectedRevisions/);
  assert.match(participantView, /data\.expectedRevisions/);
  assert.match(participantView, /lastAutosaveAttemptSignature/);
  assert.match(participantServer, /expectedRevisions:\s*context\.expectedRevisions/);
  assert.match(participantView, /LAYOUT_VERSION_CONFLICT/);
  assert.match(participantView, /The layout was saved\. Retry with Save Layout\./);
  assert.match(participantView, /realtime\.connect\(\["overlay\.windows"\]/);
  assert.doesNotMatch(participantView, /targetDisplay = fallback\.id/);
  assert.match(layouts, /layouts\/participant/);
  assert.match(layouts, /inputMode/);
  assert.match(layouts, /fallback\.every\(\(entry\) => entry\.layoutId === null && Number\(entry\.revision\) === 0\)/);
  assert.match(updateRoute, /overlay\.window\.update/);
});

test('persists Active Study window changes before applying them live', async () => {
  const [page, server, panel] = await Promise.all([
    source('src/routes/user-studies/[id]/active-study/+page.svelte'),
    source('src/routes/user-studies/[id]/active-study/+page.server.ts'),
    source('src/lib/components/admin/active-study/ActiveStudyWindowManagerPanel.svelte')
  ]);
  assert.match(page, /participantLayoutsByCondition/);
  assert.match(page, /expectedRevision: activeLayoutRevision/);
  assert.match(page, /overlay\.window\.status/);
  assert.match(server, /sessions\/\$\{sessionId\}\/overlay\/windows\/\$\{instanceId\}/);
  assert.ok(server.indexOf('const persisted = await apiAction') < server.indexOf('await sendOverlayCommand'));
  assert.match(server, /saved but not applied to the live desktop/);
  assert.match(panel, /Saved display:/);
  assert.match(panel, /Temporary live display:/);
  assert.match(panel, /Reassign this widget in Participant View/);
});

test('materializes condition trigger rules for the canonical CoreAPI', () => {
  const [rule] = materializeAdminTriggerRules([{
    ruleName: 'Speed warning',
    widgetId: 'navigation-prompt',
    condition: 'vehicle.speed > vehicle.speedLimit',
    action: 'highlight',
    bindingOverrides: { warning: 'Slow down' }
  }]);
  assert.deepEqual(rule.expression, {
    operator: 'gt',
    path: 'payload.vehicle.speed',
    valuePath: 'payload.vehicle.speedLimit'
  });
  assert.deepEqual(rule.actionConfig, {
    widgetId: 'navigation-prompt',
    action: 'highlight',
    bindingValues: { warning: 'Slow down' }
  });
});

test('routes existing manual widget controls through the runtime command boundary', async () => {
  const activeStudyServer = await source('src/routes/user-studies/[id]/active-study/+page.server.ts');
  assert.match(activeStudyServer, /\/sessions\/\$\{sessionId\}\/widgets\/trigger/);
  assert.match(activeStudyServer, /requestedAction === 'manual-trigger' \? 'trigger'/);
  assert.doesNotMatch(activeStudyServer, /category: 'widget-trigger'/);
});

test('loads globally paginated Session Logs with backend aggregate metrics', async () => {
  const [server, page] = await Promise.all([
    source('src/routes/session-logs/+page.server.ts'),
    source('src/routes/session-logs/+page.svelte')
  ]);
  assert.match(server, /\/session-events/);
  assert.doesNotMatch(server, /selectedStudies\.map/);
  assert.doesNotMatch(server, /\/sessions\/\$\{session\.id\}\/events/);
  assert.match(page, /aggregates\.activeStudyCount/);
  assert.match(page, /aggregates\.sessionCount/);
  assert.match(page, /aggregates\.eventCount/);
  assert.match(page, /aggregates\.storedPayloadBytes/);
  assert.match(page, /Next Page/);
  assert.doesNotMatch(page, /\|\| data\.studies\.length/);
});

test('uses Core API readiness rather than liveness for startup routing', async () => {
  const requested: string[] = [];
  const waiting = await getBootstrapState((async (input) => {
    requested.push(String(input));
    return Response.json({ status: 'degraded', components: [] }, { status: 503 });
  }) as typeof globalThis.fetch, 'http://core.test/api/v1');
  assert.equal(waiting.available, true);
  assert.equal(waiting.onboardingCompleted, false);
  assert.equal(requested[0], 'http://core.test/ready');

  const ready = await getBootstrapState((async () => Response.json({
    status: 'healthy', components: []
  })) as typeof globalThis.fetch, 'http://core.test/api/v1');
  assert.equal(ready.onboardingCompleted, true);
});

test('keeps System Settings read-only and exposes safe CLI guidance', async () => {
  const [server, page] = await Promise.all([
    source('src/routes/settings/system/+page.server.ts'),
    source('src/routes/settings/system/+page.svelte')
  ]);
  assert.match(server, /\/system\/status/);
  assert.doesNotMatch(server, /export const actions/);
  assert.match(page, /Secrets are never shown here/);
  assert.match(page, /scarline status/);
  assert.match(page, /scarline doctor/);
  assert.doesNotMatch(page, /Save Configuration/);
  assert.doesNotMatch(page, /Start Simulator/);
});

test('retains zero telemetry samples and caps chart history', () => {
  assert.equal(telemetryNumber(0), 0);
  assert.equal(telemetryNumber(undefined), 0);
  assert.deepEqual(appendTelemetrySample([4, 2], 0, 3), [4, 2, 0]);
  assert.deepEqual(appendTelemetrySample([4, 2, 0], 1, 3), [2, 0, 1]);
});

test('shows restricted study controls disabled with role guidance', async () => {
  const sources = await Promise.all([
    source('src/routes/user-studies/+page.svelte'),
    source('src/routes/user-studies/[id]/participants/+page.svelte'),
    source('src/routes/user-studies/[id]/conditions/+page.svelte'),
    source('src/routes/user-studies/[id]/carla-config/+page.svelte'),
    source('src/routes/user-studies/[id]/sensors/+page.svelte'),
    source('src/routes/user-studies/[id]/participant-view/+page.svelte'),
    source('src/routes/user-studies/[id]/sessions/+page.svelte'),
    source('src/lib/components/admin/active-study/ActiveStudySessionContext.svelte')
  ]);
  const joined = sources.join('\n');
  assert.match(joined, /STUDY_DESIGN_ACCESS_REQUIRED/);
  assert.match(joined, /SESSION_OPERATION_ACCESS_REQUIRED/);
  assert.match(joined, /disabled=\{!data\.canManage\}/);
  assert.match(joined, /disabled=\{!canOperate/);
});
