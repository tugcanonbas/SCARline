import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  return {
    conditions: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken),
    studyId: params.id,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

function parseRules(formData: FormData): unknown[] {
  const rawRules = formData.getAll('rules').map(String);
  return rawRules.flatMap((raw) => {
    try { return [JSON.parse(raw)]; } catch { return []; }
  });
}

function numberOrNull(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function carlaOverridesFromForm(formData: FormData) {
  return {
    weather: formData.get('weather') || null,
    trafficDensity: numberOrNull(formData, 'trafficDensity'),
    pedestrianDensity: numberOrNull(formData, 'pedestrianDensity'),
    speedLimitOverride: numberOrNull(formData, 'speedLimitOverride')
  };
}

export const actions = {
  // Create new condition
  create: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const rules = parseRules(formData);
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        order: Number(formData.get('order') || 0),
        carlaOverrides: carlaOverridesFromForm(formData),
        widgetOverrides: {
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').map((s) => s.trim()).filter(Boolean),
          triggerRules: rules
        }
      })
    }, 'Failed to create condition');
    return result.ok ? undefined : result.failure;
  },

  // Update existing condition (inline edit)
  update: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const conditionId = String(formData.get('conditionId') ?? '');
    const rules = parseRules(formData);
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/conditions/${conditionId}`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        order: Number(formData.get('order') || 0),
        carlaOverrides: carlaOverridesFromForm(formData),
        widgetOverrides: {
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').map((s) => s.trim()).filter(Boolean),
          triggerRules: rules
        }
      })
    }, 'Failed to update condition');
    return result.ok ? undefined : result.failure;
  },

  // Delete condition
  delete: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const conditionId = String(formData.get('conditionId') ?? '');
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/conditions/${conditionId}`, locals.accessToken, {
      method: 'DELETE'
    }, 'Failed to delete condition');
    return result.ok ? undefined : result.failure;
  },

  // Legacy default — redirects to create
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const rules = parseRules(formData);
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        order: Number(formData.get('order') || 0),
        carlaOverrides: carlaOverridesFromForm(formData),
        widgetOverrides: {
          hidden_widgets: String(formData.get('hiddenWidgets') || '').split(',').map((s) => s.trim()).filter(Boolean),
          triggerRules: rules
        }
      })
    }, 'Failed to create condition');
    return result.ok ? undefined : result.failure;
  }
};
