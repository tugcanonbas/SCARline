const appRoot = document.getElementById('app');
const query = new URLSearchParams(window.location.search);
const pathSegments = window.location.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
const pathLayoutId = pathSegments[0] === 'overlay' ? pathSegments[1] : pathSegments[0];
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
  socket: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  currentSession: null,
  targetZone: query.get('zone') || ''
};

const rootShell = document.createElement('div');
const toolbar = document.createElement('div');
const stage = document.createElement('main');
const statusNode = document.createElement('span');
const sessionNode = document.createElement('span');
const layoutNode = document.createElement('span');

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

function setupChrome() {
  const showToolbar = chromeMode !== 'transparent' && query.get('toolbar') !== '0';
  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: dark; }
    body { margin: 0; background: transparent; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; }
    .overlay-root { position: relative; width: 100vw; height: 100vh; overflow: hidden; background: ${chromeMode === 'transparent' ? 'transparent' : '#020617'}; }
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
  toolbar.className = 'overlay-toolbar';
  toolbar.hidden = !showToolbar;
  sessionNode.textContent = 'No active session';
  layoutNode.textContent = 'Layout pending';

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

  toolbar.append(statusNode, sessionNode, layoutNode, fullscreenButton, exitButton);
  stage.className = 'overlay-stage';
  rootShell.append(toolbar, stage);
  appRoot.replaceChildren(rootShell);
  setConnectionStatus('Disconnected', 'warn');
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(path) {
  const response = await fetch(`${apiOrigin}${path}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return response.json();
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

async function loadConditionOverrides(conditionId = state.conditionId) {
  state.hiddenWidgetIds = new Set();
  if (!state.studyId || !conditionId || !token) {
    return;
  }

  const payload = await fetchJson(`/api/studies/${state.studyId}/conditions`);
  const condition = (payload.data || []).find((entry) => entry.id === conditionId);
  const overrides = condition?.widgetOverrides || condition?.widget_overrides || {};
  const hidden = overrides.hidden_widgets || overrides.hiddenWidgets || [];
  if (Array.isArray(hidden)) {
    state.hiddenWidgetIds = new Set(hidden.map(String));
  }
}

function injectRuntime(html, metadata, instanceId) {
  const runtime = `
  <script>
    (() => {
      const bindings = new Map();
      const bindingHandlers = new Map();
      const triggerHandlers = [];
      const stateHandlers = [];
      const sendHandlers = [];
      let currentState = 'visible';
      function emitBinding(key, value) {
        bindings.set(key, value);
        const handlers = bindingHandlers.get(key) || [];
        handlers.forEach((handler) => handler(value));
      }
      window.SCARline = {
        onBinding(key, callback) {
          const handlers = bindingHandlers.get(key) || [];
          handlers.push(callback);
          bindingHandlers.set(key, handlers);
          if (bindings.has(key)) callback(bindings.get(key));
        },
        onTrigger(callback) {
          triggerHandlers.push(callback);
        },
        onStateChange(callback) {
          stateHandlers.push(callback);
          callback(currentState);
        },
        onSend(callback) {
          sendHandlers.push(callback);
        },
        send(type, payload) {
          parent.postMessage({ type: 'widget-send', instanceId: '${instanceId}', eventType: type, payload }, '*');
        },
        getBinding(key) {
          return bindings.get(key);
        },
        getState() {
          return currentState;
        },
        getMetadata() {
          return ${JSON.stringify(metadata)};
        },
        ready() {
          parent.postMessage({ type: 'widget-ready', instanceId: '${instanceId}' }, '*');
        }
      };
      window.addEventListener('message', (event) => {
        if (event.data?.instanceId !== '${instanceId}') return;
        if (event.data.type === 'binding') emitBinding(event.data.key, event.data.value);
        if (event.data.type === 'trigger') triggerHandlers.forEach((handler) => handler(event.data.payload));
        if (event.data.type === 'state') {
          currentState = event.data.state;
          stateHandlers.forEach((handler) => handler(currentState));
        }
      });
    })();
  </script>`;

  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>${runtime}`);
  }
  return `${runtime}${html}`;
}

function widgetInitialState(widget) {
  if (state.hiddenWidgetIds.has(widget.widgetId) || state.hiddenWidgetIds.has(widget.id)) {
    return 'hidden';
  }
  return 'visible';
}

function setWidgetState(instanceId, nextState) {
  const wrapper = state.wrappers.get(instanceId);
  const frame = state.frames.get(instanceId);
  if (!wrapper || !frame) {
    return;
  }
  wrapper.dataset.state = nextState;
  frame.contentWindow?.postMessage({ type: 'state', instanceId, state: nextState }, '*');
}

function postBinding(instanceId, key, value) {
  const frame = state.frames.get(instanceId);
  frame?.contentWindow?.postMessage({ type: 'binding', instanceId, key, value }, '*');
}

function applyTelemetryBindings(payload) {
  for (const [instanceId, entry] of state.widgets.entries()) {
    for (const binding of entry.metadata.bindings || []) {
      const configuredPath = entry.bindingsConfig?.[binding.key];
      const value = getPath(payload, String(configuredPath || binding.key));
      if (typeof value !== 'undefined') {
        postBinding(instanceId, binding.key, value);
      }
    }
  }
}

