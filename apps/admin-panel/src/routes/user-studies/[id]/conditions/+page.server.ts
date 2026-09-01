import { apiAction, apiRequest } from '$lib/server/api';
import {
  applyConditionSimulatorOverrides,
  applyConditionWidgetVisibility,
  configurationMetadata,
  loadConditionAuthoringViews,
  materializeAdminTriggerRules,
  readHiddenWidgets,
  replaceConditionTriggers,
  type AdminTriggerRule
} from '$lib/server/condition-configuration';
import { requireRole } from '$lib/server/rbac';
import { loadActiveStudyConditions } from '$lib/server/study-context';
import { handleStudyTransition } from '$lib/server/study-lifecycle';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const conditions = await loadActiveStudyConditions(fetch, locals, params.id);
  const [study, readiness] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}/readiness`, locals.accessToken)
  ]);
  return {
    study,
    readiness,
    conditions: await loadConditionAuthoringViews(fetch, locals, conditions, params.id),
    studyId: params.id,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

function parseRules(formData: FormData): AdminTriggerRule[] {
  const rawRules = formData.getAll('rules').map(String);
  return rawRules.flatMap((raw) => {
    try { return [JSON.parse(raw) as AdminTriggerRule]; } catch { return []; }
  });
}

function numberOrNull(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function carlaOverridesFromForm(formData: FormData) {
  const weather = String(formData.get('weather') ?? '').trim();
  return {
    weather: weather || null,
    trafficDensity: numberOrNull(formData, 'trafficDensity'),
    pedestrianDensity: numberOrNull(formData, 'pedestrianDensity'),
    speedLimitOverride: numberOrNull(formData, 'speedLimitOverride')
  };
}

function hiddenWidgetsFromForm(formData: FormData) {
  return [...new Set(String(formData.get('hiddenWidgets') || '').split(',').map((value) => value.trim()).filter(Boolean))];
}

export const actions = {
  studyTransition: handleStudyTransition,
  // Create new condition
  create: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const rules = parseRules(formData);
    materializeAdminTriggerRules(rules);
    const conditions = await loadActiveStudyConditions(fetch, locals, params.id);
    const template = conditions[0];
    const carlaOverrides = carlaOverridesFromForm(formData);
    const hiddenWidgets = hiddenWidgetsFromForm(formData);
    const condition = { metadata: {} } as Record<string, unknown>;
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/conditions`, locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        order: Number(condition.order ?? 0),
        metadata: configurationMetadata(condition, carlaOverrides, hiddenWidgets),
        ...(template ? { templateConditionId: template.id } : {})
      })
    }, 'Failed to create condition');
    if (!result.ok) return result.failure;
    const conditionId = String((result.data as Record<string, unknown>).id);
    await Promise.all([
      applyConditionSimulatorOverrides(fetch, locals, params.id, conditionId, carlaOverrides),
      applyConditionWidgetVisibility(fetch, locals, params.id, conditionId, hiddenWidgets, template ? readHiddenWidgets(template) : []),
      replaceConditionTriggers(fetch, locals, params.id, conditionId, rules)
    ]);
    return undefined;
  },

  // Update existing condition (inline edit)
  update: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const conditionId = String(formData.get('conditionId') ?? '');
    const rules = parseRules(formData);
    materializeAdminTriggerRules(rules);
    const conditions = await loadActiveStudyConditions(fetch, locals, params.id);
    const condition = conditions.find((entry) => entry.id === conditionId) ?? { metadata: {} };
    const carlaOverrides = carlaOverridesFromForm(formData);
    const hiddenWidgets = hiddenWidgetsFromForm(formData);
    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/conditions/${conditionId}`, locals.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null,
        order: Number(condition.order ?? 0),
        metadata: configurationMetadata(condition, carlaOverrides, hiddenWidgets)
      })
    }, 'Failed to update condition');
    if (!result.ok) return result.failure;
    await Promise.all([
      applyConditionSimulatorOverrides(fetch, locals, params.id, conditionId, carlaOverrides),
      applyConditionWidgetVisibility(fetch, locals, params.id, conditionId, hiddenWidgets, readHiddenWidgets(condition)),
      replaceConditionTriggers(fetch, locals, params.id, conditionId, rules)
    ]);
    return undefined;
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
  }
};
