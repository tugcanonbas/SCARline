const { app, BrowserWindow } = require("electron");

// Use an isolated profile and the desktop overlay's renderer isolation settings.
app.setPath("userData", process.env.SCARLINE_WIDGET_TEST_USER_DATA);
let window;
app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 800, height: 720, show: false, frame: false, transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
