# Editor PDF Free

Editor de PDF **gratuito y de código abierto**. Funciona en el navegador o como aplicación de escritorio (Windows, macOS y Linux). Tus archivos **nunca se suben a ningún servidor**: todo se procesa en tu propia computadora.

## Funciones

| Área | Qué puedes hacer |
|---|---|
| Archivos | Abrir PDF e imágenes (JPG, PNG, WebP), arrastrar y soltar, fusionar varios PDF en uno |
| Páginas | Girar, duplicar, eliminar, insertar en blanco, insertar otro PDF en medio, reordenar arrastrando, extraer, dividir por rangos (descarga .zip) |
| Editar texto del PDF | Corregir o borrar el texto que ya trae el documento, línea por línea. El texto original se elimina de verdad del archivo (no solo se tapa) |
| OCR | Reconoce el texto de páginas escaneadas (español e inglés) para poder editarlas |
| Edición | Agregar texto (fuente, tamaño, color, negrita, cursiva), imágenes y logos, resaltar, tapar zonas (corrector), dibujar a mano alzada |
| Firma | Dibujada, escrita con letra manuscrita o subida desde foto (quita el fondo blanco). Se guarda para reutilizarla |
| Otros | Deshacer y rehacer, zoom, atajos de teclado |

**Atajos:** `V` mover · `E` editar texto del PDF · `T` texto · `H` resaltar · `D` dibujar · `Supr` borrar elemento · `Ctrl+Z` / `Ctrl+Y` deshacer y rehacer · `Ctrl+S` guardar · flechas para mover un elemento (`Shift` = pasos de 10).

### Cómo funciona "Editar texto"

1. Elige **Editar texto** (o pulsa `E`). Las líneas editables se marcan al pasar el mouse.
2. Haz clic en una línea: aparece con su texto para corregirlo. Déjala vacía (o pulsa **Borrar línea**) para eliminarla. La **×** restaura el original.
3. Al guardar, el editor borra del archivo las instrucciones que dibujaban el texto original y escribe el nuevo en el mismo lugar, con el tamaño, el color y el estilo detectados (Arial, Times o Courier, la más parecida a la original).
4. Si en algún caso no puede borrar el original con seguridad (por ejemplo, texto dentro de un formulario o un bloque especial), lo tapa con el color de fondo y te avisa al guardar.
5. En páginas escaneadas, pulsa **Reconocer texto (OCR)**: las líneas detectadas se vuelven editables. Como en un escaneo el texto es parte de la imagen, ahí la línea original se tapa con el color del papel.

**Límites actuales:** se edita línea por línea (no reacomoda párrafos como Word); la letra de reemplazo es la estándar más parecida, no la original exacta; el OCR funciona mejor con escaneos nítidos y texto impreso (no manuscrito); no convierte a Word/Excel, la firma es visual (no es firma digital con certificado), no abre PDF protegidos con contraseña.

## Cambiar el nombre

El nombre todavía es provisional. Para cambiarlo, edita **un solo archivo**: `public/js/config.js`.

```js
name: "Editor PDF Free",      // nombre que ve el usuario
highlight: "Free",            // palabra que se resalta en color en la cabecera
appId: "io.github.editorpdffree", // identificador de los instaladores
```

El nuevo nombre se aplica en la interfaz, la pestaña del navegador, la ventana de escritorio, los instaladores y los datos internos de los PDF guardados. Lo único que queda por cambiar a mano son los textos de este README.

## Cómo usarlo

### Opción 1: sin instalar nada
Abre `public/index.html` con doble clic en Chrome, Edge o Firefox. Necesita internet para descargar las librerías desde un CDN.
Si quieres un único archivo para compartir, ejecuta `npm run single` y usa `dist/editor-pdf.html`.

### Opción 2: en tu computadora, sin internet
Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install      # descarga dependencias y copia las librerías a public/vendor (incluye el OCR en español e inglés)
npm start        # abre el editor en http://localhost:5173
```

### Opción 3: aplicación de escritorio
```bash
npm install
npm run desktop          # abre el editor en su propia ventana
npm run package          # crea el instalador para tu sistema en la carpeta dist/
npm run package:win      # o forzar Windows (.exe instalador y portable)
npm run package:mac      # macOS (.dmg)
npm run package:linux    # Linux (.AppImage)
```

## Publicar versiones en GitHub (automático)

El repositorio trae dos automatizaciones en `.github/workflows/`:

- **Versión web** (`pages.yml`): cada cambio en la rama `main` se publica en GitHub Pages. Actívalo una vez en *Settings → Pages → Source: GitHub Actions*. Quedará en `https://TU-USUARIO.github.io/editor-pdf-free/`.
- **Instaladores** (`release.yml`): al crear una etiqueta de versión, GitHub compila los instaladores para Windows, macOS y Linux y los adjunta a un *Release*:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Los instaladores no están firmados digitalmente, así que Windows y macOS mostrarán un aviso la primera vez ("Más información → Ejecutar de todas formas" en Windows; clic derecho → Abrir en macOS).

## Cómo está hecho

Es una aplicación web en **HTML, CSS y JavaScript puro**, sin frameworks ni paso de compilación.

| Pieza | Uso |
|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla, Apache-2.0) | Dibuja las páginas en pantalla |
| [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) | Copia páginas, las gira y escribe texto, imágenes y trazos en el PDF final |
| [JSZip](https://github.com/Stuk/jszip) (MIT) | Empaqueta en .zip al dividir |
| [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0) | Reconocimiento de texto (OCR) |
| [Electron](https://www.electronjs.org) (MIT) | Versión de escritorio |

Las licencias completas y los créditos están en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Funcionamiento en resumen: al abrir un archivo, cada página se guarda como una referencia (archivo de origen + número de página + giro). Lo que agregas (texto, firmas, resaltados) vive en una capa encima de la página, medida en puntos PDF. Al guardar, pdf-lib copia las páginas originales en un documento nuevo y "estampa" esa capa convirtiendo las coordenadas de pantalla a coordenadas PDF, respetando la rotación.

```
public/
  index.html        estructura de la interfaz
  js/config.js      nombre de la aplicación (configurable)
  css/styles.css    estilos (tema claro y oscuro)
  js/app.js         toda la lógica del editor
  js/pdf-text-remover.js  borra el texto original dentro del contenido de la página
  vendor/           librerías copiadas por npm install (no se sube a git)
electron/main.js    ventana de escritorio
electron-builder.config.js  configuración de los instaladores
scripts/            copia de librerías, servidor local y versión de un solo archivo (npm run single)
build/icon.png      ícono de la app
```

## Hoja de ruta

- [ ] Rellenar formularios PDF
- [ ] Marca de agua y numeración de páginas
- [ ] Proteger y quitar contraseñas
- [x] Editar y borrar el texto existente del PDF
- [x] OCR (reconocer texto en documentos escaneados)
- [ ] Editar párrafos completos (reacomodar el texto al cambiar una línea)
- [ ] Hacer buscables los PDF escaneados (capa de texto invisible del OCR)
- [ ] Abrir PDF con doble clic desde el explorador de archivos (versión de escritorio)
- [ ] Fuentes de firma incluidas para uso 100 % sin conexión

## Contribuir

Las contribuciones son bienvenidas. Abre un *issue* para reportar errores o proponer ideas, o envía un *pull request*. Antes de enviar cambios, prueba con `npm start` que abrir, editar y guardar un PDF siga funcionando.

## Licencia

[MIT](LICENSE). Puedes usarlo, modificarlo y distribuirlo libremente, incluso con fines comerciales.
