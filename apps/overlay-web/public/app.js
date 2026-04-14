const appRoot = document.getElementById('app');
const query = new URLSearchParams(window.location.search);
const pathSegments = window.location.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
const isLauncherRoute = pathSegments[0] === 'overlay' && pathSegments[1] === 'launcher';
const overlayBasePath = pathSegments[0] === 'overlay' ? '/overlay' : '';
const pathLayoutId = isLauncherRoute
  ? pathSegments[2]
  : (pathSegments[0] === 'overlay' ? pathSegments[1] : pathSegments[0]);
const apiOrigin = window.__SCARLINE_API_ORIGIN || '';
const wsBase = window.__SCARLINE_WS_URL || window.location.origin.replace(/^http/, 'ws');
const token = query.get('token') || '';
const chromeMode = query.get('chrome') || 'web';

const state = {
  layoutId: pathLayoutId || query.get('layoutId') || '',
  studyId: query.get('studyId') || '',
  conditionId: query.get('conditionId') || '',
  layout: null,
  widgets: new Map(),
  frames: new Map(),
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
  instanceId: query.get('instanceId') || '',
  popupMode: query.get('popupMode') || '',
  isLauncher: isLauncherRoute || query.get('launcher') === '1',
  popupWindows: new Map(),
  popupSyncTimer: null,
  popupBlocked: new Set(),
  lastExportProgress: null
};

const rootShell = document.createElement('div');
const toolbar = document.createElement('div');
const stage = document.createElement('main');
const statusNode = document.createElement('span');
const sessionNode = document.createElement('span');
const layoutNode = document.createElement('span');
const exportNode = document.createElement('span');

function getPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function makeShell(title, detail = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'overlay-shell';
  const titleNode = document.createElement('strong');
  titleNode.textContent = title;
  wrapper.appendChild(titleNode);
  if (detail) {
    const detailNode = document.createElement('small');
    detailNode.textContent = detail;
    wrapper.appendChild(detailNode);
  }
  return wrapper;
}

function setConnectionStatus(label, tone = 'idle') {
  statusNode.textContent = label;
  statusNode.dataset.tone = tone;
}

function setSessionIndicator(sessionEvent = state.currentSession) {
  if (!sessionEvent) {
    sessionNode.textContent = 'No active session';
    return;
  }

  const status = sessionEvent.status || sessionEvent.state || 'active';
  const sessionId = sessionEvent.sessionId || sessionEvent.id || '';
  sessionNode.textContent = sessionId ? `Session ${status} · ${String(sessionId).slice(0, 8)}` : `Session ${status}`;
}

