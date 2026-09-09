import { error } from '@sveltejs/kit';
import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { loadActiveStudyConditions, requirePrimaryCondition } from '$lib/server/study-context';
import { handleStudyTransition } from '$lib/server/study-lifecycle';

function parseJsonObject(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw error(400, 'Sensor metadata must be a JSON object');
    return parsed;
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    throw error(400, 'Invalid sensor metadata JSON');
  }
}

async function context(fetch: typeof globalThis.fetch, locals: App.Locals, studyId: string) {
  const condition = await requirePrimaryCondition(fetch, locals, studyId);
  const [devices, attached, catalogue] = await Promise.all([
    apiRequest(fetch, locals.apiBase, '/devices', locals.accessToken) as Promise<Array<Record<string, unknown>>>,
    apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${condition.id}/devices`, locals.accessToken) as Promise<Array<Record<string, unknown>>>,
    apiRequest(fetch, locals.apiBase, '/sensors/catalogue', locals.accessToken) as Promise<Array<Record<string, unknown>>>
  ]);
  const channels = new Map<string, Array<Record<string, unknown>>>();
  await Promise.all(devices.map(async (device) => channels.set(String(device.id), await apiRequest(fetch, locals.apiBase, `/devices/${device.id}/sensors`, locals.accessToken) as Array<Record<string, unknown>>)));
  return { condition, devices, attached, catalogue, channels };
}

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const current = await context(fetch, locals, params.id);
  const [study, readiness] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}/readiness`, locals.accessToken)
  ]);
  return {
    study,
    readiness,
    config: { sensors: current.attached.filter((entry) => entry.enabled).map((entry) => ({
      ...(entry.configuration as Record<string, unknown> ?? {}),
      driver: entry.deviceId, driverId: entry.deviceId, type: entry.type
    })) } as Record<string, any>,
    drivers: current.catalogue.flatMap((manifest) => {
      const device = current.devices.find((candidate) => (candidate.metadata as Record<string, unknown> | undefined)?.driverKey === manifest.key || candidate.sourceKey === `driver:${manifest.key}`);
      return device ? [{
        driverId: String(device.id), driverKey: String(manifest.key), displayName: String(manifest.name),
        sensorType: String(manifest.deviceType), channels: current.channels.get(String(device.id)) ?? [],
        configurationSchema: manifest.configurationSchema, mock: manifest.mock === true,
        defaultSampleRate: Number((manifest.channels as Array<Record<string, unknown>> | undefined)?.[0]?.sampleRate ?? 1),
        supportsRecording: (manifest.capabilities as unknown[] | undefined)?.includes('camera.local-recording') === true
      }] : [];
    }) as Array<Record<string, any>>,
    studyId: params.id,
    canManage: user.roles.some((role: string) => role === 'admin' || role === 'researcher')
  };
};

