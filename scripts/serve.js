// Servidor local mínimo, sin dependencias. Uso: npm start  (puerto: PORT=8080 npm start)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const config = require("../public/js/config.js");

const root = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT) || 5173;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2"
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}`;
  console.log(`${config.name} funcionando en ${url}  (Ctrl+C para detener)`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
