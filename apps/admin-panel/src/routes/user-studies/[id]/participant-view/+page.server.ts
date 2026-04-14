import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { randomUUID } from 'node:crypto';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  const layouts = await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken);
  const participantLayoutSummary = layouts.find((layout: Record<string, unknown>) => layout.type === 'participant') ?? layouts[0] ?? null;
  const participantLayout = participantLayoutSummary
    ? await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts/${participantLayoutSummary.id}`, locals.accessToken)
    : null;
  return {
    layouts,
    participantLayout,
    widgets: await apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken),
    studyId: params.id,
    accessToken: locals.accessToken
  };
};

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const name = String(formData.get('name') || 'Primary Participant Layout');
    const layoutJsonRaw = formData.get('layoutJson');

    let layoutConfig: Record<string, unknown>;

    if (layoutJsonRaw) {
      // Visual editor path — full JSON layout from canvas
      try {
        layoutConfig = JSON.parse(String(layoutJsonRaw));
      } catch {
        layoutConfig = {
          widgets: []
        };
      }
    } else {
      // Legacy checkbox path — widgetIds list
      const selectedWidgets = formData.getAll('widgetIds').map(String);
      layoutConfig = {
        widgets: selectedWidgets.map((widgetId, index) => ({
          id: randomUUID(),
          widgetId,
          windowMode: 'transparent_electron',
          order: index,
          x: 40 + (index * 180),
          y: 40,
          width: 180,
          height: 180,
          bindingsConfig: {},
          triggerRules: [],
          styleOverrides: {}
        }))
      };
    }

    const body = { 
      ...layoutConfig,
      name, 
      type: 'participant', 
      targetDisplay: '0',
      studyId: params.id
    };

    const layouts = await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken);
    const existing = (layouts ?? []).find((entry: Record<string, unknown>) => entry.type === 'participant')
      ?? layouts?.[0];

    if (existing) {
      const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/layouts/${existing.id}`, locals.accessToken, {
        method: 'PUT',
        body: JSON.stringify({ ...body, id: existing.id })
      }, 'Failed to update participant layout');
      return result.ok ? undefined : result.failure;
    } else {
      const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken, {
        method: 'POST',
        body: JSON.stringify(body)
      }, 'Failed to create participant layout');
      return result.ok ? undefined : result.failure;
    }
  }
};
