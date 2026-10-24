// Genera una versión del editor en UN SOLO archivo HTML (dist/editor-pdf.html).
// Útil para compartirlo por correo o abrirlo con doble clic. Necesita internet
// para descargar las librerías desde un CDN la primera vez que se abre.
//
// Uso: npm run single
//      node scripts/build-single.js --fragment salida.html   (solo el contenido de <body>, para incrustar)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pub = path.join(root, "public");
const args = process.argv.slice(2);
const fragment = args.includes("--fragment");
const outArg = args.find(a => !a.startsWith("--"));
const out = outArg ? path.resolve(outArg) : path.join(root, "dist", "editor-pdf.html");

const read = f => fs.readFileSync(path.join(pub, f), "utf8");
const esc = js => js.replace(/<\/script/gi, "<\\/script");
const config = require("../public/js/config.js");
let html = read("index.html").replace(/<title>[^<]*<\/title>/, `<title>${config.name}</title>`);

// estilos e scripts propios en línea
html = html.replace(/<link rel="stylesheet" href="css\/styles\.css">/, () => `<style>\n${read("css/styles.css")}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${esc(read(f))}</script>`);
// librerías: solo CDN
html = html.replace(/<!-- Librerías:[\s\S]*?(?=<script>\n)/, m => {
  const cdn = [...m.matchAll(/document\.write\('<script src="([^"]+)"/g)].map(x => `<script src="${x[1]}"></script>`);
  return cdn.join("\n") + "\n";
});
html = html.replace(/<link rel="icon"[^>]*>\n?/, "");
// tipografías: en un solo archivo se cargan directamente de Google Fonts
html = html.replace(/<!-- Tipografías:[^\n]*\n<link rel="stylesheet" href="vendor\/fonts\/fonts\.css" data-fallback="([^"]+)"[^>]*>/, (_, g) => `<link rel="stylesheet" href="${g}">`);

if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const keep = head
    .replace(/<meta charset[^>]*>\n?/, "").replace(/<meta name="viewport"[^>]*>\n?/, "")
    .replace(/<style>:root\{padding-top[^<]*<\/style>\n?/, "");
  html = keep.replace(/(<title>[^<]*<\/title>)/, '$1\n<meta name="claude:viewport-fit-sides" content="cover">') + body;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Generado: ${path.relative(process.cwd(), out)} (${Math.round(html.length / 1024)} KB)`);
