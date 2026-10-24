// Configuración de los instaladores. El nombre y el identificador salen de public/js/config.js
const app = require("./public/js/config.js");

module.exports = {
  appId: app.appId,
  productName: app.name,
  artifactName: "${name}-${version}-${os}-${arch}.${ext}",
  directories: { output: "dist" },
  // La app no usa módulos de Node: las librerías ya van copiadas en public/vendor
  npmRebuild: false,
  files: ["electron/**", "public/**", "scripts/serve.js", "package.json", "!**/node_modules/**"],
  icon: "build/icon.png",
  // "Abrir con…" y doble clic sobre un PDF (no se convierte en el lector predeterminado sin permiso)
  fileAssociations: [{ ext: "pdf", name: "Documento PDF", description: "Documento PDF", role: "Editor", mimeType: "application/pdf" }],
  win: { target: ["nsis", "portable"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: app.name },
  portable: { artifactName: "${name}-${version}-win-portable.${ext}" },
  mac: { target: ["dmg"], category: "public.app-category.productivity" },
  linux: { target: ["AppImage"], category: "Office" },
  publish: { provider: "github", releaseType: "draft" }   // queda como borrador: tú lo revisas y lo publicas
};
