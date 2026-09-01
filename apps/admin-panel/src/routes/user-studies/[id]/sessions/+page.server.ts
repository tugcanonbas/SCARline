import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const sessionItems = await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken) as Array<Record<string, unknown>>;
  const sessions = await Promise.all(sessionItems.map(async (item) => {
    const detail = await apiRequest(fetch, locals.apiBase, `/sessions/${item.id}`, locals.accessToken) as Record<string, unknown>;
    const conditions = detail.conditions as Array<Record<string, unknown>> | undefined;
    const started = typeof detail.startedAt === 'string' ? Date.parse(detail.startedAt) : NaN;
    const ended = typeof detail.completedAt === 'string' ? Date.parse(detail.completedAt) : Date.now();
    return {
      ...detail,
      conditionId: conditions?.[0]?.conditionId ?? null,
      durationSeconds: Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 1000)) : 0,
      status: detail.status === 'aborted' ? 'cancelled' : detail.status
    };
  }));
  return {
    sessions: sessions as Array<Record<string, any>>,
    participants: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken),
    conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
    studyId: params.id,
    canOperate: user.roles?.some((role: string) => role === 'admin' || role === 'researcher' || role === 'operator') ?? false
  };
};

export const actions = {
  create: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const formData = await request.formData();
    const participantId = String(formData.get('participantId') ?? '').trim();
    const conditionIds = formData.getAll('conditionIds').map(String).filter(Boolean);
    if (!participantId) return { message: 'Select a participant before creating a session.' };
    if (conditionIds.length === 0) return { message: 'Select at least one condition before creating a session.' };
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name') || null,
        participantId,
        conditionIds,
        runtimeMetadata: {},
        notes: null
      })
    }, 'Failed to create session');
    return result.ok ? undefined : result.failure;
  }
};
