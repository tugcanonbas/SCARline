const appRoot = document.getElementById("app");
const query = new URLSearchParams(window.location.search);
const pathSegments = window.location.pathname
  .replace(/^\/+/, "")
  .split("/")
  .filter(Boolean);
const isLauncherRoute =
  pathSegments[0] === "overlay" && pathSegments[1] === "launcher";
const overlayBasePath = pathSegments[0] === "overlay" ? "/overlay" : "";
const pathLayoutId = isLauncherRoute
  ? pathSegments[2]
  : pathSegments[0] === "overlay"
    ? pathSegments[1]
    : pathSegments[0];
const apiOrigin = window.__SCARLINE_API_ORIGIN || "";
const wsBase =
  window.__SCARLINE_WS_URL || window.location.origin.replace(/^http/, "ws");
const overlayControlOrigin =
  window.__SCARLINE_OVERLAY_CONTROL_ORIGIN || "http://127.0.0.1:4097";
const token = query.get("token") || "";
const chromeMode = query.get("chrome") || "web";
const launchAtMs = Number(query.get("launchAt") || "0");

const state = {
  layoutId: pathLayoutId || query.get("layoutId") || "",
  studyId: query.get("studyId") || "",
  conditionId: query.get("conditionId") || "",
  layout: null,
  widgets: new Map(),
  frames: new Map(),
  directWidgets: new Map(),
  wrappers: new Map(),
  hiddenWidgetIds: new Set(),
  highlightedWidgetIds: new Set(),
  widgetStateOverrides: new Map(),
  bindingOverrides: new Map(),
  widgetStateTimers: new Map(),
  socket: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  reconnecting: false,
  currentSession: null,
  bindingsFrozen: false,
  sessionEnded: false,
  instanceId: query.get("instanceId") || "",
  popupMode: query.get("popupMode") || "",
  isLauncher: isLauncherRoute || query.get("launcher") === "1",
  popupWindows: new Map(),
  popupSyncTimer: null,
  popupBlocked: new Set(),
  lastExportProgress: null,
  sensorSnapshots: new Map(),
  clockTimer: null,
  windowBoundsSyncTimer: null,
  desktopChromeResizeBound: false,
  desktopWindowPreviewBounds: null,
};

const rootShell = document.createElement("div");
const stage = document.createElement("main");
const statusNode = document.createElement("span");
const sessionNode = document.createElement("span");
const layoutNode = document.createElement("span");
const exportNode = document.createElement("span");

function isDirectDesktopWidgetWindow() {
  return isDesktopWidgetWindow();
}

function getPath(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function setPath(target, path, value) {
  const keys = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (
      !cursor[key] ||
      typeof cursor[key] !== "object" ||
      Array.isArray(cursor[key])
    ) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}

function setIfDefined(target, path, value) {
  if (typeof value === "undefined" || value === null || value === "") {
    return;
  }
  setPath(target, path, value);
}

function normalizeWebSocketUrl(base) {
  const fallback = `${window.location.origin.replace(/^http/, "ws")}/ws`;
  const source = String(base || fallback).trim() || fallback;
  const url = new URL(source, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws";
  } else {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toggleClassTokens(element, classNames, enabled) {
  const tokens = String(classNames || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return;
  }
  if (enabled) {
    element.classList.add(...tokens);
  } else {
    element.classList.remove(...tokens);
  }
}

function makeShell(title, detail = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "overlay-shell";
  const titleNode = document.createElement("strong");
  titleNode.textContent = title;
  wrapper.appendChild(titleNode);
  if (detail) {
    const detailNode = document.createElement("small");
    detailNode.textContent = detail;
    wrapper.appendChild(detailNode);
  }
  return wrapper;
}

function setConnectionStatus(label, tone = "idle") {
  statusNode.textContent = label;
  statusNode.dataset.tone = tone;
}

function setSessionIndicator(sessionEvent = state.currentSession) {
  if (!sessionEvent) {
    sessionNode.textContent = "No active session";
    return;
  }

  const status = sessionEvent.status || sessionEvent.state || "active";
  const sessionId = sessionEvent.sessionId || sessionEvent.id || "";
  sessionNode.textContent = sessionId
    ? `Session ${status} · ${String(sessionId).slice(0, 8)}`
    : `Session ${status}`;
}

function setExportIndicator(progress = state.lastExportProgress) {
  if (!progress) {
    exportNode.textContent = "No export";
    exportNode.dataset.tone = "idle";
    return;
  }

  const status = progress.status || progress.state || "running";
  const percent = Number(
    progress.progress ?? progress.percent ?? progress.percentage ?? 0,
  );
  exportNode.textContent = `Export ${status} ${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  exportNode.dataset.tone =
    status === "failed" ? "error" : status === "completed" ? "ready" : "warn";
}

function isDesktopWidgetWindow() {
  return Boolean(
    state.instanceId && chromeMode === "transparent" && !state.isLauncher,
  );
}

function readCurrentWindowBounds() {
  return {
    x: Math.max(0, Number(window.screenX || window.screenLeft || 0)),
    y: Math.max(0, Number(window.screenY || window.screenTop || 0)),
    width: Math.max(1, Number(window.outerWidth || window.innerWidth || 0)),
    height: Math.max(1, Number(window.outerHeight || window.innerHeight || 0)),
  };
}

async function persistCurrentWindowBounds(bounds = readCurrentWindowBounds()) {
  if (!state.studyId || !state.layoutId || !state.instanceId || !token) {
    return;
  }
  try {
    await postJson("/api/system/overlay/windows/update", {
      studyId: state.studyId,
      layoutId: state.layoutId,
      windows: [
        {
          instanceId: state.instanceId,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      ],
    });
  } catch (error) {
    console.warn("Failed to persist desktop widget bounds", error);
  }
}

async function pushDesktopWindowBounds(bounds) {
  if (!state.instanceId || !isDesktopWidgetWindow()) {
    return;
  }
  try {
    await fetch(`${overlayControlOrigin}/windows/update`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        windows: [
          {
            instanceId: state.instanceId,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
        ],
      }),
    });
    state.desktopWindowPreviewBounds = bounds;
  } catch (error) {
    console.warn("Failed to update desktop widget preview bounds", error);
  }
}

function scheduleCurrentWindowBoundsSync(delay = 250) {
  clearTimeout(state.windowBoundsSyncTimer);
  state.windowBoundsSyncTimer = setTimeout(() => {
    persistCurrentWindowBounds().catch((error) => {
      console.warn("Failed to schedule desktop widget bounds sync", error);
    });
  }, delay);
}

function waitForLaunchGate() {
  if (!Number.isFinite(launchAtMs) || launchAtMs <= 0) {
    return Promise.resolve();
  }
  const delay = launchAtMs - Date.now();
  if (delay <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function setupChrome() {
  if (isDirectDesktopWidgetWindow()) {
    document.documentElement.style.setProperty(
      "background",
      "transparent",
      "important",
    );
    document.documentElement.style.setProperty(
      "background-color",
      "transparent",
      "important",
    );
    document.body.style.setProperty("background", "transparent", "important");
    document.body.style.setProperty(
      "background-color",
      "transparent",
      "important",
    );
    appRoot.replaceChildren();
    appRoot.hidden = true;
    setConnectionStatus("Disconnected", "warn");
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    :root { color-scheme: dark; width: 100%; height: 100%; background: transparent !important; background-color: transparent !important; }
    html, body { margin: 0; width: 100%; height: 100%; background: transparent !important; background-color: transparent !important; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; }
    .overlay-root { position: relative; width: 100vw; height: 100vh; overflow: hidden; background: ${chromeMode === "transparent" ? "transparent" : "#020617"}; background-color: ${chromeMode === "transparent" ? "transparent" : "#020617"}; }
    .overlay-root[data-chrome="web"] { background: #020617; }
    .overlay-stage { position: absolute; inset: 0; width: 100vw; height: 100vh; overflow: hidden; background: transparent !important; background-color: transparent !important; }
    .overlay-shell { position: absolute; inset: 0; display: grid; place-content: center; gap: 10px; background: ${chromeMode === "transparent" ? "transparent" : "rgba(2, 6, 23, .92)"}; color: #f8fafc; text-align: center; }
    .overlay-shell strong { font-size: clamp(24px, 3vw, 44px); letter-spacing: -.04em; }
    .overlay-shell small { color: #94a3b8; font-size: 14px; }
    .overlay-zone { position: absolute; pointer-events: none; background: transparent !important; background-color: transparent !important; }
    .overlay-widget { position: relative; width: 100%; height: 100%; pointer-events: none; transition: opacity .18s ease, filter .18s ease, transform .18s ease; background: transparent !important; background-color: transparent !important; }
    .overlay-widget iframe { pointer-events: auto; background: transparent !important; background-color: transparent !important; }
    .overlay-widget[data-state="hidden"] { opacity: 0; pointer-events: none; }
    .overlay-widget[data-state="highlighted"] { filter: drop-shadow(0 0 24px rgba(56, 189, 248, .86)); transform: scale(1.015); }
  `;
  document.head.appendChild(style);

  rootShell.className = "overlay-root";
  rootShell.dataset.chrome = chromeMode;
  sessionNode.textContent = "No active session";
  layoutNode.textContent = "Layout pending";
  setExportIndicator();
  stage.className = "overlay-stage";
  rootShell.append(stage);
  appRoot.replaceChildren(rootShell);
  setConnectionStatus("Disconnected", "warn");
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(path) {
  const url = `${apiOrigin}${path}`;
  try {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error(
        `Fetch failed for ${path}: ${response.status} ${response.statusText}`,
      );
    }
    return response.json();
  } catch (error) {
    console.error(`fetchJson failed for ${url}`, error);
    throw error;
  }
}

async function postJson(path, payload) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return response.json();
}

function collectStringSet(...sources) {
  const values = new Set();
  for (const source of sources) {
    if (Array.isArray(source)) {
      source.forEach((value) => values.add(String(value)));
      continue;
    }

    if (source && typeof source === "object") {
      for (const [key, enabled] of Object.entries(source)) {
        if (enabled) values.add(String(key));
      }
    }
  }
  return values;
}

function collectStateOverrides(...sources) {
  const overrides = new Map();
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string") {
        overrides.set(String(key), value);
      } else if (
        value &&
        typeof value === "object" &&
        typeof value.state === "string"
      ) {
        overrides.set(String(key), value.state);
      }
    }
  }
  return overrides;
}

