import { app, BrowserWindow, screen, session } from "electron";
import {
  OverlayHostEventSchema,
  type OverlayHostEvent,
} from "@scarline/contracts";
import WebSocket from "ws";

import { orderedDisplays } from "./geometry.js";
import { commandInstanceId, processDesktopCommand } from "./command-processor.js";
import { resolveOverlayHostId } from "./host.js";
import { logDesktopOverlay } from "./logging.js";
import { ReconnectScheduler } from "./reconnect.js";
import {
  OverlayWindowManager,
  type RectangleLike,
  type WindowChangedEvent,
} from "./window-manager.js";
import type { OverlayHostCommand } from "./types.js";

type DesktopEvent =
  | WindowChangedEvent
  | {
      type: "overlay.status";
      ready: boolean;
      displays: ReturnType<typeof orderedDisplays>;
      windows: ReturnType<OverlayWindowManager["status"]>;
    }
  | {
      type: "overlay.command.result";
      commandId: string;
      accepted: boolean;
      error: string | null;
    };

const coreApiOrigin = new URL(
  process.env.SCARLINE_CORE_API_ORIGIN ?? "http://localhost:8088",
);
const overlayWebOrigin = new URL(
  process.env.SCARLINE_OVERLAY_WEB_ORIGIN ?? "http://localhost:4000",
);
const controlSecret = process.env.OVERLAY_CONTROL_SECRET;
const hostId = resolveOverlayHostId();
let socket: WebSocket | undefined;
let quitting = false;
const reconnectScheduler = new ReconnectScheduler({ connect: connectControl });

const windowManager = new OverlayWindowManager({
  createWindow: createBrowserWindow,
  getAllDisplays: () => screen.getAllDisplays(),
  getPrimaryDisplay: () => screen.getPrimaryDisplay(),
  getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
  onWindowChanged: (event) => emit(event),
  onStatusChanged: () => sendStatus(),
});

logDesktopOverlay("info", "overlay.starting", { hostId });

if (controlSecret === undefined || controlSecret.length < 32) {
  throw new Error("OVERLAY_CONTROL_SECRET must contain at least 32 characters.");
}

app.setName("SCARline Desktop Overlay");
app.commandLine.appendSwitch("disable-pinch");

void app.whenReady().then(() => {
  logDesktopOverlay("info", "overlay.ready", { hostId });
  configureSessionSecurity();
  connectControl();
  sendStatus();
  screen.on("display-added", (_event, display) => {
    windowManager.handleDisplayChange("added", String(display.id));
    logDisplayChange("added", String(display.id));
  });
  screen.on("display-removed", (_event, display) => {
    windowManager.handleDisplayChange("removed", String(display.id));
    logDisplayChange("removed", String(display.id));
  });
  screen.on("display-metrics-changed", (_event, display) => {
    windowManager.handleDisplayChange("metrics-changed", String(display.id));
    logDisplayChange("metrics-changed", String(display.id));
  });
}).catch((error: unknown) => {
  logDesktopOverlay("error", "overlay.startup_failed", {
    hostId,
    error: errorMessage(error),
  });
  app.quit();
});

app.on("window-all-closed", () => undefined);
app.on("before-quit", () => {
  quitting = true;
  reconnectScheduler.cancel();
  socket?.close();
});
process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

