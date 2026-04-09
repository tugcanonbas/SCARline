import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals, params }) => ({
  sessions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken),
  participants: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken),
  conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
  studyId: params.id
});

async function postSessionAction(fetch: typeof globalThis.fetch, locals: App.Locals, studyId: string, sessionId: string, action: string) {
  await fetch(`${locals.apiBase}/studies/${studyId}/sessions/${sessionId}/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${locals.accessToken}`
    }
  });
}

export const actions = {
  create: async ({ fetch, locals, params, request }) => {
    const formData = await request.formData();
    await fetch(`${locals.apiBase}/studies/${params.id}/sessions`, {
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
  },
  start: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'start'),
  pause: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'pause'),
  resume: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'resume'),
  complete: async ({ fetch, locals, params, request }) => postSessionAction(fetch, locals, params.id, String((await request.formData()).get('sessionId')), 'complete'),
  cancel: async ({ fetch, locals, params, request }) => {
    const formData = await request.formData();
    await fetch(`${locals.apiBase}/studies/${params.id}/sessions/${String(formData.get('sessionId'))}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        reason: formData.get('reason') || null
      })
    });
  }
};
