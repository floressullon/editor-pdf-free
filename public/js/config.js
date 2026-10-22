/*
 * CONFIGURACIÓN DEL NOMBRE DE LA APLICACIÓN
 * -----------------------------------------
 * Cambia los valores de aquí y el nuevo nombre aparecerá en:
 * la interfaz, la pestaña del navegador, la ventana de escritorio,
 * los instaladores y los datos internos de los PDF que se guardan.
 *
 * Después de cambiarlo no hace falta nada más para la versión web.
 * Para la versión de escritorio, vuelve a ejecutar: npm run package
 */
(function (root) {
  const config = {
    // Nombre completo que ve el usuario
    name: "Editor PDF Free",

    // Palabra del nombre que se resalta en color en la cabecera ("" para ninguna)
    highlight: "Free",

    // Identificador técnico para los instaladores: solo minúsculas, números y puntos.
    // Cámbialo una sola vez, antes de publicar la primera versión de escritorio.
    appId: "io.github.editorpdffree",

    // Frase corta que describe la aplicación
    tagline: "Editor de PDF gratuito y de código abierto",

    // Botones opcionales de la herramienta "Editar texto" (true = mostrar, false = ocultar)
    showOcrButton: false,        // "Reconocer texto (OCR)" para páginas escaneadas
    showDiagnosisButton: false   // "¿Qué hay en esta página?" (diagnóstico)
  };

  if (typeof module !== "undefined" && module.exports) module.exports = config;
  else root.APP_CONFIG = config;
})(this);
