import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { MessageEnvelopeSchema, type OverlayRuntimeScope } from "@scarline/contracts";
import { buildOverlayWeb } from "../../apps/overlay-web/src/server.js";
import { registerRealtimeRoutes } from "../../services/core-api/src/routes/realtime.js";
import { registerErrorHandling, ApiProblem } from "../../services/core-api/src/errors.js";
import { RealtimeHub } from "../../services/core-api/src/realtime/hub.js";
import { clearLiveWidgetData } from "../../services/core-api/src/overlay/live-data.js";
import { overlayRendererCookie } from "../../services/core-api/src/auth/overlay-cookie.js";
import { applyManualWidgetRuntimeCommand } from "../../services/core-api/src/overlay/runtime-control.js";
import { InteractionDatabase, ids, scope } from "../../services/core-api/test/fixtures/widget-interactions.js";
import type { AuthService } from "../../services/core-api/src/auth/service.js";
import type { CoreApiConfig } from "../../services/core-api/src/config.js";

// Production HTTP routes, renderer, bridge, and WebSocket hub with fixture-only
// study rows. No account, participant data or running platform is used.
let db: InteractionDatabase;
let core: ReturnType<typeof Fastify>;
let overlay: ReturnType<typeof buildOverlayWeb>;
let hub: RealtimeHub;
let origin: string;
let coreOrigin: string;
const grants = new Map<string, OverlayRuntimeScope>();
const tickets = new Map<string, OverlayRuntimeScope>();
let gate: Promise<void> | undefined;
let rejectStatus = 0;
let requests = 0;
let defaultWidgets: InteractionDatabase["widgets"];

test.beforeAll(async () => {
  db = new InteractionDatabase();
  defaultWidgets = structuredClone(db.widgets);
  core = Fastify();
  core.setValidatorCompiler(validatorCompiler); core.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(core);
  await core.register(cookie); await core.register(cors, { origin: true, credentials: true }); await core.register(websocket);
  hub = new RealtimeHub(db.pool, core.log);
  core.addHook("preHandler", async (request, reply) => {
    if (!request.url.endsWith("/interactions")) return;
    requests += 1;
    if (gate) await gate;
    if (rejectStatus) return reply.status(rejectStatus).send({ error: "Test rejection" });
  });
  const auth = {
    verifyOverlayRenderSession: async (token: string, rendererId: string) => {
      const granted = grants.get(rendererId);
      if (!granted || token !== rendererId) throw new ApiProblem(401, "INVALID_OVERLAY_SESSION", "Fixture grant expired");
      return granted;
    },
    signOverlayWebSocketTicket: async (granted: OverlayRuntimeScope) => {
      const token = randomUUID(); tickets.set(token, granted); return { token };
    },
    verifyOverlayWebSocketTicket: async (token: string) => {
      const granted = tickets.get(token); tickets.delete(token);
      if (!granted) throw new Error("Invalid fixture ticket");
      return granted;
    },
  } as unknown as AuthService;
  await registerRealtimeRoutes(core, db.pool, auth, {} as CoreApiConfig, hub);
  coreOrigin = await core.listen({ host: "127.0.0.1", port: 0 });
  overlay = buildOverlayWeb({ coreApiOrigin: coreOrigin, coreApiWebSocketOrigin: coreOrigin.replace("http:", "ws:"),
    widgetsDirectory: path.resolve("widgets"), rendererAssetsDirectory: path.resolve("apps/overlay-web/dist") });
  origin = await overlay.listen({ host: "127.0.0.1", port: 0 });
});

test.beforeEach(() => { requests = 0; rejectStatus = 0; gate = undefined; db.runtime = {}; db.events = [];
  db.widgets = structuredClone(defaultWidgets); clearLiveWidgetData(db.pool, ids.study, ids.session); });
test.afterAll(async () => { await overlay?.close(); await core?.close(); });

