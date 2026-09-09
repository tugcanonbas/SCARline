import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  DEFAULT_STUDY_DATA_POLICY,
  StudyDataPolicySchema,
  StudyStatusSchema,
} from "@scarline/contracts";

import {
  authenticate,
  requireAnyRole,
  requirePasswordReady,
  requireStudyAccess,
} from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { recordActivity } from "../infrastructure/activity.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { loadStudyReadiness } from "../studies/readiness.js";
import {
  AuthHeadersSchema,
  EmptyObjectSchema,
  StudyEntityParamsSchema,
  StudyParamsSchema,
  success,
} from "./common.js";
import { PaginationQuerySchema, decodeCursor, encodeCursor } from "./pagination.js";

const CreateStudySchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    description: z.string().nullable().default(null),
    version: z.string().trim().min(1).max(50).default("1.0"),
    metadata: z.record(z.string(), z.unknown()).default({}),
    dataPolicy: StudyDataPolicySchema.default(DEFAULT_STUDY_DATA_POLICY),
  })
  .strict();
const UpdateStudySchema = CreateStudySchema.partial().strict();
const TransitionStudySchema = z.object({ to: StudyStatusSchema }).strict();
const AddStudyUserSchema = z.object({ userId: z.string().uuid() }).strict();
const CreateParticipantSchema = z
  .object({
    participantCode: z.string().trim().min(1).max(50),
    demographicData: z.record(z.string(), z.unknown()).default({}),
    notes: z.string().nullable().default(null),
  })
  .strict();
const UpdateParticipantSchema = CreateParticipantSchema.partial().strict();
const CreateConditionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().nullable().default(null),
    order: z.number().int().nonnegative().default(0),
    metadata: z.record(z.string(), z.unknown()).default({}),
    templateConditionId: z.string().uuid().optional(),
  })
  .strict();
const UpdateConditionSchema = CreateConditionSchema.omit({ templateConditionId: true }).partial().strict();

interface StudyRow {
  id: string; name: string; description: string | null; version: string; status: string;
  created_by: string | null; metadata: Record<string, unknown>; data_policy: Record<string, unknown>;
  created_at: Date; updated_at: Date;
  participant_count?: number; condition_count?: number; session_count?: number;
}
interface ParticipantRow {
  id: string; study_id: string; participant_code: string;
  demographic_data: Record<string, unknown>; notes: string | null; created_at: Date; updated_at: Date;
}
interface ConditionRow {
  id: string; study_id: string; name: string; description: string | null; order: number;
  metadata: Record<string, unknown>; archived_at: Date | null; created_at: Date; updated_at: Date;
}

