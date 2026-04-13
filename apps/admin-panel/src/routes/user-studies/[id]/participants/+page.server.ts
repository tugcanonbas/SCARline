import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    participants: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken),
    studyId: params.id
  };
};

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    await fetch(`${locals.apiBase}/studies/${params.id}/participants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        participantCode: formData.get('participantCode'),
        notes: formData.get('notes') || null,
        demographicData: {}
      })
    });
  }
};
