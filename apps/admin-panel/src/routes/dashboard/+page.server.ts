import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals }) => {
  return {
    dashboard: await apiRequest(fetch, locals.apiBase, '/dashboard', locals.accessToken)
  };
};