async function launch(page: Page, instanceId = ids.call, live = false, layoutGrant = false) {
  const rendererId = randomUUID();
  grants.set(rendererId, { ...scope, instanceId: layoutGrant ? null : instanceId, ...(live ? {} : { sessionId: null, previewId: rendererId }) });
  const rendererCookie = overlayRendererCookie({ protocol: "http", hostname: "127.0.0.1" }, rendererId);
  await page.context().addCookies([{ name: rendererCookie.name, value: rendererId, domain: "127.0.0.1",
    path: rendererCookie.options.path, httpOnly: true, secure: false, sameSite: "Strict" }]);
  await page.goto(`${origin}/widget/${instanceId}#renderer=${rendererId}`);
  await expect(page.locator("iframe")).toHaveCount(1);
  const frame = await (await page.locator("iframe").elementHandle())!.contentFrame();
  if (!frame) throw new Error("No widget frame");
  await expect(frame.locator("[data-widget-root]")).toHaveAttribute("data-state", "visible");
  return frame;
}

function dataWidget(key: string, staleAfterMs?: number) {
  const widget = db.widgets[0]!;
  widget.widget_key = key;
  widget.metadata = JSON.parse(readFileSync(path.resolve(`widgets/components/${key}/widget.json`), "utf8"));
  if (staleAfterMs) for (const binding of Object.values(widget.metadata.bindings) as Array<Record<string, unknown>>) {
    if (binding.source === "live") binding.staleAfterMs = staleAfterMs;
  }
}

function sensorBatch(channelKey: string, samples: Record<string, unknown>[], extra = {}) {
  const now = Date.now();
  const message = MessageEnvelopeSchema.parse({ id: randomUUID(), timestamp: new Date(now).toISOString(), producer: "io-client",
    routingKey: `events.${ids.study}.${ids.session}.health.io.${channelKey}`,
    metadata: { studyId: ids.study, sessionId: ids.session, correlationId: null, source: { component: "io-client", instanceId: "widget-test" } }, payload: {
    sessionConditionId: ids.sessionCondition, deviceId: ids.call, sensorId: ids.music,
    sourceKey: `test:${channelKey}`, channelKey, sequenceStart: 0, sampleRate: 1,
    sourceTimestamp: new Date(now - (samples.length - 1) * 1000).toISOString(), droppedSamples: 0, samples, ...extra,
  } });
  hub.broadcast("session.events", message, ids.study, ids.session);
}

test("a popup launched with a layout grant receives only its own widget data", async ({ page }) => {
  dataWidget("hr");
  db.widgets[1]!.widget_key = "ecg";
  db.widgets[1]!.metadata = JSON.parse(readFileSync(path.resolve("widgets/components/ecg/widget.json"), "utf8"));
  const received: Array<Record<string, unknown>> = [];
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
    received.push(JSON.parse(String(payload)));
  }));
  const frame = await launch(page, ids.call, true, true);
  sensorBatch("ecg", Array.from({ length: 100 }, (_, i) => ({ value: Math.sin(i) })), {
    sampleRate: 500, sourceTimestamp: new Date(Date.now() - 198).toISOString(),
  });
  sensorBatch("heart_rate", [{ heartRateBpm: 73 }]);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("73");
  const updates = received.filter((entry) => entry.instanceId !== undefined);
  expect(updates.length).toBeGreaterThan(0);
  expect(updates.every((entry) => entry.instanceId === ids.call)).toBe(true);
  expect(JSON.stringify(updates)).not.toContain("vitals.ecg_samples");
});

