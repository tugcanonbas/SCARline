import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const widgetsRoot = path.join(repoRoot, "widgets", "components");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function injectIntoHead(html, injection) {
  if (html.includes("</head>")) {
    return html.replace("</head>", `${injection}</head>`);
  }
  return `${injection}${html}`;
}

async function readWidget(widgetId) {
  const widgetDir = path.join(widgetsRoot, widgetId);
  const html = await fs.readFile(path.join(widgetDir, "index.html"), "utf8");
  const metadata = JSON.parse(
    await fs.readFile(path.join(widgetDir, "widget.json"), "utf8"),
  );
  return {
    html,
    metadata,
    baseHref: pathToFileURL(`${widgetDir}/`).href,
  };
}

function buildScarlinesTestBridge({ bindings = {}, state = "visible", blockNetwork = false }) {
  const serializedBindings = JSON.stringify(bindings).replace(/<\//g, "<\\/");
  const serializedState = JSON.stringify(state);
  const networkBlock = blockNetwork
    ? `
        const blockedNetwork = (api) => () => Promise.reject(new Error("SCARline preview blocks " + api));
        window.fetch = blockedNetwork("fetch");
        window.WebSocket = function BlockedWebSocket() {
          throw new Error("SCARline preview blocks WebSocket");
        };
        window.EventSource = function BlockedEventSource() {
          throw new Error("SCARline preview blocks EventSource");
        };
      `
    : "";

  return `
    <script>
      (() => {
        const bindings = new Map(Object.entries(${serializedBindings}));
        const bindingHandlers = new Map();
        const triggerHandlers = [];
        const stateHandlers = [];
        const sent = [];
        const pendingTriggers = [];
        let ready = false;
        let currentState = ${serializedState};

        ${networkBlock}

        function dispatchBinding(key, value) {
          const handlers = bindingHandlers.get(key) || [];
          for (const handler of handlers) {
            handler(value);
          }
        }

        function dispatchState() {
          for (const handler of stateHandlers) {
            handler(currentState);
          }
        }

        function dispatchTrigger(payload) {
          for (const handler of triggerHandlers) {
            handler(payload);
          }
        }

        function flushReadyQueue() {
          if (!ready) return;
          for (const [key, value] of bindings.entries()) {
            dispatchBinding(key, value);
          }
          dispatchState();
          while (pendingTriggers.length > 0) {
            dispatchTrigger(pendingTriggers.shift());
          }
        }

        window.SCARline = {
          onBinding(key, callback) {
            const handlers = bindingHandlers.get(key) || [];
            handlers.push(callback);
            bindingHandlers.set(key, handlers);
            if (ready && bindings.has(key)) {
              callback(bindings.get(key));
            }
          },
          onTrigger(callback) {
            triggerHandlers.push(callback);
          },
          onStateChange(callback) {
            stateHandlers.push(callback);
            if (ready) {
              callback(currentState);
            }
          },
          ready() {
            if (ready) return;
            ready = true;
            flushReadyQueue();
          },
          getBinding(key) {
            return bindings.get(key);
          },
          getState() {
            return currentState;
          },
          getMetadata() {
            return {};
          },
          send(type, payload) {
            sent.push({ type, payload });
          }
        };

        window.__SCARLINE_TEST__ = {
          sent,
          emitBinding(key, value) {
            bindings.set(key, value);
            if (ready) {
              dispatchBinding(key, value);
            }
          },
          emitState(nextState) {
            currentState = nextState;
            if (ready) {
              dispatchState();
            }
          },
          emitTrigger(payload) {
            if (ready) {
              dispatchTrigger(payload);
            } else {
              pendingTriggers.push(payload);
            }
          }
        };
      })();
    </script>
  `;
}

function buildDirectHostDocument(widget, bridgeScript) {
  const headMatch = widget.html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = widget.html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  if (!headMatch || !bodyMatch) {
    throw new Error("Widget HTML is missing head or body");
  }

  const bodyAttributes = bodyMatch[1] || "";
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <base href="${widget.baseHref}" />
      ${bridgeScript}
      ${headMatch[1]}
    </head>
    <body>
      <div data-scarline-widget-host="true"${bodyAttributes}>
        ${bodyMatch[2]}
      </div>
    </body>
  </html>`;
}

function buildIframeHostDocument(frameHtml) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <style>
        html, body {
          margin: 0;
          padding: 0;
          background: #000;
        }

        iframe {
          width: 420px;
          height: 260px;
          border: 0;
          background: transparent;
        }
      </style>
    </head>
    <body>
      <iframe id="widget-frame" sandbox="allow-scripts"></iframe>
      <script>
        document.getElementById("widget-frame").srcdoc = ${JSON.stringify(frameHtml)};
      </script>
    </body>
  </html>`;
}

async function openWindow(html) {
  const windowRef = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  await windowRef.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return windowRef;
}

async function waitFor(windowRef, expression, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await windowRef.webContents.executeJavaScript(expression, true);
    if (result) {
      return result;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

async function runIframeSpeedometerScenario() {
  const widget = await readWidget("speedometer");
  const bridgeScript = buildScarlinesTestBridge({
    bindings: {
      "vehicle.speed": 88,
      "vehicle.speed_limit": 120,
      "vehicle.speed_ratio": 73,
      "vehicle.speed_arc_offset": 42.5,
      "vehicle.speed_unit": "km/h",
    },
  });
  const frameHtml = injectIntoHead(
    widget.html.replace("<head>", `<head><base href="${widget.baseHref}" />`),
    bridgeScript,
  );
  const windowRef = await openWindow(buildIframeHostDocument(frameHtml));

  try {
    await waitFor(
      windowRef,
      `document.getElementById("widget-frame")?.contentDocument?.querySelector('[data-bind="vehicle.speed"]')?.textContent?.trim() === "88"`,
    );

    const initialState = await windowRef.webContents.executeJavaScript(`
      (() => {
        const frame = document.getElementById("widget-frame");
        const doc = frame.contentDocument;
        const root = doc.querySelector("[data-widget-root]");
        const speed = doc.querySelector('[data-bind="vehicle.speed"]').textContent.trim();
        const arcOffset = doc.querySelector('[data-bind="vehicle.speed_arc_offset"]').getAttribute("stroke-dashoffset");
        const width = getComputedStyle(root).width;
        return { speed, arcOffset, width };
      })()
    `);

    assert.equal(initialState.speed, "88");
    assert.equal(initialState.arcOffset, "42.5");
    assert.equal(initialState.width, "150px");

    await windowRef.webContents.executeJavaScript(`
      (() => {
        const frame = document.getElementById("widget-frame");
        frame.contentWindow.__SCARLINE_TEST__.emitBinding("vehicle.speed", 94);
        frame.contentWindow.__SCARLINE_TEST__.emitBinding("vehicle.speed_arc_offset", 12.3);
        frame.contentWindow.__SCARLINE_TEST__.emitState("highlighted");
      })()
    `);

    const updatedState = await waitFor(
      windowRef,
      `(() => {
        const frame = document.getElementById("widget-frame");
        const doc = frame.contentDocument;
        return doc.querySelector('[data-bind="vehicle.speed"]')?.textContent?.trim() === "94"
          && doc.querySelector('[data-bind="vehicle.speed_arc_offset"]')?.getAttribute("stroke-dashoffset") === "12.3"
          && doc.querySelector("[data-widget-root]")?.dataset?.state === "highlighted";
      })()`,
    );

    assert.equal(updatedState, true);
  } finally {
    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }
}

async function runDirectMusicScenario() {
  const widget = await readWidget("music");
  const bridgeScript = buildScarlinesTestBridge({
    bindings: {
      "media.track_title": "Test Track",
      "media.artist": "SCARline QA",
      "media.album": "Runtime",
      "media.progress_label": "0:45",
      "media.duration_label": "3:29",
      "media.progress_ratio": 50,
      "media.is_playing": true,
    },
  });
  const windowRef = await openWindow(
    buildDirectHostDocument(widget, bridgeScript),
  );

  try {
    await waitFor(
      windowRef,
      `document.querySelector('[data-bind="media.track_title"]')?.textContent?.trim() === "Test Track"`,
    );

    const initialState = await windowRef.webContents.executeJavaScript(`
      (() => {
        const progress = document.querySelector('[data-bind="media.progress_ratio"]');
        const pauseIcon = document.querySelector('svg[data-bind="media.is_playing"][data-bind-class="inline-block"]');
        return {
          width: progress.style.width,
          pauseVisible: !pauseIcon.classList.contains("hidden")
        };
      })()
    `);
    assert.equal(initialState.width, "50%");
    assert.equal(initialState.pauseVisible, true);

    await windowRef.webContents.executeJavaScript(`
      (() => {
        window.__SCARLINE_TEST__.emitBinding("media.progress_ratio", 80);
        window.__SCARLINE_TEST__.emitBinding("media.is_playing", false);
        document.querySelector('[data-action="media.play_pause"]').click();
      })()
    `);

    const updatedState = await waitFor(
      windowRef,
      `(() => {
        const progress = document.querySelector('[data-bind="media.progress_ratio"]');
        const pauseIcon = document.querySelector('svg[data-bind="media.is_playing"][data-bind-class="inline-block"]');
        return progress.style.width === "80%"
          && pauseIcon.classList.contains("hidden")
          && window.__SCARLINE_TEST__.sent.some((event) => event.type === "media.play_pause");
      })()`,
    );
    assert.equal(updatedState, true);
  } finally {
    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }
}

async function runDirectWaveformScenario() {
  const widget = await readWidget("hr");
  const bridgeScript = buildScarlinesTestBridge({
    bindings: {
      "vitals.heart_rate": 102,
      "vitals.heart_rate_min": 87,
      "vitals.heart_rate_max": 113,
      "vitals.heart_rate_wave_scale": 1,
      "vitals.heart_rate_wave_duration": 1.35,
      "vitals.unit": "bpm",
    },
  });
  const windowRef = await openWindow(
    buildDirectHostDocument(widget, bridgeScript),
  );

  try {
    await waitFor(
      windowRef,
      `document.querySelector('[data-bind="vitals.heart_rate"]')?.textContent?.trim() === "102"`,
    );

    await windowRef.webContents.executeJavaScript(`
      (() => {
        window.__SCARLINE_TEST__.emitBinding("vitals.heart_rate_wave_duration", 2.2);
        window.__SCARLINE_TEST__.emitBinding("vitals.heart_rate_wave_scale", 1.8);
      })()
    `);

    const updatedState = await waitFor(
      windowRef,
      `(() => {
        const durationNode = document.querySelector('[data-bind="vitals.heart_rate_wave_duration"]');
        const scaleNode = document.querySelector('[data-bind="vitals.heart_rate_wave_scale"]');
        return durationNode.style.getPropertyValue("--wave-duration") === "2.2s"
          && scaleNode.style.getPropertyValue("--wave-scale") === "1.8";
      })()`,
    );
    assert.equal(updatedState, true);
  } finally {
    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }
}

async function runCardStylingScenario() {
  const widget = await readWidget("navigation-prompt");
  const bridgeScript = buildScarlinesTestBridge({
    bindings: {
      "navigation.current_instruction": "Keep right and prepare for the next junction.",
      "navigation.next_waypoint": "Next waypoint: North gate",
      "navigation.route_label": "Route A",
    },
  });
  const windowRef = await openWindow(
    buildDirectHostDocument(widget, bridgeScript),
  );

  try {
    await waitFor(
      windowRef,
      `document.querySelector('[data-bind="navigation.current_instruction"]')?.textContent?.includes("Keep right")`,
    );

    const styles = await windowRef.webContents.executeJavaScript(`
      (() => {
        const root = document.querySelector("[data-widget-root]");
        const computed = getComputedStyle(root);
        return {
          width: computed.width,
          height: computed.height,
          radius: computed.borderTopLeftRadius,
          background: computed.backgroundColor
        };
      })()
    `);

    assert.equal(styles.width, "316px");
    assert.equal(styles.height, "129px");
    assert.equal(styles.radius, "16px");
    assert.notEqual(styles.background, "rgba(0, 0, 0, 0)");
  } finally {
    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }
}

async function runPreviewScenario() {
  const widget = await readWidget("navigation-prompt");
  const defaults = Object.fromEntries(
    Object.entries(widget.metadata.bindings || {}).flatMap(([key, value]) =>
      "default" in value ? [[key, value.default]] : [],
    ),
  );
  const bridgeScript = buildScarlinesTestBridge({
    bindings: defaults,
    blockNetwork: true,
  });
  const previewHtml = injectIntoHead(
    widget.html.replace("<head>", `<head><base href="${widget.baseHref}" />`),
    bridgeScript,
  );
  const windowRef = await openWindow(previewHtml);

  try {
    await waitFor(
      windowRef,
      `document.querySelector('[data-bind="navigation.route_label"]')?.textContent?.trim() === "Route A"`,
    );

    const networkMessage = await windowRef.webContents.executeJavaScript(`
      window.fetch("/blocked").then(
        () => "resolved",
        (error) => String(error.message)
      )
    `);
    assert.match(networkMessage, /SCARline preview blocks fetch/);
  } finally {
    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }
}

async function main() {
  await app.whenReady();

  try {
    await runIframeSpeedometerScenario();
    await runDirectMusicScenario();
    await runDirectWaveformScenario();
    await runCardStylingScenario();
    await runPreviewScenario();
    console.log(JSON.stringify({ ok: true }));
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    app.exit(1);
  }
}

await main();
