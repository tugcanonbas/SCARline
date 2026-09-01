import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";

import { loadSimBridgeConfig } from "../src/config.js";
import { SimBridgeController } from "../src/controller.js";
import { CommandJournal } from "../src/journal.js";
import type { SimBridgeRabbitConnection } from "../src/rabbitmq.js";

class FakeSocket extends EventEmitter {
  readonly sent: string[] = [];
  closed = false;

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.closed = true;
  }
}

test("serializes registration before an immediately following heartbeat", async () => {
  const config = await loadSimBridgeConfig(new URL("../../../", import.meta.url).pathname, {
    RABBITMQ_DEFAULT_PASS: "rabbit-password",
    SIM_BRIDGE_ADAPTER_SECRET: "s".repeat(32),
  });
  const rabbit = {
    isReady: true,
    async publish() {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    async close() {},
  } as unknown as SimBridgeRabbitConnection;
  const journal = {
    isLoaded: true,
    getBinding() { return undefined; },
    recoverBinding() { return undefined; },
    async clearBinding() {},
  } as unknown as CommandJournal;
  const logger = {
    info() {},
    warn() {},
    error() {},
  } as unknown as FastifyBaseLogger;
  const controller = new SimBridgeController(config, logger, rabbit, journal);
  const socket = new FakeSocket();
  controller.attachSocket(socket as unknown as WebSocket);
  socket.emit("message", Buffer.from(JSON.stringify({
    version: 1,
    id: "550e8400-e29b-41d4-a716-446655440031",
    timestamp: "2026-08-24T12:00:00.000Z",
    type: "adapter.register",
    adapterId: "mock-race-test",
    name: "Mock Race Test",
    simulatorType: "mock",
    simulatorVersion: "1.0.0",
    capabilities: ["vehicle.telemetry"],
    priority: 100,
    activeSessionId: null,
  })));
  socket.emit("message", Buffer.from(JSON.stringify({
    version: 1,
    id: "550e8400-e29b-41d4-a716-446655440032",
    timestamp: "2026-08-24T12:00:00.001Z",
    type: "adapter.heartbeat",
    status: "ready",
    activeSessionId: null,
  })));
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(socket.closed, false);
  assert.equal(JSON.parse(socket.sent[0] ?? "{}").type, "adapter.registered");
  assert.equal(controller.adapters[0]?.status, "ready");
});

test("forwards transient IO control only to the bound CARLA adapter", async () => {
  const config = await loadSimBridgeConfig(new URL("../../../", import.meta.url).pathname, {
    RABBITMQ_DEFAULT_PASS: "rabbit-password",
    SIM_BRIDGE_ADAPTER_SECRET: "s".repeat(32),
  });
  const published: unknown[] = [];
  const rabbit = {
    isReady: true,
    async publish(message: unknown) { published.push(message); },
    async close() {},
  } as unknown as SimBridgeRabbitConnection;
  const directory = await mkdtemp(path.join(os.tmpdir(), "scarline-sim-control-"));
  const journal = new CommandJournal(path.join(directory, "journal.json"));
  await journal.load();
  const logger = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;
  const controller = new SimBridgeController(config, logger, rabbit, journal);
  const socket = new FakeSocket();
  controller.attachSocket(socket as unknown as WebSocket);
  const studyId = "550e8400-e29b-41d4-a716-446655440000";
  const sessionId = "550e8400-e29b-41d4-a716-446655440001";
  const sessionConditionId = "550e8400-e29b-41d4-a716-446655440002";
  socket.emit("message", Buffer.from(JSON.stringify({
    version: 1, id: "550e8400-e29b-41d4-a716-446655440003",
    timestamp: new Date().toISOString(), type: "adapter.register",
    adapterId: "carla-test", name: "CARLA Test", simulatorType: "carla",
    simulatorVersion: "0.9.16", capabilities: ["vehicle.telemetry", "vehicle-control"],
    priority: 10, activeSessionId: null,
  })));
  await new Promise((resolve) => setTimeout(resolve, 10));

  const deadlineAt = new Date(Date.now() + 30_000).toISOString();
  const commandId = "550e8400-e29b-41d4-a716-446655440004";
  const configuration = {
    map:"Town03", weatherPreset:"ClearNoon", weatherCustom:{cloudiness:0,precipitation:0,windIntensity:0},
    egoVehicleBlueprint:"vehicle.lincoln.mkz_2020", simulationMode:"synchronous", fixedDeltaSeconds:0.05,
    controlMode:"io", randomSeed:0, trafficConfig:{npcVehicleCount:0,speedDifference:0},
    pedestrianConfig:{pedestrianCount:0}, sunConfig:{sunAltitudeAngle:45},
    spectatorConfig:{enabled:true,x:-6,y:0,z:4,pitch:-15,yaw:0,roll:0},
    recordingConfig:{enabled:false,directory:null}, sensors:[],
  };
  const pending = controller.handleCommand({
    id: "550e8400-e29b-41d4-a716-446655440005", timestamp: new Date().toISOString(),
    routingKey: "commands.sim-bridge.session-start", producer: "core-api",
    payload: { commandId, sessionId, action:"start", deadlineAt, configuration:{studyId,sessionId,sessionConditionId,sequence:0,simulatorType:"carla",configuration} },
    metadata: { studyId, sessionId, correlationId:commandId, source:{component:"core-api",instanceId:null} },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  socket.emit("message", Buffer.from(JSON.stringify({
    version:1, id:"550e8400-e29b-41d4-a716-446655440006", timestamp:new Date().toISOString(),
    type:"adapter.command_result", commandId, success:true, code:"COMPLETED", message:"ready",
    details:{}, activeSessionId:sessionId,
  })));
  await pending;
  await controller.handleRealtimeControl({
    version:1, id:"550e8400-e29b-41d4-a716-446655440007", timestamp:new Date().toISOString(),
    type:"vehicle.control", studyId, sessionId, sessionConditionId,
    sourceKey:"driver:logitech_g29", sequence:1, throttle:0.4, steer:-0.2, brake:0,
  });
  assert.equal(JSON.parse(socket.sent.at(-1) ?? "{}").type, "adapter.vehicle_control");
  assert.ok(published.length > 0);
});
