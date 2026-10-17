// Copia las librerías desde node_modules a public/vendor para que el editor funcione sin internet.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "public", "vendor");
const files = [
  ["pdfjs-dist/build/pdf.min.js", "pdf.min.js"],
  ["pdfjs-dist/build/pdf.worker.min.js", "pdf.worker.min.js"],
  ["pdf-lib/dist/pdf-lib.min.js", "pdf-lib.min.js"],
  ["jszip/dist/jszip.min.js", "jszip.min.js"]
];

fs.mkdirSync(out, { recursive: true });
let missing = 0;
for (const [from, to] of files) {
  const src = path.join(root, "node_modules", from);
  if (!fs.existsSync(src)) { console.warn(`  Falta ${from} (¿ejecutaste npm install?)`); missing++; continue; }
  fs.copyFileSync(src, path.join(out, to));
  console.log(`  ${to}`);
}
console.log(missing ? "Algunas librerías no se copiaron; el editor usará el CDN para ellas." : "Librerías copiadas en public/vendor.");