function collectBindingOverrides(...sources) {
  const overrides = new Map();
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        overrides.set(String(key), value);
      }
    }
  }
  return overrides;
}

async function loadConditionOverrides(conditionId = state.conditionId) {
  state.hiddenWidgetIds = new Set();
  state.highlightedWidgetIds = new Set();
  state.widgetStateOverrides = new Map();
  state.bindingOverrides = new Map();
  if (!state.studyId || !conditionId || !token) {
    return;
  }

  const payload = await fetchJson(`/api/studies/${state.studyId}/conditions`);
  const condition = (payload.data || []).find(
    (entry) => entry.id === conditionId,
  );
  const overrides =
    condition?.widgetOverrides || condition?.widget_overrides || {};
  state.hiddenWidgetIds = collectStringSet(
    overrides.hidden_widgets,
    overrides.hiddenWidgets,
    overrides.hidden,
    overrides.visibility?.hidden,
  );
  state.highlightedWidgetIds = collectStringSet(
    overrides.highlighted_widgets,
    overrides.highlightedWidgets,
    overrides.highlighted,
    overrides.visibility?.highlighted,
  );
  state.widgetStateOverrides = collectStateOverrides(
    overrides.widget_states,
    overrides.widgetStates,
    overrides.states,
    overrides.visibility?.states,
  );
  state.bindingOverrides = collectBindingOverrides(
    overrides.binding_values,
    overrides.bindingValues,
    overrides.bindings,
  );
}

