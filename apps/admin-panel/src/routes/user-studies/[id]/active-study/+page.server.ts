import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals, params }) => ({
  sessions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken),
  layouts: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken),
  widgets: await apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken),
  token: locals.accessToken,
  studyId: params.id
});
