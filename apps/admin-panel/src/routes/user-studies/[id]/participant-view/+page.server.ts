import { apiRequest } from '$lib/server/api';
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

    const layoutsResponse = await fetch(`${locals.apiBase}/studies/${params.id}/layouts`, {
      headers: { authorization: `Bearer ${locals.accessToken}` }
    });
    const layoutsPayload = await layoutsResponse.json();
    const existing = (layoutsPayload.data ?? []).find((entry: Record<string, unknown>) => entry.type === 'participant')
      ?? layoutsPayload.data?.[0];

    if (existing) {
      await fetch(`${locals.apiBase}/studies/${params.id}/layouts/${existing.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${locals.accessToken}`
        },
        body: JSON.stringify({ ...body, id: existing.id })
      });
    } else {
      await fetch(`${locals.apiBase}/studies/${params.id}/layouts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${locals.accessToken}`
        },
        body: JSON.stringify(body)
      });
    }
  }
};
