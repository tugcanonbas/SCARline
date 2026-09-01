import type { FastifyBaseLogger } from "fastify";
import { Pool } from "pg";

import type { CoreApiConfig } from "../config.js";

export function createDatabasePool(
  config: CoreApiConfig,
  logger: FastifyBaseLogger,
): Pool {
  const database = config.project.database;
  const pool = new Pool({
    host: database.host,
    port: database.port,
    database: database.name,
    user: database.user,
    password: config.secrets.POSTGRES_PASSWORD,
    application_name: "scarline-core-api",
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });

  pool.on("error", (error) => {
    logger.error({ err: error }, "unexpected PostgreSQL pool error");
  });
  return pool;
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
