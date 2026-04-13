import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params, url }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  const query = new URLSearchParams();
  const limit = url.searchParams.get('limit') ?? '500';
  query.set('limit', limit);

  return {
    sessionId: params.id,
    summary: await apiRequest(fetch, locals.apiBase, `/session-logs/${params.id}/summary`, locals.accessToken),
    events: await apiRequest(fetch, locals.apiBase, `/session-logs/${params.id}?${query}`, locals.accessToken),
    limit
  };
};
