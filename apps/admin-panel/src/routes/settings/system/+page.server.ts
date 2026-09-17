import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  const [system, readinessResponse] = await Promise.all([
    apiRequest(fetch, locals.apiBase, '/system/status', locals.accessToken) as Promise<Record<string, unknown>>,
    fetch(`${locals.apiBase.replace(/\/api\/v1\/?$/, '')}/ready`)
  ]);
  const readiness = await readinessResponse.json().catch(() => ({
    status: 'unhealthy',
    checkedAt: new Date().toISOString(),
    components: []
  }));
  return { system, readiness };
};

export const actions = {
  update: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, '/system/configuration', locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        carlaServerPath: formData.get('carlaServerPath') || null,
        dataDirectory: formData.get('dataDirectory'),
        platformPort: Number(formData.get('platformPort')),
        carlaServerPort: Number(formData.get('carlaServerPort')),
        transparentOverlayEnabled: formData.get('transparentOverlayEnabled') === 'on'
      })
    });
  },
  carla: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    const action = String(formData.get('action'));
    const configuration = await apiRequest(fetch, locals.apiBase, '/system/configuration', locals.accessToken);
    await apiRequest(fetch, locals.apiBase, `/system/carla/${action}`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        carlaServerPath: configuration.carlaServerPath ?? null
      })
    });
  },
  overlayReload: async ({ fetch, locals }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    await apiRequest(fetch, locals.apiBase, '/system/overlay/reload', locals.accessToken, {
      method: 'POST'
    });
  }
};
