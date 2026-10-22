// Versión de escritorio: abre el mismo editor web en una ventana propia.
const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const config = require("../public/js/config.js");
const { startServer } = require("../scripts/serve.js");

// El editor se sirve desde un servidor local privado (solo esta computadora),
// así el OCR y los workers funcionan igual que en la versión web.
let serverUrl = null;
async function getServerUrl() {
  if (serverUrl) return serverUrl;
  const server = await startServer(0);
  serverUrl = `http://127.0.0.1:${server.address().port}/`;
  return serverUrl;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 500,
    title: config.name,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#e6e9ef",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadURL(await getServerUrl());

  // Si hay cambios sin guardar, preguntar antes de cerrar la ventana.
  win.webContents.on("will-prevent-unload", event => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Salir sin guardar", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      title: config.name,
      message: "Tienes cambios sin guardar.",
      detail: "Si sales ahora, se perderán."
    });
    if (choice === 0) event.preventDefault();
  });

  // Los enlaces externos se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
