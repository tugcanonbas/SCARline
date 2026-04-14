import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    participants: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken),
    studyId: params.id,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/participants`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        participantCode: formData.get('participantCode'),
        notes: formData.get('notes') || null,
        demographicData: {}
      })
    }, 'Failed to create participant');
    return result.ok ? undefined : result.failure;
  }
};