test("heart-rate plots use the received values and timestamps and survive reload", async ({ page }, testInfo) => {
  dataWidget("hr");
  await page.setViewportSize({ width: 190, height: 130 });
  const frame = await launch(page, ids.call, true);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("—");
  await expect(frame.locator("[data-chart-trace]")).toHaveAttribute("d", "");
  sensorBatch("heart_rate", [{ heartRateBpm: 61 }, { heartRateBpm: 92 }, { heartRateBpm: 73 }]);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("73");
  await expect(frame.locator('[data-bind="vitals.heart_rate_min"]')).toHaveText("61");
  await expect(frame.locator('[data-bind="vitals.heart_rate_max"]')).toHaveText("92");
  const plot = frame.locator("[data-chart]");
  await expect(plot).toHaveAttribute("data-sample-count", "3");
  await expect(plot).toHaveAttribute("data-minimum", "61");
  await expect(plot).toHaveAttribute("data-maximum", "92");
  expect((await frame.locator("[data-chart-trace]").getAttribute("d"))?.match(/[ML]/g)).toEqual(["M", "L", "L"]);
  await expect(frame.locator("[role=status]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("heart-rate-received-trend.png") });
  await page.reload();
  await expect(page.frameLocator("iframe").locator('[data-bind="vitals.heart_rate"]')).toHaveText("73");
  await expect(page.frameLocator("iframe").locator("[data-chart]")).toHaveAttribute("data-sample-count", "3");
});

test("ECG stays empty for BPM alone and plots only the supplied ECG samples", async ({ page }, testInfo) => {
  dataWidget("ecg");
  await page.setViewportSize({ width: 316, height: 197 });
  const frame = await launch(page, ids.call, true);
  const trace = frame.locator('[data-chart="vitals.ecg_samples"] [data-chart-trace]');
  sensorBatch("heart_rate", [{ heartRateBpm: 73 }]);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("73");
  await expect(trace).toHaveAttribute("d", "");
  await expect(frame.locator('[data-bind="vitals.ecg_status"]')).toHaveText("—");
  sensorBatch("ecg", [{ ecgSamples: [.4, -1.2, 2.5, 0], sampleRate: 100 }]);
  await expect(frame.locator('[data-chart="vitals.ecg_samples"]')).toHaveAttribute("data-sample-count", "4");
  expect((await trace.getAttribute("d"))?.match(/[ML]/g)).toEqual(["M", "L", "L", "L"]);
  const points = (await trace.getAttribute("d"))!.match(/[ML]([\d.]+),([\d.]+)/g)!;
  const y = points.map((point) => Number(point.split(",")[1]));
  expect(y[1]).toBeGreaterThan(y[0]!); expect(y[2]).toBeLessThan(y[0]!);
  await expect(frame.locator('[data-bind="vitals.spo2"]')).toHaveText("—");
  await page.screenshot({ path: testInfo.outputPath("ecg-received-samples.png") });
});

for (const signal of [
  { widget: "bp", channel: "blood_pressure", key: "vitals.blood_pressure_systolic", values: [{ systolic: 118, diastolic: 76 }, { systolic: 124, diastolic: 81 }], text: "124", count: "4" },
  { widget: "spo2", channel: "spo2", key: "vitals.spo2", values: [{ spo2Percent: 96 }, { spo2Percent: 99 }], text: "99", count: "2" },
  { widget: "resp", channel: "respiration", key: "vitals.respiration_rate", values: [{ respirationRateRpm: 14 }, { respirationRateRpm: 19 }], text: "19", count: "2" },
]) test(`${signal.widget} displays its received samples and identifies simulated data`, async ({ page }, testInfo) => {
  dataWidget(signal.widget);
  await page.setViewportSize({ width: 95, height: 65 });
  const frame = await launch(page, ids.call, true);
  await expect(frame.locator(`[data-bind="${signal.key}"]`)).toHaveText("—");
  await expect(page.locator(".browser-toolbar")).toHaveCount(0);
  sensorBatch(signal.channel, signal.values, { sourceKey: "driver:mock" });
  await expect(frame.locator(`[data-bind="${signal.key}"]`)).toHaveText(signal.text);
  await expect(frame.locator("[data-chart]")).toHaveAttribute("data-simulated", "true");
  await expect(frame.locator("[data-chart-label]")).toHaveText("Simulated");
  expect(await frame.locator("[data-chart-label]").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(frame.locator("[data-chart]")).toHaveAttribute("data-sample-count", signal.count);
  if (signal.widget === "bp") {
    await expect(frame.locator('[data-bind="vitals.blood_pressure_diastolic"]')).toHaveText("81");
    const systolic = await frame.locator('[aria-label="Systolic"]').boundingBox();
    const diastolic = await frame.locator('[aria-label="Diastolic"]').boundingBox();
    expect(systolic!.y).toBeLessThan(diastolic!.y);
  }
  await page.screenshot({ path: testInfo.outputPath(`${signal.widget}-received-samples.png`) });
});

test("ECG monitor receives all health channels while its waveform changes with new samples", async ({ page }, testInfo) => {
  dataWidget("ecg");
  await page.setViewportSize({ width: 316, height: 197 });
  const frame = await launch(page, ids.call, true);
  sensorBatch("heart_rate", [{ heartRateBpm: 68 }, { heartRateBpm: 83 }], { sourceKey: "driver:mock" });
  sensorBatch("blood_pressure", [{ systolic: 118, diastolic: 76 }, { systolic: 124, diastolic: 81 }], { sourceKey: "driver:mock" });
  sensorBatch("spo2", [{ spo2Percent: 96 }, { spo2Percent: 99 }], { sourceKey: "driver:mock" });
  sensorBatch("respiration", [{ respirationRateRpm: 14 }, { respirationRateRpm: 19 }], { sourceKey: "driver:mock" });
  sensorBatch("ecg", [{ value: -.2 }, { value: .7 }], { sourceKey: "driver:mock", sampleRate: 250,
    sampleTimestamps: [new Date(Date.now() - 4).toISOString(), new Date().toISOString()] });
  for (const [key, value] of Object.entries({ "vitals.heart_rate": "83", "vitals.blood_pressure_systolic": "124",
    "vitals.blood_pressure_diastolic": "81", "vitals.spo2": "99", "vitals.respiration_rate": "19" })) {
    await expect(frame.locator(`[data-bind="${key}"]`)).toHaveText(value);
  }
  const trace = frame.locator('[data-chart="vitals.ecg_samples"] [data-chart-trace]');
  await expect(trace).not.toHaveAttribute("d", "");
  const original = await trace.getAttribute("d");
  sensorBatch("ecg", [{ value: -.8 }, { value: 1.2 }], { sourceKey: "driver:mock", sequenceStart: 2, sampleRate: 250,
    sampleTimestamps: [new Date(Date.now() - 4).toISOString(), new Date().toISOString()] });
  await expect(trace).not.toHaveAttribute("d", original!);
  await expect(frame.locator('[data-chart="vitals.ecg_samples"]')).toHaveAttribute("data-maximum", "1.2");
  await expect(frame.locator("[data-chart][data-simulated=true]")).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("ecg-all-health-inputs.png") });
});

test("Sensor Health keeps every observed channel accessible in its existing window size", async ({ page }, testInfo) => {
  dataWidget("sensor-health");
  await page.setViewportSize({ width: 316, height: 197 });
  const frame = await launch(page, ids.call, true);
  for (const channel of ["heart_rate", "ecg", "blood_pressure", "spo2", "respiration", "eye_tracking", "steering"]) {
    sensorBatch(channel, [{ value: 1 }], { sourceKey: "driver:mock" });
  }
  await expect(frame.locator('[data-bind="sensor.streaming_label"]')).toHaveText("7/7 observed channels streaming");
  await expect(frame.locator('[data-bind="sensor.summary_3"]')).toContainText("eye tracking");
  await expect(frame.locator('[data-bind="sensor.summary_3"]')).toContainText("steering");
  await expect(frame.locator('[data-bind="sensor.summary_2"]')).toBeInViewport();
  const section = await frame.locator("section").boundingBox();
  expect(section!.height).toBe(197);
  const summary = frame.locator('[data-bind="sensor.summary_3"]');
  await summary.evaluate((element) => { const parent = element.parentElement!; parent.scrollTop = parent.scrollHeight; });
  const last = await summary.boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(197);
  await page.screenshot({ path: testInfo.outputPath("sensor-health-all-channels.png") });
});

test("sensor silence and researcher reset clear readings without restoring examples", async ({ page }) => {
  dataWidget("hr", 300);
  const frame = await launch(page, ids.call, true);
  sensorBatch("heart_rate", [{ heartRateBpm: 73 }]);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("73");
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("—");
  await expect(frame.locator('[data-chart]')).toHaveAttribute("data-data-status", "stale");
  const override = await applyManualWidgetRuntimeCommand(db.pool, ids.session, {
    instanceId: ids.call, action: "update", bindingValues: { "vitals.heart_rate": 60 },
  }, ids.study);
  hub.broadcast("widget.updates", override, ids.study, ids.session);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("60");
  await expect(frame.locator('[data-bind="vitals.heart_rate_min"]')).toHaveText("—");
  await expect(frame.locator('[data-bind="vitals.heart_rate_max"]')).toHaveText("—");
  sensorBatch("heart_rate", [{ heartRateBpm: 90 }], { sequenceStart: 1 });
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("60");
  const reset = await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "reset", bindingValues: {} }, ids.study);
  hub.broadcast("widget.updates", reset, ids.study, ids.session);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("—");
  await expect(frame.locator("[role=status]")).toHaveCount(0);
});

