import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals }) => {
  const health = await apiRequest(fetch, locals.apiBase, '/health', locals.accessToken);
  const bootstrap = await apiRequest(fetch, locals.apiBase, '/system/bootstrap', locals.accessToken);
  return {
    health,
    bootstrap
  };
};
