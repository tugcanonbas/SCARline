import assert from "node:assert/strict";
import test from "node:test";

import type { SessionParticipantWindowSave } from "@scarline/contracts";
import type { Pool } from "pg";

import { ApiProblem } from "../src/errors.js";
import { saveActiveSessionWindow } from "../src/layouts/session-window.js";

const sessionId = "550e8400-e29b-41d4-a716-446655440001";
const studyId = "550e8400-e29b-41d4-a716-446655440002";
const conditionId = "550e8400-e29b-41d4-a716-446655440003";
const layoutId = "550e8400-e29b-41d4-a716-446655440004";
const instanceId = "550e8400-e29b-41d4-a716-446655440005";
const actorUserId = "550e8400-e29b-41d4-a716-446655440006";

const input: SessionParticipantWindowSave = {
  expectedRevision: 4,
  windowMode: "transparent_electron",
  inputMode: "click_through",
  targetDisplay: "display-2",
  order: 1,
  x: 40,
  y: 50,
  width: 320,
  height: 180,
  enabled: true,
  configuration: { label: "Speed" },
  bindingsConfig: { value: "vehicle.speed" },
  styleOverrides: {},
};

function database() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("SELECT study_id,status FROM sessions")) {
        return { rows: [{ study_id: studyId, status: "running" }], rowCount: 1 };
      }
      if (text.includes("SELECT condition_id FROM session_conditions")) {
        return { rows: [{ condition_id: conditionId }], rowCount: 1 };
      }
      if (text.includes("SELECT wi.layout_id")) {
        return {
          rows: [{
            layout_id: layoutId,
            revision: 4,
            window_mode: "transparent_electron",
            input_mode: "click_through",
            target_display: "display-2",
            order: 1,
            enabled: true,
            configuration: { label: "Speed" },
            bindings_config: { value: "vehicle.speed" },
            style_overrides: {},
          }],
          rowCount: 1,
        };
      }
      if (text.includes("UPDATE layouts SET revision")) {
        return { rows: [{ revision: 5 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    pool: { async connect() { return client; } } as unknown as Pool,
    queries,
  };
}

test("persists the complete active-condition window and advances its layout revision", async () => {
  const { pool, queries } = database();
  const result = await saveActiveSessionWindow(pool, sessionId, instanceId, input, actorUserId);

  assert.equal(result.conditionId, conditionId);
  assert.equal(result.layoutId, layoutId);
  assert.equal(result.revision, 5);
  const update = queries.find(({ text }) => text.includes("UPDATE widget_instances SET"));
  assert.deepEqual(update?.values.slice(2), [
    "transparent_electron", "click_through", "display-2", 1,
    40, 50, 320, 180, true,
    JSON.stringify({ label: "Speed" }),
    JSON.stringify({ value: "vehicle.speed" }),
    JSON.stringify({}),
  ]);
  assert.equal(queries.some(({ text }) => text === "COMMIT"), true);
});

test("rejects attempts to change design-only fields through Active Study", async () => {
  const { pool, queries } = database();
  await assert.rejects(
    () => saveActiveSessionWindow(pool, sessionId, instanceId, {
      ...input,
      targetDisplay: "another-display",
    }, actorUserId),
    (error) => error instanceof ApiProblem && error.problemCode === "WINDOW_CONFIGURATION_CHANGED",
  );
  assert.equal(queries.some(({ text }) => text.includes("UPDATE widget_instances SET")), false);
  assert.equal(queries.some(({ text }) => text === "ROLLBACK"), true);
});
