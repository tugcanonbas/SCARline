import type { WidgetRuntimeAction, WidgetRuntimeCommand } from "@scarline/contracts";
import type { Pool, PoolClient } from "pg";

import { ApiProblem } from "../errors.js";
import { createEnvelope, enqueueMessage } from "../infrastructure/outbox.js";
import {
  configuredWidgetRuntime,
  readStoredWidgetRuntimeOverrides,
  validateManualBindingValues,
  type StoredWidgetRuntimeOverride,
  type WidgetVisualState,
} from "./widget-runtime-state.js";

interface SessionRow {
  readonly study_id: string;
  readonly status: string;
}

interface SessionConditionRow {
  readonly id: string;
  readonly condition_id: string;
  readonly runtime_metadata: Record<string, unknown>;
}

interface WidgetTargetRow {
  readonly instance_id: string;
  readonly widget_id: string;
  readonly widget_key: string;
  readonly layout_type: string;
  readonly layout_name: string;
  readonly order: number;
  readonly condition_metadata: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
}

export interface ManualWidgetRuntimeUpdate {
  readonly studyId: string;
  readonly sessionId: string;
  readonly sessionConditionId: string;
  readonly instanceId: string;
  readonly instanceIds: string[];
  readonly widgetKey: string;
  readonly action: "show" | "hide" | "highlight" | "reset" | "update";
  readonly requestedAction: WidgetRuntimeAction;
  readonly state: WidgetVisualState;
  readonly bindingValues: Record<string, unknown>;
  readonly triggerType: "manual";
  readonly source: "admin-panel";
  readonly triggeredBy: string;
}

export async function studyIdForSession(pool: Pool, sessionId: string): Promise<string> {
  const result = await pool.query<{ study_id: string }>(
    "SELECT study_id FROM sessions WHERE id=$1",
    [sessionId],
  );
  if (result.rows[0] === undefined) {
    throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  }
  return result.rows[0].study_id;
}

