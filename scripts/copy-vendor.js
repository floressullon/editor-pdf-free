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

// Tipografías (Fontsource, licencia SIL OFL): así la app no necesita Google Fonts
const FONTS = [
  ["ibm-plex-sans", "IBM Plex Sans", [400, 500, 600]],
  ["ibm-plex-mono", "IBM Plex Mono", [400, 500]],
  ["bricolage-grotesque", "Bricolage Grotesque", [600, 700]],
  ["caveat", "Caveat", [600]],
  ["dancing-script", "Dancing Script", [600]],
  ["great-vibes", "Great Vibes", [400]]
];
const fdir = path.join(out, "fonts");
let css = "/* Generado por scripts/copy-vendor.js — tipografías incluidas (SIL Open Font License) */\n";
for (const [id, family, weights] of FONTS) {
  const d = pkgDir(`@fontsource/${id}`);
  for (const w of weights) {
    const f = d && path.join(d, "files", `${id}-latin-${w}-normal.woff2`);
    if (f && copy(f, path.join(fdir, path.basename(f)))) {
      css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url("${path.basename(f)}") format("woff2")}\n`;
    }
  }
}
if (css.includes("@font-face")) { fs.mkdirSync(fdir, { recursive: true }); fs.writeFileSync(path.join(fdir, "fonts.css"), css); console.log("  public/vendor/fonts/fonts.css"); }
else console.warn("  Tipografías no instaladas: se cargarán de Google Fonts (o las del sistema sin internet).");

console.log(missing ? "Algunas librerías no se copiaron; el editor las cargará desde internet." : "Librerías copiadas en public/vendor.");
