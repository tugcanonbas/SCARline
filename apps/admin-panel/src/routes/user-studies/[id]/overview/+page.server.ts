import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals, params }) => ({
  study: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken)
});
