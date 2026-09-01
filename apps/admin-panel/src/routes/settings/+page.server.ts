import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  return { roles: user.roles as string[] };
};