async function saveDevices(fetch: typeof globalThis.fetch, locals: App.Locals, studyId: string, sensors: Array<Record<string, unknown>>) {
  const current = await context(fetch, locals, studyId);
  const conditions = await loadActiveStudyConditions(fetch, locals, studyId);
  for (const condition of conditions) {
    const attached = condition.id === current.condition.id
      ? current.attached
      : await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${condition.id}/devices`, locals.accessToken) as Array<Record<string, unknown>>;
    const failure = await saveConditionDevices(fetch, locals, studyId, String(condition.id), attached, current, sensors);
    if (failure) return failure;
  }
  return undefined;
}

async function saveConditionDevices(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  conditionId: string,
  attachedDevices: Array<Record<string, unknown>>,
  current: Awaited<ReturnType<typeof context>>,
  sensors: Array<Record<string, unknown>>
) {
  const selected = new Set(sensors.map((sensor) => String(sensor.driverId)));
  for (const attached of attachedDevices) {
    if (!selected.has(String(attached.deviceId))) {
      const result = await apiAction(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/devices/${attached.id}`, locals.accessToken, { method: 'DELETE' }, 'Failed to remove sensor device');
      if (!result.ok) return result.failure;
    }
  }
  for (const sensor of sensors) {
    const driver = current.catalogue.find((item) => item.key === sensor.driverKey);
    const result = await apiAction(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/devices`, locals.accessToken, {
      method: 'POST', body: JSON.stringify({ deviceId: sensor.driverId, enabled: true, configuration: { ...sensor, driverKey: sensor.driverKey, onDisconnect: sensor.required ? 'fail' : 'continue' } })
    }, 'Failed to save sensor device');
    if (!result.ok) return result.failure;
    const assignmentId = String((result.data as Record<string, unknown> | undefined)?.id ?? '');
    if (!assignmentId) continue;
    const channels = current.channels.get(String(sensor.driverId)) ?? [];
    for (const channel of channels) {
      const channelDefinition = (driver?.channels as Array<Record<string, unknown>> | undefined)?.find((item) => item.key === channel.key);
      const channelRates = sensor.channelRates && typeof sensor.channelRates === 'object' ? sensor.channelRates as Record<string, unknown> : {};
      const configured = await apiAction(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/devices/${assignmentId}/sensors`, locals.accessToken, {
        method: 'PUT', body: JSON.stringify({ sensorId: channel.id, enabled: true, configuration: { sampleRate: channelRates[String(channel.id)] ?? sensor.sample_rate ?? channelDefinition?.sampleRate ?? (channel.metadata as Record<string, unknown> | undefined)?.sampleRate ?? 1 } })
      }, 'Failed to configure sensor channel');
      if (!configured.ok) return configured.failure;
    }
  }
  return undefined;
}

export const actions = {
  studyTransition: handleStudyTransition,
  refresh: async ({ fetch, locals }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const result = await apiAction(fetch, locals.apiBase, '/sensors/refresh', locals.accessToken, { method: 'POST', body: '{}' }, 'Failed to refresh sensor drivers');
    return result.ok ? { refreshed: true, refreshResult: result.data } : result.failure;
  },
  preset: async ({ fetch, locals, params }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const current = await context(fetch, locals, params.id);
    const defaults = current.catalogue.flatMap((manifest) => {
      const device = current.devices.find((candidate) =>
        (candidate.metadata as Record<string, unknown> | undefined)?.driverKey === manifest.key
        || candidate.sourceKey === `driver:${String(manifest.key)}`
      );
      if (!device) return [];
      const channels = current.channels.get(String(device.id)) ?? [];
      const definitions = manifest.channels as Array<Record<string, unknown>> | undefined;
      return [{
        type: manifest.deviceType, driver: device.id, driverId: device.id, driverKey: manifest.key,
        channelRates: Object.fromEntries(channels.map((channel) => [String(channel.id), Number(definitions?.find((item) => item.key === channel.key)?.sampleRate ?? (channel.metadata as Record<string, unknown> | undefined)?.sampleRate ?? 1)])),
        enabled: true, required: manifest.key === 'logitech_g29', recording: false, metadata: {}
      }];
    });
    return saveDevices(fetch, locals, params.id, defaults);
  },
  save: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const form = await request.formData();
    const sensors = form.getAll('driverId').map(String).map((driverId) => {
      const channelRates = Object.fromEntries(form.getAll(`${driverId}:channelId`).map(String).map((channelId) => [channelId, Number(form.get(`${driverId}:${channelId}:sampleRate`) || 1)]));
      return {
        type: String(form.get(`${driverId}:sensorType`) || 'custom'), driver: driverId, driverId, driverKey: String(form.get(`${driverId}:driverKey`) || ''),
        channelRates, enabled: true, required: form.get(`${driverId}:required`) === 'on', recording: form.get(`${driverId}:recording`) === 'on', metadata: parseJsonObject(form.get(`${driverId}:metadata`))
      };
    });
    return saveDevices(fetch, locals, params.id, sensors);
  }
};
