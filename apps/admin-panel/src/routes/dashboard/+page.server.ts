import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    dashboard: await apiRequest(fetch, locals.apiBase, '/dashboard', locals.accessToken),
    token: locals.accessToken
  };
};
