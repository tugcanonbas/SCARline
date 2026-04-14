import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    studies: await apiRequest(fetch, locals.apiBase, '/studies', locals.accessToken),
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};
