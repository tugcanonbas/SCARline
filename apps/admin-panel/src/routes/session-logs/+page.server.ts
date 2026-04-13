import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, url }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  const query = new URLSearchParams();
  for (const key of ['studyId', 'sessionId', 'eventType', 'modality', 'limit']) {
    const value = url.searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }

  return {
    logs: await apiRequest(fetch, locals.apiBase, `/session-logs${query.size ? `?${query}` : ''}`, locals.accessToken),
    studies: await apiRequest(fetch, locals.apiBase, '/studies', locals.accessToken),
    filters: {
      studyId: url.searchParams.get('studyId') ?? '',
      sessionId: url.searchParams.get('sessionId') ?? '',
      eventType: url.searchParams.get('eventType') ?? '',
      modality: url.searchParams.get('modality') ?? '',
      limit: url.searchParams.get('limit') ?? '100'
    }
  };
};
