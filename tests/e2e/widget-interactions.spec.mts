import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { OverlayRuntimeScope } from "@scarline/contracts";
import { buildOverlayWeb } from "../../apps/overlay-web/src/server.js";
import { registerRealtimeRoutes } from "../../services/core-api/src/routes/realtime.js";
import { registerErrorHandling, ApiProblem } from "../../services/core-api/src/errors.js";
import { RealtimeHub } from "../../services/core-api/src/realtime/hub.js";
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

test.beforeAll(async () => {
  db = new InteractionDatabase();
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

test.beforeEach(() => { requests = 0; rejectStatus = 0; gate = undefined; db.runtime = {}; db.events = []; });
test.afterAll(async () => { await overlay?.close(); await core?.close(); });

async function launch(page: Page, instanceId = ids.call, live = false) {
  const rendererId = randomUUID();
  grants.set(rendererId, { ...scope, instanceId, ...(live ? {} : { sessionId: null, previewId: rendererId }) });
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
