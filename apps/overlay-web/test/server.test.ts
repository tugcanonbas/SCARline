import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { popupFeatures } from "../src/browser-position.js";
import { buildOverlayWeb, safeFilePath, safePath } from "../src/server.js";

test("serves the overlay shell and widget assets without credentials in URLs", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scarline-overlay-web-"));
  await mkdir(path.join(root, "components", "example"), { recursive: true });
  await writeFile(path.join(root, "components", "example", "index.html"), "<h1>Widget</h1>");
  const app = buildOverlayWeb({
    coreApiOrigin: "http://localhost:8088",
    coreApiWebSocketOrigin: "ws://localhost:8088",
    widgetsDirectory: root,
    rendererAssetsDirectory: path.resolve("dist"),
  });
  context.after(() => app.close());

  const shell = await app.inject({ method: "GET", url: "/widget/00000000-0000-4000-8000-000000000000" });
  assert.equal(shell.statusCode, 200);
  assert.match(shell.body, /src="\/client\.js"/);
  assert.match(shell.body, /href="\/favicon\.ico"/);
  assert.doesNotMatch(shell.body, /token|bootstrap/i);

  const asset = await app.inject({ method: "GET", url: "/assets/example/index.html" });
  assert.equal(asset.statusCode, 200);
  assert.equal(asset.body, "<h1>Widget</h1>");
});

test("converts display-relative browser popup bounds to virtual-desktop coordinates", () => {
  const features = popupFeatures({
    targetDisplay: "display-right",
    x: 35,
    y: 45,
    width: 320,
    height: 180,
  }, [{
    id: "display-right",
    index: 1,
    primary: false,
    bounds: { x: 1920, y: -120, width: 2560, height: 1440 },
  }]);
  assert.match(features, /left=1955/);
  assert.match(features, /top=-75/);
});

test("static path resolution rejects traversal outside the widgets directory", () => {
  assert.throws(() => safePath("/tmp/widgets", "../secret"), /Invalid asset path/);
  assert.equal(safePath("/tmp/widgets", "components/demo/index.html"), "/tmp/widgets/components/demo/index.html");
});

test("static file resolution rejects symlinks that escape the widgets directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scarline-overlay-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "scarline-overlay-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(path.join(outside, "secret.txt"), path.join(root, "escaped.txt"));
  await assert.rejects(() => safeFilePath(root, "escaped.txt"), /Invalid asset path/);
});

test("closes browser overlay windows on terminal or condition-change runtime messages", async () => {
  const [client, bridge] = await Promise.all([
    readFile(new URL("../src/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/bridge.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /overlay\.runtime\.close/);
  assert.match(client, /popup\.close\(\)/);
  assert.match(client, /window\.close\(\)/);
  assert.match(client, /try \{\s*message = JSON\.parse/);
  assert.match(client, /retryTimer !== null/);
  assert.match(client, /message\.instanceId !== instanceId/);
  assert.match(bridge, /getState\(\)/);
  assert.match(bridge, /getMetadata\(\)/);
  assert.ok(bridge.indexOf("state = event.data.state") < bridge.indexOf("listener(state)"));
});
