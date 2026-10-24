// Puente mínimo entre la ventana del editor y el sistema: solo permite recibir
// los archivos que el usuario abrió con doble clic o "Abrir con". Nada más.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  onOpenFiles: callback => ipcRenderer.on("open-files", (_event, files) => callback(files)),
  ready: () => ipcRenderer.send("renderer-ready")
});
