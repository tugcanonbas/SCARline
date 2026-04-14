import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    sessions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken),
    participants: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken),
    conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
    studyId: params.id,
    canOperate: user.roles?.some((role: string) => role === 'admin' || role === 'researcher' || role === 'operator') ?? false
  };
};

async function postSessionAction(fetch: typeof globalThis.fetch, locals: App.Locals, studyId: string, sessionId: string, action: string) {
  const result = await apiAction(fetch, locals.apiBase, `/studies/${studyId}/sessions/${sessionId}/${action}`, locals.accessToken, {
    method: 'POST'
  }, `Failed to ${action} session`);
  return result.ok ? undefined : result.failure;
}

export const actions = {
  create: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const formData = await request.formData();
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name') || null,
        participantId: formData.get('participantId') || null,
        conditionId: formData.get('conditionId') || null
      })
    }, 'Failed to create session');
    return result.ok ? undefined : result.failure;
  },
  start: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    return postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'start');
  },
  pause: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    return postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'pause');
  },
  resume: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    return postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'resume');
  },
  complete: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    return postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'complete');
  },
  cancel: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const formData = await request.formData();
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/sessions/${String(formData.get('sessionId'))}/cancel`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        reason: formData.get('reason') || null
      })
    }, 'Failed to cancel session');
    return result.ok ? undefined : result.failure;
  }
};
