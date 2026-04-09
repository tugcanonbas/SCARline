import { app, BrowserWindow } from 'electron';

const overlayUrl = process.env.OVERLAY_URL ?? 'http://localhost:4000/?studyId=demo&layoutId=demo';
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: Number(process.env.OVERLAY_WIDTH ?? 1600),
    height: Number(process.env.OVERLAY_HEIGHT ?? 900),
    x: Number(process.env.OVERLAY_X ?? 0),
    y: Number(process.env.OVERLAY_Y ?? 0),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadURL(overlayUrl);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
