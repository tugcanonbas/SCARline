import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  SessionEventAggregateQuerySchema,
  SessionEventAggregateResponseSchema,
  type SessionEventAggregateQuery,
} from "@scarline/contracts";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { createEnvelope, enqueueMessage } from "../infrastructure/outbox.js";
import { AuthHeadersSchema, EmptyObjectSchema, UuidParamsSchema, success } from "./common.js";
import { ensureStudyAccess } from "./studies.js";

const EventQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1_000).default(200),
  beforeId: z.coerce.number().int().positive().optional(),
  eventType: z.string().max(100).optional(),
  modality: z.string().max(50).optional(),
}).strict();
const AnnotationSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  category: z.string().trim().max(100).nullable().default(null),
  sessionConditionId: z.string().uuid().nullable().default(null),
  timestamp: z.iso.datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export async function registerEventRoutes(app: FastifyInstance, pool: Pool, auth: AuthService): Promise<void> {
  const readers = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator", "observer")];
  const annotators = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator")];

  app.get("/api/v1/session-events", {
    preHandler: readers,
    schema: {
      params: EmptyObjectSchema,
      querystring: SessionEventAggregateQuerySchema,
      headers: AuthHeadersSchema,
    },
  }, async (request) => {
    const query = SessionEventAggregateQuerySchema.parse(request.query);
    const principal = request.principal!;
    const result = await listSessionEvents(
      pool,
      query,
      principal.roles.includes("admin"),
      principal.id,
    );
    return success(SessionEventAggregateResponseSchema.parse(result));
  });

  app.get("/api/v1/sessions/:id/events", {
    preHandler: readers,
    schema: { params: UuidParamsSchema, querystring: EventQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const query = EventQuerySchema.parse(request.query);
    const session = await authorizedSession(request, pool, id);
    const result = await pool.query(
      `SELECT id,message_id AS "messageId",session_condition_id AS "sessionConditionId","timestamp",event_type AS "eventType",
        modality,source_type AS "sourceType",source_id AS "sourceId",source_key AS "sourceKey",routing_key AS "routingKey",schema_version AS "schemaVersion",payload
       FROM session_events WHERE session_id=$1 AND ($2::bigint IS NULL OR id<$2)
        AND ($3::text IS NULL OR event_type=$3) AND ($4::text IS NULL OR modality=$4)
       ORDER BY id DESC LIMIT $5`,
      [id, query.beforeId ?? null, query.eventType ?? null, query.modality ?? null, query.limit + 1],
    );
    const items = result.rows.slice(0, query.limit);
    return success({ studyId: session.studyId, items, nextBeforeId: result.rows.length > query.limit ? items.at(-1)?.id ?? null : null });
  });

  app.post("/api/v1/sessions/:id/annotations", {
    preHandler: annotators,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: AnnotationSchema },
  }, async (request, reply) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const body = AnnotationSchema.parse(request.body);
    const session = await authorizedSession(request, pool, id);
    if (body.sessionConditionId !== null) {
      const condition = await pool.query("SELECT 1 FROM session_conditions WHERE id=$1 AND session_id=$2", [body.sessionConditionId, id]);
      if (condition.rowCount !== 1) throw new ApiProblem(409, "INVALID_SESSION_CONDITION", "Annotation condition does not belong to the session.");
    }
    const envelope = createEnvelope({
      routingKey: `events.${session.studyId}.${id}.annotation.created`,
      studyId: session.studyId,
      sessionId: id,
      payload: { ...body, timestamp: body.timestamp ?? new Date().toISOString(), createdBy: request.principal!.id },
    });
    await enqueueMessage(pool, envelope);
    return reply.status(202).send(success({ eventId: envelope.id, status: "queued" }));
  });
}

interface EventCursor {
  timestamp: string;
  id: string;
}

function decodeEventCursor(value: string | undefined): EventCursor | null {
  if (value === undefined) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof decoded.timestamp !== "string"
      || Number.isNaN(Date.parse(decoded.timestamp))
      || typeof decoded.id !== "string"
      || !/^\d+$/.test(decoded.id)
    ) throw new Error("invalid cursor");
    return { timestamp: decoded.timestamp, id: decoded.id };
  } catch {
    throw new ApiProblem(400, "INVALID_CURSOR", "Pagination cursor is invalid.");
  }
}

