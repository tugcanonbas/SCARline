import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals }) => ({
  studies: await apiRequest(fetch, locals.apiBase, '/studies', locals.accessToken)
});
