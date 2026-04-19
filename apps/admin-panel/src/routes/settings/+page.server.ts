import { redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  const roles = (user.roles ?? []) as string[];
  throw redirect(303, appPath(roles.includes('admin') ? '/settings/system' : '/settings/devices'));
};
