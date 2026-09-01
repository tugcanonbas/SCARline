import { redirect } from '@sveltejs/kit';
import { requireRole } from '$lib/server/rbac';
import { appPath } from '$lib/paths';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  throw redirect(303, appPath('/settings/users'));
};
