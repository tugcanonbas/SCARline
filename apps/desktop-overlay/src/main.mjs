import http from 'node:http';
import { app, BrowserWindow, screen } from 'electron';

const overlayUrl = process.env.OVERLAY_URL ?? 'http://localhost:8088/overlay/?chrome=transparent';
const controlPort = Number(process.env.OVERLAY_CONTROL_PORT ?? 4097);
const windowMode = process.env.OVERLAY_WINDOW_MODE ?? 'single';
const clickThrough = process.env.OVERLAY_CLICK_THROUGH !== 'false';
const targetDisplay = Number(process.env.OVERLAY_DISPLAY ?? 0);

let windows = [];
let quitting = false;
let controlServer = null;

function displayBounds() {
  const displays = screen.getAllDisplays();
  return displays[targetDisplay]?.bounds ?? displays[0]?.bounds ?? {
    x: 0,
    y: 0,
    width: Number(process.env.OVERLAY_WIDTH ?? 1600),
    height: Number(process.env.OVERLAY_HEIGHT ?? 900)
  };
}

function configuredBounds() {
  const bounds = displayBounds();
  return {
    x: Number(process.env.OVERLAY_X ?? bounds.x),
    y: Number(process.env.OVERLAY_Y ?? bounds.y),
    width: Number(process.env.OVERLAY_WIDTH ?? bounds.width),
    height: Number(process.env.OVERLAY_HEIGHT ?? bounds.height)
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
  if (clickThrough) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  overlayWindow.webContents.on('render-process-gone', () => {
    if (!quitting) {
      overlayWindow.reload();
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

  if (windowMode === 'zones') {
    const zones = (process.env.OVERLAY_ZONES ?? '')
      .split(';')
      .map((zone) => zone.trim())
      .filter(Boolean);

    if (zones.length > 0) {
      windows = zones.map((zone, index) => {
        const [x, y, width, height] = zone.split(',').map(Number);
        const separator = overlayUrl.includes('?') ? '&' : '?';
        return createOverlayWindow({ x, y, width, height }, `${overlayUrl}${separator}zone=${index}`);
      });
      return;
    }
  }

  windows = [createOverlayWindow(bounds, overlayUrl)];
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

function startControlServer() {
  controlServer = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'running',
        windows: windows.length,
        url: overlayUrl
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/reload') {
      reloadWindows();
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: true }));
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
