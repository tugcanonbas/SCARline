import assert from "node:assert/strict";
import test from "node:test";

import type { OverlayHostCommand } from "../src/types.js";
import { processDesktopCommand, type DesktopCommandResult } from "../src/command-processor.js";
import { parseDesktopCommand } from "../src/commands.js";
import { resolveOverlayHostId } from "../src/host.js";
import { ReconnectScheduler } from "../src/reconnect.js";
import {
  OverlayWindowManager,
  type ManagedBrowserWindowLike,
  type RectangleLike,
} from "../src/window-manager.js";

const instanceId = "550e8400-e29b-41d4-a716-446655440031";
const commandId = "550e8400-e29b-41d4-a716-446655440090";
const displays = [
  {
    id: 10,
    label: "Primary",
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  },
  {
    id: 20,
    label: "Participant",
    scaleFactor: 1,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  },
];

class FakeWindow implements ManagedBrowserWindowLike {
  destroyed = false;
  reloaded = false;
  readonly listeners = new Map<string, Array<() => void>>();
  readonly loadError: Error | null;
  bounds: RectangleLike;

  constructor(bounds: RectangleLike, loadError: Error | null = null) {
    this.bounds = { ...bounds };
    this.loadError = loadError;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("closed");
  }

  getBounds(): RectangleLike {
    return { ...this.bounds };
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async loadURL(): Promise<void> {
    if (this.loadError !== null) throw this.loadError;
  }

  reload(): void {
    this.reloaded = true;
  }

  setBounds(bounds: RectangleLike): void {
    this.bounds = { ...bounds };
  }

  setIgnoreMouseEvents(): void {}

  on(event: "move" | "resize" | "closed", listener: () => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: "move" | "resize" | "closed"): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

function openCommand(targetDisplay = "20"): Extract<OverlayHostCommand, { type: "overlay.window.open" }> {
  return {
    type: "overlay.window.open",
    commandId,
    hostId: "lab-mac-01",
    issuedAt: "2026-08-31T12:00:00.000Z",
    window: {
      instanceId,
      targetDisplay,
      windowMode: "transparent_electron",
      inputMode: "click_through",
      coordinateSpace: "display-relative",
      x: 40,
      y: 50,
      width: 320,
      height: 240,
      widgetKey: "speedometer",
      rendererUrl: `http://localhost:4000/widget/${instanceId}`,
    },
  };
}

test("uses a configured stable host id and rejects invalid identifiers", () => {
  assert.equal(resolveOverlayHostId("lab-mac-01", "ignored"), "lab-mac-01");
  assert.equal(resolveOverlayHostId(undefined, "research-host.local"), "research-host.local");
  assert.throws(() => resolveOverlayHostId("host with spaces", "ignored"));
});

test("rejects malformed and invalid WebSocket commands without throwing", () => {
  const malformed = parseDesktopCommand("{");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.ok(malformed.error.length > 0);
  const invalid = parseDesktopCommand(JSON.stringify({
    type: "overlay.window.close",
    commandId,
  }));
  assert.equal(invalid.ok, false);
});

test("coalesces disconnects into one reconnect and supports clean shutdown", () => {
  const callbacks: Array<() => void> = [];
  let reconnects = 0;
  let cleared = 0;
  const scheduler = new ReconnectScheduler({
    connect: () => { reconnects += 1; },
    delayMilliseconds: 1_500,
    setTimer: ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimer: (() => { cleared += 1; }) as typeof clearTimeout,
  });

  scheduler.schedule();
  scheduler.schedule();
  assert.equal(callbacks.length, 1);
  assert.equal(scheduler.pending, true);
  callbacks[0]!();
  assert.equal(reconnects, 1);
  assert.equal(scheduler.pending, false);

  scheduler.schedule();
  scheduler.cancel();
  assert.equal(cleared, 1);
  assert.equal(scheduler.pending, false);
});

test("acknowledges a successfully loaded command and rejects commands for another host", async () => {
  const results: DesktopCommandResult[] = [];
  let opened = 0;
  const windows = {
    openWindow: async () => { opened += 1; },
    updateWindow: () => undefined,
    closeWindow: () => undefined,
    reloadAll: () => undefined,
  };
  await processDesktopCommand(JSON.stringify(openCommand()), {
    hostId: "lab-mac-01",
    windows,
    assertRendererUrl: () => undefined,
    emitResult: (result) => results.push(result),
  });
  await processDesktopCommand(JSON.stringify({ ...openCommand(), hostId: "other-host" }), {
    hostId: "lab-mac-01",
    windows,
    assertRendererUrl: () => undefined,
    emitResult: (result) => results.push(result),
  });

  assert.equal(opened, 1);
  assert.deepEqual(results[0], {
    type: "overlay.command.result",
    commandId,
    accepted: true,
    error: null,
  });
  assert.equal(results[1]?.accepted, false);
  assert.match(results[1]?.error ?? "", /other-host.*lab-mac-01/u);
});

test("returns a correlated rejection when a provisional window fails to load", async () => {
  const results: DesktopCommandResult[] = [];
  await processDesktopCommand(JSON.stringify(openCommand()), {
    hostId: "lab-mac-01",
    windows: {
      openWindow: async () => { throw new Error("renderer load failed"); },
      updateWindow: () => undefined,
      closeWindow: () => undefined,
      reloadAll: () => undefined,
    },
    assertRendererUrl: () => undefined,
    emitResult: (result) => results.push(result),
  });

  assert.deepEqual(results, [{
    type: "overlay.command.result",
    commandId,
    accepted: false,
    error: "renderer load failed",
  }]);
});

test("destroys and unregisters a provisional window when loading fails", async () => {
  const created: FakeWindow[] = [];
  let statusChanges = 0;
  const manager = new OverlayWindowManager({
    createWindow: (_command, bounds) => {
      const window = new FakeWindow(bounds, new Error("renderer load failed"));
      created.push(window);
      return window;
    },
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0]!,
    getDisplayMatching: (bounds) => bounds.x >= 1920 ? displays[1]! : displays[0]!,
    onWindowChanged: () => undefined,
    onStatusChanged: () => { statusChanges += 1; },
  });

  await assert.rejects(() => manager.openWindow(openCommand()), /renderer load failed/u);
  assert.equal(created[0]?.destroyed, true);
  assert.equal(manager.size, 0);
  assert.deepEqual(manager.status(), []);
  assert.ok(statusChanges >= 1);
});

test("temporarily rehomes windows after display removal without changing the saved assignment", async () => {
  let currentDisplays = [...displays];
  const created: FakeWindow[] = [];
  const manager = new OverlayWindowManager({
    createWindow: (_command, bounds) => {
      const window = new FakeWindow(bounds);
      created.push(window);
      return window;
    },
    getAllDisplays: () => currentDisplays,
    getPrimaryDisplay: () => displays[0]!,
    getDisplayMatching: (bounds) => bounds.x >= 1920 ? displays[1]! : displays[0]!,
    onWindowChanged: () => undefined,
    onStatusChanged: () => undefined,
  });

  await manager.openWindow(openCommand());
  assert.equal(manager.status()[0]?.targetDisplay, "20");
  currentDisplays = [displays[0]!];
  manager.handleDisplayChange("removed", "20");
  created[0]!.emit("move");
  const degraded = manager.status()[0]!;
  assert.equal(degraded.targetDisplay, "20");
  assert.equal(degraded.liveDisplay, "10");
  assert.equal(degraded.degraded, true);
  assert.match(degraded.degradedReason ?? "", /unavailable/u);
  assert.ok(degraded.bounds.x < 1920);

  currentDisplays = [...displays];
  manager.handleDisplayChange("added", "20");
  const restored = manager.status()[0]!;
  assert.equal(restored.targetDisplay, "20");
  assert.equal(restored.liveDisplay, "20");
  assert.equal(restored.degraded, false);
  assert.deepEqual(restored.bounds, { x: 1960, y: 50, width: 320, height: 240 });
  assert.equal(created.length, 1);
});

test("reports user movement as display-relative draft geometry", async () => {
  let changed: unknown;
  const created: FakeWindow[] = [];
  const manager = new OverlayWindowManager({
    createWindow: (_command, bounds) => {
      const window = new FakeWindow(bounds);
      created.push(window);
      return window;
    },
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0]!,
    getDisplayMatching: (bounds) => bounds.x >= 1920 ? displays[1]! : displays[0]!,
    onWindowChanged: (event) => { changed = event; },
    onStatusChanged: () => undefined,
  });

  await manager.openWindow(openCommand());
  created[0]!.bounds = { x: 2020, y: 80, width: 400, height: 300 };
  created[0]!.emit("move");
  assert.deepEqual(changed, {
    type: "overlay.window.changed",
    instanceId,
    targetDisplay: "20",
    bounds: { x: 100, y: 80, width: 400, height: 300 },
  });
  created[0]!.bounds = { x: 2020, y: 80, width: 440, height: 320 };
  created[0]!.emit("resize");
  assert.deepEqual(changed, {
    type: "overlay.window.changed",
    instanceId,
    targetDisplay: "20",
    bounds: { x: 100, y: 80, width: 440, height: 320 },
  });
});
