// Versión de escritorio: abre el editor en una ventana propia, sin navegador
// y SIN conexión a internet: tus documentos nunca salen de tu computadora.
const { app, BrowserWindow, shell, dialog, session, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const config = require("../public/js/config.js");
const { startServer } = require("../scripts/serve.js");

const OPENABLE = /\.(pdf|png|jpe?g|webp|gif|bmp)$/i;
let win = null, serverUrl = null, rendererReady = false, pending = [];

// Una sola ventana: si el usuario abre otro PDF con doble clic, llega a la ventana existente.
const gotLock = app.requestSingleInstanceLock();

// El editor se sirve desde un servidor privado en esta computadora (127.0.0.1),
// así los componentes internos (como el OCR) funcionan igual que en la web.
async function getServerUrl() {
  if (serverUrl) return serverUrl;
  const server = await startServer(0);
  serverUrl = `http://127.0.0.1:${server.address().port}/`;
  return serverUrl;
}

// Bloquea cualquier conexión que no sea el servidor local: la app no usa internet.
function lockNetwork() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    const local = serverUrl && u.startsWith(serverUrl);
    const internal = /^(data|blob|devtools|chrome-extension|file):/i.test(u);
    callback({ cancel: !(local || internal) });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
}

function filesFromArgs(argv) {
  return argv.slice(1).filter(a => !a.startsWith("-") && OPENABLE.test(a) && fs.existsSync(a));
}
function sendFiles(paths) {
  if (!paths.length) return;
  if (!win || !rendererReady) { pending.push(...paths); return; }
  const files = [];
  for (const p of paths) {
    try { files.push({ name: path.basename(p), data: fs.readFileSync(p) }); }
    catch (e) { dialog.showErrorBox(config.name, `No se pudo abrir "${path.basename(p)}".\n${e.message}`); }
  }
  if (files.length) win.webContents.send("open-files", files);
  if (win.isMinimized()) win.restore();
  win.focus();
}

async function createWindow() {
  rendererReady = false;
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 500,
    title: config.name,
    icon: path.join(__dirname, "..", "public", "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#e6e9ef",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") }
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

  // No se navega a ninguna otra página; los enlaces externos se abren en el navegador del sistema.
  win.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(serverUrl)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(serverUrl)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Al guardar, preguntar dónde (con Documentos como carpeta inicial).
  win.webContents.session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "Guardar", defaultPath: path.join(app.getPath("documents"), item.getFilename()) });
  });

  win.on("closed", () => { win = null; rendererReady = false; });
}

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  const list = pending; pending = [];
  sendFiles(list);
});

if (!gotLock) {
  app.quit();
} else {
  // Windows y Linux: archivo pasado al abrir el programa, o al abrir otro con la app ya abierta
  pending.push(...filesFromArgs(process.argv));
  app.on("second-instance", (_event, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    sendFiles(filesFromArgs(argv));
  });
  // macOS: "Abrir con" / doble clic
  app.on("open-file", (event, p) => { event.preventDefault(); sendFiles([p]); });

  app.whenReady().then(async () => {
    await getServerUrl();
    lockNetwork();
    await createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
