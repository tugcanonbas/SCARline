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
