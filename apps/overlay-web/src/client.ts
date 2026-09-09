import { popupFeatures, type BrowserDisplay } from "./browser-position.js";

interface RuntimeConfig {
  coreApiOrigin: string;
  coreApiWebSocketOrigin: string;
}

interface RuntimeWidget {
  instanceId: string;
  widgetKey: string;
  name: string;
  entry: string;
  targetDisplay: string;
  inputMode: "click_through" | "interactive";
  width: number;
  height: number;
  x: number;
  y: number;
  bindings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  styleOverrides: Record<string, unknown>;
  state: "visible" | "hidden" | "highlighted";
}

interface RuntimeSnapshot {
  scope: { rendererMode: "desktop" | "browser"; layoutId: string; instanceId: string | null };
  layout: { name: string };
  displays: BrowserDisplay[];
  widgets: RuntimeWidget[];
}

interface ApiEnvelope<T> { data: T }

const app = requiredElement("app");
void start().catch(showError);

async function start(): Promise<void> {
  const config = await fetchJson<RuntimeConfig>("/runtime-config.json", false);
  await exchangeBootstrap(config);
  const snapshot = await fetchJson<ApiEnvelope<RuntimeSnapshot>>(`${config.coreApiOrigin}/api/v1/overlay/runtime`, true);
  const route = routeParts();
  if (route.kind === "launcher") {
    await renderLauncher(config, snapshot.data);
  } else {
    const widget = snapshot.data.widgets.find((entry) => entry.instanceId === route.id);
    if (widget === undefined) throw new Error("This widget is not part of the authorized overlay scope.");
    await renderWidget(config, snapshot.data, widget);
  }
}

async function exchangeBootstrap(config: RuntimeConfig): Promise<void> {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const bootstrap = fragment.get("bootstrap");
  if (bootstrap === null) return;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const response = await fetch(`${config.coreApiOrigin}/api/v1/overlay/bootstrap`, {
    method: "POST",
    headers: { authorization: `Bearer ${bootstrap}`, "content-type": "application/json" },
    credentials: "include",
    body: "{}",
  });
  if (!response.ok) throw new Error(`Overlay authorization failed (${response.status}).`);
}

async function renderLauncher(config: RuntimeConfig, snapshot: RuntimeSnapshot): Promise<void> {
  app.className = "launcher";
  app.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = snapshot.layout.name;
  const instructions = document.createElement("p");
  instructions.textContent = "Each widget opens in a separate overlay window. Use Open when your browser blocks a popup.";
  const list = document.createElement("div");
  list.className = "launcher-list";
  app.append(heading, instructions, list);
  const popups = new Set<Window>();

  for (const widget of snapshot.widgets) {
    const row = document.createElement("div");
    row.className = "launcher-row";
    const label = document.createElement("span");
    label.textContent = widget.name;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open";
    const open = () => {
      const popup = window.open(
        `/widget/${encodeURIComponent(widget.instanceId)}`,
        `scarline-widget-${widget.instanceId}`,
        popupFeatures(widget, snapshot.displays),
      );
      button.dataset.open = String(popup !== null);
      button.textContent = popup === null ? "Open" : "Opened";
      if (popup !== null) popups.add(popup);
      return popup;
    };
    button.addEventListener("click", open);
    row.append(label, button);
    list.append(row);
    open();
  }
  await connectRuntime(config, null, () => undefined, () => {
    for (const popup of popups) if (!popup.closed) popup.close();
    window.close();
  });
}

async function renderWidget(config: RuntimeConfig, snapshot: RuntimeSnapshot, widget: RuntimeWidget): Promise<void> {
  app.className = "widget-shell";
  app.replaceChildren();
  const frame = document.createElement("iframe");
  frame.className = "widget-frame";
  frame.title = widget.name;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  const html = await fetchText(`/assets/${encodeURIComponent(widget.widgetKey)}/${safeEntry(widget.entry)}`);
  frame.srcdoc = injectBridge(html, widget.widgetKey);
  app.append(frame);

  if (snapshot.scope.rendererMode === "browser") {
    const toolbar = document.createElement("div");
    toolbar.className = "browser-toolbar";
    toolbar.textContent = `SCARline · ${widget.name}`;
    app.append(toolbar);
  }

  let frameReady = false;
  const queued: Array<Record<string, unknown>> = [];
  const send = (message: Record<string, unknown>) => {
    if (!frameReady || frame.contentWindow === null) queued.push(message);
    else frame.contentWindow.postMessage({ channel: "scarline.host.v1", ...message }, "*");
  };

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || !isRecord(event.data) || event.data.channel !== "scarline.widget.v1") return;
    if (event.data.type === "ready") {
      frameReady = true;
      for (const message of queued.splice(0)) send(message);
    } else if (event.data.type === "action" && typeof event.data.action === "string") {
      void postInteraction(config, widget.instanceId, event.data.action, isRecord(event.data.payload) ? event.data.payload : {});
    }
  });

  send({ type: "metadata", metadata: widget.metadata });
  send({ type: "bindings", bindings: widget.bindings });
  send({ type: "styles", styles: safeStyles(widget.styleOverrides) });
  send({ type: "state", state: widget.state });
  startSystemBindings(send);
  await connectRuntime(config, widget.instanceId, send, () => window.close());
}

