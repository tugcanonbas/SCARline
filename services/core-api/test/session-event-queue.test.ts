import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { MessageEnvelope } from "@scarline/contracts";
import type { RabbitConnection } from "../src/infrastructure/rabbitmq.js";
import type { RealtimeHub } from "../src/realtime/hub.js";
import type { SessionOverlayService } from "../src/overlay/session-layout.js";
import { SessionLifecycleService } from "../src/sessions/service.js";
import { createEnvelope } from "../src/infrastructure/outbox.js";
import { ids } from "./fixtures/widget-interactions.js";

function event(sessionId = ids.session) {
  return createEnvelope({ studyId: ids.study, sessionId,
    routingKey: `events.${ids.study}.${sessionId}.driving.vehicle.telemetry`, payload: { speed: 24 } });
}

function service(pool: Pool, hub = {} as RealtimeHub) {
  let consume!: (message: MessageEnvelope) => Promise<void>;
  new SessionLifecycleService(pool, {
    registerCoreCommandConsumer() {},
    registerCoreEventConsumer(handler: typeof consume) { consume = handler; },
  } as RabbitConnection, { warn() {} } as unknown as FastifyBaseLogger, 30, hub, {} as SessionOverlayService);
  return (message: MessageEnvelope) => consume(message);
}

test("same-session sensor bursts wait outside the pool while another session can proceed", async () => {
  let acquired = 0;
  let active = 0;
  let releaseFirst!: () => void;
  const firstTransaction = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const pool = { async connect() {
    const index = ++acquired;
    active++;
    return {
      async query(sql: string) {
        if (sql === "BEGIN" && index === 1) await firstTransaction;
        return { rows: [], rowCount: sql.includes("message_inbox") ? 1 : 0 };
      },
      release() { active--; },
    };
  } } as unknown as Pool;
  const consume = service(pool);
  const burst = Array.from({ length: 20 }, () => consume(event()));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(acquired, 1, "one session must not occupy all ten database connections");
  await consume(event(ids.preview));
  assert.equal(acquired, 2, "independent sessions are not blocked by the first session");
  releaseFirst();
  await Promise.all(burst);
  assert.equal(acquired, 21);
  assert.equal(active, 0);
});

test("a failed event does not block later messages for the same session", async () => {
  let attempts = 0;
  const consume = service({ async connect() {
    if (++attempts === 1) throw new Error("temporary connection failure");
    return { async query() { return { rows: [], rowCount: 0 }; }, release() {} };
  } } as unknown as Pool);
  const failed = consume(event());
  const following = consume(event());
  await assert.rejects(failed, /temporary connection failure/);
  await following;
  assert.equal(attempts, 2);
});

test("committed events release their connection before renderer delivery queries run", async () => {
  let active = 0;
  let committed = false;
  let delivered = false;
  const consume = service({ async connect() {
    active++;
    return {
      async query(sql: string) {
        if (sql === "COMMIT") committed = true;
        if (sql.includes("SELECT se.*")) return { rows: [{ id: ids.session, study_id: ids.study, status: "running" }], rowCount: 1 };
        return { rows: [], rowCount: sql.includes("message_inbox") ? 1 : 0 };
      },
      release() { active--; },
    };
  } } as unknown as Pool, {
    recordWidgetEvent() { assert.equal(committed, true); assert.equal(active, 0); },
    async broadcastEvent() { assert.equal(active, 0); delivered = true; },
  } as unknown as RealtimeHub);
  await consume(event());
  assert.equal(delivered, true);
});