async function requestControlToken(): Promise<string> {
  const response = await fetch(new URL("/api/v1/overlay/token", coreApiOrigin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-overlay-control-secret": controlSecret!,
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(
      `CoreAPI rejected desktop overlay authentication (${response.status}).`,
    );
  }
  const envelope = await response.json() as { data?: { token?: unknown } };
  if (typeof envelope.data?.token !== "string") {
    throw new Error("CoreAPI returned an invalid desktop overlay token.");
  }
  return envelope.data.token;
}

function connectControl(): void {
  void requestControlToken().then((token) => {
    if (quitting) return;
    const endpoint = new URL("/overlay-control", coreApiOrigin);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const connection = new WebSocket(
      endpoint,
      `scarline.overlay-control.${token}`,
    );
    socket = connection;
    connection.on("open", () => {
      logDesktopOverlay("info", "overlay.connected", { hostId });
      sendStatus();
    });
    connection.on("message", (data) => {
      void handleCommand(String(data));
    });
    connection.on("error", (error) => {
      logDesktopOverlay("warn", "overlay.connection_error", {
        hostId,
        error: error.message,
      });
    });
    connection.on("close", () => {
      logDesktopOverlay("warn", "overlay.disconnected", { hostId });
      scheduleReconnect(connection);
    });
  }).catch((error: unknown) => {
    logDesktopOverlay("warn", "overlay.authentication_failed", {
      hostId,
      error: errorMessage(error),
    });
    scheduleReconnect();
  });
}

function scheduleReconnect(connection?: WebSocket): void {
  if (connection !== undefined && socket !== connection) return;
  socket = undefined;
  if (quitting) return;
  reconnectScheduler.schedule();
}

async function handleCommand(raw: string): Promise<void> {
  await processDesktopCommand(raw, {
    hostId,
    windows: windowManager,
    assertRendererUrl,
    emitResult: emit,
    onInvalid: (error, issues) => logDesktopOverlay("warn", "command.invalid", { hostId, error, issues }),
    onReceived: (command) => logDesktopOverlay("info", "command.received", {
      hostId,
      commandId: command.commandId,
      commandType: command.type,
      instanceId: commandInstanceId(command),
    }),
    onCompleted: (command) => logDesktopOverlay("info", "command.completed", {
      hostId,
      commandId: command.commandId,
      commandType: command.type,
      instanceId: commandInstanceId(command),
    }),
    onFailed: (command, error) => logDesktopOverlay("error", "command.failed", {
      hostId,
      commandId: command.commandId,
      commandType: command.type,
      instanceId: commandInstanceId(command),
      error,
    }),
  });
}

function createBrowserWindow(
  command: Extract<OverlayHostCommand, { type: "overlay.window.open" }>,
  bounds: RectangleLike,
): BrowserWindow {
  const spec = command.window;
  const partition = `scarline-overlay-${spec.instanceId}`;
  const overlaySession = session.fromPartition(partition, { cache: false });
  overlaySession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  overlaySession.setPermissionCheckHandler(() => false);
  const browserWindow = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    resizable: true,
    movable: true,
    fullscreenable: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition,
    },
  });
  browserWindow.setAlwaysOnTop(true, "floating");
  browserWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  browserWindow.setIgnoreMouseEvents(
    spec.inputMode === "click_through",
    { forward: true },
  );
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url, spec.instanceId)) event.preventDefault();
  });
  browserWindow.webContents.on(
    "will-attach-webview",
    (event) => event.preventDefault(),
  );
  browserWindow.once("ready-to-show", () => browserWindow.showInactive());
  return browserWindow;
}

function sendStatus(): void {
  if (!app.isReady()) return;
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  emit({
    type: "overlay.status",
    ready: true,
    displays: orderedDisplays(displays, primary.id),
    windows: windowManager.status(),
  });
}

function emit(event: DesktopEvent): void {
  const validated: OverlayHostEvent = OverlayHostEventSchema.parse({
    ...event,
    hostId,
    occurredAt: new Date().toISOString(),
  });
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(validated));
  }
}

function assertRendererUrl(value: string, instanceId: string): void {
  if (!isAllowedRendererUrl(value, instanceId)) {
    throw new Error("Renderer URL is outside the configured overlay origin.");
  }
}

function isAllowedRendererUrl(value: string, instanceId: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === overlayWebOrigin.origin
      && url.pathname === `/widget/${instanceId}`
    );
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Desktop overlay command failed.";
}

function logDisplayChange(
  reason: "added" | "removed" | "metrics-changed",
  displayId: string,
): void {
  logDesktopOverlay("info", "display.changed", {
    hostId,
    reason,
    displayId,
    windowCount: windowManager.size,
    degradedWindowCount: windowManager.status().filter(({ degraded }) => degraded).length,
  });
}
