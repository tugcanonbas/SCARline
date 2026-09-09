import type { Pool } from "pg";
import {
  OverlayRuntimeScopeSchema,
  OverlayRuntimeSnapshotSchema,
  type OverlayDisplay,
  type OverlayRendererMode,
  type OverlayRuntimeScope,
  type OverlayRuntimeSnapshot,
} from "@scarline/contracts";

import { ApiProblem } from "../errors.js";
import {
  configuredWidgetRuntime,
  filterStoredBindingValues,
  findStoredWidgetRuntimeOverride,
  readStoredWidgetRuntimeOverrides,
} from "./widget-runtime-state.js";

interface LayoutRow {
  id: string;
  condition_id: string;
  study_id: string;
  name: string;
  type: "participant" | "researcher_monitor";
  target_display: string | null;
  condition_metadata: Record<string, unknown>;
}

interface WidgetRow {
  instance_id: string;
  widget_id: string;
  widget_key: string;
  window_mode: "transparent_electron" | "browser_popup";
  target_display: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  configuration: Record<string, unknown>;
  bindings_config: Record<string, unknown>;
  style_overrides: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export async function resolveOverlayScope(
  pool: Pool,
  input: {
    rendererMode: OverlayRendererMode;
    layoutId: string;
    instanceId?: string | null | undefined;
    sessionId?: string | null | undefined;
  },
): Promise<OverlayRuntimeScope> {
  const layout = await loadLayout(pool, input.layoutId);
  if (input.instanceId !== undefined && input.instanceId !== null) {
    const instance = await pool.query(
      "SELECT 1 FROM widget_instances WHERE id=$1 AND layout_id=$2 AND enabled=TRUE",
      [input.instanceId, input.layoutId],
    );
    if (instance.rowCount !== 1) {
      throw new ApiProblem(404, "WIDGET_INSTANCE_NOT_FOUND", "Widget instance not found.");
    }
  }
  if (input.sessionId !== undefined && input.sessionId !== null) {
    const session = await pool.query(
      "SELECT 1 FROM sessions WHERE id=$1 AND study_id=$2",
      [input.sessionId, layout.study_id],
    );
    if (session.rowCount !== 1) {
      throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found for overlay scope.");
    }
  }
  return OverlayRuntimeScopeSchema.parse({
    rendererMode: input.rendererMode,
    studyId: layout.study_id,
    sessionId: input.sessionId ?? null,
    conditionId: layout.condition_id,
    layoutId: layout.id,
    instanceId: input.instanceId ?? null,
  });
}

export async function loadOverlayRuntimeSnapshot(
  pool: Pool,
  scope: OverlayRuntimeScope,
  displays: OverlayDisplay[] = [],
): Promise<OverlayRuntimeSnapshot> {
  const layout = await loadLayout(pool, scope.layoutId);
  if (layout.study_id !== scope.studyId || layout.condition_id !== scope.conditionId) {
    throw new ApiProblem(403, "OVERLAY_SCOPE_MISMATCH", "Overlay scope no longer matches the layout.");
  }
  const values: unknown[] = [scope.layoutId];
  const instanceFilter = scope.instanceId === null ? "" : ` AND wi.id=$${values.push(scope.instanceId)}`;
  const result = await pool.query<WidgetRow>(
    `SELECT wi.id AS instance_id,wi.widget_id,w.key AS widget_key,wi.window_mode,
            wi.target_display,wi."order",wi.x,wi.y,wi.width,wi.height,
            wi.configuration,wi.bindings_config,wi.style_overrides,w.metadata
       FROM widget_instances wi JOIN widgets w ON w.id=wi.widget_id
      WHERE wi.layout_id=$1 AND wi.enabled=TRUE AND w.is_active=TRUE${instanceFilter}
      ORDER BY wi."order",wi.id`,
    values,
  );
  const runtimeOverrides = scope.sessionId === null
    ? {}
    : await loadCurrentSessionWidgetOverrides(pool, scope.sessionId, scope.conditionId);
  const widgets = result.rows.map((row) => {
    const configured = configuredWidgetRuntime(
      row.metadata,
      layout.condition_metadata,
      row.instance_id,
      row.widget_key,
    );
    const runtimeOverride = findStoredWidgetRuntimeOverride(runtimeOverrides, {
      instanceId: row.instance_id,
      widgetKey: row.widget_key,
      layoutType: layout.type,
      layoutName: layout.name,
      order: row.order,
    });
    const manualBindings = filterStoredBindingValues(
      configured.metadata,
      runtimeOverride?.bindingValues ?? {},
    );
    return {
      instanceId: row.instance_id,
      widgetId: row.widget_id,
      widgetKey: row.widget_key,
      name: configured.metadata.name,
      entry: configured.metadata.entry,
      windowMode: row.window_mode,
      inputMode: configured.metadata.triggers.length > 0 ? "interactive" as const : "click_through" as const,
      targetDisplay: row.target_display,
      order: row.order,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      metadata: configured.metadata as unknown as Record<string, unknown>,
      configuration: row.configuration,
      bindingsConfig: row.bindings_config,
      styleOverrides: row.style_overrides,
      bindings: { ...configured.bindings, ...manualBindings },
      state: runtimeOverride?.state ?? configured.state,
    };
  });
  return OverlayRuntimeSnapshotSchema.parse({
    scope,
    layout: {
      id: layout.id,
      name: layout.name,
      targetDisplay: layout.target_display,
    },
    displays,
    widgets,
  });
}

export async function requireLiveBrowserSessionScope(
  pool: Pool,
  scope: OverlayRuntimeScope,
): Promise<void> {
  if (scope.sessionId === null) return;
  const result = await pool.query<{ session_status: string; condition_status: string }>(
    `SELECT se.status AS session_status,sc.status AS condition_status
      FROM sessions se
       JOIN session_conditions sc ON sc.session_id=se.id
      WHERE se.id=$1 AND se.study_id=$2 AND sc.condition_id=$3
        AND sc.status IN ('active','paused')
      ORDER BY sc.sequence LIMIT 1`,
    [scope.sessionId, scope.studyId, scope.conditionId],
  );
  const row = result.rows[0];
  if (
    row === undefined
    || !["running", "paused"].includes(row.session_status)
    || !["active", "paused"].includes(row.condition_status)
  ) {
    throw new ApiProblem(
      409,
      "BROWSER_FALLBACK_NOT_LIVE",
      "Start the session and select its active participant layout before opening browser windows.",
    );
  }
}

async function loadLayout(pool: Pool, layoutId: string): Promise<LayoutRow> {
  const result = await pool.query<LayoutRow>(
    `SELECT l.id,l.condition_id,c.study_id,l.name,l.type,l.target_display,
            c.metadata AS condition_metadata
       FROM layouts l JOIN conditions c ON c.id=l.condition_id
      WHERE l.id=$1 AND c.archived_at IS NULL`,
    [layoutId],
  );
  if (result.rows[0] === undefined) {
    throw new ApiProblem(404, "LAYOUT_NOT_FOUND", "Overlay layout not found.");
  }
  return result.rows[0];
}

async function loadCurrentSessionWidgetOverrides(
  pool: Pool,
  sessionId: string,
  conditionId: string,
) {
  const result = await pool.query<{ runtime_metadata: Record<string, unknown> }>(
    `SELECT runtime_metadata FROM session_conditions
      WHERE session_id=$1 AND condition_id=$2 AND status IN ('pending','active','paused')
      ORDER BY sequence LIMIT 1`,
    [sessionId, conditionId],
  );
  return readStoredWidgetRuntimeOverrides(result.rows[0]?.runtime_metadata);
}