function injectRuntime(html, metadata, instanceId) {
  const metadataLiteral = JSON.stringify(metadata).replace(/<\//g, "<\\/");
  const instanceLiteral = JSON.stringify(instanceId);
  const allowedBindingsLiteral = JSON.stringify(
    (metadata.bindings || []).map((binding) => binding.key),
  );
  const allowedTriggersLiteral = JSON.stringify(
    (metadata.triggers || []).map((trigger) => trigger.action),
  );
  const runtime = `
  <style data-scarline-runtime>
    :root {
      width: 100%;
      height: 100%;
      background: transparent !important;
      background-color: transparent !important;
    }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: transparent !important;
      background-color: transparent !important;
    }
    body {
      display: flex;
      align-items: stretch;
      justify-content: stretch;
    }
    body > *:first-child {
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
  </style>
  <script>
    (() => {
      const instanceId = ${instanceLiteral};
      const metadata = ${metadataLiteral};
      const allowedBindings = new Set(${allowedBindingsLiteral});
      const allowedTriggers = new Set(${allowedTriggersLiteral});
      const bindings = new Map();
      const bindingHandlers = new Map();
      const triggerHandlers = [];
      const stateHandlers = [];
      let currentState = 'visible';
      const blockNetwork = (api) => function blockedNetworkAccess() {
        throw new Error('SCARline widgets must use window.SCARline.send instead of direct ' + api + ' calls');
      };
      // Keep fetch/XHR intact so widget styling runtimes (e.g. Tailwind CDN) can initialize.
      window.WebSocket = blockNetwork('WebSocket');
      window.EventSource = blockNetwork('EventSource');
      function installLayoutRuntime() {
        const root = document.body.firstElementChild;
        if (root) {
          root.setAttribute('data-widget-root', 'true');
        }
        document.documentElement.style.setProperty('background', 'transparent', 'important');
        document.documentElement.style.setProperty('background-color', 'transparent', 'important');
        document.body.style.setProperty('background', 'transparent', 'important');
        document.body.style.setProperty('background-color', 'transparent', 'important');
      }
      function formatValue(element, value) {
        if (value === undefined || value === null) return null;
        if (element?.dataset?.format === 'number') {
          const decimals = Number(element.dataset.decimals ?? '0');
          const numeric = Number(value);
          if (!Number.isNaN(numeric)) return numeric.toFixed(decimals);
        }
        return String(value);
      }
      function applyDomBinding(key, value) {
        const update = () => {
          for (const element of document.querySelectorAll('[data-bind]')) {
            if (element.dataset.bind !== key) continue;
            if (element.dataset.bindClass) {
              const className = element.dataset.bindClass;
              const falseClassName = element.dataset.bindClassFalse;
              if (value) {
                toggleClassTokens(element, className, true);
                if (falseClassName) toggleClassTokens(element, falseClassName, false);
              } else {
                toggleClassTokens(element, className, false);
                if (falseClassName) toggleClassTokens(element, falseClassName, true);
              }
            }
            if (element.dataset.bindStyle) {
              const styleName = element.dataset.bindStyle;
              const unit = element.dataset.styleUnit ?? '';
              element.style.setProperty(styleName, String(value) + unit);
            }
            if (element.dataset.bindAttr) {
              const attrName = element.dataset.bindAttr;
              const formatted = formatValue(element, value);
              if (formatted !== null) element.setAttribute(attrName, formatted);
            }
            if (element.dataset.bindText !== 'false') {
              const formatted = formatValue(element, value);
              if (formatted !== null) element.textContent = formatted;
            }
          }
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', update, { once: true });
        } else {
          update();
        }
      }
      function emitBinding(key, value) {
        bindings.set(key, value);
        applyDomBinding(key, value);
        const handlers = bindingHandlers.get(key) || [];
        handlers.forEach((handler) => {
          try { handler(value); } catch (error) { console.error(error); }
        });
      }
      window.SCARline = {
        onBinding(key, callback) {
          if (!allowedBindings.has(key)) {
            console.warn('Ignoring undeclared widget binding', key, metadata.id);
            return;
          }
          if (typeof callback !== 'function') return;
          const handlers = bindingHandlers.get(key) || [];
          handlers.push(callback);
          bindingHandlers.set(key, handlers);
          if (bindings.has(key)) callback(bindings.get(key));
        },
        onTrigger(callback) {
          if (typeof callback !== 'function') return;
          triggerHandlers.push(callback);
        },
        onStateChange(callback) {
          if (typeof callback !== 'function') return;
          stateHandlers.push(callback);
          callback(currentState);
        },
        send(type, payload) {
          if (typeof type !== 'string' || type.length > 80) {
            throw new Error('SCARline.send requires a short string event type');
          }
          parent.postMessage({ type: 'widget-send', instanceId, eventType: type, payload }, '*');
        },
        getBinding(key) {
          return bindings.get(key);
        },
        getState() {
          return currentState;
        },
        getMetadata() {
          return metadata;
        },
        ready() {
          parent.postMessage({ type: 'widget-ready', instanceId }, '*');
        }
      };
      window.addEventListener('message', (event) => {
        if (event.data?.instanceId !== instanceId) return;
        if (event.data.type === 'binding') emitBinding(event.data.key, event.data.value);
        if (event.data.type === 'trigger') {
          const action = event.data.payload?.action || event.data.payload?.payload?.action;
          if (action && allowedTriggers.size > 0 && !allowedTriggers.has(action)) {
            console.warn('Received undeclared widget trigger', action, metadata.id);
          }
          triggerHandlers.forEach((handler) => {
            try { handler(event.data.payload); } catch (error) { console.error(error); }
          });
        }
        if (event.data.type === 'state') {
          currentState = event.data.state;
          stateHandlers.forEach((handler) => {
            try { handler(currentState); } catch (error) { console.error(error); }
          });
        }
      });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installLayoutRuntime, { once: true });
      } else {
        installLayoutRuntime();
      }
    })();
  </script>`;

  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${runtime}`);
  }
  return `${runtime}${html}`;
}

function withBaseTag(html, href) {
  if (!href || html.includes("<base ")) {
    return html;
  }
  const baseTag = `<base href="${href}" />`;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${baseTag}`);
  }
  return `${baseTag}${html}`;
}

async function loadWidgetAssets(widgetId) {
  const normalizedWidgetId = String(widgetId || "").trim();
  if (!normalizedWidgetId) {
    throw new Error("Missing widget id");
  }

  const pathPrefixes = overlayBasePath
    ? [overlayBasePath, ""]
    : ["", "/overlay"];
  let lastError = null;

  for (const prefix of pathPrefixes) {
    const assetPrefix = `${prefix}/assets/${normalizedWidgetId}`;
    const metadataUrl = `${assetPrefix}/widget.json`;
    const htmlUrl = `${assetPrefix}/index.html`;
    try {
      const [metadataResponse, htmlResponse] = await Promise.all([
        fetch(metadataUrl),
        fetch(htmlUrl),
      ]);
      if (!metadataResponse.ok || !htmlResponse.ok) {
        throw new Error(
          `Asset fetch failed (${metadataResponse.status}/${htmlResponse.status}) via ${assetPrefix}`,
        );
      }
      return {
        metadataText: await metadataResponse.text(),
        htmlText: await htmlResponse.text(),
        assetBaseHref: `${window.location.origin}${assetPrefix}/`,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(`Unable to load assets for widget ${normalizedWidgetId}`)
  );
}

function enforceFrameTransparency(frame) {
  if (!frame) {
    return;
  }

  const apply = () => {
    const doc = frame.contentDocument;
    if (!doc) {
      return;
    }

    const html = doc.documentElement;
    const body = doc.body;
    html?.style?.setProperty("background", "transparent", "important");
    html?.style?.setProperty("background-color", "transparent", "important");
    body?.style?.setProperty("background", "transparent", "important");
    body?.style?.setProperty("background-color", "transparent", "important");
    frame.style.background = "transparent";
    frame.style.backgroundColor = "transparent";
  };

  frame.addEventListener("load", apply);
}

function resolveNodeAssetUrls(node, baseHref) {
  if (!(node instanceof Element)) {
    return;
  }

  for (const attributeName of ["src", "href"]) {
    if (!node.hasAttribute(attributeName)) {
      continue;
    }
    const value = node.getAttribute(attributeName);
    if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
      continue;
    }
    node.setAttribute(attributeName, new URL(value, baseHref).toString());
  }

  for (const element of node.querySelectorAll("[src], [href]")) {
    resolveNodeAssetUrls(element, baseHref);
  }
}

function cloneExecutableScript(sourceScript, baseHref) {
  const nextScript = document.createElement("script");
  for (const { name, value } of Array.from(sourceScript.attributes)) {
    if (name === "src") {
      nextScript.setAttribute("src", new URL(value, baseHref).toString());
      continue;
    }
    nextScript.setAttribute(name, value);
  }
  if (!sourceScript.src) {
    nextScript.textContent = sourceScript.textContent;
  }
  return nextScript;
}

function forwardWidgetInteraction(instanceId, eventType, payload) {
  const sessionId = state.currentSession?.sessionId || state.currentSession?.id;
  if (!state.studyId || !sessionId || !token) {
    console.debug("Widget interaction", { instanceId, eventType, payload });
    return;
  }

  postJson(`/api/studies/${state.studyId}/sessions/${sessionId}/triggers`, {
    triggerType: "manual",
    source: "researcher-trigger",
    widgetId: state.widgets.get(instanceId)?.widgetId || "unknown",
    instanceId,
    action: eventType || "widget-send",
    bindingValues: payload || {},
    payload: {
      source: "overlay-widget",
      eventType,
      payload,
    },
  }).catch((error) =>
    console.warn("Failed to forward widget interaction", error),
  );
}

function createDirectWidgetBridge(instanceId, metadata) {
  const bindings = new Map();
  const bindingHandlers = new Map();
  const triggerHandlers = [];
  const stateHandlers = [];
  let currentState = "visible";
  let disposed = false;

  window.SCARline = {
    onBinding(key, callback) {
      if (disposed || typeof callback !== "function") {
        return;
      }
      const handlers = bindingHandlers.get(key) || [];
      handlers.push(callback);
      bindingHandlers.set(key, handlers);
      if (bindings.has(key)) {
        callback(bindings.get(key));
      }
    },
    onTrigger(callback) {
      if (disposed || typeof callback !== "function") {
        return;
      }
      triggerHandlers.push(callback);
    },
    onStateChange(callback) {
      if (disposed || typeof callback !== "function") {
        return;
      }
      stateHandlers.push(callback);
      callback(currentState);
    },
    send(type, payload) {
      forwardWidgetInteraction(instanceId, type, payload);
    },
    getBinding(key) {
      return bindings.get(key);
    },
    getState() {
      return currentState;
    },
    getMetadata() {
      return metadata;
    },
    ready() {},
  };

  return {
    emitBinding(key, value) {
      if (disposed) return;
      bindings.set(key, value);
      const handlers = bindingHandlers.get(key) || [];
      handlers.forEach((handler) => {
        try {
          handler(value);
        } catch (error) {
          console.error(error);
        }
      });
    },
    emitTrigger(payload) {
      if (disposed) return;
      triggerHandlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error(error);
        }
      });
    },
    emitState(nextState) {
      if (disposed) return;
      currentState = nextState;
      stateHandlers.forEach((handler) => {
        try {
          handler(currentState);
        } catch (error) {
          console.error(error);
        }
      });
    },
    teardown() {
      disposed = true;
      if (window.SCARline?.getMetadata?.()?.id === metadata.id) {
        delete window.SCARline;
      }
    },
  };
}

