import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, url }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  const search = url.searchParams.get('search');
  const users = await apiRequest(fetch, locals.apiBase, '/users', locals.accessToken) as Array<Record<string, unknown>>;
  const needle = search?.trim().toLocaleLowerCase() ?? '';
  const researchers: Array<Record<string, unknown>> = users
    .filter((entry) => Array.isArray(entry.roles) && entry.roles.includes('researcher'))
    .map((entry) => ({ ...entry, name: entry.displayName, role: 'Researcher', activeStudiesCount: 0 }) as Record<string, unknown>)
    .filter((entry) => !needle || [entry.name, entry.email, entry.institution].some((value) => String(value ?? '').toLocaleLowerCase().includes(needle)));
  return {
    researchers,
    search,
    canManage: user.roles?.includes('admin') ?? false
  };
};
