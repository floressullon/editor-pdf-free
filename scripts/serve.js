// Servidor local mínimo, sin dependencias.
// Uso: npm start   (otro puerto: PORT=8080 npm start)
// También lo usa la app de escritorio para servir el editor.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const config = require("../public/js/config.js");

const root = path.join(__dirname, "..", "public");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".wasm": "application/wasm", ".gz": "application/gzip"
};

function startServer(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.normalize(path.join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
        const headers = { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-cache" };
        res.writeHead(200, headers);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(file).pipe(res);
      });
    });
    server.on("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { startServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 5173;
  startServer(port).then(() => {
    const url = `http://localhost:${port}`;
    console.log(`${config.name} funcionando en ${url}  (Ctrl+C para detener)`);
    if (!process.env.NO_OPEN) {
      const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  }, err => { console.error(`No se pudo iniciar en el puerto ${port}: ${err.message}`); process.exit(1); });
}
