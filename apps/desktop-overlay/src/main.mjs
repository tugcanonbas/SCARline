import http from "node:http";
import { app, BrowserWindow, screen } from "electron";

const controlPort = Number(process.env.OVERLAY_CONTROL_PORT ?? 4097);
const globalClickThrough = process.env.OVERLAY_CLICK_THROUGH !== "false";

const runtimeConfig = {
  targetDisplay: Number(process.env.OVERLAY_DISPLAY ?? 0),
  windows: [],
  session: {
    studyId: null,
    sessionId: null,
    layoutId: null,
    conditionId: null,
  },
};

const windowsById = new Map();
let quitting = false;
let controlServer = null;
let controlAnchorWindow = null;

function createWebPreferences() {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

function normalizeBounds(bounds = {}) {
  return {
    x: Number.isFinite(bounds.x) ? Number(bounds.x) : 0,
    y: Number.isFinite(bounds.y) ? Number(bounds.y) : 0,
    width: Number.isFinite(bounds.width)
      ? Math.max(1, Number(bounds.width))
      : 180,
    height: Number.isFinite(bounds.height)
      ? Math.max(1, Number(bounds.height))
      : 180,
  };
}

function normalizeDimension(value, fallback) {
  return Number.isFinite(value)
    ? Math.max(1, Number(value))
    : Math.max(1, Number(fallback));
}

function normalizeMode(mode) {
  return mode === "browser_popup" ? "browser_popup" : "transparent_electron";
}

function createWindowOptions(spec) {
  const bounds = normalizeBounds({
    ...spec.bounds,
    width: normalizeDimension(
      spec.bounds?.width,
      spec.preferredWidth ?? spec.minWidth ?? 180,
    ),
    height: normalizeDimension(
      spec.bounds?.height,
      spec.preferredHeight ?? spec.minHeight ?? 180,
    ),
  });
  const mode = normalizeMode(spec.mode);
  const transparent = mode === "transparent_electron";
  const focusable = transparent
    ? process.env.OVERLAY_FOCUSABLE === "true"
    : true;
  const minWidth = normalizeDimension(spec.minWidth, bounds.width);
  const minHeight = normalizeDimension(spec.minHeight, bounds.height);
  return {
    ...bounds,
    minWidth,
    minHeight,
    transparent,
    frame: !transparent,
    alwaysOnTop: transparent,
    focusable,
    skipTaskbar: transparent,
    acceptFirstMouse: true,
    movable: true,
    resizable: !transparent,
    minimizable: !transparent,
    maximizable: !transparent,
    fullscreenable: !transparent,
    thickFrame: !transparent,
    roundedCorners: !transparent,
    backgroundMaterial: transparent ? "none" : undefined,
    hasShadow: !transparent,
    backgroundColor: transparent ? "#00000000" : "#020617",
    show: false,
    webPreferences: createWebPreferences(),
  };
}

function ensureControlAnchorWindow() {
  if (controlAnchorWindow && !controlAnchorWindow.isDestroyed()) {
    return;
  }

  controlAnchorWindow = new BrowserWindow({
    x: -10000,
    y: -10000,
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: createWebPreferences(),
  });
  controlAnchorWindow.loadURL("data:text/html,<html><body></body></html>");
  controlAnchorWindow.on("closed", () => {
    controlAnchorWindow = null;
    if (!quitting) {
      setTimeout(ensureControlAnchorWindow, 0);
    }
  });
}

function applyWindowBehavior(windowRef, spec) {
  const mode = normalizeMode(spec.mode);
  const transparent = mode === "transparent_electron";
  if (transparent) {
    windowRef.setBackgroundColor("#00000000");
    const clickThrough = spec.clickThrough === true && globalClickThrough;
    windowRef.setIgnoreMouseEvents(clickThrough, { forward: true });
    windowRef.setFocusable(process.env.OVERLAY_FOCUSABLE === "true");
    windowRef.setAlwaysOnTop(true, "screen-saver");
    windowRef.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    windowRef.setIgnoreMouseEvents(false);
    windowRef.setFocusable(true);
    windowRef.setAlwaysOnTop(false);
    windowRef.setVisibleOnAllWorkspaces(false);
  }
}

function enforceRendererTransparency(windowRef, spec) {
  if (normalizeMode(spec.mode) !== "transparent_electron") {
    return;
  }

  const transparentCss = `
    html, body, #app, .overlay-root, .overlay-stage, .overlay-zone, .overlay-widget {
      background: transparent !important;
      background-color: transparent !important;
    }
  `;

  const applyTransparency = () => {
    if (windowRef.isDestroyed()) {
      return;
    }

    windowRef.setBackgroundColor("#00000000");
    windowRef.webContents.insertCSS(transparentCss).catch(() => {
      // Keep windows alive even if CSS injection fails.
    });
  };

  windowRef.webContents.on("dom-ready", applyTransparency);
  windowRef.webContents.on("did-finish-load", applyTransparency);
}

function attachRecovery(windowRef, url) {
  windowRef.webContents.on("render-process-gone", () => {
    if (!quitting) {
      setTimeout(() => {
        if (!windowRef.isDestroyed()) {
          windowRef.reload();
        }
      }, 500);
    }
  });

  windowRef.webContents.on("did-fail-load", () => {
    if (!quitting) {
      setTimeout(() => {
        if (!windowRef.isDestroyed()) {
          windowRef.loadURL(url);
        }
      }, 1500);
    }
  });
}

function showWindow(windowRef, spec) {
  const mode = normalizeMode(spec.mode);
  if (mode === "transparent_electron") {
    windowRef.showInactive();
  } else {
    windowRef.show();
  }
}

function updateRuntimeWindowBounds(instanceId, windowRef) {
  const entry = runtimeConfig.windows.find(
    (item) => item.instanceId === instanceId,
  );
  if (!entry || windowRef.isDestroyed()) {
    return;
  }
  entry.bounds = normalizeBounds(windowRef.getBounds());
}

function attachWindowTracking(windowRef, normalizedSpec) {
  const syncBounds = () =>
    updateRuntimeWindowBounds(normalizedSpec.instanceId, windowRef);
  windowRef.on("move", syncBounds);
  windowRef.on("resize", syncBounds);
  windowRef.on("moved", syncBounds);
  windowRef.on("resized", syncBounds);
  if (normalizedSpec.mode === "transparent_electron") {
    windowRef.on("focus", () => {
      if (
        !windowRef.isDestroyed() &&
        process.env.OVERLAY_FOCUSABLE !== "true"
      ) {
        windowRef.blur();
      }
    });
  }
}

function createManagedWindow(spec) {
  const normalizedSpec = {
    instanceId: String(spec.instanceId),
    widgetId: String(spec.widgetId ?? ""),
    mode: normalizeMode(spec.mode),
    clickThrough: spec.clickThrough !== false,
    url: String(spec.url ?? ""),
    bounds: normalizeBounds(spec.bounds),
    minWidth: normalizeDimension(spec.minWidth, spec.bounds?.width ?? 180),
    minHeight: normalizeDimension(spec.minHeight, spec.bounds?.height ?? 180),
    preferredWidth: normalizeDimension(
      spec.preferredWidth,
      spec.bounds?.width ?? spec.minWidth ?? 180,
    ),
    preferredHeight: normalizeDimension(
      spec.preferredHeight,
      spec.bounds?.height ?? spec.minHeight ?? 180,
    ),
  };

  const windowRef = new BrowserWindow(createWindowOptions(normalizedSpec));
  applyWindowBehavior(windowRef, normalizedSpec);
  enforceRendererTransparency(windowRef, normalizedSpec);
  attachRecovery(windowRef, normalizedSpec.url);
  attachWindowTracking(windowRef, normalizedSpec);

  windowRef.on("ready-to-show", () => {
    if (!windowRef.isDestroyed()) {
      showWindow(windowRef, normalizedSpec);
    }
  });

  windowRef.on("closed", () => {
    const existing = windowsById.get(normalizedSpec.instanceId);
    if (existing?.window === windowRef) {
      windowsById.delete(normalizedSpec.instanceId);
    }
  });

  windowRef.loadURL(normalizedSpec.url);
  windowsById.set(normalizedSpec.instanceId, {
    window: windowRef,
    spec: normalizedSpec,
  });
  return windowRef;
}

function updateManagedWindow(spec) {
  const id = String(spec.instanceId ?? "");
  const existing = windowsById.get(id);
  if (!existing || existing.window.isDestroyed()) {
    createManagedWindow(spec);
    return;
  }

  const nextSpec = {
    ...existing.spec,
    mode: normalizeMode(spec.mode ?? existing.spec.mode),
    clickThrough:
      typeof spec.clickThrough === "boolean"
        ? spec.clickThrough
        : existing.spec.clickThrough,
    url:
      typeof spec.url === "string" && spec.url.length > 0
        ? spec.url
        : existing.spec.url,
    bounds: normalizeBounds(spec.bounds ?? existing.spec.bounds),
    minWidth: normalizeDimension(spec.minWidth, existing.spec.minWidth),
    minHeight: normalizeDimension(spec.minHeight, existing.spec.minHeight),
    preferredWidth: normalizeDimension(
      spec.preferredWidth,
      existing.spec.preferredWidth,
    ),
    preferredHeight: normalizeDimension(
      spec.preferredHeight,
      existing.spec.preferredHeight,
    ),
  };

  if (nextSpec.mode !== existing.spec.mode) {
    destroyManagedWindow(id);
    createManagedWindow({
      ...nextSpec,
      instanceId: id,
      widgetId: existing.spec.widgetId,
    });
    return;
  }

  existing.window.setMinimumSize(nextSpec.minWidth, nextSpec.minHeight);
  existing.window.setBounds({
    ...nextSpec.bounds,
    width: Math.max(nextSpec.minWidth, nextSpec.bounds.width),
    height: Math.max(nextSpec.minHeight, nextSpec.bounds.height),
  });
  applyWindowBehavior(existing.window, nextSpec);
  if (nextSpec.url !== existing.spec.url) {
    existing.window.loadURL(nextSpec.url);
  }
  windowsById.set(id, {
    window: existing.window,
    spec: { ...nextSpec, instanceId: id, widgetId: existing.spec.widgetId },
  });
}

function destroyManagedWindow(instanceId) {
  const id = String(instanceId ?? "");
  const existing = windowsById.get(id);
  if (!existing) {
    return;
  }
  existing.window.removeAllListeners("closed");
  existing.window.close();
  windowsById.delete(id);
}

function syncManagedWindows() {
  const nextSpecs = runtimeConfig.windows
    .filter(
      (entry) =>
        entry &&
        typeof entry.instanceId === "string" &&
        entry.instanceId &&
        entry.url,
    )
    .map((entry) => ({
      instanceId: String(entry.instanceId),
      widgetId: String(entry.widgetId ?? ""),
      mode: normalizeMode(entry.mode),
      url: String(entry.url),
      clickThrough: entry.clickThrough !== false,
      bounds: normalizeBounds(entry.bounds),
      minWidth: normalizeDimension(entry.minWidth, entry.bounds?.width ?? 180),
      minHeight: normalizeDimension(
        entry.minHeight,
        entry.bounds?.height ?? 180,
      ),
      preferredWidth: normalizeDimension(
        entry.preferredWidth,
        entry.bounds?.width ?? entry.minWidth ?? 180,
      ),
      preferredHeight: normalizeDimension(
        entry.preferredHeight,
        entry.bounds?.height ?? entry.minHeight ?? 180,
      ),
    }));

  const nextIds = new Set(nextSpecs.map((entry) => entry.instanceId));
  for (const id of Array.from(windowsById.keys())) {
    if (!nextIds.has(id)) {
      destroyManagedWindow(id);
    }
  }

  for (const spec of nextSpecs) {
    if (windowsById.has(spec.instanceId)) {
      updateManagedWindow(spec);
    } else {
      createManagedWindow(spec);
    }
  }
}

function reloadWindows() {
  if (windowsById.size === 0) {
    syncManagedWindows();
    return;
  }
  for (const { window: windowRef } of windowsById.values()) {
    windowRef.reload();
  }
}

function overlayStatus() {
  return {
    status: "running",
    mode: "windows",
    targetDisplay: runtimeConfig.targetDisplay,
    session: runtimeConfig.session,
    windows: Array.from(windowsById.values()).map((entry) => ({
      instanceId: entry.spec.instanceId,
      widgetId: entry.spec.widgetId,
      mode: entry.spec.mode,
      bounds: entry.window.getBounds(),
    })),
    displays: screen.getAllDisplays().map((display, index) => ({
      index,
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
    })),
  };
}

function configureOverlay(payload = {}) {
  if (
    typeof payload.targetDisplay === "number" &&
    Number.isFinite(payload.targetDisplay)
  ) {
    runtimeConfig.targetDisplay = payload.targetDisplay;
  }

  if (Array.isArray(payload.windows)) {
    runtimeConfig.windows = payload.windows
      .map((entry) => ({
        instanceId: String(entry.instanceId ?? ""),
        widgetId: String(entry.widgetId ?? ""),
        mode: normalizeMode(entry.mode),
        url: String(entry.url ?? ""),
        bounds: normalizeBounds(entry.bounds),
        clickThrough: entry.clickThrough !== false,
      }))
      .filter((entry) => entry.instanceId && entry.url);
  }

  if (payload.session && typeof payload.session === "object") {
    runtimeConfig.session = {
      studyId: payload.session.studyId ?? null,
      sessionId: payload.session.sessionId ?? null,
      layoutId: payload.session.layoutId ?? null,
      conditionId: payload.session.conditionId ?? null,
    };
  }
}

function updateWindows(payload = {}) {
  if (!Array.isArray(payload.windows) || payload.windows.length === 0) {
    return;
  }

  const byId = new Map(
    runtimeConfig.windows.map((entry) => [entry.instanceId, entry]),
  );
  for (const update of payload.windows) {
    const id = String(update.instanceId ?? "");
    const existing = byId.get(id);
    if (!existing) {
      continue;
    }

    const next = {
      ...existing,
      bounds: normalizeBounds({
        x: update.bounds?.x ?? update.x ?? existing.bounds.x,
        y: update.bounds?.y ?? update.y ?? existing.bounds.y,
        width: update.bounds?.width ?? update.width ?? existing.bounds.width,
        height:
          update.bounds?.height ?? update.height ?? existing.bounds.height,
      }),
    };

    byId.set(id, next);
    updateManagedWindow(next);
  }

  runtimeConfig.windows = Array.from(byId.values());
}

function openWindows(payload = {}) {
  if (!Array.isArray(payload.windows) || payload.windows.length === 0) {
    return;
  }

  if (payload.session && typeof payload.session === "object") {
    runtimeConfig.session = {
      studyId: payload.session.studyId ?? runtimeConfig.session.studyId,
      sessionId: payload.session.sessionId ?? runtimeConfig.session.sessionId,
      layoutId: payload.session.layoutId ?? runtimeConfig.session.layoutId,
      conditionId:
        payload.session.conditionId ?? runtimeConfig.session.conditionId,
    };
  }

  const byId = new Map(
    runtimeConfig.windows.map((entry) => [entry.instanceId, entry]),
  );
  for (const entry of payload.windows) {
    const normalized = {
      instanceId: String(entry.instanceId ?? ""),
      widgetId: String(entry.widgetId ?? ""),
      mode: normalizeMode(entry.mode),
      url: String(entry.url ?? ""),
      clickThrough: entry.clickThrough !== false,
      bounds: normalizeBounds(entry.bounds),
      minWidth: normalizeDimension(entry.minWidth, entry.bounds?.width ?? 180),
      minHeight: normalizeDimension(
        entry.minHeight,
        entry.bounds?.height ?? 180,
      ),
      preferredWidth: normalizeDimension(
        entry.preferredWidth,
        entry.bounds?.width ?? entry.minWidth ?? 180,
      ),
      preferredHeight: normalizeDimension(
        entry.preferredHeight,
        entry.bounds?.height ?? entry.minHeight ?? 180,
      ),
    };
    if (!normalized.instanceId || !normalized.url) {
      continue;
    }
    byId.set(normalized.instanceId, normalized);
    updateManagedWindow(normalized);
  }

  runtimeConfig.windows = Array.from(byId.values());
}

function parseJsonBody(request, callback) {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    try {
      callback(body ? JSON.parse(body) : {});
    } catch {
      callback(null);
    }
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  });
  response.end(JSON.stringify(payload));
}