async function connectRuntime(
  config: RuntimeConfig,
  instanceId: string | null,
  send: (message: Record<string, unknown>) => void,
  close: () => void,
): Promise<void> {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let retryCount = 0;
  let connectionVersion = 0;
  const stop = () => {
    stopped = true;
    connectionVersion += 1;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    socket?.close();
    socket = null;
  };
  window.addEventListener("beforeunload", stop, { once: true });

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null) return;
    const delay = Math.min(1_000 * 2 ** retryCount, 15_000);
    retryCount += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (stopped || socket !== null) return;
    const version = ++connectionVersion;
    try {
      const ticket = await fetchJson<ApiEnvelope<{ token: string }>>(
        `${config.coreApiOrigin}/api/v1/overlay/websocket-ticket`,
        true,
        { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      );
      if (stopped || version !== connectionVersion) return;
      if (typeof ticket.data?.token !== "string" || ticket.data.token.length === 0) {
        throw new Error("Overlay WebSocket ticket is invalid.");
      }
      const opened = new WebSocket(`${config.coreApiWebSocketOrigin}/overlay-runtime`, `scarline.overlay-ticket.${ticket.data.token}`);
      socket = opened;
      opened.addEventListener("open", () => {
        if (socket === opened) retryCount = 0;
      });
      opened.addEventListener("message", (event) => {
        let message: unknown;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!isRecord(message)) return;
        if (message.type === "overlay.runtime.close") {
          stop();
          close();
          return;
        }
        if (instanceId === null || message.instanceId !== instanceId) return;
        if (message.type === "overlay.runtime.bindings" && isRecord(message.bindings)) send({ type: "bindings", bindings: message.bindings });
        else if (message.type === "overlay.runtime.trigger" && isRecord(message.trigger)) send({ type: "trigger", trigger: message.trigger });
        else if (message.type === "overlay.runtime.state" && ["visible", "hidden", "highlighted"].includes(String(message.state))) {
          send({ type: "state", state: message.state });
        }
      });
      opened.addEventListener("error", () => {
        if (socket === opened) opened.close();
      });
      opened.addEventListener("close", () => {
        if (socket !== opened) return;
        socket = null;
        scheduleReconnect();
      });
    } catch {
      if (!stopped && version === connectionVersion) scheduleReconnect();
    }
  };
  await connect();
}

async function postInteraction(config: RuntimeConfig, instanceId: string, action: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${config.coreApiOrigin}/api/v1/overlay/interactions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instanceId, action, payload }),
  });
  if (!response.ok) console.error(`SCARline widget interaction rejected (${response.status}).`);
}

function startSystemBindings(send: (message: Record<string, unknown>) => void): void {
  const update = () => {
    const now = new Date();
    const hours = now.getHours() % 12;
    send({
      type: "bindings",
      bindings: {
        "system.time_label": new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now),
        "system.date_label": new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(now),
        "system.day_label": new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now),
        "system.hour_angle": (hours + now.getMinutes() / 60) * 30,
        "system.minute_angle": now.getMinutes() * 6,
        "system.second_angle": now.getSeconds() * 6,
      },
    });
  };
  update();
  window.setInterval(update, 1_000);
}

function injectBridge(html: string, widgetKey: string): string {
  const base = `<base href="/assets/${escapeAttribute(widgetKey)}/" /><script src="/bridge.js"></script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${base}`);
  return `${base}${html}`;
}

function safeEntry(entry: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(entry) || entry.split("/").includes("..")) throw new Error("Widget entry path is invalid.");
  return entry;
}

function safeStyles(value: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key.startsWith("--") && (typeof item === "string" || typeof item === "number"))) as Record<string, string | number>;
}

function routeParts(): { kind: "launcher" | "widget"; id: string } {
  const match = location.pathname.match(/^\/(launcher|widget)\/([^/]+)$/);
  if (match?.[1] === "launcher" && match[2] !== undefined) return { kind: "launcher", id: match[2] };
  if (match?.[1] === "widget" && match[2] !== undefined) return { kind: "widget", id: match[2] };
  throw new Error("Unknown overlay route.");
}

async function fetchJson<T>(url: string, credentials: boolean, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: credentials ? "include" : "same-origin" });
  if (!response.ok) throw new Error(`SCARline request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Widget asset could not be loaded (${response.status}).`);
  return response.text();
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}.`);
  return element;
}

function showError(error: unknown): void {
  app.className = "error";
  app.textContent = error instanceof Error ? error.message : "The overlay could not be started.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export {};