function encodeEventCursor(value: EventCursor | undefined): string | null {
  return value === undefined
    ? null
    : Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function listSessionEvents(
  pool: Pool,
  query: SessionEventAggregateQuery,
  isAdmin: boolean,
  userId: string,
) {
  const cursor = decodeEventCursor(query.cursor);
  const filters = `($1::boolean OR EXISTS (
      SELECT 1 FROM study_users su WHERE su.study_id=st.id AND su.user_id=$2
    ))
    AND ($3::uuid IS NULL OR st.id=$3)
    AND ($4::uuid IS NULL OR se.id=$4)
    AND ($5::text IS NULL OR ev.event_type=$5)
    AND ($6::text IS NULL OR ev.modality=$6)`;
  const parameters = [
    isAdmin,
    userId,
    query.studyId ?? null,
    query.sessionId ?? null,
    query.eventType ?? null,
    query.modality ?? null,
  ];
  const [page, aggregate] = await Promise.all([
    pool.query(`SELECT ev.id::text AS id,ev.message_id AS "messageId",st.id AS "studyId",st.name AS "studyName",
        st.status AS "studyStatus",se.id AS "sessionId",se.name AS "sessionName",
        ev.session_condition_id AS "sessionConditionId",ev."timestamp",ev.event_type AS "eventType",
        ev.modality,ev.source_type AS "sourceType",ev.source_id AS "sourceId",ev.source_key AS "sourceKey",
        ev.routing_key AS "routingKey",ev.schema_version AS "schemaVersion",ev.payload
       FROM session_events ev
       JOIN sessions se ON se.id=ev.session_id
       JOIN studies st ON st.id=se.study_id
      WHERE ${filters}
        AND ($7::timestamptz IS NULL OR (ev."timestamp",ev.id)<($7,$8::bigint))
      ORDER BY ev."timestamp" DESC,ev.id DESC LIMIT $9`, [
      ...parameters,
      cursor?.timestamp ?? null,
      cursor?.id ?? null,
      query.limit + 1,
    ]),
    pool.query<{ active_study_count: string; session_count: string; event_count: string; stored_payload_bytes: string }>(
      `SELECT
         COUNT(DISTINCT st.id) FILTER (WHERE st.status IN ('configured','ready','running'))::bigint AS active_study_count,
         COUNT(DISTINCT se.id)::bigint AS session_count,
         COUNT(ev.id)::bigint AS event_count,
         COALESCE(SUM(pg_column_size(ev.payload)),0)::bigint AS stored_payload_bytes
       FROM session_events ev
       JOIN sessions se ON se.id=ev.session_id
       JOIN studies st ON st.id=se.study_id
      WHERE ${filters}`,
      parameters,
    ),
  ]);
  const items = page.rows.slice(0, query.limit).map((row) => ({
    ...row,
    timestamp: new Date(row.timestamp as string | Date).toISOString(),
  }));
  const last = page.rows.length > query.limit ? items.at(-1) : undefined;
  const counts = aggregate.rows[0] ?? {
    active_study_count: "0",
    session_count: "0",
    event_count: "0",
    stored_payload_bytes: "0",
  };
  return {
    items,
    nextCursor: encodeEventCursor(last === undefined ? undefined : {
      timestamp: String(last.timestamp),
      id: String(last.id),
    }),
    aggregates: {
      activeStudyCount: Number(counts.active_study_count),
      sessionCount: Number(counts.session_count),
      eventCount: Number(counts.event_count),
      storedPayloadBytes: Number(counts.stored_payload_bytes),
    },
  };
}

async function authorizedSession(request: Parameters<typeof ensureStudyAccess>[0], pool: Pool, id: string): Promise<{ studyId: string }> {
  const result = await pool.query<{ study_id: string }>("SELECT study_id FROM sessions WHERE id=$1", [id]);
  if (result.rows[0] === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  await ensureStudyAccess(request, pool, result.rows[0].study_id);
  return { studyId: result.rows[0].study_id };
}
