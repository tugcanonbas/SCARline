import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";

import { hashPassword } from "../security/password.js";

const RETRY_DELAY_MILLISECONDS = 5_000;

export class AdminBootstrapService {
  readonly #pool: Pool;
  readonly #username: string;
  readonly #password: string;
  readonly #logger: FastifyBaseLogger;
  #retryTimer: NodeJS.Timeout | undefined;
  #stopped = true;
  #complete = false;
  #lastError: string | null = null;

  constructor(
    pool: Pool,
    username: string,
    password: string,
    logger: FastifyBaseLogger,
  ) {
    this.#pool = pool;
    this.#username = username;
    this.#password = password;
    this.#logger = logger;
  }

  get isComplete(): boolean {
    return this.#complete;
  }

  get lastError(): string | null {
    return this.#lastError;
  }

  start(): void {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    void this.#attempt();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  async #attempt(): Promise<void> {
    try {
      const created = await ensureInitialAdministrator(
        this.#pool,
        this.#username,
        this.#password,
      );
      this.#complete = true;
      this.#lastError = null;
      this.#logger.info(
        created
          ? { username: this.#username }
          : { bootstrap: "already-complete" },
        created
          ? "initial administrator created; password change required"
          : "administrator bootstrap already complete",
      );
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : "bootstrap failed";
      this.#logger.warn({ err: error }, "administrator bootstrap is pending");
      this.#scheduleRetry();
    }
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#complete || this.#retryTimer !== undefined) {
      return;
    }
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#attempt();
    }, RETRY_DELAY_MILLISECONDS);
    this.#retryTimer.unref();
  }
}

export async function ensureInitialAdministrator(
  pool: Pool,
  username: string,
  password: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('scarline.bootstrap.admin'))",
    );

    const existingUsers = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM users) AS exists",
    );
    if (existingUsers.rows[0]?.exists) {
      await markBootstrapComplete(client);
      await client.query("COMMIT");
      return false;
    }

    const passwordHash = await hashPassword(password);
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (
         username,
         password_hash,
         display_name,
         password_reset_required
       ) VALUES ($1, $2, 'Administrator', TRUE)
       RETURNING id`,
      [username, passwordHash],
    );
    const userId = user.rows[0]?.id;
    if (userId === undefined) {
      throw new Error("administrator insert did not return a user id");
    }

    const roleAssignment = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id
       FROM roles
       WHERE name = 'admin'
       ON CONFLICT DO NOTHING`,
      [userId],
    );
    if (roleAssignment.rowCount !== 1) {
      throw new Error("admin role is missing from the database seed");
    }

    await markBootstrapComplete(client);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markBootstrapComplete(
  client: PoolClient,
): Promise<void> {
  await client.query(
    "DELETE FROM system_configuration WHERE key = 'onboarding_completed'",
  );
  await client.query(
    `INSERT INTO system_configuration (key, value)
     VALUES ('bootstrap_completed', 'true'::jsonb)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
  );
}
