import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
    studyId: params.id
  };
};

function parseRules(formData: FormData): unknown[] {
  const rawRules = formData.getAll('rules').map(String);
  return rawRules.flatMap((raw) => {
    try { return [JSON.parse(raw)]; } catch { return []; }
  });
}

export const actions = {
  // Create new condition
  create: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const rules = parseRules(formData);
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
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').map((s) => s.trim()).filter(Boolean),
          triggerRules: rules
        }
      })
    });
  },

  // Update existing condition (inline edit)
  update: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const conditionId = String(formData.get('conditionId') ?? '');
    const rules = parseRules(formData);
    await fetch(`${locals.apiBase}/studies/${params.id}/conditions/${conditionId}`, {
      method: 'PUT',
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
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').map((s) => s.trim()).filter(Boolean),
          triggerRules: rules
        }
      })
    });
  },

  // Delete condition
  delete: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const conditionId = String(formData.get('conditionId') ?? '');
    await fetch(`${locals.apiBase}/studies/${params.id}/conditions/${conditionId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${locals.accessToken}` }
    });
  },

  // Legacy default — redirects to create
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const rules = parseRules(formData);
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
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').map((s) => s.trim()).filter(Boolean),
          triggerRules: rules
        }
      })
    });
  }
};
