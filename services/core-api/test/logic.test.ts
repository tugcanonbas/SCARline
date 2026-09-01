import assert from "node:assert/strict";
import test from "node:test";

import { MessageEnvelopeSchema } from "@scarline/contracts";

import { createEnvelope } from "../src/infrastructure/outbox.js";
import { evaluateTriggerExpression } from "../src/triggers/evaluator.js";
import { requireAnyRole } from "../src/auth/guards.js";
import { ApiProblem } from "../src/errors.js";
import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  requireEditableStudy,
  transitionRequiresNoNonterminalSessions,
} from "../src/routes/studies.js";

test("creates valid command and event envelopes with session terminology", () => {
  const sessionId = "440bd5d9-c6a0-41a9-99b1-03ccca42df3d";
  const studyId = "50523e28-b25a-49e3-bfbb-c558582c93f7";
  const command = createEnvelope({
    routingKey: "commands.core-api.session-lifecycle",
    studyId,
    sessionId,
    payload: { action: "ready" },
  });
  assert.equal(MessageEnvelopeSchema.safeParse(command).success, true);
  assert.equal(command.metadata.sessionId, sessionId);
  assert.equal("runId" in command.metadata, false);
});

test("evaluates nested safe trigger expressions", () => {
  const expression = {
    operator: "and",
    expressions: [
      { operator: "gte", path: "payload.speed", value: 30 },
      {
        operator: "or",
        expressions: [
          { operator: "eq", path: "payload.mode", value: "manual" },
          { operator: "in", path: "payload.mode", value: ["assisted", "autonomous"] },
        ],
      },
      { operator: "not", expression: { operator: "eq", path: "payload.emergency", value: true } },
    ],
  };
  assert.equal(evaluateTriggerExpression(expression, { payload: { speed: 35, mode: "assisted", emergency: false } }), true);
  assert.equal(evaluateTriggerExpression(expression, { payload: { speed: 20, mode: "assisted", emergency: false } }), false);
});

test("does not traverse prototype-related trigger paths", () => {
  assert.equal(
    evaluateTriggerExpression(
      { operator: "eq", path: "payload.__proto__.polluted", value: true },
      { payload: {} },
    ),
    false,
  );
});

test("compares trigger values from two safe paths", () => {
  const expression = {
    operator: "gt",
    path: "payload.vehicle.speed",
    valuePath: "payload.vehicle.speedLimit",
  };
  assert.equal(evaluateTriggerExpression(expression, { payload: { vehicle: { speed: 51, speedLimit: 50 } } }), true);
  assert.equal(evaluateTriggerExpression(expression, { payload: { vehicle: { speed: 49, speedLimit: 50 } } }), false);
});

test("treats Observer as read-only in role guards", async () => {
  const request = {
    principal: {
      id: "550e8400-e29b-41d4-a716-446655440090",
      authSessionId: "550e8400-e29b-41d4-a716-446655440091",
      username: "observer",
      displayName: "Observer",
      passwordResetRequired: false,
      roles: ["observer"],
    },
  } as unknown as FastifyRequest;
  await requireAnyRole("admin", "researcher", "operator", "observer")(request);
  await assert.rejects(
    requireAnyRole("admin", "researcher", "operator")(request),
    (error: unknown) => error instanceof ApiProblem && error.problemCode === "FORBIDDEN",
  );
});

test("keeps configuration editable while sessions are only queued", async () => {
  const queries: string[] = [];
  const queuedOnlyPool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("SELECT * FROM studies")) {
        return { rows: [{ id: "study-id", status: "draft" }] };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  await requireEditableStudy(queuedOnlyPool, "study-id");
  assert.doesNotMatch(queries[1] ?? "", /'created'/);

  const preparedSessionPool = {
    async query(sql: string) {
      if (sql.includes("SELECT * FROM studies")) {
        return { rows: [{ id: "study-id", status: "configured" }] };
      }
      return { rows: [{}], rowCount: 1 };
    },
  } as unknown as Pool;
  await assert.rejects(
    requireEditableStudy(preparedSessionPool, "study-id"),
    (error: unknown) => error instanceof ApiProblem && error.problemCode === "ACTIVE_SESSION_EXISTS",
  );
});

test("allows a draft study with queued sessions to be marked configured", () => {
  assert.equal(transitionRequiresNoNonterminalSessions("draft", "configured"), false);
  assert.equal(transitionRequiresNoNonterminalSessions("ready", "configured"), true);
  assert.equal(transitionRequiresNoNonterminalSessions("running", "completed"), true);
});
