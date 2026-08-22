import { redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  return {
    researchers: await apiRequest(fetch, locals.apiBase, '/researchers', locals.accessToken)
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
        description: formData.get('description') || undefined,
        researcherIds: researcherIds.length > 0 ? researcherIds : undefined
      })
    }, 'Failed to create study');
    if (!result.ok) return result.failure;
    throw redirect(303, appPath(`/user-studies/${result.data.id}/overview`));
  }
};
