import type { Pool, QueryResultRow } from 'pg';

interface ActivityLogInput {
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  payload?: Record<string, unknown>;
}

export async function queryOne<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  values: unknown[] = []
): Promise<T | null> {
  const result = await pool.query<T>(sql, values);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(sql, values);
  return result.rows;
}

export async function getSystemConfiguration(pool: Pool): Promise<Record<string, unknown>> {
  const result = await pool.query<{ key: string; value: unknown }>('SELECT key, value FROM system_configuration');
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

export async function upsertSystemConfiguration(
  pool: Pool,
  entries: Record<string, unknown>
): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    await pool.query(
      `INSERT INTO system_configuration (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  }
}

export async function logActivity(pool: Pool, input: ActivityLogInput): Promise<void> {
  await pool.query(
    `INSERT INTO activity_log (actor_user_id, entity_type, entity_id, action, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.actorUserId ?? null,
      input.entityType,
      input.entityId ?? null,
      input.action,
      JSON.stringify(input.payload ?? {})
    ]
  );
}

export async function refreshSessionSummary(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `INSERT INTO session_summaries (
       session_id,
       study_id,
       event_count,
       modality_count,
       first_event_at,
       last_event_at,
       summary,
       updated_at
     )
     SELECT sessions.id,
            sessions.study_id,
            COUNT(session_events.id)::int,
            COUNT(DISTINCT session_events.modality)::int,
            MIN(session_events.timestamp),
            MAX(session_events.timestamp),
            jsonb_build_object(
              'status', sessions.status,
              'durationSeconds', sessions.duration_seconds,
              'startedAt', sessions.started_at,
              'completedAt', sessions.completed_at
            ),
            NOW()
     FROM sessions
     LEFT JOIN session_events ON session_events.session_id = sessions.id
     WHERE sessions.id = $1
     GROUP BY sessions.id
     ON CONFLICT (session_id) DO UPDATE SET
       study_id = EXCLUDED.study_id,
       event_count = EXCLUDED.event_count,
       modality_count = EXCLUDED.modality_count,
       first_event_at = EXCLUDED.first_event_at,
       last_event_at = EXCLUDED.last_event_at,
       summary = EXCLUDED.summary,
       updated_at = NOW()`,
    [sessionId]
  );
}
