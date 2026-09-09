import { error } from '@sveltejs/kit';

import { apiRequest } from './api';
import { loadActiveStudyConditions } from './study-context';

type JsonRecord = Record<string, unknown>;

export type CarlaOverrides = {
  weather: string | null;
  trafficDensity: number | null;
  pedestrianDensity: number | null;
  speedLimitOverride: number | null;
};

export type AdminTriggerRule = {
  ruleName: string;
  widgetId: string;
  condition: string;
  action: 'show' | 'hide' | 'highlight' | 'update' | 'reset';
  bindingOverrides: JsonRecord;
};

const EXPRESSION_PATTERN = /^\s*([a-zA-Z0-9_.-]+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?|[a-zA-Z0-9_.-]+)\s*$/;
const OPERATOR_TO_API = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '==': 'eq', '!=': 'ne' } as const;
const OPERATOR_FROM_API = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '==', ne: '!=' } as const;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function conditionMetadata(condition: JsonRecord): JsonRecord {
  return asRecord(condition.metadata);
}

export function readCarlaOverrides(condition: JsonRecord): CarlaOverrides {
  const raw = asRecord(conditionMetadata(condition).carlaOverrides);
  return {
    weather: typeof raw.weather === 'string' && raw.weather ? raw.weather : null,
    trafficDensity: finiteNumberOrNull(raw.trafficDensity),
    pedestrianDensity: finiteNumberOrNull(raw.pedestrianDensity),
    speedLimitOverride: finiteNumberOrNull(raw.speedLimitOverride)
  };
}

export function readHiddenWidgets(condition: JsonRecord): string[] {
  const widgetOverrides = asRecord(conditionMetadata(condition).widgetOverrides);
  return Array.isArray(widgetOverrides.hidden_widgets)
    ? widgetOverrides.hidden_widgets.map(String).filter(Boolean)
    : [];
}

export function configurationMetadata(condition: JsonRecord, carlaOverrides: CarlaOverrides, hiddenWidgets: string[]): JsonRecord {
  const metadata = conditionMetadata(condition);
  const previousWidgetOverrides = asRecord(metadata.widgetOverrides);
  const widgetOverrides = { ...previousWidgetOverrides };
  delete widgetOverrides.triggerRules;
  return {
    ...metadata,
    carlaOverrides,
    widgetOverrides: {
      ...widgetOverrides,
      hidden_widgets: hiddenWidgets
    }
  };
}

export function applyCarlaOverrides(baseConfiguration: JsonRecord, overrides: CarlaOverrides): JsonRecord {
  const trafficConfig = asRecord(baseConfiguration.trafficConfig);
  const pedestrianConfig = asRecord(baseConfiguration.pedestrianConfig);
  return {
    ...baseConfiguration,
    weatherPreset: overrides.weather ?? baseConfiguration.weatherPreset ?? null,
    trafficConfig: {
      ...trafficConfig,
      npcVehicleCount: overrides.trafficDensity ?? trafficConfig.npcVehicleCount ?? 0,
      speedLimitOverride: overrides.speedLimitOverride
    },
    pedestrianConfig: {
      ...pedestrianConfig,
      pedestrianCount: overrides.pedestrianDensity ?? pedestrianConfig.pedestrianCount ?? 0
    }
  };
}

