import type { Pool } from "pg";

import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { loadOverlayRuntimeSnapshot, resolveOverlayScope } from "./runtime.js";

export interface SessionLayoutOpenResult {
  readonly hostId: string;
  readonly layoutId: string;
  readonly conditionId: string;
  readonly openedInstanceIds: string[];
}

export interface SessionLayoutCloseResult {
  readonly attemptedInstanceIds: string[];
  readonly closedInstanceIds: string[];
  readonly failures: Array<{
    hostId: string;
    instanceId: string;
    message: string;
  }>;
}

export class SessionLayoutOpenError extends Error {
  readonly conditionId: string;
  readonly layoutId: string;
  readonly failedInstanceId: string | null;
  readonly openedInstanceIds: string[];

  constructor(
    message: string,
    input: {
      conditionId: string;
      layoutId: string;
      failedInstanceId: string | null;
      openedInstanceIds: string[];
    },
  ) {
    super(message);
    this.name = "SessionLayoutOpenError";
    this.conditionId = input.conditionId;
    this.layoutId = input.layoutId;
    this.failedInstanceId = input.failedInstanceId;
    this.openedInstanceIds = input.openedInstanceIds;
  }
}

export class SessionOverlayService {
  readonly #pool: Pool;
  readonly #auth: AuthService;
  readonly #realtime: RealtimeHub;
  readonly #overlayWebOrigin: string;

  constructor(
    pool: Pool,
    auth: AuthService,
    realtime: RealtimeHub,
    overlayWebOrigin: string,
  ) {
    this.#pool = pool;
    this.#auth = auth;
    this.#realtime = realtime;
    this.#overlayWebOrigin = overlayWebOrigin.replace(/\/$/, "");
  }

  async openDesktopLayout(input: {
    sessionId: string;
    conditionId?: string;
    hostId?: string | null;
  }): Promise<SessionLayoutOpenResult> {
    const conditionId = input.conditionId ?? await this.#currentOrNextCondition(input.sessionId);
    const layoutResult = await this.#pool.query<{ id: string }>(
      `SELECT l.id
         FROM layouts l JOIN conditions c ON c.id=l.condition_id
        WHERE l.condition_id=$1 AND c.archived_at IS NULL AND l.type='participant'
        ORDER BY l.created_at,l.id LIMIT 1`,
      [conditionId],
    );
    const layoutId = layoutResult.rows[0]?.id;
    if (layoutId === undefined) {
      throw new ApiProblem(
        409,
        "PARTICIPANT_LAYOUT_REQUIRED",
        "Create a participant layout for the active condition before opening desktop widgets.",
      );
    }
    const scope = await resolveOverlayScope(this.#pool, {
      rendererMode: "desktop",
      layoutId,
      instanceId: null,
      sessionId: input.sessionId,
    });
    const snapshot = await loadOverlayRuntimeSnapshot(this.#pool, scope);
    if (snapshot.widgets.length === 0) {
      throw new ApiProblem(
        409,
        "PARTICIPANT_WIDGET_REQUIRED",
        "Place at least one enabled widget in the participant layout before opening it.",
      );
    }

    const openedInstanceIds: string[] = [];
    let selectedHostId = input.hostId ?? null;
    for (const widget of snapshot.widgets) {
      try {
        const credential = await this.#auth.signOverlayBootstrapToken({
          ...scope,
          instanceId: widget.instanceId,
        });
        const result = await this.#realtime.sendOverlayCommand({
          type: "overlay.window.open",
          hostId: selectedHostId ?? undefined,
          window: {
            instanceId: widget.instanceId,
            widgetKey: widget.widgetKey,
            rendererUrl: `${this.#overlayWebOrigin}/widget/${widget.instanceId}#bootstrap=${encodeURIComponent(credential.token)}`,
            targetDisplay: widget.targetDisplay,
            windowMode: "transparent_electron",
            inputMode: widget.inputMode,
            coordinateSpace: "display-relative",
            x: widget.x,
            y: widget.y,
            width: widget.width,
            height: widget.height,
          },
        });
        selectedHostId = result.hostId;
        openedInstanceIds.push(widget.instanceId);
      } catch (error) {
        await Promise.allSettled(openedInstanceIds.map((instanceId) =>
          this.#realtime.sendOverlayCommand({
            type: "overlay.window.close",
            hostId: selectedHostId ?? undefined,
            instanceId,
          }),
        ));
        throw new SessionLayoutOpenError(
          error instanceof Error ? error.message : "The desktop overlay could not open the participant layout.",
          {
            conditionId,
            layoutId,
            failedInstanceId: widget.instanceId,
            openedInstanceIds,
          },
        );
      }
    }

    return {
      hostId: selectedHostId!,
      layoutId,
      conditionId,
      openedInstanceIds,
    };
  }

  async closeDesktopSession(input: {
    sessionId: string;
    excludeInstanceIds?: string[];
  }): Promise<SessionLayoutCloseResult> {
    const persisted = await this.#pool.query<{ overlay: unknown }>(
      `SELECT result_payload->'overlay' AS overlay
         FROM lifecycle_commands
        WHERE session_id=$1
          AND action IN ('start','advance')
          AND jsonb_typeof(result_payload->'overlay')='object'
        ORDER BY created_at,id`,
      [input.sessionId],
    );
    const excluded = new Set(input.excludeInstanceIds ?? []);
    const targets = new Map<string, { hostId: string; instanceId: string }>();
    for (const row of persisted.rows) {
      if (row.overlay === null || typeof row.overlay !== "object" || Array.isArray(row.overlay)) continue;
      const overlay = row.overlay as Record<string, unknown>;
      const hostId = typeof overlay.hostId === "string" ? overlay.hostId : null;
      const instanceIds = Array.isArray(overlay.openedInstanceIds)
        ? overlay.openedInstanceIds.filter((value): value is string => typeof value === "string")
        : [];
      if (hostId === null) continue;
      for (const instanceId of instanceIds) {
        if (!excluded.has(instanceId)) targets.set(`${hostId}:${instanceId}`, { hostId, instanceId });
      }
    }

    const closedInstanceIds: string[] = [];
    const failures: SessionLayoutCloseResult["failures"] = [];
    await Promise.all([...targets.values()].map(async ({ hostId, instanceId }) => {
      try {
        await this.#realtime.sendOverlayCommand({
          type: "overlay.window.close",
          hostId,
          instanceId,
        });
        closedInstanceIds.push(instanceId);
      } catch (error) {
        failures.push({
          hostId,
          instanceId,
          message: error instanceof Error ? error.message : "The desktop widget window could not be closed.",
        });
      }
    }));
    return {
      attemptedInstanceIds: [...targets.values()].map(({ instanceId }) => instanceId),
      closedInstanceIds,
      failures,
    };
  }

  async #currentOrNextCondition(sessionId: string): Promise<string> {
    const result = await this.#pool.query<{ condition_id: string }>(
      `SELECT condition_id FROM session_conditions
        WHERE session_id=$1 AND status IN ('active','paused','pending')
        ORDER BY CASE WHEN status IN ('active','paused') THEN 0 ELSE 1 END,sequence
        LIMIT 1`,
      [sessionId],
    );
    const conditionId = result.rows[0]?.condition_id;
    if (conditionId === undefined) {
      throw new ApiProblem(409, "NO_ACTIVE_CONDITION", "The session has no condition available for its participant layout.");
    }
    return conditionId;
  }
}
