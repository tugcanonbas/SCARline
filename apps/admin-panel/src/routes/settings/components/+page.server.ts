import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals }) => ({
  components: await apiRequest(fetch, locals.apiBase, '/system/components', locals.accessToken)
});
