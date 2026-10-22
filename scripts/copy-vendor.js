// Copia las librerías desde node_modules a public/vendor para que el editor funcione sin internet.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const nm = path.join(root, "node_modules");
const out = path.join(root, "public", "vendor");

// Busca un paquete en node_modules (también anidado dentro de otro paquete)
function pkgDir(name, parent) {
  const cands = [path.join(nm, name)];
  if (parent) cands.unshift(path.join(nm, parent, "node_modules", name));
  return cands.find(d => fs.existsSync(d)) || null;
}
function copy(src, dest) {
  if (!src || !fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("  " + path.relative(root, dest));
  return true;
}

let missing = 0;
const need = (ok, what) => { if (!ok) { console.warn(`  Falta ${what} (¿ejecutaste npm install?)`); missing++; } };

// Visor, edición y zip
need(copy(path.join(nm, "pdfjs-dist/build/pdf.min.js"), path.join(out, "pdf.min.js")), "pdfjs-dist");
need(copy(path.join(nm, "pdfjs-dist/build/pdf.worker.min.js"), path.join(out, "pdf.worker.min.js")), "pdfjs-dist (worker)");
need(copy(path.join(nm, "pdf-lib/dist/pdf-lib.min.js"), path.join(out, "pdf-lib.min.js")), "pdf-lib");
need(copy(path.join(nm, "jszip/dist/jszip.min.js"), path.join(out, "jszip.min.js")), "jszip");

// OCR: Tesseract.js (motor, worker, núcleo WebAssembly e idiomas)
const tdir = path.join(out, "tesseract");
const tjs = pkgDir("tesseract.js");
need(tjs && copy(path.join(tjs, "dist/tesseract.min.js"), path.join(tdir, "tesseract.min.js")), "tesseract.js");
need(tjs && copy(path.join(tjs, "dist/worker.min.js"), path.join(tdir, "worker.min.js")), "tesseract.js (worker)");
const core = pkgDir("tesseract.js-core", "tesseract.js");
if (core) {
  for (const f of fs.readdirSync(core)) if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy(path.join(core, f), path.join(tdir, "core", f));
} else need(false, "tesseract.js-core");
for (const lang of ["spa", "eng"]) {
  const d = pkgDir(`@tesseract.js-data/${lang}`);
  const src = d && ["4.0.0_best_int", "4.0.0", "4.0.0_best"].map(v => path.join(d, v, `${lang}.traineddata.gz`)).find(f => fs.existsSync(f));
  if (!copy(src, path.join(tdir, "lang", `${lang}.traineddata.gz`))) console.warn(`  Idioma OCR "${lang}" no instalado: se descargará de internet al usar el OCR.`);
}

console.log(missing ? "Algunas librerías no se copiaron; el editor las cargará desde internet." : "Librerías copiadas en public/vendor.");
