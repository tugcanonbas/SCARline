import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";

import {
  MessageEnvelopeSchema,
  RABBITMQ_EXCHANGES,
  type MessageEnvelope,
} from "@scarline/contracts";

import type { ManagedCoreApiService } from "../runtime.js";
import type { RabbitConnection } from "./rabbitmq.js";

const POLL_MILLISECONDS = 200;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;

export function createEnvelope(input: {
  routingKey: string;
  payload: Record<string, unknown>;
  studyId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
}): MessageEnvelope {
  return MessageEnvelopeSchema.parse({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    routingKey: input.routingKey,
    producer: "core-api",
    payload: input.payload,
    metadata: {
      studyId: input.studyId ?? null,
      sessionId: input.sessionId ?? null,
      correlationId: input.correlationId ?? null,
      source: { component: "core-api", instanceId: null },
    },
  });
}

export async function enqueueMessage(
  database: Pool | PoolClient,
  envelope: MessageEnvelope,
): Promise<void> {
  const exchange = envelope.routingKey.startsWith("commands.")
    ? RABBITMQ_EXCHANGES.commands
    : RABBITMQ_EXCHANGES.events;
  await database.query(
    `INSERT INTO event_outbox(id,exchange,routing_key,message)
     VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING`,
    [envelope.id, exchange, envelope.routingKey, JSON.stringify(envelope)],
  );
}

export async function claimInboxMessage(
  client: PoolClient,
  messageId: string,
  consumer: string,
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO message_inbox(message_id,consumer) VALUES($1,$2)
     ON CONFLICT(message_id) DO NOTHING`,
    [messageId, consumer],
  );
  return result.rowCount === 1;
}

export class OutboxPublisher implements ManagedCoreApiService {
  readonly #pool: Pool;
  readonly #rabbit: RabbitConnection;
  readonly #logger: FastifyBaseLogger;
  #timer: NodeJS.Timeout | undefined;
  #running = false;

  constructor(pool: Pool, rabbit: RabbitConnection, logger: FastifyBaseLogger) {
    this.#pool = pool;
    this.#rabbit = rabbit;
    this.#logger = logger;
  }

  async start(): Promise<void> {
    await this.#pool.query(
      `UPDATE event_outbox SET status='pending',claimed_at=NULL
       WHERE status='publishing' AND claimed_at < NOW() - INTERVAL '1 minute'`,
    );
    this.#schedule(0);
  }

  stop(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #schedule(delay: number): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#poll();
    }, delay);
    this.#timer.unref();
  }

  async #poll(): Promise<void> {
    if (this.#running) return this.#schedule(POLL_MILLISECONDS);
    this.#running = true;
    try {
      if (!this.#rabbit.isReady) return;
      const claimed = await this.#pool.query<{ id: string; message: MessageEnvelope }>(
        `UPDATE event_outbox o SET status='publishing',claimed_at=NOW(),attempts=attempts+1
         FROM (
           SELECT id FROM event_outbox
           WHERE status='pending' AND available_at<=NOW()
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
         ) q WHERE o.id=q.id RETURNING o.id,o.message`,
        [BATCH_SIZE],
      );
      for (const row of claimed.rows) await this.#publish(row.id, row.message);
    } catch (error) {
      this.#logger.error({ err: error }, "Outbox publisher poll failed");
    } finally {
      this.#running = false;
      this.#schedule(POLL_MILLISECONDS);
    }
  }

  async #publish(id: string, value: MessageEnvelope): Promise<void> {
    try {
      const envelope = MessageEnvelopeSchema.parse(value);
      await this.#rabbit.publish(envelope);
      await this.#pool.query(
        "UPDATE event_outbox SET status='published',published_at=NOW(),claimed_at=NULL,last_error=NULL WHERE id=$1",
        [id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#pool.query(
        `UPDATE event_outbox SET
           status=CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
           available_at=NOW() + (LEAST(attempts,6) * INTERVAL '1 second'),
           claimed_at=NULL,last_error=$3
         WHERE id=$1`,
        [id, MAX_ATTEMPTS, message.slice(0, 2_000)],
      );
    }
  }
}
