import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    config: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sensor-config`, locals.accessToken),
    drivers: await apiRequest(fetch, locals.apiBase, '/sensors/drivers', locals.accessToken),
    studyId: params.id
  };
};

export const actions = {
  default: async ({ fetch, locals, params }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    await fetch(`${locals.apiBase}/studies/${params.id}/sensor-config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        sensors: [
          { type: 'steering_wheel', driver: 'logitech_g29', sample_rate: 100, metadata: { force_feedback: true } },
          { type: 'camera', driver: 'usb_camera', sample_rate: 30, metadata: { preferred_source: 'embedded-or-usb' } }
        ]
      })
    });
  }
};
