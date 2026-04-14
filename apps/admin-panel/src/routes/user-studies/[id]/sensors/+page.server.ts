import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    config: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sensor-config`, locals.accessToken),
    drivers: await apiRequest(fetch, locals.apiBase, '/sensors/drivers', locals.accessToken),
    studyId: params.id,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

export const actions = {
  default: async ({ fetch, locals, params }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/sensor-config`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        sensors: [
          { type: 'steering_wheel', driver: 'logitech_g29', sample_rate: 100, metadata: { force_feedback: true } },
          { type: 'camera', driver: 'usb_camera', sample_rate: 30, metadata: { preferred_source: 'embedded-or-usb' } }
        ]
      })
    }, 'Failed to save sensor configuration');
    return result.ok ? undefined : result.failure;
  }
};
