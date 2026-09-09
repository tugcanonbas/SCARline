import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AdapterCommandResultMessage, SimulatorSessionConfiguration } from "@scarline/contracts";
import WebSocket, { type RawData } from "ws";

import { MockSimulatorClient } from "../src/client.js";
import { loadMockSimulatorConfig } from "../src/config.js";
import { MockCommandJournal } from "../src/journal.js";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

class DelayedJournal extends MockCommandJournal {
  override async record(
    result: AdapterCommandResultMessage,
    activeConfiguration: SimulatorSessionConfiguration | null,
    paused: boolean,
  ): Promise<void> {
    await delay(125);
    await super.record(result, activeConfiguration, paused);
  }
}

class MemorySocket extends EventEmitter {
  readyState = WebSocket.CONNECTING;
  readonly sent: Array<Record<string, unknown>> = [];

  override on(event: "open", listener: () => void): this;
  override on(event: "message", listener: (raw: RawData) => void): this;
  override on(event: "error", listener: (error: Error) => void): this;
  override on(event: "close", listener: () => void): this;
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener);
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  receive(message: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

test("acknowledges a session bind before publishing its first telemetry", { timeout: 5_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "scarline-mock-ordering-"));
  const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
  const base = await loadMockSimulatorConfig(repositoryRoot, {
    SIM_BRIDGE_ADAPTER_SECRET: "test-adapter-secret-test-adapter-secret",
  });
  const config = {
    ...base,
    bridgeUrl: "ws://memory.test/adapter",
    commandJournalPath: path.join(directory, "commands.json"),
  };
  const socket = new MemorySocket();
  const client = new MockSimulatorClient(
    config,
    new DelayedJournal(config.commandJournalPath),
    () => socket,
  );

  try {
    await client.start();
    socket.open();
    const registration = socket.sent.find((message) => message.type === "adapter.register");
    assert.ok(registration);
    socket.receive({
      version: 1,
      id: "550e8400-e29b-41d4-a716-446655440031",
      timestamp: new Date().toISOString(),
      type: "adapter.registered",
      correlationId: registration.id,
      assignedId: "550e8400-e29b-41d4-a716-446655440032",
      heartbeatIntervalMilliseconds: 1_000,
      maximumMessageBytes: 1_000_000,
    });
    const beforeBind = socket.sent.length;
    socket.receive({
      version: 1,
      id: "550e8400-e29b-41d4-a716-446655440033",
      timestamp: new Date().toISOString(),
      type: "adapter.bind_session",
      commandId: "550e8400-e29b-41d4-a716-446655440034",
      studyId: "550e8400-e29b-41d4-a716-446655440035",
      sessionId: "550e8400-e29b-41d4-a716-446655440036",
      sessionConditionId: "550e8400-e29b-41d4-a716-446655440037",
      sequence: 0,
      simulatorType: "mock",
      configuration: {},
      deadlineAt: new Date(Date.now() + 2_000).toISOString(),
    });
    await delay(250);
    const relevantMessages = socket.sent
      .slice(beforeBind)
      .map((message) => String(message.type))
      .filter((type) => type !== "adapter.heartbeat");
    assert.equal(relevantMessages[0], "adapter.command_result");
    assert.ok(relevantMessages.includes("vehicle.telemetry"));
  } finally {
    client.stop();
  }
});
