import { apiRequest } from './api';
import { loadActiveStudyConditions } from './study-context';

type JsonRecord = Record<string, unknown>;

export class LayoutPersistenceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: JsonRecord = {}
  ) {
    super(message);
    this.name = 'LayoutPersistenceError';
  }
}

export async function loadAdminLayouts(fetch: typeof globalThis.fetch, locals: App.Locals, studyId: string) {
  const conditions = await loadActiveStudyConditions(fetch, locals, studyId);
  const primary = conditions[0];
  if (!primary) throw new LayoutPersistenceError(409, 'CONDITION_REQUIRED', 'Create a study condition before configuring participant layouts.');
  const [catalogue, layoutsByCondition] = await Promise.all([
    apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken) as Promise<JsonRecord[]>,
    Promise.all(conditions.map((condition) => apiRequest(
      fetch,
      locals.apiBase,
      `/studies/${studyId}/conditions/${String(condition.id)}/layouts`,
      locals.accessToken
    ) as Promise<JsonRecord[]>))
  ]);
  const normalizedLayoutsByCondition = layoutsByCondition.map((layouts) => normalizeLayouts(layouts, catalogue));
  const expectedRevisions = conditions.map((condition, index) => {
    const layout = layoutsByCondition[index]?.find((entry) => entry.type === 'participant');
    return {
      conditionId: String(condition.id),
      layoutId: layout?.id ? String(layout.id) : null,
      revision: Number(layout?.revision ?? 0)
    };
  });
  const layouts: JsonRecord[] = (normalizedLayoutsByCondition[0] ?? []).map((layout): JsonRecord => ({
    ...layout,
    expectedRevisions
  }));
  const participantLayoutsByCondition = Object.fromEntries(conditions.map((condition, index) => [
    String(condition.id),
    normalizedLayoutsByCondition[index]?.find((layout) => layout.type === 'participant') ?? null
  ]));
  return { condition: primary, conditions, catalogue, layouts, expectedRevisions, participantLayoutsByCondition };
}

export async function persistAdminLayout(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  payload: JsonRecord,
  _requestedLayoutId?: string
) {
  const context = await loadAdminLayouts(fetch, locals, studyId);
  const catalogueId = new Map(context.catalogue.map((widget) => [String(widget.id), String(widget.databaseId)]));
  const requestedWidgets = Array.isArray(payload.widgets) ? payload.widgets as JsonRecord[] : [];
  const expectedRevisions = normalizeExpectedRevisions(payload.expectedRevisions, context.expectedRevisions);
  const body = {
    name: String(payload.name ?? 'Primary Participant Layout'),
    targetDisplay: payload.targetDisplay === null ? null : String(payload.targetDisplay ?? 'primary'),
    layoutConfig: asRecord(payload.layoutConfig),
    expectedRevisions,
    widgets: requestedWidgets.map((widget, order) => {
      const widgetKey = String(widget.widgetId ?? '');
      const widgetId = catalogueId.get(widgetKey) ?? widgetKey;
      const triggerRules = Array.isArray(widget.triggerRules) ? widget.triggerRules : [];
      return {
        widgetId,
        windowMode: widget.windowMode === 'browser_popup' ? 'browser_popup' : 'transparent_electron',
        inputMode: widget.inputMode === 'interactive' || triggerRules.length > 0 ? 'interactive' : 'click_through',
        targetDisplay: String(widget.targetDisplay ?? payload.targetDisplay ?? 'primary'),
        order,
        x: Math.round(Number(widget.x ?? 0)),
        y: Math.round(Number(widget.y ?? 0)),
        width: Math.max(1, Math.round(Number(widget.width ?? 180))),
        height: Math.max(1, Math.round(Number(widget.height ?? 180))),
        enabled: widget.enabled !== false,
        configuration: {
          ...asRecord(widget.configuration),
          triggerRules
        },
        bindingsConfig: asRecord(widget.bindingsConfig),
        styleOverrides: asRecord(widget.styleOverrides)
      };
    })
  };
  const headers = new Headers({ 'content-type': 'application/json' });
  if (locals.accessToken) headers.set('authorization', `Bearer ${locals.accessToken}`);
  const response = await fetch(`${locals.apiBase}/studies/${studyId}/layouts/participant`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    throw new LayoutPersistenceError(
      response.status,
      String(envelope?.error?.code ?? 'LAYOUT_SAVE_FAILED'),
      String(envelope?.error?.message ?? 'Failed to save participant layout. Retry saving.'),
      asRecord(envelope?.error?.details)
    );
  }
  const result = asRecord(envelope?.data);
  const layouts = Array.isArray(result.layouts) ? result.layouts as JsonRecord[] : [];
  return {
    id: String(result.primaryLayoutId ?? ''),
    revision: Number(layouts[0]?.revision ?? 0),
    expectedRevisions: layouts.map((layout) => ({
      conditionId: String(layout.conditionId),
      layoutId: String(layout.layoutId),
      revision: Number(layout.revision)
    }))
  };
}

function normalizeExpectedRevisions(value: unknown, fallback: JsonRecord[]): JsonRecord[] {
  if (!Array.isArray(value)) return fallback;
  if (
    value.length === 0
    && fallback.length > 0
    && fallback.every((entry) => entry.layoutId === null && Number(entry.revision) === 0)
  ) return fallback;
  return value.map((entry) => {
    const item = asRecord(entry);
    return {
      conditionId: String(item.conditionId ?? ''),
      layoutId: item.layoutId === null ? null : String(item.layoutId ?? ''),
      revision: Number(item.revision ?? 0)
    };
  });
}

function normalizeLayouts(layouts: JsonRecord[], catalogue: JsonRecord[]): JsonRecord[] {
  const keyByDatabaseId = new Map(catalogue.map((widget) => [String(widget.databaseId), String(widget.id)]));
  return layouts.map((layout) => ({
    ...layout,
    widgets: ((layout.widgets ?? []) as JsonRecord[]).map((widget) => {
      const configuration = asRecord(widget.configuration);
      return {
        ...widget,
        widgetId: keyByDatabaseId.get(String(widget.widgetId)) ?? String(widget.widgetId),
        triggerRules: Array.isArray(configuration.triggerRules) ? configuration.triggerRules : []
      };
    })
  }));
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
