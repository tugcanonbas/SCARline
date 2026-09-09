import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import type { MessageEnvelope } from "@scarline/contracts";

import type { AuthenticatedPrincipal } from "../src/auth/service.js";
import { RealtimeHub } from "../src/realtime/hub.js";

const studyId = "550e8400-e29b-41d4-a716-446655440001";
const sessionId = "550e8400-e29b-41d4-a716-446655440002";

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(value?: unknown) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  on(event: string, listener: (value?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emitMessage(value: Record<string, unknown>): void {
    const data = { toString: () => JSON.stringify(value) };
    for (const listener of this.listeners.get("message") ?? []) listener(data);
  }
}

const logger = {
  warn: () => undefined,
} as unknown as FastifyBaseLogger;

const principal: AuthenticatedPrincipal = {
  id: "550e8400-e29b-41d4-a716-446655440003",
  username: "admin",
  displayName: "Administrator",
  roles: ["admin"],
  authSessionId: "550e8400-e29b-41d4-a716-446655440004",
  passwordResetRequired: false,
};

function event(routingKey: string, payload: Record<string, unknown>): MessageEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440005",
    timestamp: "2026-09-01T10:00:00.000Z",
    routingKey,
    producer: "sim-bridge",
    payload,
    metadata: {
      studyId,
      sessionId,
      correlationId: null,
      source: { component: "sim-bridge", instanceId: "mock-primary" },
    },
  };
}

test("routes mock simulator telemetry to the session telemetry subscription", async () => {
  const hub = new RealtimeHub({} as Pool, logger);
  const socket = new FakeSocket();
  hub.attachUser(socket, principal);
  socket.emitMessage({
    type: "subscription.subscribe",
    requestId: "550e8400-e29b-41d4-a716-446655440006",
    channels: ["session.telemetry", "session.events"],
    filters: { studyId },
  });

  await hub.broadcastEvent(event(
    `events.${studyId}.${sessionId}.driving.vehicle.telemetry`,
    { modality: "driving", speed: 27, throttle: 0.4, steer: 0.1, brake: 0 },
  ));

  const messages = socket.sent.map((value) => JSON.parse(value) as Record<string, unknown>);
  const delivery = messages.find((message) => message.type === "data");
  assert.equal(delivery?.channel, "session.telemetry");
  assert.deepEqual((delivery?.data as MessageEnvelope).payload, {
    modality: "driving",
    speed: 27,
    throttle: 0.4,
    steer: 0.1,
    brake: 0,
  });
});

test("keeps non-telemetry simulator events on the session events subscription", async () => {
  const hub = new RealtimeHub({} as Pool, logger);
  const socket = new FakeSocket();
  hub.attachUser(socket, principal);
  socket.emitMessage({
    type: "subscription.subscribe",
    requestId: "550e8400-e29b-41d4-a716-446655440007",
    channels: ["session.telemetry", "session.events"],
    filters: { studyId },
  });

  await hub.broadcastEvent(event(
    `events.${studyId}.${sessionId}.driving.simulator.status`,
    { modality: "driving", status: "connected" },
  ));

  const messages = socket.sent.map((value) => JSON.parse(value) as Record<string, unknown>);
  const delivery = messages.find((message) => message.type === "data");
  assert.equal(delivery?.channel, "session.events");
});