function targetWidgetIds(update) {
  if (update.instanceId) {
    return [String(update.instanceId)];
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
  const action = update.action || update.payload?.action || 'trigger';

  for (const instanceId of targets) {
    const entry = state.widgets.get(instanceId);
    if (!entry) {
      continue;
    }

    for (const [key, value] of Object.entries(update.bindingValues || {})) {
      const bindingKey = key.includes('.') ? key : `${entry.widgetId}.${key}`;
      postBinding(instanceId, bindingKey, value);
      postBinding(instanceId, key, value);
      for (const binding of entry.metadata.bindings || []) {
        if (String(binding.key).split('.').at(-1) === key) {
          postBinding(instanceId, binding.key, value);
        }
      }
    }

    if (action === 'hide') setWidgetState(instanceId, 'hidden');
    if (action === 'show' || action === 'reset') setWidgetState(instanceId, 'visible');
    if (action === 'highlight') setWidgetState(instanceId, 'highlighted');

    const frame = state.frames.get(instanceId);
    frame?.contentWindow?.postMessage({ type: 'trigger', instanceId, payload: update }, '*');
  }
}

async function renderLayout() {
  if (!state.studyId || !state.layoutId) {
    stage.replaceChildren(makeShell('Overlay waiting for a participant layout', 'Open from Admin Panel or provide studyId and layoutId.'));
    return;
  }

  await loadConditionOverrides();
  const payload = await fetchJson(`/api/studies/${state.studyId}/layouts/${state.layoutId}`);
  state.layout = payload.data;
  state.widgets.clear();
  state.frames.clear();
  state.wrappers.clear();
  stage.replaceChildren();
  layoutNode.textContent = state.layout.name || state.layoutId;

  for (const zone of state.layout.zones) {
    if (state.targetZone && state.targetZone !== zone.id && state.targetZone !== String(state.layout.zones.indexOf(zone))) {
      continue;
    }

    const zoneNode = document.createElement('section');
    zoneNode.className = 'overlay-zone';
    zoneNode.dataset.zoneId = zone.id;
    zoneNode.style.left = `${zone.x}px`;
    zoneNode.style.top = `${zone.y}px`;
    zoneNode.style.width = `${zone.width}px`;
    zoneNode.style.height = `${zone.height}px`;
    zoneNode.style.zIndex = String(10 + Number(zone.display || 0));
    stage.appendChild(zoneNode);
  }

  for (const widget of state.layout.widgets) {
    const zoneNode = stage.querySelector(`[data-zone-id="${widget.zoneId}"]`);
    if (!zoneNode) {
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'overlay-widget';
    wrapper.dataset.instanceId = widget.id;
    wrapper.dataset.widgetId = widget.widgetId;
    wrapper.dataset.state = widgetInitialState(widget);
    wrapper.style.zIndex = String(100 + Number(widget.order || 0));
    zoneNode.appendChild(wrapper);
    state.wrappers.set(widget.id, wrapper);

    try {
      const [metadataResponse, htmlResponse] = await Promise.all([
        fetch(`assets/${widget.widgetId}/widget.json`),
        fetch(`assets/${widget.widgetId}/index.html`)
      ]);
      const metadata = await metadataResponse.json();
      const html = await htmlResponse.text();
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
}

async function switchToSessionLayout(sessionEvent) {
  state.currentSession = sessionEvent;
  sessionNode.textContent = sessionEvent.status ? `Session ${sessionEvent.status}` : 'Session update';
  const nextLayoutId = sessionEvent.runtimeMetadata?.layoutId || sessionEvent.layoutId;
  if (sessionEvent.studyId) state.studyId = sessionEvent.studyId;
  if (sessionEvent.conditionId) state.conditionId = sessionEvent.conditionId;
  if (nextLayoutId && nextLayoutId !== state.layoutId) {
    state.layoutId = nextLayoutId;
    await renderLayout();
  } else if (sessionEvent.conditionId) {
    await loadConditionOverrides(sessionEvent.conditionId);
    for (const [instanceId, entry] of state.widgets.entries()) {
      setWidgetState(instanceId, widgetInitialState(entry));
    }
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
    setConnectionStatus('Connected', 'ready');
    socket.send(JSON.stringify({
      action: 'subscribe',
      channels: ['session.events', 'session.telemetry', 'widget.updates', 'system.health', 'sensor.status']
    }));
  });

  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data);
    if (message.channel === 'session.events') {
      await switchToSessionLayout(message.data);
      return;
    }

    if (message.channel === 'session.telemetry') {
      applyTelemetryBindings(message.data.payload || message.data);
      return;
    }

    if (message.channel === 'widget.updates') {
      if (message.data.payload && !message.data.instanceId && !message.data.widgetId) {
        applyTelemetryBindings(message.data.payload);
      } else {
        applyWidgetUpdate(message.data);
      }
    }
  });

  socket.addEventListener('close', () => {
    setConnectionStatus('Reconnecting', 'error');
    const delay = Math.min(1000 * 2 ** state.reconnectAttempt, 15000);
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
    const wrapper = state.wrappers.get(event.data.instanceId);
    setWidgetState(event.data.instanceId, wrapper?.dataset.state || 'visible');
  }

  if (event.data?.type === 'widget-send') {
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
renderLayout()
  .then(connectSocket)
  .catch((error) => {
    console.error(error);
    stage.replaceChildren(makeShell('Overlay runtime failed to initialize', error.message || 'Unknown error'));
    connectSocket();
  });
