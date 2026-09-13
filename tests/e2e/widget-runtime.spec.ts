import { _electron as electron, expect, test, type Frame, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWidgetAsset, readWidgetComponentAsset } from "../../apps/admin-panel/src/lib/server/widget-assets";

// These fixtures use real widget markup and bridge code without a study,
// participant session, database, or external service.
let origin: string;
let server: Server;
type Mode = "overlay" | "admin-preview";
type WidgetApi = { getBinding(key: string): unknown; getState(): string; send(action: string): void };

test.beforeAll(async () => {
  // A real loopback server also covers Electron's separate iframe processes,
  // which do not consistently use Playwright's intercepted network requests.
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, "http://127.0.0.1").pathname;
    try {
      if (pathname === "/") {
        response.setHeader("content-type", "text/html");
        return response.end('<button id="before">Before widget</button><div id="fixture"></div><button id="after">After widget</button><output id="actions">0</output>');
      }
      if (pathname === "/bridge.js") {
        response.setHeader("content-type", "text/javascript");
        response.setHeader("access-control-allow-origin", "*");
        return response.end(await readFile("apps/overlay-web/dist/bridge.js"));
      }
      const asset = await readWidgetAsset(pathname.slice(1));
      response.setHeader("content-type", asset.contentType);
      response.end(asset.body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function loadWidget(page: Page, widgetId: string, mode: Mode = "overlay") {
  const asset = await readWidgetComponentAsset(widgetId, "index.html", mode === "admin-preview");
  const metadata = JSON.parse(Buffer.from((await readWidgetAsset(`components/${widgetId}/widget.json`)).body).toString());
  const defaults = Object.fromEntries(Object.entries(metadata.bindings).flatMap(([key, value]) => {
    const binding = value as { default?: unknown };
    return Object.hasOwn(binding, "default") ? [[key, binding.default]] : [];
  }));
  const html = Buffer.from(asset.body).toString().replace(/<head>/i,
    `<head><base href="${origin}/components/${widgetId}/">${mode === "overlay" ? '<script type="module" src="/bridge.js"></script>' : ""}`);
  await page.goto(origin);
  await page.evaluate(({ html, metadata, defaults, mode }) => {
    const frame = document.createElement("iframe");
    frame.name = "widget";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.cssText = "width:640px;height:500px;border:0";
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data.type === "ready" || event.data.type === "scarline.widget.ready") {
        if (mode === "overlay") {
          for (const message of [
            { type: "metadata", metadata }, { type: "bindings", bindings: defaults }, { type: "state", state: "visible" },
          ]) frame.contentWindow!.postMessage({ channel: "scarline.host.v1", ...message }, "*");
        }
        frame.dataset.ready = "true";
      }
      if (event.data.type === "action" || event.data.type === "scarline.widget.action") {
        const output = document.getElementById("actions")!;
        output.textContent = String(Number(output.textContent) + 1);
      }
    });
    frame.srcdoc = html;
    document.getElementById("fixture")!.append(frame);
  }, { html, metadata, defaults, mode });
  await expect(page.locator("iframe")).toHaveAttribute("data-ready", "true");
  const frame = await (await page.locator("iframe").elementHandle())!.contentFrame();
  if (!frame) throw new Error(`Widget frame unavailable: ${JSON.stringify(page.frames().map((entry) => ({ name: entry.name(), url: entry.url() })))}`);
  await expect(frame.locator("[data-widget-root]")).toHaveAttribute("data-state", "visible");
  return frame;
}

async function send(page: Page, message: Record<string, unknown>, mode: Mode = "overlay") {
  const envelope = mode === "overlay" ? { channel: "scarline.host.v1", ...message }
    : message.type === "trigger" ? { type: "scarline.preview.trigger", event: message.trigger }
    : message.type === "bindings" ? { type: "scarline.preview.bindings", values: message.bindings }
    : { type: "scarline.preview.state", state: message.state };
  await page.evaluate((envelope) => document.querySelector("iframe")!.contentWindow!.postMessage(envelope, "*"), envelope);
}

async function binding(frame: Frame, key: string) {
  return frame.evaluate((key) => (window as unknown as { SCARline: WidgetApi }).SCARline.getBinding(key), key);
}