function startControlServer() {
  controlServer = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
      });
      response.end();
      return;
    }

    if (request.url === "/health" || request.url === "/status") {
      writeJson(response, 200, overlayStatus());
      return;
    }

    if (request.method === "POST" && request.url === "/reload") {
      reloadWindows();
      writeJson(response, 202, { accepted: true });
      return;
    }

    if (request.method === "POST" && request.url === "/configure") {
      parseJsonBody(request, (payload) => {
        if (!payload) {
          writeJson(response, 400, { error: "invalid_json" });
          return;
        }
        configureOverlay(payload);
        syncManagedWindows();
        writeJson(response, 202, { accepted: true, config: overlayStatus() });
      });
      return;
    }

    if (request.method === "POST" && request.url === "/windows/update") {
      parseJsonBody(request, (payload) => {
        if (!payload) {
          writeJson(response, 400, { error: "invalid_json" });
          return;
        }
        updateWindows(payload);
        writeJson(response, 202, { accepted: true, config: overlayStatus() });
      });
      return;
    }

    if (request.method === "POST" && request.url === "/windows/open") {
      parseJsonBody(request, (payload) => {
        if (!payload) {
          writeJson(response, 400, { error: "invalid_json" });
          return;
        }
        openWindows(payload);
        writeJson(response, 202, { accepted: true, config: overlayStatus() });
      });
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  });

  controlServer.on("error", (error) => {
    console.error(
      `Overlay control server failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  controlServer.listen(controlPort, "127.0.0.1", () => {
    console.log(`Overlay control server listening on 127.0.0.1:${controlPort}`);
  });
}

app.whenReady().then(() => {
  app.dock?.hide?.();
  ensureControlAnchorWindow();
  startControlServer();
});

app.on("before-quit", () => {
  quitting = true;
  controlServer?.close();
});

app.on("window-all-closed", () => {
  // This process is a control server first. Keep it alive so Participant View
  // can open new per-widget windows after the operator closes the last one.
});
