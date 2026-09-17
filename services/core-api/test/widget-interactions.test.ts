import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { OverlayRuntimeScope } from "@scarline/contracts";

import { applyOverlayWidgetInteraction } from "../src/overlay/interaction-control.js";
import { applyManualWidgetRuntimeCommand } from "../src/overlay/runtime-control.js";
import { loadOverlayRuntimeSnapshot } from "../src/overlay/runtime.js";
import { ApiProblem, registerErrorHandling } from "../src/errors.js";
import { registerRealtimeRoutes } from "../src/routes/realtime.js";
import { RealtimeHub } from "../src/realtime/hub.js";
import type { AuthService } from "../src/auth/service.js";
import type { CoreApiConfig } from "../src/config.js";
import { InteractionDatabase, ids, scope } from "./fixtures/widget-interactions.js";
import { musicBindingUpdate, projectMusicBindings } from "../src/overlay/widget-interactions.js";

const input = (action = "call.mute", instanceId = ids.call) => ({ action, instanceId, requestId: randomUUID(), payload: {} });
const problem = (code: string) => (error: unknown) => error instanceof ApiProblem && error.problemCode === code;

test("simulated playback advances from its anchor, pauses, seeks and stops at the configured duration", () => {
  const start = musicBindingUpdate({ "media.progress_label": "0:05", "media.duration_label": "0:10" }, { "media.is_playing": true }, 10_000);
  assert.equal(projectMusicBindings(start, 12_000)["media.progress_label"], "0:07");
  const pause = musicBindingUpdate(start, { "media.is_playing": false }, 12_000);
  assert.equal(projectMusicBindings(pause, 30_000)["media.progress_label"], "0:07");
  const seek = musicBindingUpdate(pause, { "media.progress_ratio": 20, "media.is_playing": true }, 30_000);
  assert.equal(seek["media.position_seconds"], 2);
  assert.equal(projectMusicBindings(seek, 38_000)["media.progress_ratio"], 100);
  assert.equal(projectMusicBindings(seek, 38_000)["media.is_playing"], false);
  assert.equal(musicBindingUpdate(seek, { "media.duration_seconds": 0 }, 40_000)["media.progress_ratio"], 0);
});

test("call toggles and exclusive audio selection persist independently of music", async () => {
  const db = new InteractionDatabase();
  for (const [action, key] of [["call.mute", "call.is_muted"], ["call.hold", "call.is_on_hold"]]) {
    assert.equal((await applyOverlayWidgetInteraction(db.pool, scope, input(action))).update.bindingValues[key!], true);
    assert.equal((await applyOverlayWidgetInteraction(db.pool, scope, input(action))).update.bindingValues[key!], false);
  }
  for (const action of ["call.speaker", "call.speaker", "call.bluetooth"]) {
    const { update } = await applyOverlayWidgetInteraction(db.pool, scope, input(action));
    assert.equal(update.bindingValues["call.is_bluetooth"], action === "call.bluetooth");
    assert.equal(update.bindingValues["call.is_speaker"], action === "call.speaker");
    assert.equal(update.bindingValues["call.audio_route_label"], action === "call.speaker" ? "Speaker" : "Bluetooth");
  }
  const play = await applyOverlayWidgetInteraction(db.pool, scope, input("media.play_pause", ids.music));
  assert.equal(play.update.bindingValues["media.is_playing"], true);
  const snapshot = await loadOverlayRuntimeSnapshot(db.pool, scope);
  assert.equal(snapshot.widgets[1]?.bindings["media.is_playing"], true);
  assert.equal(snapshot.widgets[0]?.bindings["call.is_muted"], false);
  assert.equal(db.events.length, 8);
  assert.equal(db.events[7]?.routingKey, `events.${ids.study}.${ids.session}.widget.interaction`);
});

