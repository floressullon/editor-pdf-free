// Configuración de los instaladores. El nombre y el identificador salen de public/js/config.js
const app = require("./public/js/config.js");

module.exports = {
  appId: app.appId,
  productName: app.name,
  artifactName: "${name}-${version}-${os}-${arch}.${ext}",
  directories: { output: "dist" },
  files: ["electron/**", "public/**", "scripts/serve.js", "package.json"],
  icon: "build/icon.png",
  // "Abrir con…" y doble clic sobre un PDF (no se convierte en el lector predeterminado sin permiso)
  fileAssociations: [{ ext: "pdf", name: "Documento PDF", description: "Documento PDF", role: "Editor", mimeType: "application/pdf" }],
  win: { target: ["nsis", "portable"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: app.name },
  portable: { artifactName: "${name}-${version}-win-portable.${ext}" },
  mac: { target: ["dmg"], category: "public.app-category.productivity" },
  linux: { target: ["AppImage"], category: "Office" },
  publish: { provider: "github", releaseType: "release" }
};
