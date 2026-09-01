import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { AuthHeadersSchema, EmptyObjectSchema, success } from "./common.js";

export async function registerDashboardRoute(
  app: FastifyInstance,
  pool: Pool,
  auth: AuthService,
  realtime: RealtimeHub,
): Promise<void> {
  app.get("/api/v1/dashboard", {
    preHandler: [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator", "observer")],
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const principal = request.principal!;
    const access = `($1::boolean OR EXISTS (
      SELECT 1 FROM study_users su WHERE su.study_id=s.id AND su.user_id=$2
    ))`;
    const [summary, activeStudies, recentSessions] = await Promise.all([
      pool.query<{
        active_studies: string; total_sessions: string; total_participants: string; total_events: string;
      }>(`SELECT
          COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('configured','ready','running')) AS active_studies,
          COUNT(DISTINCT se.id) AS total_sessions,
          COUNT(DISTINCT p.id) AS total_participants,
          COUNT(DISTINCT ev.id) AS total_events
        FROM studies s
        LEFT JOIN sessions se ON se.study_id=s.id
        LEFT JOIN participants p ON p.study_id=s.id
        LEFT JOIN session_events ev ON ev.session_id=se.id
        WHERE ${access}`, [principal.roles.includes("admin"), principal.id]),
      pool.query(`SELECT s.id,s.name,s.description,s.status,s.created_at AS "createdAt",s.updated_at AS "updatedAt",
          COUNT(DISTINCT p.id)::int AS "participantCount",COUNT(DISTINCT se.id)::int AS "sessionCount"
        FROM studies s
        LEFT JOIN participants p ON p.study_id=s.id
        LEFT JOIN sessions se ON se.study_id=s.id
        WHERE ${access} AND s.status IN ('configured','ready','running')
        GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 5`, [principal.roles.includes("admin"), principal.id]),
      pool.query(`SELECT se.id,se.study_id AS "studyId",se.participant_id AS "participantId",se.name,se.status,
          se.started_at AS "startedAt",se.paused_at AS "pausedAt",se.completed_at AS "completedAt",
          se.runtime_metadata AS "runtimeMetadata",se.notes,
          EXTRACT(EPOCH FROM (COALESCE(se.completed_at,NOW())-se.started_at))::int AS "durationSeconds",
          (SELECT sc.condition_id FROM session_conditions sc WHERE sc.session_id=se.id ORDER BY sc.sequence LIMIT 1) AS "conditionId"
        FROM sessions se JOIN studies s ON s.id=se.study_id
        WHERE ${access} ORDER BY se.created_at DESC LIMIT 5`, [principal.roles.includes("admin"), principal.id]),
    ]);
    const row = summary.rows[0]!;
    return success({
      activeStudies: Number(row.active_studies),
      totalSessions: Number(row.total_sessions),
      totalParticipants: Number(row.total_participants),
      totalEvents: Number(row.total_events),
      recentSessions: recentSessions.rows,
      activeStudyItems: activeStudies.rows,
      componentHealth: realtime.componentStatus.map((component) => ({
        ...component,
        componentId: component.instanceId ?? component.component,
        componentName: component.component,
        checkedAt: component.updatedAt,
        message: component.available ? "Available" : "Not currently available",
      })),
    });
  });
}