test("duplicate and simultaneous requests apply once; a new request toggles from committed state", async () => {
  const db = new InteractionDatabase();
  const request = input();
  const results = await Promise.all([applyOverlayWidgetInteraction(db.pool, scope, request), applyOverlayWidgetInteraction(db.pool, scope, request)]);
  assert.deepEqual(results.map((value) => value.duplicate), [false, true]);
  assert.equal(db.events.length, 1);
  assert.equal(results[1]?.update.bindingValues["call.is_muted"], true);
  const next = await applyOverlayWidgetInteraction(db.pool, scope, input());
  assert.equal(next.update.bindingValues["call.is_muted"], false);
  await assert.rejects(() => applyOverlayWidgetInteraction(db.pool, scope, { ...request, action: "call.hold" }), problem("INTERACTION_REQUEST_CONFLICT"));
});

test("researcher updates and reset share state with interactions; a late retry cannot undo reset", async () => {
  const db = new InteractionDatabase();
  const request = input();
  await applyOverlayWidgetInteraction(db.pool, scope, request);
  await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "update", bindingValues: { "call.is_muted": false } }, ids.study);
  assert.equal((await applyOverlayWidgetInteraction(db.pool, scope, input())).update.bindingValues["call.is_muted"], true);
  const reset = await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "reset", bindingValues: {} }, ids.study);
  const retry = await applyOverlayWidgetInteraction(db.pool, scope, request);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.update.bindingValues["call.is_muted"], false);
  assert.equal(retry.update.revision, reset.revision);
  assert.deepEqual(db.runtime.widgetRuntime, {});
});

test("normal actions only deliver changed or overridden bindings; a missed reset supplies a full snapshot", async () => {
  const db = new InteractionDatabase();
  const first = await applyOverlayWidgetInteraction(db.pool, scope, { ...input(), observedRevision: 0 });
  assert.deepEqual(first.update.bindingValues, { "call.is_muted": true });
  assert.equal(first.update.replaceBindings, false);
  await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "reset", bindingValues: {} }, ids.study);
  const second = await applyOverlayWidgetInteraction(db.pool, scope, { ...input("call.hold"), observedRevision: first.update.revision });
  assert.equal(second.update.replaceBindings, true);
  assert.equal(second.update.bindingValues["call.is_muted"], false);
  assert.equal(second.update.bindingValues["call.is_on_hold"], true);
});

test("preview launches survive reconnect and remain isolated from other previews and live sessions", async () => {
  const db = new InteractionDatabase();
  const preview = { ...scope, sessionId: null, previewId: ids.preview };
  const request = input();
  await applyOverlayWidgetInteraction(db.pool, preview, request);
  await applyOverlayWidgetInteraction(db.pool, preview, request);
  assert.equal((await loadOverlayRuntimeSnapshot(db.pool, preview)).widgets[0]?.bindings["call.is_muted"], true);
  assert.equal((await loadOverlayRuntimeSnapshot(db.pool, { ...preview, previewId: randomUUID() })).widgets[0]?.bindings["call.is_muted"], false);
  assert.equal((await loadOverlayRuntimeSnapshot(db.pool, scope)).widgets[0]?.bindings["call.is_muted"], false);
  assert.deepEqual(db.runtime, {});
  assert.equal(db.events.length, 0);
});

test("hidden, stale, disabled, undeclared and out-of-scope actions cannot mutate state", async () => {
  for (const scenario of ["hidden", "stale", "disabled", "undeclared", "instance", "study", "ended"] as const) {
    const db = new InteractionDatabase();
    let granted = scope;
    let request = input();
    let code: string;
    switch (scenario) {
      case "hidden": db.conditionMetadata = { widgetOverrides: { hidden_widgets: ["activecall"] } }; code = "WIDGET_HIDDEN"; break;
      case "stale": db.activeCondition = ids.music; code = "INTERACTION_CONDITION_CHANGED"; break;
      case "disabled": db.widgets[0]!.enabled = false; code = "WIDGET_OUT_OF_SCOPE"; break;
      case "undeclared": request = input("controls.primary"); code = "UNDECLARED_WIDGET_ACTION"; break;
      case "instance": granted = { ...scope, instanceId: ids.music }; code = "WIDGET_OUT_OF_SCOPE"; break;
      case "study": granted = { ...scope, studyId: ids.music }; code = "OVERLAY_SCOPE_MISMATCH"; break;
      case "ended": db.sessionStatus = "completed"; code = "SESSION_NOT_LIVE"; break;
    }
    await assert.rejects(() => applyOverlayWidgetInteraction(db.pool, granted, request), problem(code));
    assert.deepEqual(db.runtime, {});
    assert.equal(db.events.length, 0);
  }
});

