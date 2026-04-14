import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.SCARLINE_E2E_URL ?? 'http://127.0.0.1:8088').replace(/\/$/, '');

function buildCookieHeader(accessToken, refreshToken) {
  return [
    `scarline_access_token=${accessToken}`,
    `scarline_refresh_token=${refreshToken}`
  ].join('; ');
}

async function requestJson(path, { method = 'GET', token, body, headers } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${payload?.error?.message ?? response.statusText}`);
  }

  return payload;
}

function createSocketHarness(token) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
  const backlog = [];
  const waiters = new Set();

  function flush(message) {
    for (const waiter of Array.from(waiters)) {
      if (waiter.channel === message.channel && waiter.predicate(message.data)) {
        clearTimeout(waiter.timeout);
        waiters.delete(waiter);
        waiter.resolve(message);
      }
    }
  }

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    backlog.push(message);
    flush(message);
  });

  socket.addEventListener('close', () => {
    for (const waiter of Array.from(waiters)) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.reject(new Error('WebSocket closed before the expected message arrived'));
    }
  });

  return {
    async connect() {
      await new Promise((resolve, reject) => {
        const handleOpen = () => resolve();
        const handleError = () => reject(new Error('Failed to connect to the SCARline WebSocket gateway'));
        socket.addEventListener('open', handleOpen, { once: true });
        socket.addEventListener('error', handleError, { once: true });
      });

      socket.send(JSON.stringify({
        action: 'subscribe',
        channels: ['session.events', 'session.telemetry', 'widget.updates', 'system.health']
      }));
    },
    waitFor(channel, predicate, timeoutMs = 20_000) {
      for (const message of backlog) {
        if (message.channel === channel && predicate(message.data)) {
          return Promise.resolve(message);
        }
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          channel,
          predicate,
          resolve,
          reject,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Timed out waiting for ${channel}`));
          }, timeoutMs)
        };

        waiters.add(waiter);
      });
    },
    close() {
      socket.close();
    }
  };
}

