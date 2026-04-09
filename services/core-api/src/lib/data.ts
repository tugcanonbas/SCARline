import type { Pool, QueryResultRow } from 'pg';

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