export async function applyManualWidgetRuntimeCommand(
  pool: Pool,
  sessionId: string,
  command: WidgetRuntimeCommand,
  actorUserId: string,
): Promise<ManualWidgetRuntimeUpdate> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await lockSession(client, sessionId);
    const sessionCondition = await lockCurrentSessionCondition(client, sessionId);
    const target = await resolveActiveWidgetTarget(
      client,
      session.study_id,
      sessionCondition.condition_id,
      command.instanceId,
    );
    const configured = configuredWidgetRuntime(
      target.metadata,
      target.condition_metadata,
      target.instance_id,
      target.widget_key,
    );
    const bindingValues = validateManualBindingValues(configured.metadata, command.bindingValues);
    if (command.action === "update" && Object.keys(bindingValues).length === 0) {
      throw new ApiProblem(400, "EMPTY_WIDGET_UPDATE", "A widget binding update requires at least one binding value.");
    }

    const runtimeMetadata = readObject(sessionCondition.runtime_metadata);
    const runtimeOverrides = readStoredWidgetRuntimeOverrides(runtimeMetadata);
    const previous = runtimeOverrides[target.instance_id];
    const next = resolveNextRuntimeOverride(previous, target, command.action, bindingValues, actorUserId);
    let deliveredBindings = bindingValues;
    let state = next?.state ?? previous?.state ?? configured.state;
    let action = canonicalAction(command.action);
    if (command.action === "reset") {
      delete runtimeOverrides[target.instance_id];
      deliveredBindings = configured.bindings;
      state = configured.state;
    } else {
      runtimeOverrides[target.instance_id] = next!;
    }

    await client.query(
      "UPDATE session_conditions SET runtime_metadata=$2::jsonb WHERE id=$1",
      [sessionCondition.id, JSON.stringify({ ...runtimeMetadata, widgetRuntime: runtimeOverrides })],
    );
    const update: ManualWidgetRuntimeUpdate = {
      studyId: session.study_id,
      sessionId,
      sessionConditionId: sessionCondition.id,
      instanceId: target.instance_id,
      instanceIds: [...new Set([target.instance_id, command.instanceId])],
      widgetKey: target.widget_key,
      action,
      requestedAction: command.action,
      state,
      bindingValues: deliveredBindings,
      triggerType: "manual",
      source: "admin-panel",
      triggeredBy: actorUserId,
    };
    await enqueueMessage(client, createEnvelope({
      routingKey: `events.${session.study_id}.${sessionId}.trigger.widget-manual`,
      studyId: session.study_id,
      sessionId,
      payload: { ...update },
    }));
    await client.query("COMMIT");
    return update;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockSession(client: PoolClient, sessionId: string): Promise<SessionRow> {
  const result = await client.query<SessionRow>(
    "SELECT study_id,status FROM sessions WHERE id=$1 FOR UPDATE",
    [sessionId],
  );
  const session = result.rows[0];
  if (session === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  if (session.status !== "running" && session.status !== "paused") {
    throw new ApiProblem(409, "SESSION_NOT_LIVE", "Widgets can only be triggered while the session is running or paused.");
  }
  return session;
}

async function lockCurrentSessionCondition(
  client: PoolClient,
  sessionId: string,
): Promise<SessionConditionRow> {
  const result = await client.query<SessionConditionRow>(
    `SELECT id,condition_id,runtime_metadata FROM session_conditions
      WHERE session_id=$1 AND status IN ('active','paused')
      ORDER BY sequence LIMIT 1 FOR UPDATE`,
    [sessionId],
  );
  if (result.rows[0] === undefined) {
    throw new ApiProblem(409, "SESSION_CONDITION_NOT_LIVE", "The session has no active or paused condition.");
  }
  return result.rows[0];
}

async function resolveActiveWidgetTarget(
  client: PoolClient,
  studyId: string,
  conditionId: string,
  requestedInstanceId: string,
): Promise<WidgetTargetRow> {
  const source = await client.query<{
    widget_key: string;
    layout_type: string;
    layout_name: string;
    order: number;
    study_id: string;
  }>(
    `SELECT w.key AS widget_key,l.type AS layout_type,l.name AS layout_name,wi."order",c.study_id
       FROM widget_instances wi
       JOIN widgets w ON w.id=wi.widget_id
       JOIN layouts l ON l.id=wi.layout_id
       JOIN conditions c ON c.id=l.condition_id
      WHERE wi.id=$1`,
    [requestedInstanceId],
  );
  const sourceWidget = source.rows[0];
  if (sourceWidget === undefined || sourceWidget.study_id !== studyId) {
    throw new ApiProblem(404, "WIDGET_INSTANCE_NOT_FOUND", "Widget instance not found in this study.");
  }
  const target = await client.query<WidgetTargetRow>(
    `SELECT wi.id AS instance_id,wi.widget_id,w.key AS widget_key,l.type AS layout_type,l.name AS layout_name,wi."order",
            c.metadata AS condition_metadata,w.metadata
       FROM widget_instances wi
       JOIN widgets w ON w.id=wi.widget_id
       JOIN layouts l ON l.id=wi.layout_id
       JOIN conditions c ON c.id=l.condition_id
      WHERE l.condition_id=$1 AND wi.enabled=TRUE AND w.is_active=TRUE
        AND l.type=$2 AND l.name=$3 AND w.key=$4 AND wi."order"=$5
      ORDER BY (wi.id=$6) DESC,wi.id
      LIMIT 1`,
    [conditionId, sourceWidget.layout_type, sourceWidget.layout_name, sourceWidget.widget_key, sourceWidget.order, requestedInstanceId],
  );
  if (target.rows[0] === undefined) {
    throw new ApiProblem(
      409,
      "WIDGET_NOT_IN_ACTIVE_CONDITION",
      "The selected widget is not enabled in the session's current condition.",
    );
  }
  return target.rows[0];
}

function resolveNextRuntimeOverride(
  previous: StoredWidgetRuntimeOverride | undefined,
  target: WidgetTargetRow,
  action: WidgetRuntimeAction,
  bindingValues: Record<string, unknown>,
  actorUserId: string,
): StoredWidgetRuntimeOverride | null {
  if (action === "reset") return null;
  const state = actionState(action) ?? previous?.state;
  return {
    ...(state === undefined ? {} : { state }),
    bindingValues: { ...(previous?.bindingValues ?? {}), ...bindingValues },
    widgetKey: target.widget_key,
    layoutType: target.layout_type,
    layoutName: target.layout_name,
    order: target.order,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUserId,
  };
}

function actionState(action: WidgetRuntimeAction): WidgetVisualState | undefined {
  if (action === "trigger" || action === "show") return "visible";
  if (action === "hide") return "hidden";
  if (action === "highlight") return "highlighted";
  return undefined;
}

function canonicalAction(action: WidgetRuntimeAction): ManualWidgetRuntimeUpdate["action"] {
  return action === "trigger" ? "show" : action;
}

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
