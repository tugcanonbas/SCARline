import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { randomUUID } from 'node:crypto';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    layouts: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken),
    widgets: await apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken),
    studyId: params.id
  };
};

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const selectedWidgets = formData.getAll('widgetIds').map(String);
    const body = {
      name: formData.get('name') || 'Primary Participant Layout',
      type: 'participant',
      targetDisplay: '0',
      layoutConfig: {
        zones: [
          { id: 'primary', x: 40, y: 40, width: 1280, height: 720, display: 0 }
        ],
        widgets: selectedWidgets.map((widgetId, index) => ({
          id: randomUUID(),
          widgetId,
          zoneId: 'primary',
          order: index,
          bindingsConfig: {},
          triggerRules: [],
          styleOverrides: {}
        }))
      }
    };

    const hasExisting = Array.isArray((await fetch(`${locals.apiBase}/studies/${params.id}/layouts`, {
      headers: { authorization: `Bearer ${locals.accessToken}` }
    }).then((response) => response.json())).data);

    if (hasExisting) {
      const layoutsResponse = await fetch(`${locals.apiBase}/studies/${params.id}/layouts`, {
        headers: { authorization: `Bearer ${locals.accessToken}` }
      });
      const layoutsPayload = await layoutsResponse.json();
      const existing = layoutsPayload.data?.[0];
      if (existing) {
        await fetch(`${locals.apiBase}/studies/${params.id}/layouts/${existing.id}`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${locals.accessToken}`
          },
          body: JSON.stringify({
            id: existing.id,
            studyId: params.id,
            ...body
          })
        });
        return;
      }
    }

    await fetch(`${locals.apiBase}/studies/${params.id}/layouts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify(body)
    });
  }
};