function setExportIndicator(progress = state.lastExportProgress) {
  if (!progress) {
    exportNode.textContent = 'No export';
    exportNode.dataset.tone = 'idle';
    return;
  }

  const status = progress.status || progress.state || 'running';
  const percent = Number(progress.progress ?? progress.percent ?? progress.percentage ?? 0);
  exportNode.textContent = `Export ${status} ${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  exportNode.dataset.tone = status === 'failed' ? 'error' : status === 'completed' ? 'ready' : 'warn';
}

function setupChrome() {
  const showToolbar = chromeMode !== 'transparent' && query.get('toolbar') !== '0';
  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: dark; }
    html, body { margin: 0; background: transparent; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; }
    .overlay-root { position: relative; width: 100vw; height: 100vh; overflow: hidden; background: ${chromeMode === 'transparent' ? 'transparent' : '#020617'}; }
    .overlay-root[data-chrome="web"] { background: #020617; }
    .overlay-toolbar { position: fixed; top: 14px; left: 50%; z-index: 9999; display: flex; transform: translateX(-50%); align-items: center; gap: 12px; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 999px; background: rgba(2, 6, 23, 0.78); padding: 9px 12px; color: #e2e8f0; box-shadow: 0 20px 50px rgba(0,0,0,.32); backdrop-filter: blur(16px); }
    .overlay-toolbar[hidden] { display: none; }
    .overlay-toolbar span { font-size: 12px; line-height: 1; }
    .overlay-toolbar [data-tone="ready"] { color: #86efac; }
    .overlay-toolbar [data-tone="warn"] { color: #fde68a; }
    .overlay-toolbar [data-tone="error"] { color: #fca5a5; }
    .overlay-toolbar button { border: 0; border-radius: 999px; background: rgba(15, 23, 42, .9); color: #f8fafc; cursor: pointer; padding: 7px 10px; font-size: 12px; }
    .overlay-stage { position: absolute; inset: 0; width: 100vw; height: 100vh; overflow: hidden; }
    .overlay-shell { position: absolute; inset: 0; display: grid; place-content: center; gap: 10px; background: rgba(2, 6, 23, .92); color: #f8fafc; text-align: center; }
    .overlay-shell strong { font-size: clamp(24px, 3vw, 44px); letter-spacing: -.04em; }
    .overlay-shell small { color: #94a3b8; font-size: 14px; }
    .overlay-zone { position: absolute; pointer-events: none; }
    .overlay-widget { position: relative; width: 100%; height: 100%; pointer-events: none; transition: opacity .18s ease, filter .18s ease, transform .18s ease; }
    .overlay-widget iframe { pointer-events: auto; }
    .overlay-widget[data-state="hidden"] { opacity: 0; pointer-events: none; }
    .overlay-widget[data-state="highlighted"] { filter: drop-shadow(0 0 24px rgba(56, 189, 248, .86)); transform: scale(1.015); }
  `;
  document.head.appendChild(style);

  rootShell.className = 'overlay-root';
  rootShell.dataset.chrome = chromeMode;
  toolbar.className = 'overlay-toolbar';
  toolbar.hidden = !showToolbar;
  sessionNode.textContent = 'No active session';
  layoutNode.textContent = 'Layout pending';
  setExportIndicator();

  const fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.textContent = 'Fullscreen';
  fullscreenButton.addEventListener('click', async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await rootShell.requestFullscreen();
    }
  });

  const exitButton = document.createElement('button');
  exitButton.type = 'button';
  exitButton.textContent = 'Exit';
  exitButton.addEventListener('click', () => {
    window.close();
    stage.replaceChildren(makeShell('Overlay closed', 'Close this browser tab if it remains open.'));
  });

  toolbar.append(statusNode, sessionNode, layoutNode, exportNode, fullscreenButton, exitButton);
  stage.className = 'overlay-stage';
  rootShell.append(toolbar, stage);
  appRoot.replaceChildren(rootShell);
  setConnectionStatus('Disconnected', 'warn');
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(path) {
  const url = `${apiOrigin}${path}`;
  try {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error(`Fetch failed for ${path}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`fetchJson failed for ${url}`, error);
    throw error;
  }
}

async function postJson(path, payload) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify(payload)
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

    if (source && typeof source === 'object') {
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
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') {
        overrides.set(String(key), value);
      } else if (value && typeof value === 'object' && typeof value.state === 'string') {
        overrides.set(String(key), value.state);
      }
    }
  }
  return overrides;
}

function collectBindingOverrides(...sources) {
  const overrides = new Map();
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
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
  const condition = (payload.data || []).find((entry) => entry.id === conditionId);
  const overrides = condition?.widgetOverrides || condition?.widget_overrides || {};
  state.hiddenWidgetIds = collectStringSet(
    overrides.hidden_widgets,
    overrides.hiddenWidgets,
    overrides.hidden,
    overrides.visibility?.hidden
  );
  state.highlightedWidgetIds = collectStringSet(
    overrides.highlighted_widgets,
    overrides.highlightedWidgets,
    overrides.highlighted,
    overrides.visibility?.highlighted
  );
  state.widgetStateOverrides = collectStateOverrides(
    overrides.widget_states,
    overrides.widgetStates,
    overrides.states,
    overrides.visibility?.states
  );
  state.bindingOverrides = collectBindingOverrides(
    overrides.binding_values,
    overrides.bindingValues,
    overrides.bindings
  );
}

function injectRuntime(html, metadata, instanceId) {
  const metadataLiteral = JSON.stringify(metadata).replace(/<\//g, '<\\/');
  const instanceLiteral = JSON.stringify(instanceId);
  const allowedBindingsLiteral = JSON.stringify((metadata.bindings || []).map((binding) => binding.key));
  const allowedTriggersLiteral = JSON.stringify((metadata.triggers || []).map((trigger) => trigger.action));
  const runtime = `
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
      window.fetch = blockNetwork('fetch');
      window.WebSocket = blockNetwork('WebSocket');
      window.EventSource = blockNetwork('EventSource');
      window.XMLHttpRequest = blockNetwork('XMLHttpRequest');
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
                element.classList.add(className);
                if (falseClassName) element.classList.remove(falseClassName);
              } else {
                element.classList.remove(className);
                if (falseClassName) element.classList.add(falseClassName);
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
    })();
  </script>`;

  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>${runtime}`);
  }
  return `${runtime}${html}`;
}

