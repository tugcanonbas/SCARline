import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params, url }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const query = new URLSearchParams();
  const limit = url.searchParams.get('limit') ?? '500';
  query.set('limit', limit);

  const session = await apiRequest(fetch, locals.apiBase, `/sessions/${params.id}`, locals.accessToken) as Record<string, unknown>;
  const events = await apiRequest(fetch, locals.apiBase, `/sessions/${params.id}/events?${query}`, locals.accessToken) as Array<Record<string, unknown>>;
  const startedAt = typeof session.startedAt === 'string' ? Date.parse(session.startedAt) : NaN;
  const endedAt = typeof session.completedAt === 'string' ? Date.parse(session.completedAt) : Date.now();
  const normalizedEvents: Array<Record<string, unknown>> = events.map((event) => ({ ...event, source: event.sourceKey ?? event.sourceType ?? 'unknown' }));
  return {
    sessionId: params.id,
    summary: {
      status: String(session.status ?? 'unknown'),
      eventCount: normalizedEvents.length,
      modalityCount: new Set(normalizedEvents.map((event) => event.modality)).size,
      durationSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0
    },
    events: normalizedEvents,
    limit
  };
};
