import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { error } from '@sveltejs/kit';

const FILTER_KEYS = ['studyId', 'sessionId', 'eventType', 'modality', 'limit', 'cursor'] as const;

export const load = async ({ fetch, locals, url }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const [studies, eventsResponse] = await Promise.all([
    apiRequest(fetch, locals.apiBase, '/studies?limit=200', locals.accessToken) as Promise<Array<Record<string, unknown>>>,
    fetch(`${locals.apiBase}/session-events${query.size ? `?${query}` : ''}`, {
      headers: { authorization: `Bearer ${locals.accessToken}` }
    })
  ]);
  const eventsPayload = await eventsResponse.json().catch(() => null);
  if (!eventsResponse.ok) {
    throw error(eventsResponse.status, typeof eventsPayload?.error?.message === 'string'
      ? eventsPayload.error.message
      : 'Session events could not be loaded.');
  }
  const result = eventsPayload?.data ?? {};
  const nextQuery = new URLSearchParams(query);
  nextQuery.delete('cursor');
  if (typeof result.nextCursor === 'string' && result.nextCursor) {
    nextQuery.set('cursor', result.nextCursor);
  }

  return {
    logs: Array.isArray(result.items) ? result.items : [],
    aggregates: result.aggregates ?? {
      activeStudyCount: 0,
      sessionCount: 0,
      eventCount: 0,
      storedPayloadBytes: 0
    },
    nextQuery: typeof result.nextCursor === 'string' && result.nextCursor ? nextQuery.toString() : '',
    studies: studies as Array<{ id: string; name: string }>,
    filters: {
      studyId: url.searchParams.get('studyId') ?? '',
      sessionId: url.searchParams.get('sessionId') ?? '',
      eventType: url.searchParams.get('eventType') ?? '',
      modality: url.searchParams.get('modality') ?? '',
      limit: url.searchParams.get('limit') ?? '100'
    }
  };
};