function withBaseTag(html, href) {
  if (!href || html.includes('<base ')) {
    return html;
  }
  const baseTag = `<base href="${href}" />`;
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>${baseTag}`);
  }
  return `${baseTag}${html}`;
}

async function loadWidgetAssets(widgetId) {
  const normalizedWidgetId = String(widgetId || '').trim();
  if (!normalizedWidgetId) {
    throw new Error('Missing widget id');
  }

  const pathPrefixes = overlayBasePath ? [overlayBasePath, ''] : ['', '/overlay'];
  let lastError = null;

  for (const prefix of pathPrefixes) {
    const assetPrefix = `${prefix}/assets/${normalizedWidgetId}`;
    const metadataUrl = `${assetPrefix}/widget.json`;
    const htmlUrl = `${assetPrefix}/index.html`;
    try {
      const [metadataResponse, htmlResponse] = await Promise.all([
        fetch(metadataUrl),
        fetch(htmlUrl)
      ]);
      if (!metadataResponse.ok || !htmlResponse.ok) {
        throw new Error(`Asset fetch failed (${metadataResponse.status}/${htmlResponse.status}) via ${assetPrefix}`);
      }
      return {
        metadataText: await metadataResponse.text(),
        htmlText: await htmlResponse.text(),
        assetBaseHref: `${window.location.origin}${assetPrefix}/`
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Unable to load assets for widget ${normalizedWidgetId}`);
}

function normalizeWidgetMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Widget metadata must be an object');
  }

  const bindings = Array.isArray(metadata.bindings)
    ? metadata.bindings
    : metadata.bindings && typeof metadata.bindings === 'object'
      ? Object.entries(metadata.bindings).map(([key, value]) => ({ key, ...(value || {}) }))
      : [];
  const triggers = Array.isArray(metadata.triggers)
    ? metadata.triggers
    : metadata.actions && typeof metadata.actions === 'object'
      ? Object.entries(metadata.actions).map(([action, value]) => ({ action, ...(value || {}) }))
      : [];
  const ui = metadata.ui && typeof metadata.ui === 'object'
    ? ('preferredWidth' in metadata.ui
        ? metadata.ui
        : {
            minWidth: Number(metadata.ui?.minSize?.w || 0),
            minHeight: Number(metadata.ui?.minSize?.h || 0),
            preferredWidth: Number(metadata.ui?.preferredSize?.w || 0),
            preferredHeight: Number(metadata.ui?.preferredSize?.h || 0)
          })
    : null;

  return {
    ...metadata,
    bindings,
    triggers,
    ui
  };
}

function widgetInitialState(widget) {
  const overrideState = state.widgetStateOverrides.get(widget.id) || state.widgetStateOverrides.get(widget.widgetId);
  if (overrideState) {
    return overrideState;
  }

  if (state.hiddenWidgetIds.has(widget.widgetId) || state.hiddenWidgetIds.has(widget.id)) {
    return 'hidden';
  }

  if (state.highlightedWidgetIds.has(widget.widgetId) || state.highlightedWidgetIds.has(widget.id)) {
    return 'highlighted';
  }

  return 'visible';
}

