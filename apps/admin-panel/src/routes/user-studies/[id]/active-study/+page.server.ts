import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    sessions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken),
    layouts: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken),
    widgets: await apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken),
    token: locals.accessToken,
    studyId: params.id
  };
};
