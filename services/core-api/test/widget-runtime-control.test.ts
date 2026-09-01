import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import { ApiProblem } from "../src/errors.js";
import { applyManualWidgetRuntimeCommand } from "../src/overlay/runtime-control.js";
import {
  configuredWidgetRuntime,
  findStoredWidgetRuntimeOverride,
  readStoredWidgetRuntimeOverrides,
} from "../src/overlay/widget-runtime-state.js";

const sessionId = "550e8400-e29b-41d4-a716-446655440001";
const studyId = "550e8400-e29b-41d4-a716-446655440002";
const sessionConditionId = "550e8400-e29b-41d4-a716-446655440003";
const conditionId = "550e8400-e29b-41d4-a716-446655440004";
const sourceInstanceId = "550e8400-e29b-41d4-a716-446655440005";
const targetInstanceId = "550e8400-e29b-41d4-a716-446655440006";
const widgetId = "550e8400-e29b-41d4-a716-446655440007";
const actorUserId = "550e8400-e29b-41d4-a716-446655440008";

const metadata = {
  id: "speedometer",
  name: "Speedometer",
  description: "Vehicle speed",
  version: "1.0.0",
  category: "driving",
  entry: "index.html",
  bindings: [{ key: "vehicle.speed", type: "number", default: 0 }],
  triggers: [],
  ui: { minWidth: 100, minHeight: 80, preferredWidth: 200, preferredHeight: 160 },
};

class RuntimeControlDatabase {
  sessionStatus = "running";
  runtimeMetadata: Record<string, unknown> = {};
  committed = false;
  rolledBack = false;
  outboxMessage: Record<string, unknown> | undefined;

  readonly pool = {
    connect: async () => ({
      query: (text: string, values: unknown[] = []) => this.query(text, values),
      release: () => undefined,
    }),
  } as unknown as Pool;

  async query(text: string, values: unknown[] = []) {
    if (text === "BEGIN") return { rows: [], rowCount: 0 };
    if (text === "COMMIT") {
      this.committed = true;
      return { rows: [], rowCount: 0 };
    }
    if (text === "ROLLBACK") {
      this.rolledBack = true;
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("FROM sessions WHERE id=$1 FOR UPDATE")) {
      return { rows: [{ study_id: studyId, status: this.sessionStatus }], rowCount: 1 };
    }
    if (text.includes("FROM session_conditions") && text.includes("FOR UPDATE")) {
      return {
        rows: [{ id: sessionConditionId, condition_id: conditionId, runtime_metadata: this.runtimeMetadata }],
        rowCount: 1,
      };
    }
    if (text.includes("WHERE wi.id=$1") && !text.includes("l.condition_id=$1")) {
      return {
        rows: [{ widget_key: "speedometer", layout_type: "participant", layout_name: "Participant", order: 0, study_id: studyId }],
        rowCount: 1,
      };
    }
    if (text.includes("WHERE l.condition_id=$1")) {
      return {
        rows: [{
          instance_id: targetInstanceId,
          widget_id: widgetId,
          widget_key: "speedometer",
          layout_type: "participant",
          layout_name: "Participant",
          order: 0,
          condition_metadata: {},
          metadata,
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith("UPDATE session_conditions SET runtime_metadata")) {
      this.runtimeMetadata = JSON.parse(String(values[1]));
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO event_outbox")) {
      this.outboxMessage = JSON.parse(String(values[3]));
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test("maps the existing manual trigger to a visible, audited active-condition update", async () => {
  const database = new RuntimeControlDatabase();
  const update = await applyManualWidgetRuntimeCommand(database.pool, sessionId, {
    instanceId: sourceInstanceId,
    action: "trigger",
    bindingValues: { "vehicle.speed": 42 },
  }, actorUserId);

  assert.equal(database.committed, true);
  assert.equal(update.action, "show");
  assert.equal(update.state, "visible");
  assert.deepEqual(update.instanceIds, [targetInstanceId, sourceInstanceId]);
  assert.deepEqual(update.bindingValues, { "vehicle.speed": 42 });
  assert.equal(database.outboxMessage?.routingKey, `events.${studyId}.${sessionId}.trigger.widget-manual`);
  const stored = readStoredWidgetRuntimeOverrides(database.runtimeMetadata)[targetInstanceId];
  assert.equal(stored?.state, "visible");
  assert.deepEqual(stored?.bindingValues, { "vehicle.speed": 42 });
});

test("rejects undeclared binding updates and commands outside a live session", async () => {
  const invalidBinding = new RuntimeControlDatabase();
  await assert.rejects(
    () => applyManualWidgetRuntimeCommand(invalidBinding.pool, sessionId, {
      instanceId: sourceInstanceId,
      action: "update",
      bindingValues: { "vehicle.unknown": 42 },
    }, actorUserId),
    (error) => error instanceof ApiProblem && error.problemCode === "UNDECLARED_WIDGET_BINDING",
  );
  assert.equal(invalidBinding.rolledBack, true);

  const completed = new RuntimeControlDatabase();
  completed.sessionStatus = "completed";
  await assert.rejects(
    () => applyManualWidgetRuntimeCommand(completed.pool, sessionId, {
      instanceId: sourceInstanceId,
      action: "show",
      bindingValues: {},
    }, actorUserId),
    (error) => error instanceof ApiProblem && error.problemCode === "SESSION_NOT_LIVE",
  );
});

test("restores persisted runtime state across equivalent condition layouts", () => {
  const stored = readStoredWidgetRuntimeOverrides({
    widgetRuntime: {
      [targetInstanceId]: {
        state: "highlighted",
        bindingValues: { "vehicle.speed": 51 },
        widgetKey: "speedometer",
        layoutType: "participant",
        layoutName: "Participant",
        order: 0,
      },
    },
  });
  const override = findStoredWidgetRuntimeOverride(stored, {
    instanceId: sourceInstanceId,
    widgetKey: "speedometer",
    layoutType: "participant",
    layoutName: "Participant",
    order: 0,
  });
  assert.equal(override?.state, "highlighted");
  assert.deepEqual(override?.bindingValues, { "vehicle.speed": 51 });

  const configured = configuredWidgetRuntime(metadata, {
    widgetOverrides: { hidden_widgets: ["speedometer"] },
  }, sourceInstanceId, "speedometer");
  assert.equal(configured.state, "hidden");
  assert.deepEqual(configured.bindings, { "vehicle.speed": 0 });
});