test("preview examples stay isolated from a live sensor feed", async ({ page }) => {
  dataWidget("hr");
  const frame = await launch(page);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("102");
  sensorBatch("heart_rate", [{ heartRateBpm: 73 }]);
  await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("102");
  await expect(page.locator(".browser-toolbar")).toContainText("Preview");
});

test("call buttons confirm state, prevent repeated clicks while pending, and survive reload", async ({ page }) => {
  let release: () => void = () => {};
  const frame = await launch(page);
  await expect.poll(() => core.websocketServer.clients.size).toBeGreaterThan(0);
  hub.broadcast("session.telemetry", { call: { caller_name: "Live caller" } }, ids.study, null);
  await expect(frame.locator("#caller-name")).toHaveText("Live caller");
  gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await frame.locator("#btn-mute").click();
    await expect(frame.locator("[data-widget-root]")).toHaveAttribute("aria-busy", "true");
    await expect(frame.locator("[role=status]")).toHaveCount(0);
    await expect(frame.locator("#btn-mute")).toBeDisabled();
    await frame.locator("#btn-mute").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => requests).toBe(1);
  } finally { gate = undefined; release(); }
  await expect(frame.locator("#btn-mute")).toHaveAttribute("aria-pressed", "true");
  await expect(frame.locator("#btn-mute")).toBeEnabled();
  await expect(frame.locator("[role=status]")).toHaveCount(0);
  await expect(frame.locator("#caller-name")).toHaveText("Live caller");
  await frame.locator("#btn-hold").click();
  await expect(frame.locator("#btn-hold")).toHaveAttribute("aria-pressed", "true");
  await frame.locator("#btn-spkr").click();
  await expect(frame.locator("#btn-spkr")).toHaveAttribute("aria-pressed", "true");
  await expect(frame.locator("#btn-audio")).toHaveAttribute("aria-pressed", "false");
  await expect(frame.locator("#btn-audio span")).toHaveText("Bluetooth");
  await page.reload();
  const reloaded = page.frameLocator("iframe");
  await expect(reloaded.locator("#btn-mute")).toHaveAttribute("aria-pressed", "true");
  await reloaded.locator("#btn-mute").click();
  await expect(reloaded.locator("#btn-mute")).toHaveAttribute("aria-pressed", "false");
  expect(db.events).toHaveLength(0);
});

