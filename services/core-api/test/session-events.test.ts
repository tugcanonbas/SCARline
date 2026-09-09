import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import { listSessionEvents } from "../src/routes/events.js";

const event = {
  id: "42",
  messageId: null,
  studyId: "550e8400-e29b-41d4-a716-446655440001",
  studyName: "Study",
  studyStatus: "running",
  sessionId: "550e8400-e29b-41d4-a716-446655440002",
  sessionName: "Session",
  sessionConditionId: null,
  timestamp: new Date("2026-09-01T10:00:00.000Z"),
  eventType: "vehicle.telemetry",
  modality: "simulator",
  sourceType: "simulator",
  sourceId: null,
  sourceKey: "mock-primary",
  routingKey: "events.study.session.vehicle.telemetry",
  schemaVersion: "1.0",
  payload: { speed: 0 },
};

test("lists globally ordered session events with filter-wide aggregates and a stable cursor", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      if (text.includes("COUNT(DISTINCT st.id)")) {
        return { rows: [{
          active_study_count: "0",
          session_count: "7",
          event_count: "245",
          stored_payload_bytes: "8192",
        }] };
      }
      return { rows: [event, { ...event, id: "41" }] };
    },
  } as unknown as Pool;

  const result = await listSessionEvents(pool, {
    studyId: event.studyId,
    eventType: "vehicle.telemetry",
    limit: 1,
  }, false, "550e8400-e29b-41d4-a716-446655440003");

  assert.deepEqual(result.aggregates, {
    activeStudyCount: 0,
    sessionCount: 7,
    eventCount: 245,
    storedPayloadBytes: 8192,
  });
  assert.equal(result.items.length, 1);
  assert.ok(result.nextCursor);
  assert.match(calls[0]!.text, /ORDER BY ev\."timestamp" DESC,ev\.id DESC/);
  assert.match(calls[0]!.text, /study_users/);
  assert.equal(calls[0]!.values[2], event.studyId);
  assert.equal(calls[0]!.values[4], "vehicle.telemetry");
  assert.equal(calls[1]!.values.length, 6);

  calls.length = 0;
  await listSessionEvents(pool, { limit: 1, cursor: result.nextCursor! }, true, event.studyId);
  assert.equal(calls[0]!.values[6], event.timestamp.toISOString());
  assert.equal(calls[0]!.values[7], event.id);
});