function mountDirectWidget(wrapper, html, metadata, instanceId) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const baseHref =
    parsed.querySelector("base")?.href || window.location.origin + "/";
  const bridge = createDirectWidgetBridge(instanceId, metadata);

  wrapper.className = parsed.body.className;
  wrapper.setAttribute("data-scarline-direct-widget-host", "true");
  wrapper.dataset.instanceId = instanceId;
  wrapper.style.position = "fixed";
  wrapper.style.inset = "0";
  wrapper.style.width = "100vw";
  wrapper.style.height = "100vh";
  wrapper.style.background = "transparent";
  wrapper.style.backgroundColor = "transparent";
  wrapper.style.overflow = "hidden";
  wrapper.style.pointerEvents = "auto";
  wrapper.replaceChildren();

  for (const child of Array.from(parsed.head.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.tagName === "STYLE" || child.tagName === "LINK") {
      const clone = child.cloneNode(true);
      resolveNodeAssetUrls(clone, baseHref);
      wrapper.appendChild(clone);
    }
  }

  const pendingScripts = [];
  for (const child of Array.from(parsed.body.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && child.nodeName === "SCRIPT") {
      pendingScripts.push(child);
      continue;
    }
    const clone = child.cloneNode(true);
    if (clone instanceof Element) {
      resolveNodeAssetUrls(clone, baseHref);
    }
    wrapper.appendChild(clone);
  }

  for (const scriptNode of pendingScripts) {
    wrapper.appendChild(cloneExecutableScript(scriptNode, baseHref));
  }

  state.directWidgets.set(instanceId, bridge);
}

function normalizeWidgetMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Widget metadata must be an object");
  }

  const bindings = Array.isArray(metadata.bindings)
    ? metadata.bindings
    : metadata.bindings && typeof metadata.bindings === "object"
      ? Object.entries(metadata.bindings).map(([key, value]) => ({
          key,
          ...(value || {}),
        }))
      : [];
  const triggers = Array.isArray(metadata.triggers)
    ? metadata.triggers
    : metadata.actions && typeof metadata.actions === "object"
      ? Object.entries(metadata.actions).map(([action, value]) => ({
          action,
          ...(value || {}),
        }))
      : [];
  const ui =
    metadata.ui && typeof metadata.ui === "object"
      ? "preferredWidth" in metadata.ui
        ? metadata.ui
        : {
            minWidth: Number(metadata.ui?.minSize?.w || 0),
            minHeight: Number(metadata.ui?.minSize?.h || 0),
            preferredWidth: Number(metadata.ui?.preferredSize?.w || 0),
            preferredHeight: Number(metadata.ui?.preferredSize?.h || 0),
          }
      : null;

  return {
    ...metadata,
    bindings,
    triggers,
    ui,
  };
}

function widgetInitialState(widget) {
  const overrideState =
    state.widgetStateOverrides.get(widget.id) ||
    state.widgetStateOverrides.get(widget.widgetId);
  if (overrideState) {
    return overrideState;
  }

  if (
    state.hiddenWidgetIds.has(widget.widgetId) ||
    state.hiddenWidgetIds.has(widget.id)
  ) {
    return "hidden";
  }

  if (
    state.highlightedWidgetIds.has(widget.widgetId) ||
    state.highlightedWidgetIds.has(widget.id)
  ) {
    return "highlighted";
  }

  return "visible";
}

function normalizeWidgetState(nextState) {
  if (nextState === "hide") return "hidden";
  if (nextState === "show" || nextState === "reset") return "visible";
  if (["visible", "hidden", "highlighted"].includes(nextState))
    return nextState;
  return "visible";
}

function setWidgetState(instanceId, nextState, options = {}) {
  const wrapper = state.wrappers.get(instanceId);
  if (!wrapper) {
    return;
  }

  const normalizedState = normalizeWidgetState(nextState);
  clearTimeout(state.widgetStateTimers.get(instanceId));
  state.widgetStateTimers.delete(instanceId);

  wrapper.dataset.state = normalizedState;
  wrapper.hidden = normalizedState === "hidden";
  const directWidget = state.directWidgets.get(instanceId);
  if (directWidget) {
    directWidget.emitState(normalizedState);
  } else {
    const frame = state.frames.get(instanceId);
    frame?.contentWindow?.postMessage(
      { type: "state", instanceId, state: normalizedState },
      "*",
    );
  }

  if (normalizedState === "highlighted" && Number(options.durationMs) > 0) {
    const timer = setTimeout(() => {
      state.widgetStateTimers.delete(instanceId);
      setWidgetState(
        instanceId,
        widgetInitialState(state.widgets.get(instanceId) || {}),
      );
    }, Number(options.durationMs));
    state.widgetStateTimers.set(instanceId, timer);
  }
}

function postBinding(instanceId, key, value) {
  const directWidget = state.directWidgets.get(instanceId);
  if (directWidget) {
    directWidget.emitBinding(key, value);
    return;
  }
  const frame = state.frames.get(instanceId);
  frame?.contentWindow?.postMessage(
    { type: "binding", instanceId, key, value },
    "*",
  );
}

function dispatchBindingPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  applyTelemetryBindings(payload);
}

function localDateBindings(now = new Date()) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hour12 = hours % 12 || 12;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const month = now.toLocaleDateString(undefined, { month: "long" });
  const date = String(now.getDate());
  const year = String(now.getFullYear());

  return {
    system: {
      time_label: now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      date_label: `${month} ${date}`,
      day_label: day,
      hour_angle: (hour12 + minutes / 60) * 30,
      minute_angle: minutes * 6,
      second_angle: seconds * 6,
    },
    calendar: {
      month_label: month,
      year_label: year,
      date_label: date,
      weekday_label: day,
      today_label: "Today",
    },
  };
}

