import { Pool } from 'pg';
import type { CoreApiConfig } from './config.js';

export function createPool(config: CoreApiConfig): Pool {
  return new Pool({
    connectionString: config.DATABASE_URL,
    min: 2,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}