test('public onboarding, study setup, session start, dashboard, and overlay flow works through the gateway', { timeout: 90_000 }, async (t) => {
  let healthResponse;
  try {
    healthResponse = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    t.skip(`SCARline stack is not reachable at ${baseUrl}`);
    return;
  }

  assert.equal(healthResponse.status, 200);

  const rootResponse = await fetch(`${baseUrl}/`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000)
  });
  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.get('location'), '/admin/dashboard');

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const username = `e2e-admin-${suffix}`;
  const password = `Password123!${suffix.slice(-2)}`;

  await requestJson('/api/onboarding/system', {
    method: 'POST',
    body: {
      carlaServerPath: null,
      dataDirectory: `/tmp/scarline-e2e-${suffix}`,
      platformPort: 8088,
      carlaServerPort: 2000,
      transparentOverlayEnabled: true
    }
  });

  await requestJson('/api/onboarding/researcher', {
    method: 'POST',
    body: {
      fullName: `E2E Researcher ${suffix}`,
      email: `e2e-${suffix}@scarline.local`,
      institution: 'SCARline QA',
      role: 'Researcher',
      username,
      password
    }
  });

  const loginPayload = await requestJson('/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password
    }
  });

  const accessToken = loginPayload.data.accessToken;
  const refreshToken = loginPayload.data.refreshToken;
  const cookieHeader = buildCookieHeader(accessToken, refreshToken);

  const dashboardPage = await fetch(`${baseUrl}/admin/dashboard`, {
    headers: {
      cookie: cookieHeader
    },
    signal: AbortSignal.timeout(10_000)
  });
  assert.equal(dashboardPage.status, 200);
  assert.match(await dashboardPage.text(), /Dashboard/);

  const socket = createSocketHarness(accessToken);
  await socket.connect();
  t.after(() => socket.close());

  const studyPayload = await requestJson('/api/studies', {
    method: 'POST',
    token: accessToken,
    body: {
      name: `E2E Study ${suffix}`,
      description: 'End-to-end validation flow'
    }
  });
  const studyId = studyPayload.data.id;

  const conditionPayload = await requestJson(`/api/studies/${studyId}/conditions`, {
    method: 'POST',
    token: accessToken,
    body: {
      name: 'Baseline',
      description: 'Default mock-simulator condition',
      order: 0,
      carlaOverrides: {},
      widgetOverrides: {}
    }
  });
  const conditionId = conditionPayload.data.id;

  const participantPayload = await requestJson(`/api/studies/${studyId}/participants`, {
    method: 'POST',
    token: accessToken,
    body: {
      participantCode: `P-${suffix}`,
      demographicData: {
        cohort: 'e2e'
      },
      assignedConditionId: conditionId
    }
  });
  const participantId = participantPayload.data.id;

  await requestJson(`/api/studies/${studyId}/carla-config`, {
    method: 'PUT',
    token: accessToken,
    body: {
      map: 'MockTown01',
      weatherPreset: 'ClearNoon',
      weatherCustom: {},
      egoVehicleBlueprint: 'vehicle.lincoln.mkz_2020',
      simulationMode: 'synchronous',
      fixedDeltaSeconds: 0.05,
      trafficConfig: {
        npcCount: 12
      },
      pedestrianConfig: {},
      sunConfig: {},
      spectatorConfig: {},
      recordingConfig: {},
      sensors: [
        { id: 'speed', type: 'sensor.speedometer' }
      ]
    }
  });

  await requestJson(`/api/studies/${studyId}/sensor-config`, {
    method: 'PUT',
    token: accessToken,
    body: {
      sensors: [
        { driverId: 'logitech_g29', sensorType: 'steering_wheel' },
        { driverId: 'usb_camera', sensorType: 'camera' }
      ]
    }
  });

  const widgetInstanceId = randomUUID();
  const layoutPayload = await requestJson(`/api/studies/${studyId}/layouts`, {
    method: 'POST',
    token: accessToken,
    body: {
      name: 'Participant Main',
      type: 'participant',
      targetDisplay: '0',
      widgets: [
        {
          id: widgetInstanceId,
          widgetId: 'speedometer',
          windowMode: 'transparent_electron',
          order: 0,
          x: 40,
          y: 40,
          width: 180,
          height: 180,
          bindingsConfig: {},
          triggerRules: [],
          styleOverrides: {}
        }
      ]
    }
  });
  const layoutId = layoutPayload.data.id;

  const overlayResponse = await fetch(
    `${baseUrl}/overlay/${layoutId}?studyId=${studyId}&token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  assert.equal(overlayResponse.status, 200);
  assert.match(await overlayResponse.text(), /SCARline Overlay/);

  const sessionPayload = await requestJson(`/api/studies/${studyId}/sessions`, {
    method: 'POST',
    token: accessToken,
    body: {
      participantId,
      conditionId,
      name: 'E2E Session'
    }
  });
  const sessionId = sessionPayload.data.id;

  t.after(async () => {
    try {
      await requestJson(`/api/studies/${studyId}/sessions/${sessionId}/cancel`, {
        method: 'POST',
        token: accessToken,
        body: {
          reason: 'integration-test-cleanup'
        }
      });
    } catch {
      // Ignore cleanup failures.
    }
  });

  const sessionStarted = socket.waitFor(
    'session.events',
    (data) => data.sessionId === sessionId && data.status === 'running'
  );
  const telemetryReceived = socket.waitFor(
    'session.telemetry',
    (data) => typeof data.routingKey === 'string' && data.routingKey.includes(`.${sessionId}.driving.vehicle.telemetry`)
  );

  await requestJson(`/api/studies/${studyId}/sessions/${sessionId}/start`, {
    method: 'POST',
    token: accessToken
  });

  const startedMessage = await sessionStarted;
  assert.equal(startedMessage.data.sessionId, sessionId);
  await telemetryReceived;

  const widgetUpdate = socket.waitFor(
    'widget.updates',
    (data) => data.instanceId === widgetInstanceId && data.widgetId === 'speedometer'
  );

  await requestJson(`/api/studies/${studyId}/sessions/${sessionId}/triggers`, {
    method: 'POST',
    token: accessToken,
    body: {
      instanceId: widgetInstanceId,
      widgetId: 'speedometer',
      triggerType: 'manual',
      source: 'researcher-trigger',
      bindingValues: {
        speed: 42
      },
      payload: {
        reason: 'e2e-trigger'
      }
    }
  });

  const widgetMessage = await widgetUpdate;
  assert.equal(widgetMessage.data.instanceId, widgetInstanceId);

  const dashboardPayload = await requestJson('/api/dashboard', {
    token: accessToken
  });
  assert.ok(
    dashboardPayload.data.recentSessions.some((session) => session.id === sessionId && session.status === 'running')
  );
});
