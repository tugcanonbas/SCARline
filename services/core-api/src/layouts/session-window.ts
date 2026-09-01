import { isDeepStrictEqual } from "node:util";

import {
  SessionParticipantWindowSaveResultSchema,
  type SessionParticipantWindowSave,
  type SessionParticipantWindowSaveResult,
} from "@scarline/contracts";
import type { Pool } from "pg";

import { ApiProblem } from "../errors.js";
import { recordActivity } from "../infrastructure/activity.js";

interface SessionRow {
  study_id: string;
  status: string;
}

interface SessionConditionRow {
  condition_id: string;
}

interface WindowRow {
  layout_id: string;
  revision: number;
  window_mode: string;
  input_mode: string;
  target_display: string;
  order: number;
  enabled: boolean;
  configuration: Record<string, unknown>;
  bindings_config: Record<string, unknown>;
  style_overrides: Record<string, unknown>;
}

export async function saveActiveSessionWindow(
  pool: Pool,
  sessionId: string,
  instanceId: string,
  input: SessionParticipantWindowSave,
  actorUserId: string,
): Promise<SessionParticipantWindowSaveResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = (await client.query<SessionRow>(
      "SELECT study_id,status FROM sessions WHERE id=$1 FOR UPDATE",
      [sessionId],
    )).rows[0];
    if (session === undefined) {
      throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    }
    if (!["running", "paused"].includes(session.status)) {
      throw new ApiProblem(409, "SESSION_NOT_RUNNING", "Start the session before saving live window changes.");
    }

    const activeCondition = (await client.query<SessionConditionRow>(
      `SELECT condition_id FROM session_conditions
        WHERE session_id=$1 AND status IN ('active','paused')
        ORDER BY sequence LIMIT 1 FOR UPDATE`,
      [sessionId],
    )).rows[0];
    if (activeCondition === undefined) {
      throw new ApiProblem(409, "ACTIVE_CONDITION_NOT_FOUND", "The session has no active condition to update.");
    }

    const window = (await client.query<WindowRow>(
      `SELECT wi.layout_id,l.revision,wi.window_mode,wi.input_mode,wi.target_display,
              wi."order",wi.enabled,wi.configuration,wi.bindings_config,wi.style_overrides
         FROM widget_instances wi
         JOIN layouts l ON l.id=wi.layout_id
        WHERE wi.id=$1 AND l.condition_id=$2 AND l.type='participant'
        FOR UPDATE OF wi,l`,
      [instanceId, activeCondition.condition_id],
    )).rows[0];
    if (window === undefined) {
      throw new ApiProblem(
        404,
        "ACTIVE_WINDOW_NOT_FOUND",
        "This window does not belong to the session's active participant layout.",
      );
    }
    if (window.revision !== input.expectedRevision) {
      throw new ApiProblem(
        409,
        "LAYOUT_VERSION_CONFLICT",
        "The participant layout changed elsewhere. Reload Active Study before applying this window again.",
        { currentRevision: window.revision, layoutId: window.layout_id },
      );
    }

    assertOperationalFieldsUnchanged(window, input);
    await client.query(
      `UPDATE widget_instances SET
         window_mode=$3,input_mode=$4,target_display=$5,"order"=$6,
         x=$7,y=$8,width=$9,height=$10,enabled=$11,
         configuration=$12::jsonb,bindings_config=$13::jsonb,style_overrides=$14::jsonb
       WHERE id=$1 AND layout_id=$2`,
      [
        instanceId,
        window.layout_id,
        input.windowMode,
        input.inputMode,
        input.targetDisplay,
        input.order,
        input.x,
        input.y,
        input.width,
        input.height,
        input.enabled,
        JSON.stringify(input.configuration),
        JSON.stringify(input.bindingsConfig),
        JSON.stringify(input.styleOverrides),
      ],
    );
    const revision = (await client.query<{ revision: number }>(
      "UPDATE layouts SET revision=revision+1 WHERE id=$1 RETURNING revision",
      [window.layout_id],
    )).rows[0]!.revision;
    await recordActivity(client, {
      actorUserId,
      studyId: session.study_id,
      entityType: "widget-instance",
      entityId: instanceId,
      action: "session.window-saved",
      payload: { sessionId, layoutId: window.layout_id, revision },
    });
    await client.query("COMMIT");
    return SessionParticipantWindowSaveResultSchema.parse({
      sessionId,
      conditionId: activeCondition.condition_id,
      layoutId: window.layout_id,
      revision,
      instanceId,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertOperationalFieldsUnchanged(
  current: WindowRow,
  input: SessionParticipantWindowSave,
): void {
  const changed = [
    current.window_mode !== input.windowMode,
    current.input_mode !== input.inputMode,
    current.target_display !== input.targetDisplay,
    current.order !== input.order,
    current.enabled !== input.enabled,
    !isDeepStrictEqual(current.configuration, input.configuration),
    !isDeepStrictEqual(current.bindings_config, input.bindingsConfig),
    !isDeepStrictEqual(current.style_overrides, input.styleOverrides),
  ].some(Boolean);
  if (changed) {
    throw new ApiProblem(
      409,
      "WINDOW_CONFIGURATION_CHANGED",
      "The window configuration changed elsewhere. Reload Active Study before applying this window again.",
    );
  }
}