function ensureClockBindings() {
  const update = () => dispatchBindingPayload(localDateBindings());
  update();
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(update, 1000);
}

function sessionBindingPayload(sessionEvent = state.currentSession) {
  if (!sessionEvent) {
    return null;
  }
  const status = String(sessionEvent.status || sessionEvent.state || "Created");
  const startedAt =
    sessionEvent.startedAt ||
    sessionEvent.started_at ||
    sessionEvent.createdAt ||
    sessionEvent.created_at;
  const updatedAt =
    sessionEvent.updatedAt ||
    sessionEvent.updated_at ||
    sessionEvent.completedAt ||
    sessionEvent.completed_at ||
    startedAt;
  const now = Date.now();
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const durationMinutes = Number.isNaN(startedMs)
    ? null
    : Math.max(0, Math.round((now - startedMs) / 60000));
  return {
    session: {
      status_label: titleCase(status),
      runtime_state: String(
        sessionEvent.runtimeMetadata?.status || status,
      ).toLowerCase(),
      started_at_label: startedAt
        ? `Started ${new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Started pending",
      updated_at_label: updatedAt
        ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Updated pending",
      duration_label:
        durationMinutes === null ? "Pending" : `${durationMinutes} min`,
      condition_label:
        sessionEvent.conditionName ||
        sessionEvent.conditionLabel ||
        "Condition pending",
    },
    controls: {
      runtime_state: String(
        sessionEvent.runtimeMetadata?.status || status,
      ).toLowerCase(),
    },
  };
}

function updateSensorSnapshots(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const key = String(
    snapshot.driverId ||
      snapshot.sensorType ||
      snapshot.type ||
      crypto.randomUUID(),
  );
  state.sensorSnapshots.set(key, {
    driverId: String(snapshot.driverId || key),
    sensorType: String(snapshot.sensorType || snapshot.type || "sensor"),
    connected: Boolean(snapshot.connected),
    sampleRate: Number(snapshot.sampleRate || 0),
    message: snapshot.message ? String(snapshot.message) : null,
    checkedAt: snapshot.checkedAt ? String(snapshot.checkedAt) : null,
    degraded: Boolean(snapshot.degraded),
  });
}

function sensorBindingPayload() {
  const snapshots = Array.from(state.sensorSnapshots.values()).sort(
    (left, right) => {
      return (
        left.driverId.localeCompare(right.driverId) ||
        left.sensorType.localeCompare(right.sensorType)
      );
    },
  );
  if (snapshots.length === 0) {
    return null;
  }
  const connectedCount = snapshots.filter((entry) => entry.connected).length;
  const issue = snapshots.find(
    (entry) => entry.degraded || !entry.connected || entry.message,
  );
  const summaries = snapshots.slice(0, 3).map((entry) => {
    const stateLabel = entry.connected
      ? entry.degraded
        ? "degraded"
        : "streaming"
      : "offline";
    return `${titleCase(entry.sensorType)} · ${stateLabel}`;
  });
  while (summaries.length < 3) {
    summaries.push("Awaiting sensor update");
  }
  return {
    sensor: {
      streaming_label: `${connectedCount}/${snapshots.length} sensors streaming`,
      issue_label:
        issue?.message ||
        (issue
          ? `${titleCase(issue.sensorType)} needs attention`
          : "No issues detected"),
      summary_1: summaries[0],
      summary_2: summaries[1],
      summary_3: summaries[2],
    },
  };
}

function contextualTelemetryPayload(message = {}) {
  const sourcePayload =
    message.payload && typeof message.payload === "object"
      ? message.payload
      : message;
  const contextual = JSON.parse(JSON.stringify(sourcePayload || {}));
  const vehicle =
    sourcePayload.vehicle && typeof sourcePayload.vehicle === "object"
      ? sourcePayload.vehicle
      : null;
  if (vehicle) {
    const speed = Number(vehicle.speed);
    const speedLimit = Number(vehicle.speedLimit ?? vehicle.speed_limit);
    if (!Number.isNaN(speedLimit)) {
      setPath(contextual, "vehicle.speedLimit", speedLimit);
      setPath(contextual, "vehicle.speed_limit", speedLimit);
    }
    if (!Number.isNaN(speed)) {
      setPath(contextual, "vehicle.speed", speed);
    }
    if (!Number.isNaN(speed) && !Number.isNaN(speedLimit) && speedLimit > 0) {
      const ratio = Math.max(0, Math.min(1.15, speed / speedLimit));
      setPath(contextual, "vehicle.speed_ratio", Math.round(ratio * 100));
      setPath(
        contextual,
        "vehicle.speed_arc_offset",
        Number((188.5 * (1 - Math.min(ratio, 1))).toFixed(1)),
      );
    }
    setPath(contextual, "vehicle.speed_unit", "km/h");
  }

  const heartRate = sourcePayload.heartRateBpm ?? sourcePayload.bpm;
  setIfDefined(contextual, "vitals.heart_rate", heartRate);
  setIfDefined(
    contextual,
    "vitals.unit",
    typeof heartRate !== "undefined" ? "bpm" : undefined,
  );
  setIfDefined(contextual, "vitals.heart_rate_min", heartRate);
  setIfDefined(contextual, "vitals.heart_rate_max", heartRate);
  setIfDefined(
    contextual,
    "vitals.spo2",
    sourcePayload.spo2 ?? sourcePayload.spo2Percent,
  );
  setIfDefined(
    contextual,
    "vitals.spo2_unit",
    typeof (sourcePayload.spo2 ?? sourcePayload.spo2Percent) !== "undefined"
      ? "%"
      : undefined,
  );
  setIfDefined(
    contextual,
    "vitals.respiration_rate",
    sourcePayload.respirationRate ?? sourcePayload.respiration_rate,
  );
  setIfDefined(
    contextual,
    "vitals.respiration_unit",
    typeof (sourcePayload.respirationRate ?? sourcePayload.respiration_rate) !==
      "undefined"
      ? "rpm"
      : undefined,
  );
  setIfDefined(
    contextual,
    "vitals.blood_pressure_systolic",
    sourcePayload.bloodPressureSystolic ?? sourcePayload.systolic,
  );
  setIfDefined(
    contextual,
    "vitals.blood_pressure_diastolic",
    sourcePayload.bloodPressureDiastolic ?? sourcePayload.diastolic,
  );
  if (
    typeof getPath(contextual, "vitals.blood_pressure_systolic") !== "undefined"
  ) {
    setPath(contextual, "vitals.blood_pressure_unit", "mmHg");
  }
  return contextual;
}

function applyTelemetryBindings(payload) {
  if (state.bindingsFrozen) {
    return;
  }
  for (const [instanceId, entry] of state.widgets.entries()) {
    for (const binding of entry.metadata.bindings || []) {
      const configuredPath = entry.bindingsConfig?.[binding.key];
      const overrideValues =
        state.bindingOverrides.get(instanceId) ||
        state.bindingOverrides.get(entry.widgetId);
      const value = Object.prototype.hasOwnProperty.call(
        overrideValues || {},
        binding.key,
      )
        ? overrideValues[binding.key]
        : getPath(payload, String(configuredPath || binding.key));
      if (typeof value !== "undefined") {
        postBinding(instanceId, binding.key, value);
      }
    }
  }
}

function applyConditionOverridesToWidgets() {
  for (const [instanceId, entry] of state.widgets.entries()) {
    setWidgetState(instanceId, widgetInitialState(entry));
    const overrideValues =
      state.bindingOverrides.get(instanceId) ||
      state.bindingOverrides.get(entry.widgetId);
    if (overrideValues) {
      for (const [key, value] of Object.entries(overrideValues)) {
        postBinding(instanceId, key, value);
      }
    }
  }
}

function targetWidgetIds(update = {}) {
  if (Array.isArray(update.instanceIds)) {
    return update.instanceIds.map(String).filter((id) => state.widgets.has(id));
  }

  if (update.instanceId) {
    return [String(update.instanceId)];
  }

  if (Array.isArray(update.widgetIds)) {
    const widgetIds = new Set(update.widgetIds.map(String));
    return Array.from(state.widgets.entries())
      .filter(([, entry]) => widgetIds.has(entry.widgetId))
      .map(([instanceId]) => instanceId);
  }

  if (update.widgetId) {
    return Array.from(state.widgets.entries())
      .filter(([, entry]) => entry.widgetId === update.widgetId)
      .map(([instanceId]) => instanceId);
  }

  return [];
}

function applyWidgetUpdate(update) {
  const targets = targetWidgetIds(update);
  const action =
    update.action ||
    update.payload?.action ||
    update.state ||
    update.payload?.state ||
    "trigger";
  const bindingValues =
    update.bindingValues ||
    update.payload?.bindingValues ||
    update.payload?.bindings ||
    {};
  const durationMs = update.durationMs || update.payload?.durationMs;

  for (const instanceId of targets) {
    const entry = state.widgets.get(instanceId);
    if (!entry) {
      continue;
    }

    for (const [key, value] of Object.entries(bindingValues)) {
      const bindingKey = key.includes(".") ? key : `${entry.widgetId}.${key}`;
      postBinding(instanceId, bindingKey, value);
      postBinding(instanceId, key, value);
      for (const binding of entry.metadata.bindings || []) {
        if (String(binding.key).split(".").at(-1) === key) {
          postBinding(instanceId, binding.key, value);
        }
      }
    }

    if (
      [
        "hide",
        "hidden",
        "show",
        "visible",
        "reset",
        "highlight",
        "highlighted",
      ].includes(action)
    ) {
      setWidgetState(instanceId, action, { durationMs });
    }

    const directWidget = state.directWidgets.get(instanceId);
    if (directWidget) {
      directWidget.emitTrigger(update);
    } else {
      const frame = state.frames.get(instanceId);
      frame?.contentWindow?.postMessage(
        { type: "trigger", instanceId, payload: update },
        "*",
      );
    }
  }
}

function applyExportProgress(progress) {
  state.lastExportProgress = progress;
  setExportIndicator(progress);
  applyTelemetryBindings({
    export: {
      id: progress.exportId || progress.id,
      status: progress.status || progress.state,
      progress:
        progress.progress ?? progress.percent ?? progress.percentage ?? 0,
      artifactUrl: progress.artifactUrl || progress.downloadUrl,
    },
  });
}

function validateWidgetCompatibility(metadata, widget) {
  if (metadata.id !== widget.widgetId) {
    throw new Error(`Widget metadata mismatch for ${widget.widgetId}`);
  }

  if (!Array.isArray(metadata.bindings) || !Array.isArray(metadata.triggers)) {
    throw new Error(`Widget ${widget.widgetId} has incompatible metadata`);
  }
}

function widgetWindowMode(widget) {
  if (
    widget.windowMode === "browser_popup" ||
    widget.windowMode === "transparent_electron"
  ) {
    return widget.windowMode;
  }
  return state.layout?.isTransparent === false
    ? "browser_popup"
    : "transparent_electron";
}

function buildInstanceOverlayUrl(widget, mode) {
  const params = new URLSearchParams();
  params.set("layoutId", state.layoutId);
  params.set("instanceId", widget.id);
  params.set("chrome", mode === "transparent_electron" ? "transparent" : "web");
  params.set("toolbar", mode === "browser_popup" ? "0" : "1");
  if (state.studyId) params.set("studyId", state.studyId);
  if (state.conditionId) params.set("conditionId", state.conditionId);
  if (token) params.set("token", token);
  if (state.currentSession?.id || state.currentSession?.sessionId) {
    params.set(
      "sessionId",
      state.currentSession.id || state.currentSession.sessionId,
    );
  }
  const overlayPrefix = overlayBasePath || "/overlay";
  return `${window.location.origin}${overlayPrefix}/${state.layoutId}?${params.toString()}`;
}

function popupFeatureString(widget) {
  const left = Number(widget.x || 0);
  const top = Number(widget.y || 0);
  const width = Math.max(120, Number(widget.width || 180));
  const height = Math.max(100, Number(widget.height || 180));
  return [
    "popup=yes",
    "resizable=yes",
    "scrollbars=no",
    "toolbar=yes",
    "location=yes",
    "menubar=yes",
    "status=yes",
    `left=${left}`,
    `top=${top}`,
    `width=${width}`,
    `height=${height}`,
  ].join(",");
}

async function syncPopupBounds() {
  if (
    !state.studyId ||
    !state.layoutId ||
    state.popupWindows.size === 0 ||
    !token
  ) {
    return;
  }
  const windows = [];
  for (const [instanceId, popup] of state.popupWindows.entries()) {
    if (!popup || popup.closed) continue;
    windows.push({
      instanceId,
      x: Math.max(0, Number(popup.screenX || 0)),
      y: Math.max(0, Number(popup.screenY || 0)),
      width: Math.max(1, Number(popup.outerWidth || 0)),
      height: Math.max(1, Number(popup.outerHeight || 0)),
    });
  }
  if (windows.length === 0) return;
  try {
    await postJson("/api/system/overlay/windows/update", {
      studyId: state.studyId,
      layoutId: state.layoutId,
      windows,
    });
  } catch (error) {
    console.warn("Failed to sync popup bounds", error);
  }
}

function ensurePopupSyncLoop() {
  clearInterval(state.popupSyncTimer);
  state.popupSyncTimer = setInterval(syncPopupBounds, 1200);
}

function installDesktopWindowChrome() {
  const existing = document.querySelector("[data-overlay-window-chrome]");
  existing?.remove();

  if (!isDesktopWidgetWindow()) {
    return;
  }

  const chrome = document.createElement("div");
  chrome.dataset.overlayWindowChrome = "true";
  chrome.style.position = "fixed";
  chrome.style.inset = "0";
  chrome.style.pointerEvents = "none";
  chrome.style.zIndex = "10000";

  const dragHandle = document.createElement("div");
  dragHandle.setAttribute("aria-hidden", "true");
  dragHandle.style.position = "absolute";
  dragHandle.style.top = "0";
  dragHandle.style.left = "0";
  dragHandle.style.right = "0";
  dragHandle.style.height = "18px";
  dragHandle.style.cursor = "move";
  dragHandle.style.pointerEvents = "auto";
  dragHandle.style.background = "transparent";
  dragHandle.style.opacity = "0";
  dragHandle.style.userSelect = "none";

  const resizeHandle = document.createElement("div");
  resizeHandle.setAttribute("aria-hidden", "true");
  resizeHandle.style.position = "absolute";
  resizeHandle.style.right = "0";
  resizeHandle.style.bottom = "0";
  resizeHandle.style.width = "18px";
  resizeHandle.style.height = "18px";
  resizeHandle.style.cursor = "nwse-resize";
  resizeHandle.style.pointerEvents = "auto";
  resizeHandle.style.background = "transparent";
  resizeHandle.style.opacity = "0";
  resizeHandle.style.userSelect = "none";

  const bindWindowGesture = (handle, onMove, onComplete) => {
    handle.addEventListener("pointerdown", (event) => {
      if (!isDesktopWidgetWindow()) {
        return;
      }
      event.preventDefault();
      const startPointerX = event.screenX;
      const startPointerY = event.screenY;
      const startBounds = readCurrentWindowBounds();
      let lastBounds = startBounds;

      const move = (nextEvent) => {
        lastBounds = onMove({
          startPointerX,
          startPointerY,
          startBounds,
          pointerX: nextEvent.screenX,
          pointerY: nextEvent.screenY,
        });
      };

      const stop = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", stop, true);
        window.removeEventListener("pointercancel", stop, true);
        onComplete(lastBounds);
      };

      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", stop, true);
      window.addEventListener("pointercancel", stop, true);
    });
  };

  bindWindowGesture(
    dragHandle,
    ({ startPointerX, startPointerY, startBounds, pointerX, pointerY }) => {
      const nextX = startBounds.x + (pointerX - startPointerX);
      const nextY = startBounds.y + (pointerY - startPointerY);
      const nextBounds = {
        ...startBounds,
        x: Math.max(0, Math.round(nextX)),
        y: Math.max(0, Math.round(nextY)),
      };
      void pushDesktopWindowBounds(nextBounds);
      return nextBounds;
    },
    (bounds) => {
      persistCurrentWindowBounds(bounds).catch((error) => {
        console.warn("Failed to persist widget move", error);
      });
    },
  );

  bindWindowGesture(
    resizeHandle,
    ({ startPointerX, startPointerY, startBounds, pointerX, pointerY }) => {
      const nextWidth = Math.max(
        120,
        startBounds.width + (pointerX - startPointerX),
      );
      const nextHeight = Math.max(
        100,
        startBounds.height + (pointerY - startPointerY),
      );
      const nextBounds = {
        ...startBounds,
        width: Math.round(nextWidth),
        height: Math.round(nextHeight),
      };
      void pushDesktopWindowBounds(nextBounds);
      return nextBounds;
    },
    (bounds) => {
      persistCurrentWindowBounds(bounds).catch((error) => {
        console.warn("Failed to persist widget resize", error);
      });
    },
  );

  chrome.append(dragHandle, resizeHandle);
  if (isDirectDesktopWidgetWindow()) {
    document.body.appendChild(chrome);
  } else {
    rootShell.appendChild(chrome);
  }
  if (!state.desktopChromeResizeBound) {
    window.addEventListener("resize", () => scheduleCurrentWindowBoundsSync(), {
      passive: true,
    });
    state.desktopChromeResizeBound = true;
  }
}

function renderLauncherFallback(popups) {
  const fallback = document.createElement("section");
  fallback.className = "overlay-shell";
  const title = document.createElement("strong");
  title.textContent = "Popup windows blocked by browser";
  const detail = document.createElement("small");
  detail.textContent =
    "Use the buttons below to open each widget window manually.";
  fallback.append(title, detail);
  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.flexWrap = "wrap";
  actionRow.style.gap = "8px";
  actionRow.style.justifyContent = "center";
  actionRow.style.marginTop = "12px";
  for (const widget of popups) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Open ${widget.widgetId}`;
    button.addEventListener("click", () => {
      const popup = window.open(
        buildInstanceOverlayUrl(widget, "browser_popup"),
        `scarline_widget_${widget.id}`,
        popupFeatureString(widget),
      );
      if (popup) {
        state.popupWindows.set(widget.id, popup);
        state.popupBlocked.delete(widget.id);
        syncPopupBounds();
      } else {
        state.popupBlocked.add(widget.id);
      }
    });
    actionRow.appendChild(button);
  }
  fallback.appendChild(actionRow);
  stage.replaceChildren(fallback);
}

function openBrowserPopups() {
  const popupWidgets = [...(state.layout?.widgets || [])].sort(
    (left, right) => {
      return (
        Number(left.order || 0) - Number(right.order || 0) ||
        Number(left.y || 0) - Number(right.y || 0) ||
        Number(left.x || 0) - Number(right.x || 0)
      );
    },
  );
  if (popupWidgets.length === 0) {
    stage.replaceChildren(
      makeShell(
        "No widgets in layout",
        "Add widgets in Participant View to open browser windows.",
      ),
    );
    return;
  }

  for (const widget of popupWidgets) {
    const existing = state.popupWindows.get(widget.id);
    if (existing && !existing.closed) {
      continue;
    }
    const popup = window.open(
      buildInstanceOverlayUrl(widget, "browser_popup"),
      `scarline_widget_${widget.id}`,
      popupFeatureString(widget),
    );
    if (popup) {
      state.popupWindows.set(widget.id, popup);
      state.popupBlocked.delete(widget.id);
    } else {
      state.popupBlocked.add(widget.id);
    }
  }

  if (state.popupBlocked.size > 0) {
    renderLauncherFallback(popupWidgets);
  } else {
    stage.replaceChildren(
      makeShell(
        "Browser widget launcher active",
        `${popupWidgets.length} widget windows opened.`,
      ),
    );
  }
  ensurePopupSyncLoop();
  syncPopupBounds();
}

async function renderLayout() {
  if (!state.studyId || !state.layoutId) {
    stage.replaceChildren(
      makeShell(
        "Overlay waiting for a participant layout",
        "Open from Admin Panel or provide studyId and layoutId.",
      ),
    );
    return;
  }

  await loadConditionOverrides();
  const payload = await fetchJson(
    `/api/studies/${state.studyId}/layouts/${state.layoutId}`,
  );
  state.layout = payload.data;
  for (const timer of state.widgetStateTimers.values()) {
    clearTimeout(timer);
  }
  for (const directWidget of state.directWidgets.values()) {
    directWidget.teardown();
  }
  state.directWidgets.clear();
  document
    .querySelectorAll("[data-scarline-direct-widget-host]")
    .forEach((node) => node.remove());
  state.widgets.clear();
  state.frames.clear();
  state.wrappers.clear();
  state.widgetStateTimers.clear();
  stage.replaceChildren();
  installDesktopWindowChrome();
  layoutNode.textContent = state.layout.name || state.layoutId;

  if (state.isLauncher && state.popupMode === "browser") {
    openBrowserPopups();
    return;
  }

  const widgetHost = isDirectDesktopWidgetWindow()
    ? null
    : (() => {
        const host = document.createElement("section");
        host.className = "overlay-zone";
        host.style.left = "0px";
        host.style.top = "0px";
        host.style.width = "100%";
        host.style.height = "100%";
        host.style.zIndex = "10";
        stage.appendChild(host);
        return host;
      })();

  for (const widget of state.layout.widgets) {
    if (state.instanceId && widget.id !== state.instanceId) {
      continue;
    }

    const mode = widgetWindowMode(widget);
    if (
      state.instanceId &&
      mode === "browser_popup" &&
      chromeMode === "transparent"
    ) {
      continue;
    }
    if (
      !state.instanceId &&
      mode === "browser_popup" &&
      chromeMode === "transparent"
    ) {
      // Browser popup widgets are rendered separately; transparent overlay keeps only electron windows.
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "overlay-widget";
    wrapper.dataset.instanceId = widget.id;
    wrapper.dataset.widgetId = widget.widgetId;
    wrapper.dataset.state = widgetInitialState(widget);
    wrapper.style.zIndex = String(100 + Number(widget.order || 0));
    wrapper.style.position = "absolute";
    wrapper.style.left = state.instanceId ? "0px" : `${widget.x || 0}px`;
    wrapper.style.top = state.instanceId ? "0px" : `${widget.y || 0}px`;
    wrapper.style.width = state.instanceId
      ? "100%"
      : `${widget.width || 180}px`;
    wrapper.style.height = state.instanceId
      ? "100%"
      : `${widget.height || 180}px`;
    wrapper.style.background = "transparent";
    wrapper.style.backgroundColor = "transparent";
    wrapper.style.overflow = "hidden";
    if (isDirectDesktopWidgetWindow()) {
      document.body.insertBefore(wrapper, appRoot);
    } else {
      widgetHost.appendChild(wrapper);
    }
    state.wrappers.set(widget.id, wrapper);

    try {
      const assets = await loadWidgetAssets(widget.widgetId);
      const metadata = normalizeWidgetMetadata(JSON.parse(assets.metadataText));
      const html = withBaseTag(assets.htmlText, assets.assetBaseHref);
      validateWidgetCompatibility(metadata, widget);
      state.widgets.set(widget.id, { ...widget, metadata });

      if (isDirectDesktopWidgetWindow()) {
        mountDirectWidget(wrapper, html, metadata, widget.id);
      } else {
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("allowtransparency", "true");
        frame.style.width = "100%";
        frame.style.height = "100%";
        frame.style.border = "0";
        frame.style.background = "transparent";
        frame.style.backgroundColor = "transparent";
        frame.style.pointerEvents = "auto";
        enforceFrameTransparency(frame);
        frame.srcdoc = injectRuntime(html, metadata, widget.id);
        state.frames.set(widget.id, frame);
        wrapper.appendChild(frame);
      }
    } catch (error) {
      console.error(error);
      wrapper.appendChild(makeShell(`Widget failed: ${widget.widgetId}`));
    }
  }

  applyConditionOverridesToWidgets();
  dispatchBindingPayload(localDateBindings());
  dispatchBindingPayload(sessionBindingPayload());
  dispatchBindingPayload(sensorBindingPayload());
}

async function switchToSessionLayout(sessionEvent) {
  state.currentSession = sessionEvent;
  setSessionIndicator(sessionEvent);
  const status = String(
    sessionEvent.status || sessionEvent.state || "",
  ).toLowerCase();
  if (status === "paused") {
    state.bindingsFrozen = true;
    return;
  }
  if (status === "completed" || status === "cancelled") {
    state.bindingsFrozen = true;
    state.sessionEnded = true;
    for (const instanceId of state.widgets.keys()) {
      setWidgetState(instanceId, "hidden");
    }
    return;
  }
  state.bindingsFrozen = false;
  state.sessionEnded = false;

  const nextLayoutId =
    sessionEvent.runtimeMetadata?.layoutId || sessionEvent.layoutId;
  if (sessionEvent.studyId) state.studyId = sessionEvent.studyId;
  if (sessionEvent.conditionId) state.conditionId = sessionEvent.conditionId;
  if (nextLayoutId && nextLayoutId !== state.layoutId) {
    state.layoutId = nextLayoutId;
    await renderLayout();
  } else if (sessionEvent.conditionId) {
    await loadConditionOverrides(sessionEvent.conditionId);
    applyConditionOverridesToWidgets();
  }
}

function connectSocket() {
  if (!token) {
    setConnectionStatus("Preview only", "warn");
    return;
  }

  if (state.socket && state.socket.readyState < WebSocket.CLOSING) {
    state.socket.close();
  }

  const socketUrl = normalizeWebSocketUrl(wsBase);
  socketUrl.searchParams.set("token", token);
  const socket = new WebSocket(socketUrl.toString());
  state.socket = socket;
  setConnectionStatus("Connecting", "warn");

  socket.addEventListener("open", () => {
    state.reconnectAttempt = 0;
    state.reconnecting = false;
    setConnectionStatus("Connected", "ready");
    socket.send(
      JSON.stringify({
        action: "subscribe",
        channels: [
          "session.events",
          "session.telemetry",
          "widget.updates",
          "system.health",
          "sensor.status",
          "export.progress",
        ],
      }),
    );
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignoring invalid overlay websocket message", error);
      return;
    }

    const data = message.data || {};

    if (message.channel === "session.events") {
      await switchToSessionLayout(data);
      dispatchBindingPayload(sessionBindingPayload(data));
      return;
    }

    if (message.channel === "session.telemetry") {
      dispatchBindingPayload(contextualTelemetryPayload(data));
      return;
    }

    if (message.channel === "widget.updates") {
      if (data.payload && targetWidgetIds(data).length === 0) {
        applyTelemetryBindings(data.payload);
      } else {
        applyWidgetUpdate(data);
      }
      return;
    }

    if (message.channel === "export.progress") {
      applyExportProgress(data.payload || data);
      dispatchBindingPayload(localDateBindings());
      return;
    }

    if (message.channel === "sensor.status") {
      updateSensorSnapshots(data.payload || data);
      dispatchBindingPayload(sensorBindingPayload());
    }
  });

  socket.addEventListener("close", () => {
    if (state.reconnecting) return;
    state.reconnecting = true;
    const delay = Math.min(1000 * 2 ** state.reconnectAttempt, 15000);
    setConnectionStatus(`Reconnecting in ${Math.ceil(delay / 1000)}s`, "error");
    state.reconnectAttempt += 1;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connectSocket, delay);
  });

  socket.addEventListener("error", () => {
    setConnectionStatus("Connection error", "error");
  });
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "widget-ready") {
    if (
      state.frames.get(event.data.instanceId)?.contentWindow !== event.source
    ) {
      return;
    }
    const wrapper = state.wrappers.get(event.data.instanceId);
    setWidgetState(event.data.instanceId, wrapper?.dataset.state || "visible");
  }

  if (event.data?.type === "widget-send") {
    if (
      state.frames.get(event.data.instanceId)?.contentWindow !== event.source
    ) {
      return;
    }
    forwardWidgetInteraction(
      event.data.instanceId,
      event.data.eventType || "widget-send",
      event.data.payload || {},
    );
  }
});

setupChrome();
ensureClockBindings();
window.addEventListener("online", () => {
  if (
    token &&
    (!state.socket || state.socket.readyState >= WebSocket.CLOSING)
  ) {
    connectSocket();
  }
});
window.addEventListener("offline", () =>
  setConnectionStatus("Offline", "error"),
);
window.addEventListener("beforeunload", () => {
  if (state.clockTimer) {
    clearInterval(state.clockTimer);
    state.clockTimer = null;
  }
  if (state.popupSyncTimer) {
    clearInterval(state.popupSyncTimer);
    state.popupSyncTimer = null;
  }
});
waitForLaunchGate()
  .then(renderLayout)
  .then(connectSocket)
  .catch((error) => {
    console.error(error);
    stage.replaceChildren(
      makeShell(
        "Overlay runtime failed to initialize",
        error.message || "Unknown error",
      ),
    );
    connectSocket();
  });
