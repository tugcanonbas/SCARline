const appRoot = document.getElementById('app');
const query = new URLSearchParams(window.location.search);
const layoutId = window.location.pathname.replace(/^\/+/, '') || query.get('layoutId');
const studyId = query.get('studyId');
const token = query.get('token');
const apiOrigin = window.__SCARLINE_API_ORIGIN || '';
const wsBase = window.__SCARLINE_WS_URL || window.location.origin.replace(/^http/, 'ws');

const state = {
  layout: null,
  widgets: new Map(),
  frames: new Map(),
  currentSession: null
};

function getPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function makeShell(title) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.inset = '0';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.background = 'rgba(0, 0, 0, 0.45)';
  wrapper.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  wrapper.style.borderRadius = '16px';
  wrapper.style.boxShadow = '0 18px 40px rgba(0, 0, 0, 0.4)';
  wrapper.textContent = title;
  return wrapper;
}

function injectRuntime(html, metadata, instanceId) {
  const runtime = `
  <script>
    (() => {
      const bindings = new Map();
      const bindingHandlers = new Map();
      const triggerHandlers = [];
      const stateHandlers = [];
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
          if (bindings.has(key)) {
            callback(bindings.get(key));
          }
        },
        onTrigger(callback) {
          triggerHandlers.push(callback);
        },
        onStateChange(callback) {
          stateHandlers.push(callback);
          callback(currentState);
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
        if (event.data?.instanceId !== '${instanceId}') {
          return;
        }
        if (event.data.type === 'binding') {
          emitBinding(event.data.key, event.data.value);
        }
        if (event.data.type === 'trigger') {
          triggerHandlers.forEach((handler) => handler(event.data.payload));
        }
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

async function renderLayout() {
  if (!studyId || !layoutId) {
    appRoot.replaceChildren(makeShell('Overlay preview requires studyId and layoutId.'));
    return;
  }

  const response = await fetch(`${apiOrigin}/api/studies/${studyId}/layouts/${layoutId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    appRoot.replaceChildren(makeShell('Unable to load layout.'));
    return;
  }

  const payload = await response.json();
  state.layout = payload.data;
  appRoot.innerHTML = '';
  appRoot.style.position = 'relative';
  appRoot.style.width = '100vw';
  appRoot.style.height = '100vh';
  appRoot.style.background = '#000';

  for (const zone of state.layout.zones) {
    const zoneNode = document.createElement('section');
    zoneNode.dataset.zoneId = zone.id;
    zoneNode.style.position = 'absolute';
    zoneNode.style.left = `${zone.x}px`;
    zoneNode.style.top = `${zone.y}px`;
    zoneNode.style.width = `${zone.width}px`;
    zoneNode.style.height = `${zone.height}px`;
    zoneNode.style.pointerEvents = 'none';
    appRoot.appendChild(zoneNode);
  }

  for (const widget of state.layout.widgets) {
    const metadataResponse = await fetch(`/assets/${widget.widgetId}/widget.json`);
    const htmlResponse = await fetch(`/assets/${widget.widgetId}/index.html`);
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

    const zoneNode = appRoot.querySelector(`[data-zone-id="${widget.zoneId}"]`);
    if (zoneNode) {
      zoneNode.appendChild(frame);
    }
  }
}

function connectSocket() {
  if (!token) {
    return;
  }

  const socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      action: 'subscribe',
      channels: ['session.events', 'session.telemetry', 'widget.updates']
    }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.channel === 'session.events') {
      state.currentSession = message.data;
      return;
    }

    if (message.channel === 'session.telemetry') {
      for (const [instanceId, entry] of state.widgets.entries()) {
        const frame = state.frames.get(instanceId);
        if (!frame) {
          continue;
        }
        for (const binding of entry.metadata.bindings || []) {
          const value = getPath(message.data.payload || message.data, binding.key);
          if (typeof value !== 'undefined') {
            frame.contentWindow?.postMessage({ type: 'binding', instanceId, key: binding.key, value }, '*');
          }
        }
      }
      return;
    }

    if (message.channel === 'widget.updates') {
      const instanceId = message.data.instanceId;
      const frame = state.frames.get(instanceId);
      if (!frame) {
        return;
      }
      frame.contentWindow?.postMessage({ type: 'trigger', instanceId, payload: message.data }, '*');
    }
  });
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'widget-ready') {
    const frame = state.frames.get(event.data.instanceId);
    if (frame) {
      frame.contentWindow?.postMessage({ type: 'state', instanceId: event.data.instanceId, state: 'visible' }, '*');
    }
  }
});

renderLayout().then(connectSocket).catch((error) => {
  console.error(error);
  appRoot.replaceChildren(makeShell('Overlay runtime failed to initialize.'));
});