test("call boolean bindings preserve icons and labels across repeated updates", async ({ page }) => {
  const frame = await loadWidget(page, "activecall");
  for (const value of [true, false, true, false]) {
    await send(page, { type: "bindings", bindings: {
      "call.is_on_hold": value, "call.is_muted": value, "call.is_speaker": value, "call.is_bluetooth": value,
    } });
    await expect.poll(() => binding(frame, "call.is_muted")).toBe(value);
    for (const [id, label] of [["btn-hold", "Hold"], ["btn-mute", "Mute"], ["btn-spkr", "Speaker"]]) {
      await expect(frame.locator(`#${id} svg`)).toHaveCount(1);
      await expect(frame.locator(`#${id} span`)).toHaveText(label);
    }
    await expect(frame.locator('#btn-mute [data-bind-class="text-blue-500"]')).toHaveClass(value ? /text-blue-500/ : /opacity-60/);
  }
  await expect(frame.locator("[data-widget-root]")).toHaveCSS("background-color", "rgb(104, 109, 118)");
  await expect(frame.locator(".bg-grid")).toHaveCount(1);
});

test("music toggles play/pause icons without replacing SVG paths", async ({ page }) => {
  const frame = await loadWidget(page, "music");
  const icons = frame.locator('[data-action="media.play_pause"] svg');
  for (const playing of [true, false, true]) {
    await send(page, { type: "bindings", bindings: { "media.is_playing": playing } });
    await expect.poll(() => binding(frame, "media.is_playing")).toBe(playing);
    await expect(icons.locator("path")).toHaveCount(2);
    await expect(icons.nth(playing ? 0 : 1)).toBeVisible();
    await expect(icons.nth(playing ? 1 : 0)).toBeHidden();
  }
});

test("hide blocks mouse, keyboard and scripted actions; show preserves disabled controls", async ({ page }) => {
  const frame = await loadWidget(page, "activecall");
  const root = frame.locator("[data-widget-root]");
  await frame.locator("#btn-hold").evaluate((button: HTMLButtonElement) => { button.disabled = true; });
  await frame.locator("#btn-add").focus();
  for (let cycle = 0; cycle < 2; cycle++) {
    await send(page, { type: "trigger", trigger: { action: "hide" } });
    await expect(root).toHaveAttribute("inert", "");
    await expect(root).toHaveAttribute("aria-hidden", "true");
    await expect(frame.locator("#btn-add")).not.toBeFocused();
    await frame.locator("#btn-add").click({ force: true });
    await frame.locator("#btn-add").evaluate((button: HTMLButtonElement) => button.click());
    await frame.evaluate(() => (window as unknown as { SCARline: WidgetApi }).SCARline.send("call.add"));
    await page.locator("#before").focus();
    // A browser may focus the empty iframe itself, but none of its widget
    // controls may enter the keyboard focus sequence while hidden.
    for (let step = 0; step < 4; step++) {
      await page.keyboard.press("Tab");
      await expect(root.locator(":focus")).toHaveCount(0);
      await page.keyboard.press("Enter");
    }
    await expect(page.locator("#actions")).toHaveText(String(cycle));
    await send(page, { type: "trigger", trigger: { action: "show" } });
    await expect(root).not.toHaveAttribute("inert");
    await expect(root).not.toHaveAttribute("aria-hidden");
    await expect(frame.locator("#btn-hold")).toBeDisabled();
    await frame.locator("#btn-add").click();
    await expect(page.locator("#actions")).toHaveText(String(cycle + 1));
  }
});

for (const mode of ["overlay", "admin-preview"] as const) {
  test(`${mode} reset restores original text, style and icons when defaults are absent`, async ({ page }) => {
    const frame = await loadWidget(page, "music", mode);
    const progress = frame.locator('[data-bind="media.progress_ratio"]');
    for (let cycle = 0; cycle < 2; cycle++) {
      await send(page, { type: "trigger", trigger: {
        action: "update", bindingValues: { "media.track_title": "Test track", "media.is_playing": true, "media.progress_ratio": 0 },
      } }, mode);
      await expect(frame.locator('[data-bind="media.track_title"]')).toHaveText("Test track");
      await expect(progress).toHaveCSS("width", "0px");
      await expect.poll(() => binding(frame, "media.track_title")).toBe("Test track");
      await send(page, { type: "trigger", trigger: { action: "reset", state: "hidden", bindingValues: {} } }, mode);
      await expect(frame.locator("[data-widget-root]")).toHaveAttribute("data-state", "hidden");
      await expect(frame.locator('[data-bind="media.track_title"]')).toHaveText("IGYEIH");
      await expect.poll(() => binding(frame, "media.track_title")).toBeUndefined();
      expect(await progress.evaluate((element: HTMLElement) => element.style.width)).toBe("");
      await expect(frame.locator('[data-action="media.play_pause"] svg path')).toHaveCount(2);
      expect(await frame.evaluate(() => (window as unknown as { SCARline: WidgetApi }).SCARline.getState())).toBe("hidden");
    }
  });
}

