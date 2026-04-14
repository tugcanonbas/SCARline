import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, url }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'viewer']);
  const search = url.searchParams.get('search');
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return {
    researchers: await apiRequest(fetch, locals.apiBase, `/researchers${query}`, locals.accessToken),
    search,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};
