import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { recordActivity } from "../infrastructure/activity.js";
import { AuthHeadersSchema, EmptyObjectSchema, UuidParamsSchema, success } from "./common.js";
import { ensureStudyAccess } from "./studies.js";

const CreateExportSchema = z.object({
  scope: z.enum(["study", "participant", "session", "session_condition"]),
  targetId: z.string().uuid(),
  format: z.enum(["csv", "json", "both"]).default("both"),
  pseudonymize: z.boolean().default(true),
  includeDemographics: z.boolean().default(false),
}).strict();
const ExportQuerySchema = z.object({
  studyId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional(),
}).strict();

export async function registerExportRoutes(app: FastifyInstance, pool: Pool, auth: AuthService, exportsDirectory: string): Promise<void> {
  const exporter = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher")];
  app.get("/api/v1/exports", {
    preHandler: exporter,
    schema: { params: EmptyObjectSchema, querystring: ExportQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const query = ExportQuerySchema.parse(request.query);
    const principal = request.principal!;
    const result = await pool.query(
      `SELECT e.id,e.study_id AS "studyId",e.participant_id AS "participantId",e.session_id AS "sessionId",
        e.session_condition_id AS "sessionConditionId",e.format,e.scope,e.status,e.progress,e.parameters,
        e.result_size_bytes AS "resultSizeBytes",e.error_message AS "errorMessage",e.started_at AS "startedAt",
        e.completed_at AS "completedAt",e.created_at AS "createdAt",e.updated_at AS "updatedAt",
        COALESCE(e.study_id,p.study_id,se.study_id,sc.study_id) AS authorized_study_id
       FROM export_jobs e
       LEFT JOIN participants p ON p.id=e.participant_id
       LEFT JOIN sessions se ON se.id=e.session_id
       LEFT JOIN session_conditions sc ON sc.id=e.session_condition_id
       WHERE ($1::boolean OR EXISTS (SELECT 1 FROM study_users su
              WHERE su.study_id=COALESCE(e.study_id,p.study_id,se.study_id,sc.study_id) AND su.user_id=$2))
         AND ($3::uuid IS NULL OR COALESCE(e.study_id,p.study_id,se.study_id,sc.study_id)=$3)
         AND ($4::uuid IS NULL OR e.session_id=$4)
         AND ($5::text IS NULL OR e.status=$5)
       ORDER BY e.created_at DESC`,
      [principal.roles.includes("admin"), principal.id, query.studyId ?? null, query.sessionId ?? null, query.status ?? null],
    );
    return success(result.rows.map(({ authorized_study_id: _studyId, ...row }) => row));
  });
  app.post("/api/v1/exports", {
    preHandler: exporter,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: CreateExportSchema },
  }, async (request, reply) => {
    const body = CreateExportSchema.parse(request.body);
    const target = await resolveTarget(pool, body.scope, body.targetId);
    await ensureStudyAccess(request, pool, target.studyId);
    const columns: Record<string, string | null> = { study: null, participant: null, session: null, session_condition: null };
    columns[body.scope] = body.targetId;
    const result = await pool.query(
      `INSERT INTO export_jobs(study_id,participant_id,session_id,session_condition_id,format,scope,parameters,requested_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING id,status,progress,created_at AS "createdAt"`,
      [body.scope === "study" ? body.targetId : target.studyId, columns.participant, columns.session, columns.session_condition,
        body.format, body.scope, JSON.stringify({ pseudonymize: body.pseudonymize, includeDemographics: body.includeDemographics }), request.principal!.id],
    );
    await recordActivity(pool, { actorUserId: request.principal!.id, studyId: target.studyId, entityType: "export-job", entityId: result.rows[0].id, action: "export.queued", payload: { scope: body.scope, targetId: body.targetId } });
    return reply.status(202).send(success(result.rows[0]));
  });

  app.get("/api/v1/exports/:id", {
    preHandler: exporter,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => success(await loadAuthorizedJob(request, pool, UuidParamsSchema.parse(request.params).id)));

  app.get("/api/v1/exports/:id/download", {
    preHandler: exporter,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request, reply) => {
    const job = await loadAuthorizedJob(request, pool, UuidParamsSchema.parse(request.params).id);
    if (job.status !== "completed" || typeof job.result_path !== "string") throw new ApiProblem(409, "EXPORT_NOT_READY", "The export artifact is not ready.");
    const resolved = path.resolve(job.result_path);
    const root = `${path.resolve(exportsDirectory)}${path.sep}`;
    if (!resolved.startsWith(root)) throw new ApiProblem(500, "INVALID_EXPORT_PATH", "The export artifact path is invalid.");
    await stat(resolved).catch(() => { throw new ApiProblem(404, "EXPORT_ARTIFACT_MISSING", "The export artifact is missing."); });
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="scarline-export-${job.id}.zip"`);
    return reply.send(createReadStream(resolved));
  });

  app.delete("/api/v1/exports/:id", {
    preHandler: exporter,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request, reply) => {
    const id = UuidParamsSchema.parse(request.params).id;
    const job = await loadAuthorizedJob(request, pool, id);
    if (job.status === "running") {
      throw new ApiProblem(409, "EXPORT_RUNNING", "A running export cannot be cancelled safely. Wait for it to finish.");
    }
    if (job.status === "queued") {
      await pool.query("UPDATE export_jobs SET status='cancelled',completed_at=NOW() WHERE id=$1", [id]);
      return reply.status(204).send();
    }
    if (typeof job.result_path === "string") {
      const resolved = path.resolve(job.result_path);
      const root = `${path.resolve(exportsDirectory)}${path.sep}`;
      if (!resolved.startsWith(root)) throw new ApiProblem(500, "INVALID_EXPORT_PATH", "The export artifact path is invalid.");
      await unlink(resolved).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await pool.query("DELETE FROM export_jobs WHERE id=$1", [id]);
    return reply.status(204).send();
  });
}

async function resolveTarget(pool: Pool, scope: string, id: string): Promise<{ studyId: string }> {
  const query = scope === "study" ? "SELECT id AS study_id FROM studies WHERE id=$1"
    : scope === "participant" ? "SELECT study_id FROM participants WHERE id=$1"
    : scope === "session" ? "SELECT study_id FROM sessions WHERE id=$1"
    : "SELECT study_id FROM session_conditions WHERE id=$1";
  const result = await pool.query<{ study_id: string }>(query, [id]);
  if (result.rows[0] === undefined) throw new ApiProblem(404, "EXPORT_TARGET_NOT_FOUND", "Export target not found.");
  return { studyId: result.rows[0].study_id };
}

async function loadAuthorizedJob(request: Parameters<typeof ensureStudyAccess>[0], pool: Pool, id: string) {
  const result = await pool.query(`SELECT * FROM export_jobs WHERE id=$1`, [id]);
  const job = result.rows[0];
  if (job === undefined) throw new ApiProblem(404, "EXPORT_NOT_FOUND", "Export job not found.");
  const target = await resolveTarget(pool, job.scope, job[job.scope === "session_condition" ? "session_condition_id" : `${job.scope}_id`]);
  await ensureStudyAccess(request, pool, target.studyId);
  return job;
}