test("lost responses offer a retry that retrieves the committed result without a second toggle", async ({ page }) => {
  const frame = await launch(page);
  let dropped = false;
  await page.route("**/interactions", async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    await route.fetch(); // Commit the real route's result, then lose its response.
    await route.abort("failed");
  });
  await frame.locator("#btn-mute").click();
  await expect(frame.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await frame.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(frame.locator("#btn-mute")).toBeEnabled();
  await expect(frame.locator("#btn-mute")).toHaveAttribute("aria-pressed", "true");
  expect(requests).toBe(2);
});

test("expired credentials show an actionable error without changing the control", async ({ page }) => {
  const frame = await launch(page);
  rejectStatus = 401;
  await frame.locator("#btn-mute").click();
  await expect(frame.locator("[role=status]")).toContainText("Session expired. Relaunch");
  await expect(frame.locator("#btn-mute")).toBeEnabled();
  await expect(frame.locator("#btn-mute")).toHaveAttribute("aria-pressed", "false");
});

test("WebSocket reconnect restores a researcher reset missed while disconnected", async ({ page }) => {
  const frame = await launch(page, ids.call, true);
  await frame.locator("#btn-mute").click();
  await expect(frame.locator("#btn-mute")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => core.websocketServer.clients.size).toBeGreaterThan(0);
  for (const socket of core.websocketServer.clients) socket.close(1012, "Fixture reconnect");
  await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "reset", bindingValues: {} }, ids.study);
  await expect(frame.locator("#btn-mute")).toHaveAttribute("aria-pressed", "false");
  await expect(frame.locator("#btn-mute")).toBeEnabled();
});

