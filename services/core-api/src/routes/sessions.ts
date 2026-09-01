import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  OverlayHostIdSchema,
  OverlayRendererModeSchema,
  SessionParticipantWindowSaveSchema,
  SessionStatusSchema,
} from "@scarline/contracts";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { recordActivity } from "../infrastructure/activity.js";
import type { LifecycleAction, SessionLifecycleService } from "../sessions/service.js";
import type { SessionOverlayService } from "../overlay/session-layout.js";
import { saveActiveSessionWindow } from "../layouts/session-window.js";
import { AuthHeadersSchema, EmptyObjectSchema, StudyParamsSchema, UuidParamsSchema, success } from "./common.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { ensureStudyAccess } from "./studies.js";

const CreateSessionSchema = z.object({
  participantId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).nullable().default(null),
  conditionIds: z.array(z.string().uuid()).min(1).optional(),
  runtimeMetadata: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().nullable().default(null),
}).strict();
const SessionQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
  status: SessionStatusSchema.optional(),
}).strict();
const LifecycleBodySchema = z.object({
  reason: z.string().trim().max(2_000).nullable().default(null),
  rendererMode: OverlayRendererModeSchema.optional(),
  hostId: OverlayHostIdSchema.nullable().optional(),
}).strict();
const DesktopLayoutBodySchema = z.object({
  hostId: OverlayHostIdSchema.nullable().optional(),
}).strict();
const UpdateSessionSchema = z.object({
  name: z.string().trim().min(1).max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  runtimeMetadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
const SessionWindowParamsSchema = z.object({
  id: z.string().uuid(),
  instanceId: z.string().uuid(),
}).strict();

interface SessionRow {
  id: string; study_id: string; participant_id: string; name: string | null; status: string;
  started_by_user_id: string | null; started_at: Date | null; paused_at: Date | null; completed_at: Date | null;
  runtime_metadata: Record<string, unknown>; notes: string | null; created_at: Date; updated_at: Date;
}

function mapSession(row: SessionRow) {
  return {
    id: row.id, studyId: row.study_id, participantId: row.participant_id, name: row.name, status: row.status,
    startedByUserId: row.started_by_user_id, startedAt: row.started_at?.toISOString() ?? null,
    pausedAt: row.paused_at?.toISOString() ?? null, completedAt: row.completed_at?.toISOString() ?? null,
    runtimeMetadata: row.runtime_metadata, notes: row.notes,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  pool: Pool,
  auth: AuthService,
  lifecycle: SessionLifecycleService,
  sessionOverlays: SessionOverlayService,
  defaultLimit: number,
  maxLimit: number,
): Promise<void> {
  const readers = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator", "observer")];
  const operators = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator")];

  app.post("/api/v1/studies/:studyId/sessions", {
    preHandler: operators,
    schema: { params: StudyParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: CreateSessionSchema },
  }, async (request, reply) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    const body = CreateSessionSchema.parse(request.body);
    await ensureStudyAccess(request, pool, studyId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const study = await client.query<{ status: string }>("SELECT status FROM studies WHERE id=$1 FOR SHARE", [studyId]);
      if (study.rows[0] === undefined) throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
      if (!["configured", "ready", "running"].includes(study.rows[0].status)) {
        throw new ApiProblem(409, "STUDY_NOT_CONFIGURED", "Sessions can only be created for a configured, ready, or running study.");
      }
      const participant = await client.query("SELECT 1 FROM participants WHERE id=$1 AND study_id=$2", [body.participantId, studyId]);
      if (participant.rowCount !== 1) throw new ApiProblem(404, "PARTICIPANT_NOT_FOUND", "Participant does not belong to this study.");
      const selected = body.conditionIds ?? (await client.query<{ id: string }>(
        `SELECT id FROM conditions WHERE study_id=$1 AND archived_at IS NULL ORDER BY "order",created_at`, [studyId],
      )).rows.map(({ id }) => id);
      if (selected.length === 0) throw new ApiProblem(409, "NO_SESSION_CONDITIONS", "A session requires at least one condition.");
      const valid = await client.query<{ id: string }>(
        "SELECT id FROM conditions WHERE study_id=$1 AND archived_at IS NULL AND id=ANY($2::uuid[])",
        [studyId, selected],
      );
      const validIds = new Set(valid.rows.map(({ id }) => id));
      if (selected.some((id) => !validIds.has(id))) {
        throw new ApiProblem(409, "INVALID_SESSION_CONDITION", "Every selected condition must be active and belong to the study.");
      }
      const created = await client.query<SessionRow>(
        `INSERT INTO sessions(study_id,participant_id,name,runtime_metadata,notes)
         VALUES($1,$2,$3,$4::jsonb,$5) RETURNING *`,
        [studyId, body.participantId, body.name, JSON.stringify(body.runtimeMetadata), body.notes],
      );
      const session = created.rows[0]!;
      for (const [sequence, conditionId] of selected.entries()) {
        await client.query(
          "INSERT INTO session_conditions(session_id,study_id,condition_id,sequence) VALUES($1,$2,$3,$4)",
          [session.id, studyId, conditionId, sequence],
        );
      }
      await recordActivity(client, { actorUserId: request.principal!.id, studyId, entityType: "session", entityId: session.id, action: "session.created" });
      await client.query("COMMIT");
      return reply.status(201).send(success(await loadSession(pool, session.id)));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/studies/:studyId/sessions", {
    preHandler: readers,
    schema: { params: StudyParamsSchema, querystring: SessionQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    const query = SessionQuerySchema.parse(request.query);
    await ensureStudyAccess(request, pool, studyId);
    const limit = Math.min(query.limit ?? defaultLimit, maxLimit);
    const cursor = decodeCursor(query.cursor);
    const result = await pool.query<SessionRow>(
      `SELECT * FROM sessions WHERE study_id=$1 AND ($2::text IS NULL OR status=$2)
       AND ($3::timestamptz IS NULL OR (created_at,id)<($3,$4::uuid))
       ORDER BY created_at DESC,id DESC LIMIT $5`,
      [studyId, query.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const last = result.rows.length > limit ? rows.at(-1) : undefined;
    return success({ items: rows.map(mapSession), nextCursor: encodeCursor(last && { createdAt: last.created_at.toISOString(), id: last.id }) });
  });

  app.get("/api/v1/sessions/:id", {
    preHandler: readers,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const session = await pool.query<{ study_id: string }>("SELECT study_id FROM sessions WHERE id=$1", [id]);
    if (session.rows[0] === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    await ensureStudyAccess(request, pool, session.rows[0].study_id);
    return success(await loadSession(pool, id));
  });

  app.patch("/api/v1/sessions/:id", {
    preHandler: [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher")],
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: UpdateSessionSchema },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const body = UpdateSessionSchema.parse(request.body);
    const session = await pool.query<{ study_id: string }>("SELECT study_id FROM sessions WHERE id=$1", [id]);
    if (session.rows[0] === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    await ensureStudyAccess(request, pool, session.rows[0].study_id);
    await pool.query(
      `UPDATE sessions SET name=CASE WHEN $2 THEN $3 ELSE name END,notes=CASE WHEN $4 THEN $5 ELSE notes END,
       runtime_metadata=COALESCE($6::jsonb,runtime_metadata) WHERE id=$1`,
      [id, "name" in body, body.name ?? null, "notes" in body, body.notes ?? null,
        body.runtimeMetadata === undefined ? null : JSON.stringify(body.runtimeMetadata)],
    );
    await recordActivity(pool, { actorUserId: request.principal!.id, studyId: session.rows[0].study_id, entityType: "session", entityId: id, action: "session.updated", payload: { fields: Object.keys(body) } });
    return success(await loadSession(pool, id));
  });

  app.delete("/api/v1/sessions/:id", {
    preHandler: [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher")],
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request, reply) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const session = await pool.query<{ study_id: string; status: string }>("SELECT study_id,status FROM sessions WHERE id=$1", [id]);
    const row = session.rows[0];
    if (row === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    await ensureStudyAccess(request, pool, row.study_id);
    if (["ready", "running", "paused"].includes(row.status)) {
      throw new ApiProblem(409, "SESSION_ACTIVE", "Abort or complete the session before deleting it.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM message_inbox WHERE message_id IN (
          SELECT id FROM event_outbox WHERE message#>>'{metadata,sessionId}'=$1
        )`, [id],
      );
      await client.query("DELETE FROM event_outbox WHERE message#>>'{metadata,sessionId}'=$1", [id]);
      await client.query("DELETE FROM sessions WHERE id=$1", [id]);
      await recordActivity(client, { actorUserId: request.principal!.id, studyId: row.study_id, entityType: "session", entityId: id, action: "session.deleted" });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return reply.status(204).send();
  });

  for (const action of ["ready", "start", "pause", "resume", "advance", "complete", "abort", "fail"] as LifecycleAction[]) {
    app.post(`/api/v1/sessions/:id/${action}`, {
      preHandler: operators,
      schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: LifecycleBodySchema },
    }, async (request, reply) => {
      const { id } = UuidParamsSchema.parse(request.params);
      const { reason, rendererMode, hostId } = LifecycleBodySchema.parse(request.body);
      if (action === "abort" && !reason) {
        throw new ApiProblem(400, "ABORT_REASON_REQUIRED", "Enter a reason for this abnormal termination.");
      }
      const session = await pool.query<{ study_id: string }>("SELECT study_id FROM sessions WHERE id=$1", [id]);
      if (session.rows[0] === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
      await ensureStudyAccess(request, pool, session.rows[0].study_id);
      const command = await lifecycle.queueCommand({
        sessionId: id,
        action,
        requestedBy: request.principal!.id,
        reason,
        ...(rendererMode === undefined ? {} : { rendererMode }),
        ...(hostId === undefined ? {} : { hostId }),
      });
      await recordActivity(pool, { actorUserId: request.principal!.id, studyId: session.rows[0].study_id, entityType: "lifecycle-command", entityId: command.commandId, action: `session.${action}`, payload: { sessionId: id, reason } });
      return reply.status(202).send(success(command));
    });
  }

  app.post("/api/v1/sessions/:id/overlay/desktop", {
    preHandler: operators,
    schema: {
      params: UuidParamsSchema,
      querystring: EmptyObjectSchema,
      headers: AuthHeadersSchema,
      body: DesktopLayoutBodySchema,
    },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const { hostId } = DesktopLayoutBodySchema.parse(request.body);
    const session = await pool.query<{ study_id: string; status: string }>(
      "SELECT study_id,status FROM sessions WHERE id=$1",
      [id],
    );
    const row = session.rows[0];
    if (row === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    await ensureStudyAccess(request, pool, row.study_id);
    if (!["running", "paused"].includes(row.status)) {
      throw new ApiProblem(409, "SESSION_NOT_RUNNING", "Start the session before opening its participant layout.");
    }
    const result = await sessionOverlays.openDesktopLayout({
      sessionId: id,
      ...(hostId === undefined ? {} : { hostId }),
    });
    await recordActivity(pool, {
      actorUserId: request.principal!.id,
      studyId: row.study_id,
      entityType: "session",
      entityId: id,
      action: "session.overlay-retried",
      payload: { hostId: result.hostId, layoutId: result.layoutId },
    });
    return success(result);
  });

  app.put("/api/v1/sessions/:id/overlay/windows/:instanceId", {
    preHandler: operators,
    schema: {
      params: SessionWindowParamsSchema,
      querystring: EmptyObjectSchema,
      headers: AuthHeadersSchema,
      body: SessionParticipantWindowSaveSchema,
    },
  }, async (request) => {
    const { id, instanceId } = SessionWindowParamsSchema.parse(request.params);
    const body = SessionParticipantWindowSaveSchema.parse(request.body);
    const session = await pool.query<{ study_id: string }>(
      "SELECT study_id FROM sessions WHERE id=$1",
      [id],
    );
    const studyId = session.rows[0]?.study_id;
    if (studyId === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    await ensureStudyAccess(request, pool, studyId);
    const result = await saveActiveSessionWindow(pool, id, instanceId, body, request.principal!.id);
    return success(result);
  });

  app.get("/api/v1/session-commands/:id", {
    preHandler: readers,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const result = await pool.query(
      `SELECT lc.id,lc.session_id AS "sessionId",lc.requested_by AS "requestedBy",lc.action,lc.status,lc.reason,
        lc.error_message AS "errorMessage",lc.required_components AS "requiredComponents",
        lc.acknowledged_components AS "acknowledgedComponents",lc.result_payload AS "resultPayload",lc.deadline_at AS "deadlineAt",
        lc.created_at AS "createdAt",lc.completed_at AS "completedAt",s.study_id
       FROM lifecycle_commands lc JOIN sessions s ON s.id=lc.session_id WHERE lc.id=$1`, [id],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApiProblem(404, "COMMAND_NOT_FOUND", "Lifecycle command not found.");
    await ensureStudyAccess(request, pool, row.study_id);
    delete row.study_id;
    return success(row);
  });
}

async function loadSession(pool: Pool, sessionId: string) {
  const result = await pool.query<SessionRow>("SELECT * FROM sessions WHERE id=$1", [sessionId]);
  const row = result.rows[0];
  if (row === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  const conditions = await pool.query(
    `SELECT sc.id,sc.condition_id AS "conditionId",sc.sequence,sc.status,sc.started_at AS "startedAt",
      sc.completed_at AS "completedAt",sc.configuration_snapshot AS "configurationSnapshot",sc.runtime_metadata AS "runtimeMetadata",
      c.name AS name FROM session_conditions sc JOIN conditions c ON c.id=sc.condition_id
     WHERE sc.session_id=$1 ORDER BY sc.sequence`, [sessionId],
  );
  const latestCommand = await pool.query(
    `SELECT id,session_id AS "sessionId",requested_by AS "requestedBy",action,status,reason,
            error_message AS "errorMessage",required_components AS "requiredComponents",
            acknowledged_components AS "acknowledgedComponents",result_payload AS "resultPayload",
            deadline_at AS "deadlineAt",created_at AS "createdAt",completed_at AS "completedAt"
       FROM lifecycle_commands WHERE session_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [sessionId],
  );
  const activeCondition = conditions.rows.find((condition) =>
    ["active", "paused"].includes(String(condition.status)),
  ) ?? null;
  const nextCondition = conditions.rows.find((condition) => condition.status === "pending") ?? null;
  return {
    ...mapSession(row),
    conditions: conditions.rows,
    activeCondition,
    nextCondition,
    conditionCount: conditions.rows.length,
    remainingConditionCount: conditions.rows.filter((condition) => condition.status === "pending").length,
    latestCommand: latestCommand.rows[0] ?? null,
  };
}
