import { redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  throw redirect(303, appPath(`/user-studies/${params.id}/overview`));
};
