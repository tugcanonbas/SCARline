import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterRegisterMessage } from "@scarline/contracts";
import type { WebSocket } from "ws";

import { AdapterRegistry } from "../src/registry.js";

const base: Omit<AdapterRegisterMessage, "id" | "adapterId" | "priority"> = {
  version: 1,
  timestamp: "2026-08-24T12:00:00.000Z",
  type: "adapter.register",
  name: "Mock",
  simulatorType: "mock",
  simulatorVersion: "1.0.0",
  capabilities: ["vehicle.telemetry"],
  activeSessionId: null,
};

function socket(): WebSocket {
  return { close() {} } as unknown as WebSocket;
}

test("selects available adapters by priority and keeps one session binding", () => {
  const registry = new AdapterRegistry();
  const lowPriority = registry.register({
    ...base,
    id: "550e8400-e29b-41d4-a716-446655440011",
    adapterId: "mock-secondary",
    priority: 200,
  }, socket());
  const preferred = registry.register({
    ...base,
    id: "550e8400-e29b-41d4-a716-446655440012",
    adapterId: "mock-primary",
    priority: 100,
  }, socket());
  assert.equal(registry.available("mock")?.assignedId, preferred.assignedId);
  registry.bind(preferred.assignedId, {
    studyId: "550e8400-e29b-41d4-a716-446655440013",
    sessionId: "550e8400-e29b-41d4-a716-446655440014",
    sessionConditionId: "550e8400-e29b-41d4-a716-446655440015",
    sequence: 0,
    simulatorType: "mock",
    configuration: {},
  });
  assert.equal(registry.available("mock")?.assignedId, lowPriority.assignedId);
  assert.equal(registry.forSession("550e8400-e29b-41d4-a716-446655440014")?.assignedId, preferred.assignedId);
});
