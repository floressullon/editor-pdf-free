// Configuración de los instaladores. El nombre y el identificador salen de public/js/config.js
const app = require("./public/js/config.js");

module.exports = {
  appId: app.appId,
  productName: app.name,
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  directories: { output: "dist" },
  files: ["electron/**", "public/**", "package.json"],
  icon: "build/icon.png",
  win: { target: ["nsis", "portable"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  portable: { artifactName: "${productName}-${version}-portable.${ext}" },
  mac: { target: ["dmg"], category: "public.app-category.productivity" },
  linux: { target: ["AppImage"], category: "Office" },
  publish: { provider: "github", releaseType: "release" }
};