export async function saveAndApplySimulatorTemplate(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  configuration: JsonRecord
): Promise<void> {
  const [study, conditions, components] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${studyId}`, locals.accessToken) as Promise<JsonRecord>,
    loadActiveStudyConditions(fetch, locals, studyId),
    apiRequest(fetch, locals.apiBase, '/components/status', locals.accessToken) as Promise<JsonRecord[]>
  ]);
  const availableSimulatorTypes = new Set(
    components
      .filter((component) => component.component === 'sim-bridge' && component.available === true)
      .flatMap((component) => Array.isArray(component.adapters) ? component.adapters.map(String) : [])
      .filter((type) => type === 'carla' || type === 'mock')
  );
  const onlyAvailableSimulator = availableSimulatorTypes.size === 1
    ? [...availableSimulatorTypes][0] as 'carla' | 'mock'
    : null;
  const currentSimulators = await Promise.all(conditions.map((condition) => apiRequest(
    fetch,
    locals.apiBase,
    `/studies/${studyId}/conditions/${String(condition.id)}/simulator`,
    locals.accessToken
  ) as Promise<JsonRecord | null>));
  const metadata = asRecord(study.metadata);
  await apiRequest(fetch, locals.apiBase, `/studies/${studyId}`, locals.accessToken, {
    method: 'PATCH',
    body: JSON.stringify({
      metadata: {
        ...metadata,
        configurationTemplates: {
          ...asRecord(metadata.configurationTemplates),
          simulator: configuration
        }
      }
    })
  });
  await Promise.all(conditions.map((condition, index) => {
    if (currentSimulators[index]?.simulatorType === 'mock') return Promise.resolve();
    const simulatorType = onlyAvailableSimulator === 'mock' ? 'mock' : 'carla';
    return putSimulator(
      fetch, locals, studyId, String(condition.id), simulatorType, applyCarlaOverrides(configuration, readCarlaOverrides(condition))
    );
  }));
}

export async function applyConditionSimulatorOverrides(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  conditionId: string,
  overrides: CarlaOverrides
): Promise<void> {
  const study = await apiRequest(fetch, locals.apiBase, `/studies/${studyId}`, locals.accessToken) as JsonRecord;
  const template = asRecord(asRecord(asRecord(study.metadata).configurationTemplates).simulator);
  let base = template;
  let simulatorType: 'carla' | 'mock' = 'carla';
  if (Object.keys(base).length === 0) {
    const current = await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/simulator`, locals.accessToken) as JsonRecord | null;
    if (current?.simulatorType === 'mock') return;
    simulatorType = current?.simulatorType === 'carla' ? 'carla' : simulatorType;
    base = asRecord(current?.configuration);
  }
  if (Object.keys(base).length > 0) {
    await putSimulator(fetch, locals, studyId, conditionId, simulatorType, applyCarlaOverrides(base, overrides));
  }
}