function mapStudy(row: StudyRow) {
  return { id: row.id, name: row.name, description: row.description, version: row.version,
    status: row.status, createdBy: row.created_by, metadata: row.metadata,
    dataPolicy: row.data_policy, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    participantCount: Number(row.participant_count ?? 0), conditionCount: Number(row.condition_count ?? 0),
    sessionCount: Number(row.session_count ?? 0) };
}
function mapParticipant(row: ParticipantRow) {
  return { id: row.id, studyId: row.study_id, participantCode: row.participant_code,
    demographicData: row.demographic_data, notes: row.notes,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function mapCondition(row: ConditionRow) {
  return { id: row.id, studyId: row.study_id, name: row.name, description: row.description,
    order: row.order, metadata: row.metadata, archivedAt: row.archived_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

export async function requireEditableStudy(client: Pool | PoolClient, studyId: string): Promise<StudyRow> {
  const result = await client.query<StudyRow>("SELECT * FROM studies WHERE id = $1", [studyId]);
  const study = result.rows[0];
  if (study === undefined) throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
  if (!['draft', 'configured'].includes(study.status)) {
    throw new ApiProblem(409, "STUDY_CONFIGURATION_LOCKED", "Study configuration is locked in its current state.");
  }
  const active = await client.query(
    `SELECT 1 FROM sessions
     WHERE study_id = $1 AND status IN ('ready','running','paused') LIMIT 1`,
    [studyId],
  );
  if (active.rowCount === 1) {
    throw new ApiProblem(409, "ACTIVE_SESSION_EXISTS", "Study configuration cannot change after a session is prepared or started.");
  }
  return study;
}

export function transitionRequiresNoNonterminalSessions(from: string, to: string): boolean {
  return (from === "ready" && to === "configured") || to === "completed";
}

export async function requireRemovableStudyConfiguration(client: Pool | PoolClient, studyId: string): Promise<StudyRow> {
  const result = await client.query<StudyRow>("SELECT * FROM studies WHERE id=$1", [studyId]);
  const study = result.rows[0];
  if (study === undefined) throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
  if (!["draft", "configured", "completed"].includes(study.status)) {
    throw new ApiProblem(409, "STUDY_CONFIGURATION_LOCKED", "Configuration cannot be removed in the study's current state.");
  }
  const active = await client.query(
    "SELECT 1 FROM sessions WHERE study_id=$1 AND status IN ('created','ready','running','paused') LIMIT 1",
    [studyId],
  );
  if (active.rowCount === 1) {
    throw new ApiProblem(409, "ACTIVE_SESSION_EXISTS", "Configuration cannot be removed while a session is nonterminal.");
  }
  return study;
}

export async function ensureStudyAccess(request: FastifyRequest, pool: Pool, studyId: string): Promise<void> {
  await requireStudyAccess(pool, request.principal!, studyId);
}

async function requireParticipantMutable(pool: Pool, studyId: string): Promise<void> {
  const result = await pool.query<{ status: string }>("SELECT status FROM studies WHERE id=$1", [studyId]);
  const status = result.rows[0]?.status;
  if (status === undefined) throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
  if (["completed", "archived"].includes(status)) {
    throw new ApiProblem(409, "STUDY_PARTICIPANTS_LOCKED", "Participants are locked after the study is completed.");
  }
}

export async function registerStudyRoutes(
  app: FastifyInstance,
  pool: Pool,
  auth: AuthService,
  realtime: RealtimeHub,
  defaultLimit: number,
  maxLimit: number,
): Promise<void> {
  const authenticated = [authenticate(auth), requirePasswordReady];
  const designer = [...authenticated, requireAnyRole("admin", "researcher")];

  app.get("/api/v1/studies", {
    preHandler: authenticated,
    schema: { params: EmptyObjectSchema, querystring: PaginationQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const query = PaginationQuerySchema.parse(request.query);
    const limit = Math.min(query.limit ?? defaultLimit, maxLimit);
    const cursor = decodeCursor(query.cursor);
    const principal = request.principal!;
    const result = await pool.query<StudyRow>(
      `SELECT s.*,
          (SELECT COUNT(*)::int FROM participants p WHERE p.study_id=s.id) AS participant_count,
          (SELECT COUNT(*)::int FROM conditions c WHERE c.study_id=s.id AND c.archived_at IS NULL) AS condition_count,
          (SELECT COUNT(*)::int FROM sessions se WHERE se.study_id=s.id) AS session_count
       FROM studies s
       WHERE ($1::boolean OR EXISTS (SELECT 1 FROM study_users su WHERE su.study_id = s.id AND su.user_id = $2))
         AND ($3::timestamptz IS NULL OR (s.created_at, s.id) < ($3, $4::uuid))
       ORDER BY s.created_at DESC, s.id DESC LIMIT $5`,
      [principal.roles.includes("admin"), principal.id, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const last = result.rows.length > limit ? rows.at(-1) : undefined;
    return success({ items: rows.map(mapStudy), nextCursor: encodeCursor(last && { createdAt: last.created_at.toISOString(), id: last.id }) });
  });

  app.post("/api/v1/studies", {
    preHandler: designer,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: CreateStudySchema },
  }, async (request, reply) => {
    const body = CreateStudySchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<StudyRow>(
        `INSERT INTO studies (name, description, version, created_by, metadata, data_policy)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING *`,
        [body.name, body.description, body.version, request.principal!.id, JSON.stringify(body.metadata), JSON.stringify(body.dataPolicy)],
      );
      const study = result.rows[0]!;
      await client.query("INSERT INTO study_users (study_id, user_id, added_by) VALUES ($1,$2,$2)", [study.id, request.principal!.id]);
      await recordActivity(client, { actorUserId: request.principal!.id, studyId: study.id, entityType: "study", entityId: study.id, action: "study.created" });
      await client.query("COMMIT");
      return reply.status(201).send(success(mapStudy(study)));
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  });

  app.get("/api/v1/studies/:studyId", {
    preHandler: authenticated,
    schema: { params: StudyParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    await ensureStudyAccess(request, pool, studyId);
    const result = await pool.query<StudyRow>(`SELECT s.*,
      (SELECT COUNT(*)::int FROM participants p WHERE p.study_id=s.id) AS participant_count,
      (SELECT COUNT(*)::int FROM conditions c WHERE c.study_id=s.id AND c.archived_at IS NULL) AS condition_count,
      (SELECT COUNT(*)::int FROM sessions se WHERE se.study_id=s.id) AS session_count
      FROM studies s WHERE s.id = $1`, [studyId]);
    if (!result.rows[0]) throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
    return success(mapStudy(result.rows[0]));
  });

  app.get("/api/v1/studies/:studyId/readiness", {
    preHandler: authenticated,
    schema: { params: StudyParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    await ensureStudyAccess(request, pool, studyId);
    return success(await loadStudyReadiness(pool, realtime, studyId));
  });

  app.patch("/api/v1/studies/:studyId", {
    preHandler: designer,
    schema: { params: StudyParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: UpdateStudySchema },
  }, async (request) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    const body = UpdateStudySchema.parse(request.body);
    await ensureStudyAccess(request, pool, studyId);
    await requireEditableStudy(pool, studyId);
    const result = await pool.query<StudyRow>(
      `UPDATE studies SET
         name = COALESCE($2,name), description = CASE WHEN $3 THEN $4 ELSE description END,
         version = COALESCE($5,version), metadata = COALESCE($6::jsonb,metadata),
         data_policy = COALESCE($7::jsonb,data_policy)
       WHERE id = $1 RETURNING *`,
      [studyId, body.name ?? null, "description" in body, body.description ?? null, body.version ?? null,
        body.metadata === undefined ? null : JSON.stringify(body.metadata), body.dataPolicy === undefined ? null : JSON.stringify(body.dataPolicy)],
    );
    await recordActivity(pool, { actorUserId: request.principal!.id, studyId, entityType: "study", entityId: studyId, action: "study.updated", payload: { fields: Object.keys(body) } });
    return success(mapStudy(result.rows[0]!));
  });

  app.post("/api/v1/studies/:studyId/transition", {
    preHandler: designer,
    schema: { params: StudyParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: TransitionStudySchema },
  }, async (request) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    const { to } = TransitionStudySchema.parse(request.body);
    await ensureStudyAccess(request, pool, studyId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<StudyRow>("SELECT * FROM studies WHERE id=$1 FOR UPDATE", [studyId]);
      const study = locked.rows[0];
      if (!study) throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
      const allowed: Record<string, string[]> = {
        draft: ["configured"], configured: ["draft", "ready"], ready: ["configured"],
        running: ["completed"], completed: ["archived"], archived: [],
      };
      if (!allowed[study.status]?.includes(to)) throw new ApiProblem(409, "INVALID_STUDY_TRANSITION", `Cannot transition study from ${study.status} to ${to}.`);
      if (to === "ready") {
        const readiness = await loadStudyReadiness(client, realtime, studyId);
        if (!readiness.ready) {
          const blocker = readiness.checks.find((entry) => entry.blocking && entry.status === "not_ready");
          throw new ApiProblem(
            409,
            blocker?.blockingCode ?? "STUDY_NOT_READY",
            blocker?.message ?? "Complete every required Quick Start step before marking the study ready.",
            { readiness },
          );
        }
      }
      if (transitionRequiresNoNonterminalSessions(study.status, to)) {
        const active = await client.query("SELECT 1 FROM sessions WHERE study_id=$1 AND status IN ('created','ready','running','paused') LIMIT 1", [studyId]);
        if (active.rowCount === 1) throw new ApiProblem(409, "ACTIVE_SESSION_EXISTS", "A nonterminal session prevents this transition.");
      }
      const updated = await client.query<StudyRow>("UPDATE studies SET status=$2 WHERE id=$1 RETURNING *", [studyId,to]);
      await recordActivity(client, { actorUserId: request.principal!.id, studyId, entityType:"study", entityId:studyId, action:"study.transitioned", payload:{ from:study.status,to } });
      await client.query("COMMIT");
      return success(mapStudy(updated.rows[0]!));
    } catch (error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; } finally { client.release(); }
  });

  app.delete("/api/v1/studies/:studyId", {
    preHandler: designer,
    schema: { params: StudyParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request, reply) => {
    const { studyId } = StudyParamsSchema.parse(request.params);
    await ensureStudyAccess(request,pool,studyId);
    const sessions = await pool.query("SELECT 1 FROM sessions WHERE study_id=$1 LIMIT 1", [studyId]);
    if (sessions.rowCount === 1) throw new ApiProblem(409,"STUDY_HAS_HISTORY","A study with sessions must be archived, not deleted.");
    const result = await pool.query("DELETE FROM studies WHERE id=$1",[studyId]);
    if (result.rowCount !== 1) throw new ApiProblem(404,"STUDY_NOT_FOUND","Study not found.");
    return reply.status(204).send();
  });

  app.get("/api/v1/studies/:studyId/users", {
    preHandler: authenticated,
    schema:{params:StudyParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema},
  }, async request => {
    const {studyId}=StudyParamsSchema.parse(request.params); await ensureStudyAccess(request,pool,studyId);
    const result=await pool.query(`SELECT u.id,u.username,u.display_name AS "displayName",array_agg(r.name ORDER BY r.name) AS roles
      FROM study_users su JOIN users u ON u.id=su.user_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
      WHERE su.study_id=$1 GROUP BY u.id ORDER BY u.username`,[studyId]);
    return success(result.rows);
  });

  app.post("/api/v1/studies/:studyId/users", {
    preHandler:designer,schema:{params:StudyParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema,body:AddStudyUserSchema},
  }, async (request,reply)=>{
    const {studyId}=StudyParamsSchema.parse(request.params); const {userId}=AddStudyUserSchema.parse(request.body); await ensureStudyAccess(request,pool,studyId);
    await pool.query(`INSERT INTO study_users(study_id,user_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[studyId,userId,request.principal!.id]);
    await recordActivity(pool,{actorUserId:request.principal!.id,studyId,entityType:"study-user",entityId:userId,action:"study-user.added"});
    return reply.status(204).send();
  });

  app.delete("/api/v1/studies/:studyId/users/:id", {
    preHandler:designer,schema:{params:StudyEntityParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema},
  }, async (request,reply)=>{
    const {studyId,id}=StudyEntityParamsSchema.parse(request.params); await ensureStudyAccess(request,pool,studyId);
    await pool.query("DELETE FROM study_users WHERE study_id=$1 AND user_id=$2",[studyId,id]); return reply.status(204).send();
  });

  registerParticipantRoutes(app,pool,auth,defaultLimit,maxLimit);
  registerConditionRoutes(app,pool,auth);
}

function registerParticipantRoutes(app:FastifyInstance,pool:Pool,auth:AuthService,defaultLimit:number,maxLimit:number):void {
  const authenticated=[authenticate(auth),requirePasswordReady]; const designer=[...authenticated,requireAnyRole("admin","researcher")];
  app.get("/api/v1/studies/:studyId/participants",{preHandler:authenticated,schema:{params:StudyParamsSchema,querystring:PaginationQuerySchema,headers:AuthHeadersSchema}},async request=>{
    const {studyId}=StudyParamsSchema.parse(request.params); await ensureStudyAccess(request,pool,studyId); const query=PaginationQuerySchema.parse(request.query); const limit=Math.min(query.limit??defaultLimit,maxLimit); const cursor=decodeCursor(query.cursor);
    const result=await pool.query<ParticipantRow>(`SELECT * FROM participants WHERE study_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`,[studyId,cursor?.createdAt??null,cursor?.id??null,limit+1]); const rows=result.rows.slice(0,limit); const last=result.rows.length>limit?rows.at(-1):undefined;
    return success({items:rows.map(mapParticipant),nextCursor:encodeCursor(last&&{createdAt:last.created_at.toISOString(),id:last.id})});
  });
  app.post("/api/v1/studies/:studyId/participants",{preHandler:designer,schema:{params:StudyParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema,body:CreateParticipantSchema}},async(request,reply)=>{
    const {studyId}=StudyParamsSchema.parse(request.params); const body=CreateParticipantSchema.parse(request.body); await ensureStudyAccess(request,pool,studyId); await requireParticipantMutable(pool,studyId);
    const result=await pool.query<ParticipantRow>(`INSERT INTO participants(study_id,participant_code,demographic_data,notes) VALUES($1,$2,$3::jsonb,$4) RETURNING *`,[studyId,body.participantCode,JSON.stringify(body.demographicData),body.notes]); await recordActivity(pool,{actorUserId:request.principal!.id,studyId,entityType:"participant",entityId:result.rows[0]!.id,action:"participant.created"}); return reply.status(201).send(success(mapParticipant(result.rows[0]!)));
  });
  app.patch("/api/v1/studies/:studyId/participants/:id",{preHandler:designer,schema:{params:StudyEntityParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema,body:UpdateParticipantSchema}},async request=>{
    const {studyId,id}=StudyEntityParamsSchema.parse(request.params); const body=UpdateParticipantSchema.parse(request.body); await ensureStudyAccess(request,pool,studyId); await requireParticipantMutable(pool,studyId);
    const result=await pool.query<ParticipantRow>(`UPDATE participants SET participant_code=COALESCE($3,participant_code),demographic_data=COALESCE($4::jsonb,demographic_data),notes=CASE WHEN $5 THEN $6 ELSE notes END WHERE id=$1 AND study_id=$2 RETURNING *`,[id,studyId,body.participantCode??null,body.demographicData===undefined?null:JSON.stringify(body.demographicData),"notes" in body,body.notes??null]); if(!result.rows[0])throw new ApiProblem(404,"PARTICIPANT_NOT_FOUND","Participant not found."); return success(mapParticipant(result.rows[0]));
  });
  app.delete("/api/v1/studies/:studyId/participants/:id",{preHandler:designer,schema:{params:StudyEntityParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema}},async(request,reply)=>{
    const {studyId,id}=StudyEntityParamsSchema.parse(request.params); await ensureStudyAccess(request,pool,studyId); await requireParticipantMutable(pool,studyId); const used=await pool.query("SELECT 1 FROM sessions WHERE participant_id=$1 LIMIT 1",[id]); if(used.rowCount===1)throw new ApiProblem(409,"PARTICIPANT_HAS_HISTORY","A participant with sessions cannot be deleted."); await pool.query("DELETE FROM participants WHERE id=$1 AND study_id=$2",[id,studyId]); return reply.status(204).send();
  });
}

function registerConditionRoutes(app:FastifyInstance,pool:Pool,auth:AuthService):void {
  const authenticated=[authenticate(auth),requirePasswordReady]; const designer=[...authenticated,requireAnyRole("admin","researcher")];
  app.get("/api/v1/studies/:studyId/conditions",{preHandler:authenticated,schema:{params:StudyParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema}},async request=>{const{studyId}=StudyParamsSchema.parse(request.params);await ensureStudyAccess(request,pool,studyId);const result=await pool.query<ConditionRow>('SELECT * FROM conditions WHERE study_id=$1 ORDER BY "order",created_at',[studyId]);return success(result.rows.map(mapCondition));});
  app.post("/api/v1/studies/:studyId/conditions",{preHandler:designer,schema:{params:StudyParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema,body:CreateConditionSchema}},async(request,reply)=>{
    const{studyId}=StudyParamsSchema.parse(request.params);const body=CreateConditionSchema.parse(request.body);await ensureStudyAccess(request,pool,studyId);
    const client=await pool.connect();
    try{
      await client.query("BEGIN");await requireEditableStudy(client,studyId);
      if(body.templateConditionId!==undefined){
        const template=await client.query("SELECT 1 FROM conditions WHERE id=$1 AND study_id=$2 AND archived_at IS NULL",[body.templateConditionId,studyId]);
        if(template.rowCount!==1)throw new ApiProblem(404,"TEMPLATE_CONDITION_NOT_FOUND","Template condition not found in this study.");
      }
      const result=await client.query<ConditionRow>(`INSERT INTO conditions(study_id,name,description,"order",metadata)VALUES($1,$2,$3,$4,$5::jsonb)RETURNING *`,[studyId,body.name,body.description,body.order,JSON.stringify(body.metadata)]);
      const condition=result.rows[0]!;
      if(body.templateConditionId!==undefined)await cloneConditionConfiguration(client,body.templateConditionId,condition.id);
      await client.query("COMMIT");
      return reply.status(201).send(success(mapCondition(condition)));
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  });
  app.patch("/api/v1/studies/:studyId/conditions/:id",{preHandler:designer,schema:{params:StudyEntityParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema,body:UpdateConditionSchema}},async request=>{const{studyId,id}=StudyEntityParamsSchema.parse(request.params);const body=UpdateConditionSchema.parse(request.body);await ensureStudyAccess(request,pool,studyId);await requireEditableStudy(pool,studyId);const result=await pool.query<ConditionRow>(`UPDATE conditions SET name=COALESCE($3,name),description=CASE WHEN $4 THEN $5 ELSE description END,"order"=COALESCE($6,"order"),metadata=COALESCE($7::jsonb,metadata)WHERE id=$1 AND study_id=$2 RETURNING *`,[id,studyId,body.name??null,"description" in body,body.description??null,body.order??null,body.metadata===undefined?null:JSON.stringify(body.metadata)]);if(!result.rows[0])throw new ApiProblem(404,"CONDITION_NOT_FOUND","Condition not found.");return success(mapCondition(result.rows[0]));});
  app.delete("/api/v1/studies/:studyId/conditions/:id",{preHandler:designer,schema:{params:StudyEntityParamsSchema,querystring:EmptyObjectSchema,headers:AuthHeadersSchema}},async(request,reply)=>{const{studyId,id}=StudyEntityParamsSchema.parse(request.params);await ensureStudyAccess(request,pool,studyId);const study=await requireRemovableStudyConfiguration(pool,studyId);const used=await pool.query("SELECT 1 FROM session_conditions WHERE condition_id=$1 LIMIT 1",[id]);if(used.rowCount===1||study.status==="completed")await pool.query("UPDATE conditions SET archived_at=COALESCE(archived_at,NOW()) WHERE id=$1 AND study_id=$2",[id,studyId]);else await pool.query("DELETE FROM conditions WHERE id=$1 AND study_id=$2",[id,studyId]);return reply.status(204).send();});
}

async function cloneConditionConfiguration(client:PoolClient,sourceConditionId:string,targetConditionId:string):Promise<void>{
  await client.query(`INSERT INTO simulator_configurations(condition_id,simulator_type,configuration)
    SELECT $2,simulator_type,configuration FROM simulator_configurations WHERE condition_id=$1`,[sourceConditionId,targetConditionId]);

  const sourceDevices=await client.query<{id:string;device_id:string;enabled:boolean;configuration:Record<string,unknown>}>(
    "SELECT id,device_id,enabled,configuration FROM condition_devices WHERE condition_id=$1",[sourceConditionId]);
  for(const source of sourceDevices.rows){
    const inserted=await client.query<{id:string}>(`INSERT INTO condition_devices(condition_id,device_id,enabled,configuration)
      VALUES($1,$2,$3,$4::jsonb) RETURNING id`,[targetConditionId,source.device_id,source.enabled,JSON.stringify(source.configuration)]);
    await client.query(`INSERT INTO condition_sensor_configurations(condition_device_id,device_id,sensor_id,enabled,configuration)
      SELECT $2,device_id,sensor_id,enabled,configuration FROM condition_sensor_configurations WHERE condition_device_id=$1`,[source.id,inserted.rows[0]!.id]);
  }

  const sourceLayouts=await client.query<{id:string;name:string;type:string;target_display:string|null;layout_config:Record<string,unknown>}>(
    "SELECT id,name,type,target_display,layout_config FROM layouts WHERE condition_id=$1 ORDER BY created_at",[sourceConditionId]);
  for(const source of sourceLayouts.rows){
    const inserted=await client.query<{id:string}>(`INSERT INTO layouts(condition_id,name,type,target_display,layout_config)
      VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id`,[targetConditionId,source.name,source.type,source.target_display,JSON.stringify(source.layout_config)]);
    await client.query(`INSERT INTO widget_instances(layout_id,widget_id,window_mode,target_display,"order",x,y,width,height,enabled,configuration,bindings_config,style_overrides)
      SELECT $2,widget_id,window_mode,target_display,"order",x,y,width,height,enabled,configuration,bindings_config,style_overrides
      FROM widget_instances WHERE layout_id=$1`,[source.id,inserted.rows[0]!.id]);
  }
}
