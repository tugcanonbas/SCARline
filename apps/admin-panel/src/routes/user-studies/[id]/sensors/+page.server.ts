import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { error } from '@sveltejs/kit';

function parseJsonObject(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw error(400, 'Sensor metadata must be a JSON object');
    }
    return parsed;
  } catch (parseError) {
    if (parseError && typeof parseError === 'object' && 'status' in parseError) {
      throw parseError;
    }
    throw error(400, 'Invalid sensor metadata JSON');
  }
}

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  return {
    study: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    config: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sensor-config`, locals.accessToken),
    drivers: await apiRequest(fetch, locals.apiBase, '/sensors/drivers', locals.accessToken),
    studyId: params.id,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

export const actions = {
  preset: async ({ fetch, locals, params }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const drivers = await apiRequest(fetch, locals.apiBase, '/sensors/drivers', locals.accessToken);
    const sensors = drivers.map((driver: Record<string, unknown>) => ({
      type: driver.sensorType,
      driver: driver.driverId,
      driverId: driver.driverId,
      sample_rate: driver.driverId === 'logitech_g29' ? 100 : 30,
      enabled: true,
      required: driver.driverId === 'logitech_g29',
      metadata: driver.driverId === 'logitech_g29'
        ? { force_feedback: true }
        : { preferred_source: 'embedded-or-usb' }
    }));
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/sensor-config`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({ sensors })
    }, 'Failed to save sensor configuration');
    return result.ok ? undefined : result.failure;
  },
  save: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const selectedDrivers = formData.getAll('driverId').map(String);
    const sensors = selectedDrivers.map((driverId) => ({
      type: String(formData.get(`${driverId}:sensorType`) || 'custom'),
      driver: driverId,
      driverId,
      sample_rate: Number(formData.get(`${driverId}:sampleRate`) || 1),
      enabled: true,
      required: formData.get(`${driverId}:required`) === 'on',
      metadata: parseJsonObject(formData.get(`${driverId}:metadata`))
    }));
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/sensor-config`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        sensors
      })
    }, 'Failed to save sensor configuration');
    return result.ok ? undefined : result.failure;
  }
};
