import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Pool } from "pg";

import type { AuthService } from "../src/auth/service.js";
import { SessionLayoutOpenError, SessionOverlayService } from "../src/overlay/session-layout.js";
import type { RealtimeHub } from "../src/realtime/hub.js";

const studyId = "550e8400-e29b-41d4-a716-446655440011";
const sessionId = "550e8400-e29b-41d4-a716-446655440012";
const conditionId = "550e8400-e29b-41d4-a716-446655440013";
const layoutId = "550e8400-e29b-41d4-a716-446655440014";
const firstInstanceId = "550e8400-e29b-41d4-a716-446655440015";
const secondInstanceId = "550e8400-e29b-41d4-a716-446655440016";
const widgetId = "550e8400-e29b-41d4-a716-446655440017";
const metadata = JSON.parse(readFileSync(new URL("../../../widgets/components/time/widget.json", import.meta.url), "utf8"));

const layoutRow = {
  id: layoutId,
  condition_id: conditionId,
  study_id: studyId,
  name: "Participant",
  type: "participant",
  target_display: "display-1",
  condition_metadata: {},
};

function pool() {
  return {
    async query(text: string) {
      if (text.includes("result_payload->'overlay'")) {
        return {
          rows: [
            { overlay: { hostId: "lab-host", openedInstanceIds: [firstInstanceId] } },
            { overlay: { hostId: "lab-host", openedInstanceIds: [firstInstanceId, secondInstanceId] } },
          ],
          rowCount: 2,
        };
      }
      if (text.includes("WHERE l.condition_id=$1")) return { rows: [{ id: layoutId }], rowCount: 1 };
      if (text.includes("SELECT l.id,l.condition_id")) return { rows: [layoutRow], rowCount: 1 };
      if (text.includes("SELECT 1 FROM sessions")) return { rows: [{ exists: 1 }], rowCount: 1 };
      if (text.includes("FROM widget_instances wi JOIN widgets")) {
        return {
          rows: [firstInstanceId, secondInstanceId].map((instance_id, order) => ({
            instance_id, widget_id: widgetId, widget_key: "time", window_mode: "transparent_electron",
            target_display: "display-1", order, x: order * 200, y: 0, width: 180, height: 180,
            configuration: {}, bindings_config: {}, style_overrides: {}, metadata,
          })),
          rowCount: 2,
        };
      }
      if (text.includes("SELECT runtime_metadata FROM session_conditions")) return { rows: [{ runtime_metadata: {} }], rowCount: 1 };
      throw new Error(`Unexpected session layout query: ${text}`);
    },
  } as unknown as Pool;
}

test("compensates already opened desktop windows when a layout batch fails", async () => {
  const commands: Array<Record<string, unknown>> = [];
  const hub = {
    async sendOverlayCommand(command: Record<string, unknown>) {
      commands.push(command);
      if (command.type === "overlay.window.open" && (command.window as Record<string, unknown>).instanceId === secondInstanceId) {
        throw new Error("second window failed to load");
      }
      return { hostId: "lab-host", accepted: true };
    },
  } as unknown as RealtimeHub;
  const auth = {
    async signOverlayBootstrapToken() { return { token: "bootstrap-token", expiresAt: new Date().toISOString() }; },
  } as unknown as AuthService;
  const service = new SessionOverlayService(pool(), auth, hub, "http://overlay-web:4174");

  await assert.rejects(
    () => service.openDesktopLayout({ sessionId, conditionId }),
    (error) => error instanceof SessionLayoutOpenError
      && error.failedInstanceId === secondInstanceId
      && error.openedInstanceIds[0] === firstInstanceId,
  );
  assert.deepEqual(commands.map((command) => command.type), [
    "overlay.window.open",
    "overlay.window.open",
    "overlay.window.close",
  ]);
  assert.equal(commands[2]?.hostId, "lab-host");
  assert.equal(commands[2]?.instanceId, firstInstanceId);
});

test("closes each persisted desktop window for a terminal session exactly once", async () => {
  const commands: Array<Record<string, unknown>> = [];
  const hub = {
    async sendOverlayCommand(command: Record<string, unknown>) {
      commands.push(command);
      return { hostId: command.hostId, accepted: true };
    },
  } as unknown as RealtimeHub;
  const service = new SessionOverlayService(
    pool(),
    {} as AuthService,
    hub,
    "http://overlay-web:4174",
  );

  const result = await service.closeDesktopSession({ sessionId });
  assert.deepEqual(new Set(result.attemptedInstanceIds), new Set([firstInstanceId, secondInstanceId]));
  assert.deepEqual(new Set(result.closedInstanceIds), new Set([firstInstanceId, secondInstanceId]));
  assert.equal(result.failures.length, 0);
  assert.equal(commands.length, 2);
  assert.equal(commands.every((command) => command.type === "overlay.window.close"), true);
  assert.equal(commands.every((command) => command.hostId === "lab-host"), true);
});

test("keeps the newly opened condition windows while closing previous ones", async () => {
  const commands: Array<Record<string, unknown>> = [];
  const hub = {
    async sendOverlayCommand(command: Record<string, unknown>) {
      commands.push(command);
      return { hostId: command.hostId, accepted: true };
    },
  } as unknown as RealtimeHub;
  const service = new SessionOverlayService(
    pool(),
    {} as AuthService,
    hub,
    "http://overlay-web:4174",
  );

  const result = await service.closeDesktopSession({
    sessionId,
    excludeInstanceIds: [secondInstanceId],
  });
  assert.deepEqual(result.attemptedInstanceIds, [firstInstanceId]);
  assert.equal(commands[0]?.instanceId, firstInstanceId);
});
