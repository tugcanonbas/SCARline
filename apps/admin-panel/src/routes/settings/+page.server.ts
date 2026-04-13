import { redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  throw redirect(303, appPath('/settings/system'));
};