async function putSimulator(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  conditionId: string,
  simulatorType: 'carla' | 'mock',
  configuration: JsonRecord
) {
  await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/simulator`, locals.accessToken, {
    method: 'PUT', body: JSON.stringify({ simulatorType, configuration })
  });
}

export async function applyConditionWidgetVisibility(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  conditionId: string,
  hiddenWidgets: string[],
  previousHiddenWidgets: string[] = []
): Promise<void> {
  const [layouts, catalogue] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/layouts`, locals.accessToken) as Promise<JsonRecord[]>,
    apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken) as Promise<JsonRecord[]>
  ]);
  const keyByDatabaseId = new Map(catalogue.map((widget) => [String(widget.databaseId), String(widget.id)]));
  const hidden = new Set(hiddenWidgets);
  const previouslyHidden = new Set(previousHiddenWidgets);
  await Promise.all(layouts.flatMap((layout) => ((layout.widgets ?? []) as JsonRecord[]).map(async (widget) => {
    const widgetKey = keyByDatabaseId.get(String(widget.widgetId)) ?? String(widget.widgetId);
    const aliases = [widgetKey, String(widget.widgetId), String(widget.id)];
    const isHidden = aliases.some((alias) => hidden.has(alias));
    const wasHidden = aliases.some((alias) => previouslyHidden.has(alias));
    if (!isHidden && !wasHidden) return;
    const enabled = !isHidden;
    if (widget.enabled === enabled) return;
    await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/layouts/${layout.id}/widgets/${widget.id}`, locals.accessToken, {
      method: 'PATCH', body: JSON.stringify({ enabled })
    });
  })));
}

export async function replaceConditionTriggers(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  conditionId: string,
  rules: AdminTriggerRule[]
): Promise<void> {
  const base = `/studies/${studyId}/conditions/${conditionId}/triggers`;
  const bodies = materializeAdminTriggerRules(rules);
  const existing = await apiRequest(fetch, locals.apiBase, base, locals.accessToken) as JsonRecord[];
  await Promise.all(existing.map((rule) => apiRequest(fetch, locals.apiBase, `${base}/${rule.id}`, locals.accessToken, { method: 'DELETE' })));
  for (const body of bodies) {
    await apiRequest(fetch, locals.apiBase, base, locals.accessToken, {
      method: 'POST', body: JSON.stringify(body)
    });
  }
}

export function materializeAdminTriggerRules(rules: AdminTriggerRule[]): JsonRecord[] {
  const bodies = rules.map(triggerRuleToApi);
  const names = bodies.map((body) => String(body.name));
  if (new Set(names).size !== names.length) throw error(400, 'Trigger rule names must be unique within a condition.');
  return bodies;
}

export async function loadConditionAuthoringViews(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  conditions: JsonRecord[],
  studyId: string
): Promise<JsonRecord[]> {
  const catalogue = await apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken) as JsonRecord[];
  const keyByDatabaseId = new Map(catalogue.map((widget) => [String(widget.databaseId), String(widget.id)]));
  return Promise.all(conditions.map(async (condition) => {
    const conditionId = String(condition.id);
    const [layouts, triggers] = await Promise.all([
      apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/layouts`, locals.accessToken) as Promise<JsonRecord[]>,
      apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions/${conditionId}/triggers`, locals.accessToken) as Promise<JsonRecord[]>
    ]);
    const canonicalHidden = layouts.flatMap((layout) => (layout.widgets ?? []) as JsonRecord[])
      .filter((widget) => widget.enabled === false)
      .map((widget) => keyByDatabaseId.get(String(widget.widgetId)) ?? String(widget.widgetId));
    const hiddenWidgets = canonicalHidden.length > 0 ? [...new Set(canonicalHidden)] : readHiddenWidgets(condition);
    return {
      ...condition,
      carlaOverrides: readCarlaOverrides(condition),
      widgetOverrides: {
        hidden_widgets: hiddenWidgets,
        triggerRules: triggers.map(triggerRuleFromApi)
      }
    };
  }));
}

function triggerRuleToApi(rule: AdminTriggerRule, index: number): JsonRecord {
  const ruleName = String(rule.ruleName ?? '').trim();
  const widgetId = String(rule.widgetId ?? '').trim();
  const condition = String(rule.condition ?? '');
  if (!widgetId) throw error(400, `Trigger rule "${ruleName || index + 1}" requires a widget ID.`);
  const match = condition.match(EXPRESSION_PATTERN);
  if (!match) throw error(400, `Trigger rule "${ruleName || index + 1}" has an invalid condition expression.`);
  const [, left, operator, right] = match;
  const expression: JsonRecord = {
    operator: OPERATOR_TO_API[operator as keyof typeof OPERATOR_TO_API],
    path: apiPath(left)
  };
  const number = Number(right);
  if (right.includes('.') && !Number.isFinite(number)) expression.valuePath = apiPath(right);
  else if (Number.isFinite(number)) expression.value = number;
  else if (right === 'true' || right === 'false') expression.value = right === 'true';
  else expression.value = right;
  return {
    name: ruleName || `Rule ${index + 1}`,
    description: null,
    expression,
    actionType: 'widget.update',
    actionConfig: {
      widgetId,
      action: isAdminAction(rule.action) ? rule.action : 'update',
      bindingValues: asRecord(rule.bindingOverrides)
    },
    enabled: true,
    priority: index,
    cooldownMs: 0
  };
}

function triggerRuleFromApi(rule: JsonRecord): AdminTriggerRule {
  const actionConfig = asRecord(rule.actionConfig);
  const expression = asRecord(rule.expression);
  const operator = OPERATOR_FROM_API[String(expression.operator) as keyof typeof OPERATOR_FROM_API] ?? '==';
  const expected = expression.valuePath ?? expression.value ?? '';
  return {
    ruleName: String(rule.name ?? ''),
    widgetId: String(actionConfig.widgetId ?? ''),
    condition: `${adminPath(String(expression.path ?? ''))} ${operator} ${adminPath(String(expected))}`.trim(),
    action: isAdminAction(actionConfig.action) ? actionConfig.action : 'update',
    bindingOverrides: asRecord(actionConfig.bindingValues ?? actionConfig.bindingOverrides)
  };
}

function apiPath(path: string): string {
  return path.startsWith('session.') || path.startsWith('payload.') ? path : `payload.${path}`;
}

function adminPath(path: string): string {
  return path.startsWith('payload.') ? path.slice('payload.'.length) : path;
}

function finiteNumberOrNull(value: unknown): number | null {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

function isAdminAction(value: unknown): value is AdminTriggerRule['action'] {
  return ['show', 'hide', 'highlight', 'update', 'reset'].includes(String(value));
}