function normalizeWidgetState(nextState) {
  if (nextState === 'hide') return 'hidden';
  if (nextState === 'show' || nextState === 'reset') return 'visible';
  if (['visible', 'hidden', 'highlighted'].includes(nextState)) return nextState;
  return 'visible';
}

function setWidgetState(instanceId, nextState, options = {}) {
  const wrapper = state.wrappers.get(instanceId);
  const frame = state.frames.get(instanceId);
  if (!wrapper || !frame) {
    return;
  }

  const normalizedState = normalizeWidgetState(nextState);
  clearTimeout(state.widgetStateTimers.get(instanceId));
  state.widgetStateTimers.delete(instanceId);

  wrapper.dataset.state = normalizedState;
  wrapper.hidden = normalizedState === 'hidden';
  frame.contentWindow?.postMessage({ type: 'state', instanceId, state: normalizedState }, '*');

  if (normalizedState === 'highlighted' && Number(options.durationMs) > 0) {
    const timer = setTimeout(() => {
      state.widgetStateTimers.delete(instanceId);
      setWidgetState(instanceId, widgetInitialState(state.widgets.get(instanceId) || {}));
    }, Number(options.durationMs));
    state.widgetStateTimers.set(instanceId, timer);
  }
}

function postBinding(instanceId, key, value) {
  const frame = state.frames.get(instanceId);
  frame?.contentWindow?.postMessage({ type: 'binding', instanceId, key, value }, '*');
}

function applyTelemetryBindings(payload) {
  if (state.bindingsFrozen) {
    return;
  }
  for (const [instanceId, entry] of state.widgets.entries()) {
    for (const binding of entry.metadata.bindings || []) {
      const configuredPath = entry.bindingsConfig?.[binding.key];
      const overrideValues = state.bindingOverrides.get(instanceId) || state.bindingOverrides.get(entry.widgetId);
      const value = Object.prototype.hasOwnProperty.call(overrideValues || {}, binding.key)
        ? overrideValues[binding.key]
        : getPath(payload, String(configuredPath || binding.key));
      if (typeof value !== 'undefined') {
        postBinding(instanceId, binding.key, value);
      }
    }
  }
}

