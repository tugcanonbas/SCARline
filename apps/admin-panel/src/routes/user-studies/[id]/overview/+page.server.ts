import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { handleStudyTransition } from '$lib/server/study-lifecycle';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const [study, readiness] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}/readiness`, locals.accessToken)
  ]);
  return {
    study,
    readiness,
    canManage: user.roles.some((role: string) => role === 'admin' || role === 'researcher')
  };
};

export const actions = {
  studyTransition: handleStudyTransition
};
