import assert from "node:assert/strict";
import test from "node:test";

import type { OverlayRuntimeScope } from "@scarline/contracts";
import type { Pool } from "pg";

import { ApiProblem } from "../src/errors.js";
import { loadOverlayRuntimeSnapshot, requireLiveBrowserSessionScope } from "../src/overlay/runtime.js";

const scope: OverlayRuntimeScope = {
  rendererMode: "browser",
  studyId: "550e8400-e29b-41d4-a716-446655440001",
  sessionId: "550e8400-e29b-41d4-a716-446655440002",
  conditionId: "550e8400-e29b-41d4-a716-446655440003",
  layoutId: "550e8400-e29b-41d4-a716-446655440004",
  instanceId: null,
};

function pool(sessionStatus = "running", conditionStatus = "active") {
  return {
    async query(text: string) {
      if (text.includes("FROM layouts l JOIN conditions")) {
        return { rows: [{
          id: scope.layoutId,
          condition_id: scope.conditionId,
          study_id: scope.studyId,
          name: "Participant",
          type: "participant",
          target_display: "display-right",
          condition_metadata: {},
        }], rowCount: 1 };
      }
      if (text.includes("FROM widget_instances wi JOIN widgets")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("FROM sessions se") && text.includes("session_conditions")) {
        return ["active", "paused"].includes(conditionStatus)
          ? { rows: [{ session_status: sessionStatus, condition_status: conditionStatus }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected overlay runtime query: ${text}`);
    },
  } as unknown as Pool;
}

test("includes selected-host display topology in browser runtime snapshots", async () => {
  const displays = [{
    id: "display-right",
    index: 1,
    name: "Right display",
    primary: false,
    scaleFactor: 2,
    bounds: { x: 1920, y: -120, width: 2560, height: 1440 },
    workArea: { x: 1920, y: -120, width: 2560, height: 1400 },
  }];
  const snapshot = await loadOverlayRuntimeSnapshot(pool(), { ...scope, sessionId: null }, displays);
  assert.deepEqual(snapshot.displays, displays);
  assert.equal(snapshot.layout.targetDisplay, "display-right");
});

test("allows browser fallback only for the session's active condition", async () => {
  await assert.doesNotReject(() => requireLiveBrowserSessionScope(pool(), scope));
  await assert.rejects(
    () => requireLiveBrowserSessionScope(pool("ready", "pending"), scope),
    (error) => error instanceof ApiProblem && error.problemCode === "BROWSER_FALLBACK_NOT_LIVE",
  );
});
