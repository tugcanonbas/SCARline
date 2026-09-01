import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { AuthHeadersSchema, EmptyObjectSchema, StudyParamsSchema, success } from "./common.js";
import { ensureStudyAccess } from "./studies.js";

const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  beforeId: z.coerce.number().int().positive().optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
}).strict();

export async function registerActivityRoutes(app: FastifyInstance, pool: Pool, auth: AuthService): Promise<void> {
  const authenticated = [authenticate(auth), requirePasswordReady];
  app.get("/api/v1/activity", {
    preHandler: [...authenticated, requireAnyRole("admin")],
    schema: { params: EmptyObjectSchema, querystring: ActivityQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => success(await listActivity(pool, ActivityQuerySchema.parse(request.query), null)));

  app.get("/api/v1/studies/:studyId/activity", {
    preHandler: [...authenticated, requireAnyRole("admin", "researcher", "observer")],
    schema: { params: StudyParamsSchema, querystring: ActivityQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    await ensureStudyAccess(request, pool, studyId);
    return success(await listActivity(pool, ActivityQuerySchema.parse(request.query), studyId));
  });
}

async function listActivity(pool: Pool, query: z.infer<typeof ActivityQuerySchema>, studyId: string | null) {
  const result = await pool.query(
    `SELECT id,actor_user_id AS "actorUserId",study_id AS "studyId",entity_type AS "entityType",
      entity_id AS "entityId",action,payload,created_at AS "createdAt"
     FROM activity_log WHERE ($1::uuid IS NULL OR study_id=$1) AND ($2::bigint IS NULL OR id<$2)
       AND ($3::text IS NULL OR action=$3) AND ($4::text IS NULL OR entity_type=$4)
     ORDER BY id DESC LIMIT $5`,
    [studyId, query.beforeId ?? null, query.action ?? null, query.entityType ?? null, query.limit + 1],
  );
  const items = result.rows.slice(0, query.limit);
  return { items, nextBeforeId: result.rows.length > query.limit ? items.at(-1)?.id ?? null : null };
}
