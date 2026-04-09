import { apiRequest } from '$lib/server/api';
import { fail } from '@sveltejs/kit';

export const load = async ({ fetch, locals, params }) => ({
  sessions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken),
  participants: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken),
  conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
  studyId: params.id
});

async function postSessionAction(fetch: typeof globalThis.fetch, locals: App.Locals, studyId: string, sessionId: string, action: string) {
  const response = await fetch(`${locals.apiBase}/studies/${studyId}/sessions/${sessionId}/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${locals.accessToken}`
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return fail(response.status, {
      message: payload?.error?.message ?? `Failed to ${action} session`
    });
  }

  return undefined;
}

export const actions = {
  create: async ({ fetch, locals, params, request }) => {
    const formData = await request.formData();
    const response = await fetch(`${locals.apiBase}/studies/${params.id}/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        name: formData.get('name') || null,
        participantId: formData.get('participantId') || null,
        conditionId: formData.get('conditionId') || null
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, {
        message: payload?.error?.message ?? 'Failed to create session'
      });
    }
  },
  start: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'start'),
  pause: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'pause'),
  resume: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'resume'),
  complete: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'complete'),
  cancel: async ({ fetch, locals, params, request }) => {
    const formData = await request.formData();
    const response = await fetch(`${locals.apiBase}/studies/${params.id}/sessions/${String(formData.get('sessionId'))}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        reason: formData.get('reason') || null
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, {
        message: payload?.error?.message ?? 'Failed to cancel session'
      });
    }
  }
};
