import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
    studyId: params.id
  };
};

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    await fetch(`${locals.apiBase}/studies/${params.id}/conditions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        order: Number(formData.get('order') || 0),
        carlaOverrides: {
          weather: formData.get('weather') || null
        },
        widgetOverrides: {
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').filter(Boolean)
        }
      })
    });
  }
};