test("music play advances progress and pause freezes it; a researcher reset is restored after reload", async ({ page }) => {
  const frame = await launch(page, ids.music, true);
  await frame.getByRole("button", { name: "Play music", exact: true }).click();
  await expect(frame.getByRole("button", { name: "Pause music", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(frame.locator('[data-bind="media.progress_label"]')).not.toHaveText("1:34");
  await frame.getByRole("button", { name: "Pause music", exact: true }).click();
  await expect(frame.getByRole("button", { name: "Play music", exact: true })).toBeEnabled();
  const paused = await frame.locator('[data-bind="media.progress_label"]').textContent();
  await page.waitForTimeout(1_200);
  await expect(frame.locator('[data-bind="media.progress_label"]')).toHaveText(paused!);
  const reset = await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.music, action: "reset", bindingValues: {} }, ids.study);
  hub.broadcast("widget.updates", reset, ids.study, ids.session);
  await expect(frame.locator('[data-bind="media.progress_label"]')).toHaveText("1:34");
  await page.reload();
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Play music", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(db.events).toHaveLength(3);
});

test("Electron uses the same confirmed interaction controls in a sandboxed overlay", async ({}, testInfo) => {
  test.skip(process.platform === "linux" && !process.env.DISPLAY, "Requires a graphical session or Xvfb");
  const directory = await mkdtemp(path.join(tmpdir(), "scarline-interaction-electron-"));
  const desktop = await electron.launch({ args: [path.resolve("tests/fixtures/widget-runtime-electron.cjs")],
    env: { ...process.env, SCARLINE_WIDGET_TEST_USER_DATA: directory } });
  try {
    const page = await desktop.firstWindow();
    const frame = await launch(page);
    await frame.locator("#btn-mute").click();
    await expect(frame.locator("#btn-mute")).toHaveAttribute("aria-pressed", "true");
    await expect(frame.locator("#btn-mute svg")).toHaveCount(1);
    await expect(frame.locator("[data-widget-root]")).toHaveCSS("background-color", "rgb(104, 109, 118)");
    await expect(frame.locator(".bg-grid")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("electron-call-interaction.png") });
  } finally { await desktop.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Electron renders received ECG samples without a synthetic waveform", async ({}, testInfo) => {
  test.skip(process.platform === "linux" && !process.env.DISPLAY, "Requires a graphical session or Xvfb");
  dataWidget("ecg");
  const directory = await mkdtemp(path.join(tmpdir(), "scarline-data-electron-"));
  const desktop = await electron.launch({ args: [path.resolve("tests/fixtures/widget-runtime-electron.cjs")],
    env: { ...process.env, SCARLINE_WIDGET_TEST_USER_DATA: directory } });
  try {
    const page = await desktop.firstWindow();
    const frame = await launch(page, ids.call, true);
    sensorBatch("ecg", [{ ecgSamples: [0, 1, -.5, 2, 0], sampleRate: 20 }]);
    await expect(frame.locator('[data-chart="vitals.ecg_samples"]')).toHaveAttribute("data-sample-count", "5");
    expect((await frame.locator('[data-chart="vitals.ecg_samples"] path').getAttribute("d"))?.match(/[ML]/g)).toEqual(["M", "L", "L", "L", "L"]);
    await expect(frame.locator('[data-bind="vitals.heart_rate"]')).toHaveText("—");
    await expect(frame.locator("[data-widget-root]")).toHaveCSS("background-color", "rgb(104, 109, 118)");
    await expect(frame.locator(".bg-grid")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("electron-received-ecg.png") });
  } finally { await desktop.close(); await rm(directory, { recursive: true, force: true }); }
});
