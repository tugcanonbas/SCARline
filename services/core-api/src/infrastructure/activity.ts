import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export async function recordActivity(
  database: Queryable,
  input: {
    readonly actorUserId: string | null;
    readonly studyId?: string | null;
    readonly entityType: string;
    readonly entityId?: string | null;
    readonly action: string;
    readonly payload?: Record<string, unknown>;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO activity_log
       (actor_user_id, study_id, entity_type, entity_id, action, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.actorUserId,
      input.studyId ?? null,
      input.entityType,
      input.entityId ?? null,
      input.action,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}