test("failed audit persistence rolls back the state and allows the same request to retry", async () => {
  const db = new InteractionDatabase();
  const request = input();
  db.failOutbox = true;
  await assert.rejects(() => applyOverlayWidgetInteraction(db.pool, scope, request), /Outbox unavailable/);
  assert.deepEqual(db.runtime, {});
  db.failOutbox = false;
  const result = await applyOverlayWidgetInteraction(db.pool, scope, request);
  assert.equal(result.duplicate, false);
  assert.equal(result.update.bindingValues["call.is_muted"], true);
});

test("HTTP interactions return confirmed state, require renderer credentials and validate request IDs", async (context) => {
  const db = new InteractionDatabase();
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  await app.register(cookie); await app.register(websocket);
  const auth = { verifyOverlayRenderSession: async (token: string) => {
    if (token !== "fixture") throw new ApiProblem(401, "INVALID_OVERLAY_SESSION", "Invalid session");
    return scope;
  } } as unknown as AuthService;
  const hub = new RealtimeHub(db.pool, app.log);
  await registerRealtimeRoutes(app, db.pool, auth, {} as CoreApiConfig, hub);
  context.after(() => app.close());
  const url = `/api/v1/overlay/renderers/${ids.preview}/interactions`;
  const request = input();
  const headers = { host: "localhost:8088", cookie: `scarline_overlay_${ids.preview}=fixture` };
  const { overlayRendererCookie } = await import("../src/auth/overlay-cookie.js");
  headers.cookie = `${overlayRendererCookie({ protocol: "http", hostname: "localhost" }, ids.preview).name}=fixture`;
  assert.equal((await app.inject({ method: "POST", url, payload: request })).statusCode, 401);
  const response = await app.inject({ method: "POST", url, headers, payload: request });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(response.json().data.update.bindingValues["call.is_muted"], true);
  assert.equal(response.json().data.requestId, request.requestId);
  const invalid = await app.inject({ method: "POST", url, headers, payload: { ...request, requestId: "invalid" } });
  assert.equal(invalid.statusCode, 400);
});

test("realtime updates and session lifecycle never leak into an independent preview", async (context) => {
  const db = new InteractionDatabase();
  const app = Fastify();
  context.after(() => app.close());
  const hub = new RealtimeHub(db.pool, app.log);
  const messages: Array<Array<Record<string, unknown>>> = [];
  const scopes: OverlayRuntimeScope[] = [scope,
    { ...scope, sessionId: null, previewId: ids.preview },
    { ...scope, sessionId: null, previewId: randomUUID() }];
  for (const grant of scopes) {
    const sent: Array<Record<string, unknown>> = [];
    await hub.attachRenderer({ readyState: 1, on() {}, close() {}, send(data) { sent.push(JSON.parse(data)); } }, grant);
    assert.ok(sent.some((message) => (message.trigger as any)?.action === "reset"));
    sent.length = 0;
    messages.push(sent);
  }
  const previewResult = await applyOverlayWidgetInteraction(db.pool, scopes[1]!, input());
  hub.broadcast("widget.updates", previewResult.update, ids.study, null);
  assert.deepEqual(messages.map((entry) => entry.length), [0, 1, 0]);
  hub.broadcast("session.lifecycle", { status: "completed" }, ids.study, ids.session);
  assert.ok(messages[0]!.some((message) => message.type === "overlay.runtime.close"));
  assert.equal(messages[1]!.length, 1);
  assert.equal(messages[2]!.length, 0);
});
