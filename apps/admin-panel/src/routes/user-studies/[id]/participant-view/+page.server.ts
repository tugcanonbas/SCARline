import { apiRequest } from '$lib/server/api';
import { loadAdminLayouts } from '$lib/server/layouts';
import { requireRole } from '$lib/server/rbac';
import { handleStudyTransition } from '$lib/server/study-lifecycle';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const context = await loadAdminLayouts(fetch, locals, params.id);
  const participantLayout = context.layouts.find((layout) => layout.type === 'participant') ?? context.layouts[0] ?? null;
  const overlayStatus = await apiRequest(fetch, locals.apiBase, '/overlay/status', locals.accessToken) as Record<string, unknown>;
  const displays = Array.isArray(overlayStatus.displays) ? overlayStatus.displays.map((display, index) => {
    const item = display as Record<string, unknown>;
    return { ...item, index, label: item.name ?? `Display ${index}`, isPrimary: item.primary === true };
  }) : [];
  const [study, readiness] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}/readiness`, locals.accessToken)
  ]);
  return {
    study,
    readiness,
    canManage: user.roles.some((role: string) => role === 'admin' || role === 'researcher'),
    layouts: context.layouts,
    participantLayout,
    expectedRevisions: context.expectedRevisions,
    widgets: context.catalogue,
    overlayDisplays: { displays, fallback: displays.length === 0 },
    overlayWindows: Array.isArray(overlayStatus.windows) ? overlayStatus.windows : [],
    webSocketOrigin: locals.webSocketOrigin,
    studyId: params.id
  };
};

export const actions = {
  studyTransition: handleStudyTransition
};