function applyConditionOverridesToWidgets() {
  for (const [instanceId, entry] of state.widgets.entries()) {
    setWidgetState(instanceId, widgetInitialState(entry));
    const overrideValues = state.bindingOverrides.get(instanceId) || state.bindingOverrides.get(entry.widgetId);
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
  const action = update.action || update.payload?.action || update.state || update.payload?.state || 'trigger';
  const bindingValues = update.bindingValues || update.payload?.bindingValues || update.payload?.bindings || {};
  const durationMs = update.durationMs || update.payload?.durationMs;

  for (const instanceId of targets) {
    const entry = state.widgets.get(instanceId);
    if (!entry) {
      continue;
    }

    for (const [key, value] of Object.entries(bindingValues)) {
      const bindingKey = key.includes('.') ? key : `${entry.widgetId}.${key}`;
      postBinding(instanceId, bindingKey, value);
      postBinding(instanceId, key, value);
      for (const binding of entry.metadata.bindings || []) {
        if (String(binding.key).split('.').at(-1) === key) {
          postBinding(instanceId, binding.key, value);
        }
      }
    }

    if (['hide', 'hidden', 'show', 'visible', 'reset', 'highlight', 'highlighted'].includes(action)) {
      setWidgetState(instanceId, action, { durationMs });
    }

    const frame = state.frames.get(instanceId);
    frame?.contentWindow?.postMessage({ type: 'trigger', instanceId, payload: update }, '*');
  }
}

function applyExportProgress(progress) {
  state.lastExportProgress = progress;
  setExportIndicator(progress);
  applyTelemetryBindings({
    export: {
      id: progress.exportId || progress.id,
      status: progress.status || progress.state,
      progress: progress.progress ?? progress.percent ?? progress.percentage ?? 0,
      artifactUrl: progress.artifactUrl || progress.downloadUrl
    }
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
  if (widget.windowMode === 'browser_popup' || widget.windowMode === 'transparent_electron') {
    return widget.windowMode;
  }
  return state.layout?.isTransparent === false ? 'browser_popup' : 'transparent_electron';
}

function buildInstanceOverlayUrl(widget, mode) {
  const params = new URLSearchParams();
  params.set('layoutId', state.layoutId);
  params.set('instanceId', widget.id);
  params.set('chrome', mode === 'transparent_electron' ? 'transparent' : 'web');
  params.set('toolbar', mode === 'browser_popup' ? '0' : '1');
  if (state.studyId) params.set('studyId', state.studyId);
  if (state.conditionId) params.set('conditionId', state.conditionId);
  if (token) params.set('token', token);
  if (state.currentSession?.id || state.currentSession?.sessionId) {
    params.set('sessionId', state.currentSession.id || state.currentSession.sessionId);
  }
  const overlayPrefix = overlayBasePath || '/overlay';
  return `${window.location.origin}${overlayPrefix}/${state.layoutId}?${params.toString()}`;
}

function popupFeatureString(widget) {
  const left = Number(widget.x || 0);
  const top = Number(widget.y || 0);
  const width = Math.max(120, Number(widget.width || 180));
  const height = Math.max(100, Number(widget.height || 180));
  return [
    'popup=yes',
    'resizable=yes',
    'scrollbars=no',
    'toolbar=yes',
    'location=yes',
    'menubar=yes',
    'status=yes',
    `left=${left}`,
    `top=${top}`,
    `width=${width}`,
    `height=${height}`
  ].join(',');
}

async function syncPopupBounds() {
  if (!state.studyId || !state.layoutId || state.popupWindows.size === 0 || !token) {
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
      height: Math.max(1, Number(popup.outerHeight || 0))
    });
  }
  if (windows.length === 0) return;
  try {
    await postJson('/api/system/overlay/windows/update', {
      studyId: state.studyId,
      layoutId: state.layoutId,
      windows
    });
  } catch (error) {
    console.warn('Failed to sync popup bounds', error);
  }
}

function ensurePopupSyncLoop() {
  clearInterval(state.popupSyncTimer);
  state.popupSyncTimer = setInterval(syncPopupBounds, 1200);
}

function renderLauncherFallback(popups) {
  const fallback = document.createElement('section');
  fallback.className = 'overlay-shell';
  const title = document.createElement('strong');
  title.textContent = 'Popup windows blocked by browser';
  const detail = document.createElement('small');
  detail.textContent = 'Use the buttons below to open each widget window manually.';
  fallback.append(title, detail);
  const actionRow = document.createElement('div');
  actionRow.style.display = 'flex';
  actionRow.style.flexWrap = 'wrap';
  actionRow.style.gap = '8px';
  actionRow.style.justifyContent = 'center';
  actionRow.style.marginTop = '12px';
  for (const widget of popups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Open ${widget.widgetId}`;
    button.addEventListener('click', () => {
      const popup = window.open(
        buildInstanceOverlayUrl(widget, 'browser_popup'),
        `scarline_widget_${widget.id}`,
        popupFeatureString(widget)
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
  const popupWidgets = state.layout?.widgets || [];
  if (popupWidgets.length === 0) {
    stage.replaceChildren(makeShell('No widgets in layout', 'Add widgets in Participant View to open browser windows.'));
    return;
  }

  for (const widget of popupWidgets) {
    const existing = state.popupWindows.get(widget.id);
    if (existing && !existing.closed) {
      continue;
    }
    const popup = window.open(
      buildInstanceOverlayUrl(widget, 'browser_popup'),
      `scarline_widget_${widget.id}`,
      popupFeatureString(widget)
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
    stage.replaceChildren(makeShell('Browser widget launcher active', `${popupWidgets.length} widget windows opened.`));
  }
  ensurePopupSyncLoop();
  syncPopupBounds();
}

async function renderLayout() {
  if (!state.studyId || !state.layoutId) {
    stage.replaceChildren(makeShell('Overlay waiting for a participant layout', 'Open from Admin Panel or provide studyId and layoutId.'));
    return;
  }

  await loadConditionOverrides();
  const payload = await fetchJson(`/api/studies/${state.studyId}/layouts/${state.layoutId}`);
  state.layout = payload.data;
  for (const timer of state.widgetStateTimers.values()) {
    clearTimeout(timer);
  }
  state.widgets.clear();
  state.frames.clear();
  state.wrappers.clear();
  state.widgetStateTimers.clear();
  stage.replaceChildren();
  layoutNode.textContent = state.layout.name || state.layoutId;

  if (state.isLauncher && state.popupMode === 'browser') {
    openBrowserPopups();
    return;
  }

  const widgetHost = document.createElement('section');
  widgetHost.className = 'overlay-zone';
  widgetHost.style.left = '0px';
  widgetHost.style.top = '0px';
  widgetHost.style.width = '100%';
  widgetHost.style.height = '100%';
  widgetHost.style.zIndex = '10';
  stage.appendChild(widgetHost);

  for (const widget of state.layout.widgets) {
    if (state.instanceId && widget.id !== state.instanceId) {
      continue;
    }

    const mode = widgetWindowMode(widget);
    if (state.instanceId && mode === 'browser_popup' && chromeMode === 'transparent') {
      continue;
    }
    if (!state.instanceId && mode === 'browser_popup' && chromeMode === 'transparent') {
      // Browser popup widgets are rendered separately; transparent overlay keeps only electron windows.
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'overlay-widget';
    wrapper.dataset.instanceId = widget.id;
    wrapper.dataset.widgetId = widget.widgetId;
    wrapper.dataset.state = widgetInitialState(widget);
    wrapper.style.zIndex = String(100 + Number(widget.order || 0));
    wrapper.style.position = 'absolute';
    wrapper.style.left = state.instanceId ? '0px' : `${widget.x || 0}px`;
    wrapper.style.top = state.instanceId ? '0px' : `${widget.y || 0}px`;
    wrapper.style.width = state.instanceId ? '100%' : `${widget.width || 180}px`;
    wrapper.style.height = state.instanceId ? '100%' : `${widget.height || 180}px`;
    widgetHost.appendChild(wrapper);
    state.wrappers.set(widget.id, wrapper);

    try {
      const assets = await loadWidgetAssets(widget.widgetId);
      const metadata = normalizeWidgetMetadata(JSON.parse(assets.metadataText));
      const html = withBaseTag(assets.htmlText, assets.assetBaseHref);
      validateWidgetCompatibility(metadata, widget);
      state.widgets.set(widget.id, { ...widget, metadata });

      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.border = '0';
      frame.style.background = 'transparent';
      frame.style.pointerEvents = 'auto';
      frame.srcdoc = injectRuntime(html, metadata, widget.id);
      state.frames.set(widget.id, frame);
      wrapper.appendChild(frame);
    } catch (error) {
      console.error(error);
      wrapper.appendChild(makeShell(`Widget failed: ${widget.widgetId}`));
    }
  }

  applyConditionOverridesToWidgets();
}

async function switchToSessionLayout(sessionEvent) {
  state.currentSession = sessionEvent;
  setSessionIndicator(sessionEvent);
  const status = String(sessionEvent.status || sessionEvent.state || '').toLowerCase();
  if (status === 'paused') {
    state.bindingsFrozen = true;
    return;
  }
  if (status === 'completed' || status === 'cancelled') {
    state.bindingsFrozen = true;
    state.sessionEnded = true;
    for (const instanceId of state.widgets.keys()) {
      setWidgetState(instanceId, 'hidden');
    }
    return;
  }
  state.bindingsFrozen = false;
  state.sessionEnded = false;

  const nextLayoutId = sessionEvent.runtimeMetadata?.layoutId || sessionEvent.layoutId;
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
    setConnectionStatus('Preview only', 'warn');
    return;
  }

  if (state.socket && state.socket.readyState < WebSocket.CLOSING) {
    state.socket.close();
  }

  const socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
  state.socket = socket;
  setConnectionStatus('Connecting', 'warn');

  socket.addEventListener('open', () => {
    state.reconnectAttempt = 0;
    state.reconnecting = false;
    setConnectionStatus('Connected', 'ready');
    socket.send(JSON.stringify({
      action: 'subscribe',
      channels: ['session.events', 'session.telemetry', 'widget.updates', 'system.health', 'sensor.status', 'export.progress']
    }));
  });

  socket.addEventListener('message', async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn('Ignoring invalid overlay websocket message', error);
      return;
    }

    const data = message.data || {};

    if (message.channel === 'session.events') {
      await switchToSessionLayout(data);
      return;
    }

    if (message.channel === 'session.telemetry') {
      applyTelemetryBindings(data.payload || data);
      return;
    }

    if (message.channel === 'widget.updates') {
      if (data.payload && targetWidgetIds(data).length === 0) {
        applyTelemetryBindings(data.payload);
      } else {
        applyWidgetUpdate(data);
      }
      return;
    }

    if (message.channel === 'export.progress') {
      applyExportProgress(data.payload || data);
    }
  });

  socket.addEventListener('close', () => {
    if (state.reconnecting) return;
    state.reconnecting = true;
    const delay = Math.min(1000 * 2 ** state.reconnectAttempt, 15000);
    setConnectionStatus(`Reconnecting in ${Math.ceil(delay / 1000)}s`, 'error');
    state.reconnectAttempt += 1;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connectSocket, delay);
  });

  socket.addEventListener('error', () => {
    setConnectionStatus('Connection error', 'error');
  });
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'widget-ready') {
    if (state.frames.get(event.data.instanceId)?.contentWindow !== event.source) {
      return;
    }
    const wrapper = state.wrappers.get(event.data.instanceId);
    setWidgetState(event.data.instanceId, wrapper?.dataset.state || 'visible');
  }

  if (event.data?.type === 'widget-send') {
    if (state.frames.get(event.data.instanceId)?.contentWindow !== event.source) {
      return;
    }
    const sessionId = state.currentSession?.sessionId || state.currentSession?.id;
    if (!state.studyId || !sessionId || !token) {
      console.debug('Widget interaction', event.data);
      return;
    }

    postJson(`/api/studies/${state.studyId}/sessions/${sessionId}/triggers`, {
      triggerType: 'manual',
      source: 'researcher-trigger',
      widgetId: state.widgets.get(event.data.instanceId)?.widgetId || 'unknown',
      instanceId: event.data.instanceId,
      action: event.data.eventType || 'widget-send',
      bindingValues: event.data.payload || {},
      payload: {
        source: 'overlay-widget',
        eventType: event.data.eventType,
        payload: event.data.payload
      }
    }).catch((error) => console.warn('Failed to forward widget interaction', error));
  }
});

setupChrome();
window.addEventListener('online', () => {
  if (token && (!state.socket || state.socket.readyState >= WebSocket.CLOSING)) {
    connectSocket();
  }
});
window.addEventListener('offline', () => setConnectionStatus('Offline', 'error'));
window.addEventListener('beforeunload', () => {
  if (state.popupSyncTimer) {
    clearInterval(state.popupSyncTimer);
    state.popupSyncTimer = null;
  }
});
renderLayout()
  .then(connectSocket)
  .catch((error) => {
    console.error(error);
    stage.replaceChildren(makeShell('Overlay runtime failed to initialize', error.message || 'Unknown error'));
    connectSocket();
  });
