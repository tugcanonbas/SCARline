import { apiRequest } from '$lib/server/api';

export const load = async ({ fetch, locals, params }) => ({
  conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
  studyId: params.id
});

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
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
