import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import type { RealtimeHub } from "../src/realtime/hub.js";
import { loadStudyReadiness } from "../src/studies/readiness.js";

const studyId = "550e8400-e29b-41d4-a716-446655440001";
const conditionId = "550e8400-e29b-41d4-a716-446655440002";
const layoutId = "550e8400-e29b-41d4-a716-446655440003";
const instanceId = "550e8400-e29b-41d4-a716-446655440004";

function database(input: { participantCount: number; configured: boolean; hasLayout: boolean }) {
  return {
    async query(text: string) {
      if (text.includes("SELECT status FROM studies")) return { rows: [{ status: "configured" }], rowCount: 1 };
      if (text.includes("FROM participants")) return { rows: [{ count: input.participantCount }], rowCount: 1 };
      if (text.includes("FROM sessions")) return { rows: [{ count: 0 }], rowCount: 1 };
      if (text.includes("LEFT JOIN simulator_configurations")) {
        return { rows: [{ id: conditionId, name: "Baseline", simulator_type: input.configured ? "carla" : null }], rowCount: 1 };
      }
      if (text.includes("JOIN condition_devices")) return { rows: [], rowCount: 0 };
      if (text.includes("LEFT JOIN layouts")) {
        return {
          rows: [{
            condition_id: conditionId,
            condition_name: "Baseline",
            layout_id: input.hasLayout ? layoutId : null,
            instance_id: input.hasLayout ? instanceId : null,
            target_display: input.hasLayout ? "display-1" : null,
            window_mode: input.hasLayout ? "transparent_electron" : null,
            widget_active: input.hasLayout ? true : null,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected readiness query: ${text}`);
    },
  } as unknown as Pool;
}

function realtime(connected: boolean) {
  return {
    overlayStatus: {
      selectedHostId: connected ? "lab-host" : null,
      selectionRequired: false,
      hosts: connected ? [{ hostId: "lab-host", connected: true, ready: true, displays: [{ id: "display-1", primary: true }] }] : [],
    },
    missingSimulatorCapabilities: () => [],
    isComponentAvailable: () => false,
    hasRendererMode: () => false,
  } as unknown as RealtimeHub;
}

test("reports a configured study ready when every blocking dependency is available", async () => {
  const result = await loadStudyReadiness(
    database({ participantCount: 1, configured: true, hasLayout: true }),
    realtime(true),
    studyId,
  );
  assert.equal(result.ready, true);
  assert.equal(result.checks.length, 9);
  assert.equal(result.checks.find(({ key }) => key === "study_status")?.status, "not_ready");
  assert.equal(result.checks.find(({ key }) => key === "study_status")?.blocking, false);
});

test("returns correction routes and blocking codes for missing readiness steps", async () => {
  const result = await loadStudyReadiness(
    database({ participantCount: 0, configured: false, hasLayout: false }),
    realtime(false),
    studyId,
  );
  assert.equal(result.ready, false);
  assert.equal(result.checks.find(({ key }) => key === "participants")?.blockingCode, "PARTICIPANT_REQUIRED");
  assert.equal(result.checks.find(({ key }) => key === "simulator")?.blockingCode, "SIMULATOR_CONFIGURATION_REQUIRED");
  assert.equal(result.checks.find(({ key }) => key === "participant_view")?.correctionRoute, `/user-studies/${studyId}/participant-view`);
});
