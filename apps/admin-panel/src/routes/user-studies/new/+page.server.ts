import { redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  const users = user.roles.includes('admin')
    ? await apiRequest(fetch, locals.apiBase, '/users', locals.accessToken) as Array<Record<string, unknown>>
    : [user];
  return {
    researchers: users
      .filter((entry) => Array.isArray(entry.roles) && entry.roles.includes('researcher'))
      .map((entry) => ({ ...entry, name: entry.displayName }))
  };
};

export const actions = {
  default: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const researcherIds = formData.getAll('researcherIds');
    
    const result = await apiAction(fetch, locals.apiBase, '/studies', locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        version: '1.0',
        metadata: {}
      })
    }, 'Failed to create study');
    if (!result.ok) return result.failure;
    for (const userId of researcherIds.map(String)) {
      const assignment = await apiAction(fetch, locals.apiBase, `/studies/${result.data.id}/users`, locals.accessToken, {
        method: 'POST',
        body: JSON.stringify({ userId })
      }, 'Study was created, but a researcher could not be assigned');
      if (!assignment.ok) return assignment.failure;
    }
    throw redirect(303, appPath(`/user-studies/${result.data.id}/overview`));
  }
};
