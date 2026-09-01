import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";

import {
  OverlayCommandError,
  RealtimeHub,
} from "../src/realtime/hub.js";

const instanceId = "550e8400-e29b-41d4-a716-446655440031";
const timestamp = "2026-08-31T12:00:00.000Z";

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(value?: unknown) => void>>();

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("socket closed");
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener();
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
  info: () => undefined,
  warn: () => undefined,
} as unknown as FastifyBaseLogger;

function createHub(): RealtimeHub {
  return new RealtimeHub({} as Pool, logger);
}

function registerHost(hub: RealtimeHub, socket: FakeSocket, hostId: string): void {
  hub.attachOverlay(socket);
  socket.emitMessage({
    type: "overlay.status",
    hostId,
    occurredAt: timestamp,
    ready: true,
    displays: [],
    windows: [],
  });
}

function sentCommand(socket: FakeSocket): Record<string, unknown> {
  return JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
}

test("keeps separate host records and automatically selects one connected host", () => {
  const hub = createHub();
  const socket = new FakeSocket();
  registerHost(hub, socket, "lab-mac-01");

  const status = hub.overlayStatus as {
    connected: boolean;
    selectedHostId: string | null;
    hosts: Array<Record<string, unknown>>;
  };
  assert.equal(status.connected, true);
  assert.equal(status.selectedHostId, "lab-mac-01");
  assert.equal(status.hosts.length, 1);
  assert.equal(status.hosts[0]?.hostId, "lab-mac-01");
  assert.equal(status.hosts[0]?.connected, true);
  assert.equal(status.hosts[0]?.connectedAt !== undefined, true);
});

test("requires a target for multiple hosts and sends to exactly the selected host", async () => {
  const hub = createHub();
  const first = new FakeSocket();
  const second = new FakeSocket();
  registerHost(hub, first, "lab-mac-01");
  registerHost(hub, second, "lab-mac-02");

  await assert.rejects(
    () => hub.sendOverlayCommand({
      type: "overlay.window.close",
      instanceId,
    }, 100),
    (error) => error instanceof OverlayCommandError
      && error.code === "OVERLAY_HOST_SELECTION_REQUIRED",
  );

  const pending = hub.sendOverlayCommand({
    type: "overlay.window.close",
    hostId: "lab-mac-02",
    instanceId,
  }, 100);
  assert.equal(first.sent.length, 0);
  assert.equal(second.sent.length, 1);
  const command = sentCommand(second);
  assert.equal(command.hostId, "lab-mac-02");
  second.emitMessage({
    type: "overlay.command.result",
    hostId: "lab-mac-02",
    occurredAt: timestamp,
    commandId: command.commandId,
    accepted: true,
    error: null,
  });
  const result = await pending;
  assert.equal(result.hostId, "lab-mac-02");
  assert.equal(result.accepted, true);
});

test("distinguishes host rejection, disconnection, and timeout", async () => {
  const rejectedHub = createHub();
  const rejectedSocket = new FakeSocket();
  registerHost(rejectedHub, rejectedSocket, "lab-mac-01");
  const rejected = rejectedHub.sendOverlayCommand({
    type: "overlay.window.close",
    instanceId,
  }, 100);
  const rejectedCommand = sentCommand(rejectedSocket);
  rejectedSocket.emitMessage({
    type: "overlay.command.result",
    hostId: "lab-mac-01",
    occurredAt: timestamp,
    commandId: rejectedCommand.commandId,
    accepted: false,
    error: "renderer load failed",
  });
  await assert.rejects(
    () => rejected,
    (error) => error instanceof OverlayCommandError
      && error.code === "OVERLAY_COMMAND_REJECTED"
      && error.message === "renderer load failed",
  );

  const disconnectedHub = createHub();
  const disconnectedSocket = new FakeSocket();
  registerHost(disconnectedHub, disconnectedSocket, "lab-mac-01");
  const disconnected = disconnectedHub.sendOverlayCommand({
    type: "overlay.window.close",
    instanceId,
  }, 100);
  disconnectedSocket.close();
  await assert.rejects(
    () => disconnected,
    (error) => error instanceof OverlayCommandError
      && error.code === "OVERLAY_DISCONNECTED",
  );

  const timeoutHub = createHub();
  const timeoutSocket = new FakeSocket();
  registerHost(timeoutHub, timeoutSocket, "lab-mac-01");
  await assert.rejects(
    () => timeoutHub.sendOverlayCommand({
      type: "overlay.window.close",
      instanceId,
    }, 5),
    (error) => error instanceof OverlayCommandError
      && error.code === "OVERLAY_COMMAND_TIMEOUT",
  );
});

test("keeps the host record and reconnect timestamps when the same host reconnects", () => {
  const hub = createHub();
  const first = new FakeSocket();
  registerHost(hub, first, "lab-mac-01");
  first.close();

  const disconnected = hub.overlayStatus as {
    hosts: Array<Record<string, unknown>>;
  };
  assert.equal(disconnected.hosts.length, 1);
  assert.equal(disconnected.hosts[0]?.connected, false);
  assert.equal(typeof disconnected.hosts[0]?.disconnectedAt, "string");

  const second = new FakeSocket();
  registerHost(hub, second, "lab-mac-01");
  const reconnected = hub.overlayStatus as {
    selectedHostId: string | null;
    hosts: Array<Record<string, unknown>>;
  };
  assert.equal(reconnected.hosts.length, 1);
  assert.equal(reconnected.hosts[0]?.connected, true);
  assert.equal(reconnected.selectedHostId, "lab-mac-01");
});