test("reset restores SVG attributes and condition values without forcing visibility", async ({ page }) => {
  const frame = await loadWidget(page, "speedometer");
  const arc = frame.locator('[data-bind="vehicle.speed_arc_offset"]');
  const speed = frame.locator('[data-bind="vehicle.speed"]');
  await send(page, { type: "trigger", trigger: { action: "update", bindingValues: { "vehicle.speed": 0, "vehicle.speed_arc_offset": 0 } } });
  await expect(speed).toHaveText("0");
  await expect(arc).toHaveAttribute("stroke-dashoffset", "0.0");
  await send(page, { type: "trigger", trigger: { action: "reset", state: "highlighted", bindingValues: { "vehicle.speed": 17 } } });
  await expect(speed).toHaveText("17");
  await expect(arc).toHaveAttribute("stroke-dashoffset", "75.4");
  await expect(frame.locator("[data-widget-root]")).toHaveAttribute("data-state", "highlighted");
  expect(await binding(frame, "vehicle.speed")).toBe(17);
  expect(await binding(frame, "vehicle.speed_arc_offset")).toBeUndefined();
  await send(page, { type: "trigger", trigger: { action: "reset", state: "hidden", bindingValues: {} } });
  await expect(speed).toHaveText("132");
  await expect(frame.locator("[data-widget-root]")).toHaveAttribute("data-state", "hidden");
});

test("Electron renders call and music bindings, hiding and reset in sandboxed overlay windows", async ({}, testInfo) => {
  test.skip(process.platform === "linux" && !process.env.DISPLAY, "The Electron renderer check requires a graphical session or Xvfb");
  const directory = await mkdtemp(path.join(tmpdir(), "scarline-widget-electron-"));
  const desktop = await electron.launch({
    args: [path.resolve("tests/fixtures/widget-runtime-electron.cjs")],
    env: { ...process.env, SCARLINE_WIDGET_TEST_USER_DATA: directory },
  });
  try {
    const page = await desktop.firstWindow();
    for (const widgetId of ["activecall", "music"]) {
      const frame = await loadWidget(page, widgetId);
      const values = widgetId === "activecall" ? { "call.is_muted": true } : { "media.is_playing": true, "media.track_title": "Desktop test" };
      await send(page, { type: "trigger", trigger: { action: "update", bindingValues: values } });
      const key = widgetId === "activecall" ? "call.is_muted" : "media.is_playing";
      await expect.poll(() => binding(frame, key)).toBe(true);
      if (widgetId === "activecall") {
        await expect(frame.locator("#btn-mute span")).toHaveText("Mute");
        await expect(frame.locator("#btn-mute svg")).toHaveCount(1);
      } else {
        await expect(frame.locator('[data-action="media.play_pause"] svg path')).toHaveCount(2);
      }
      await page.screenshot({ path: testInfo.outputPath(`electron-${widgetId}.png`) });
      await send(page, { type: "state", state: "hidden" });
      await expect(frame.locator("[data-widget-root]")).toHaveAttribute("inert", "");
      await frame.locator("[data-action]").first().evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.locator("#actions")).toHaveText("0");
      await send(page, { type: "trigger", trigger: { action: "reset", state: "visible", bindingValues: {} } });
      await expect(frame.locator("[data-widget-root]")).not.toHaveAttribute("inert");
      await expect.poll(() => binding(frame, key)).toBeUndefined();
      await expect(frame.locator("[data-widget-root]")).toHaveCSS("background-color", "rgb(104, 109, 118)");
    }
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
