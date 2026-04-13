import http from 'node:http';
import { app, BrowserWindow, screen } from 'electron';

const defaultOverlayUrl = process.env.OVERLAY_URL ?? 'http://localhost:8088/overlay/?chrome=transparent';
const controlPort = Number(process.env.OVERLAY_CONTROL_PORT ?? 4097);
const clickThrough = process.env.OVERLAY_CLICK_THROUGH !== 'false';

const runtimeConfig = {
  url: defaultOverlayUrl,
  mode: process.env.OVERLAY_WINDOW_MODE ?? 'single',
  targetDisplay: Number(process.env.OVERLAY_DISPLAY ?? 0),
  zones: (process.env.OVERLAY_ZONES ?? '')
    .split(';')
    .map((zone) => zone.trim())
    .filter(Boolean),
  bounds: {
    x: process.env.OVERLAY_X ? Number(process.env.OVERLAY_X) : null,
    y: process.env.OVERLAY_Y ? Number(process.env.OVERLAY_Y) : null,
    width: process.env.OVERLAY_WIDTH ? Number(process.env.OVERLAY_WIDTH) : null,
    height: process.env.OVERLAY_HEIGHT ? Number(process.env.OVERLAY_HEIGHT) : null
  },
  session: {
    studyId: null,
    sessionId: null,
    layoutId: null,
    conditionId: null
  }
};

let windows = [];
let quitting = false;
let controlServer = null;
let mousePassthrough = clickThrough;

function displayBounds() {
  const displays = screen.getAllDisplays();
  return displays[runtimeConfig.targetDisplay]?.bounds ?? displays[0]?.bounds ?? {
    x: 0,
    y: 0,
    width: Number(process.env.OVERLAY_WIDTH ?? 1600),
    height: Number(process.env.OVERLAY_HEIGHT ?? 900)
  };
}

function configuredBounds() {
  const bounds = displayBounds();
  return {
    x: runtimeConfig.bounds.x ?? bounds.x,
    y: runtimeConfig.bounds.y ?? bounds.y,
    width: runtimeConfig.bounds.width ?? bounds.width,
    height: runtimeConfig.bounds.height ?? bounds.height
  };
}

function windowOptions(bounds) {
  return {
    ...bounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: process.env.OVERLAY_FOCUSABLE === 'true',
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  };
}

function createOverlayWindow(bounds, url) {
  const overlayWindow = new BrowserWindow(windowOptions(bounds));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (mousePassthrough) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  overlayWindow.webContents.on('render-process-gone', () => {
    if (!quitting) {
      setTimeout(() => {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.reload();
        }
      }, 500);
    }
  });

  overlayWindow.webContents.on('did-fail-load', () => {
    if (!quitting) {
      setTimeout(() => {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.loadURL(url);
        }
      }, 1500);
    }
  });

  overlayWindow.on('closed', () => {
    windows = windows.filter((entry) => entry !== overlayWindow);
    if (!quitting && windows.length === 0) {
      setTimeout(createWindows, 1000);
    }
  });

  overlayWindow.loadURL(url);
  return overlayWindow;
}

function createWindows() {
  destroyWindows();
  const bounds = configuredBounds();

  if (runtimeConfig.mode === 'zones') {
    const zones = runtimeConfig.zones;

    if (zones.length > 0) {
      windows = zones.map((zone, index) => {
        const [x, y, width, height] = zone.split(',').map(Number);
        const separator = runtimeConfig.url.includes('?') ? '&' : '?';
        return createOverlayWindow({ x, y, width, height }, `${runtimeConfig.url}${separator}zone=${index}`);
      });
      return;
    }
  }

  windows = [createOverlayWindow(bounds, runtimeConfig.url)];
}

function destroyWindows() {
  for (const overlayWindow of windows) {
    overlayWindow.removeAllListeners('closed');
    overlayWindow.close();
  }
  windows = [];
}

function reloadWindows() {
  if (windows.length === 0) {
    createWindows();
    return;
  }

  for (const overlayWindow of windows) {
    overlayWindow.reload();
  }
}

function overlayStatus() {
  return {
    status: 'running',
    windows: windows.length,
    url: runtimeConfig.url,
    mode: runtimeConfig.mode,
    display: runtimeConfig.targetDisplay,
    clickThrough: mousePassthrough,
    session: runtimeConfig.session,
    bounds: windows.map((overlayWindow) => overlayWindow.getBounds()),
    displays: screen.getAllDisplays().map((display, index) => ({
      index,
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    }))
  };
}

function setClickThrough(enabled) {
  mousePassthrough = enabled;
  for (const overlayWindow of windows) {
    overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
  }
}

function configureOverlay(payload = {}) {
  if (typeof payload.url === 'string' && payload.url.length > 0) {
    runtimeConfig.url = payload.url;
  }
  if (payload.mode === 'single' || payload.mode === 'zones') {
    runtimeConfig.mode = payload.mode;
  }
  if (typeof payload.targetDisplay === 'number' && Number.isFinite(payload.targetDisplay)) {
    runtimeConfig.targetDisplay = payload.targetDisplay;
  }
  if (Array.isArray(payload.zones)) {
    runtimeConfig.zones = payload.zones.map((zone) => String(zone));
  }
  if (payload.bounds && typeof payload.bounds === 'object') {
    runtimeConfig.bounds = {
      x: Number.isFinite(payload.bounds.x) ? Number(payload.bounds.x) : null,
      y: Number.isFinite(payload.bounds.y) ? Number(payload.bounds.y) : null,
      width: Number.isFinite(payload.bounds.width) ? Number(payload.bounds.width) : null,
      height: Number.isFinite(payload.bounds.height) ? Number(payload.bounds.height) : null
    };
  }
  if (payload.session && typeof payload.session === 'object') {
    runtimeConfig.session = {
      studyId: payload.session.studyId ?? null,
      sessionId: payload.session.sessionId ?? null,
      layoutId: payload.session.layoutId ?? null,
      conditionId: payload.session.conditionId ?? null
    };
  }
  if (typeof payload.clickThrough === 'boolean') {
    setClickThrough(payload.clickThrough);
  }
}

function startControlServer() {
  controlServer = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(overlayStatus()));
      return;
    }

    if (request.url === '/status') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(overlayStatus()));
      return;
    }

    if (request.method === 'POST' && request.url === '/reload') {
      reloadWindows();
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: true }));
      return;
    }

    if (request.method === 'POST' && request.url === '/configure') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          configureOverlay(payload);
          createWindows();
          response.writeHead(202, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ accepted: true, config: overlayStatus() }));
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid_json' }));
        }
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/click-through') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          setClickThrough(payload.enabled !== false);
          response.writeHead(202, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ accepted: true, clickThrough: mousePassthrough }));
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid_json' }));
        }
      });
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  controlServer.listen(controlPort, '127.0.0.1');
}

app.whenReady().then(() => {
  createWindows();
  startControlServer();
});

app.on('before-quit', () => {
  quitting = true;
  controlServer?.close();
});

app.on('window-all-closed', () => {
  app.quit();
});
