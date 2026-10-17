# Editor PDF Free

Editor de PDF **gratuito y de código abierto**. Funciona en el navegador o como aplicación de escritorio (Windows, macOS y Linux). Tus archivos **nunca se suben a ningún servidor**: todo se procesa en tu propia computadora.

## Funciones

| Área | Qué puedes hacer |
|---|---|
| Archivos | Abrir PDF e imágenes (JPG, PNG, WebP), arrastrar y soltar, fusionar varios PDF en uno |
| Páginas | Girar, duplicar, eliminar, insertar en blanco, insertar otro PDF en medio, reordenar arrastrando, extraer, dividir por rangos (descarga .zip) |
| Edición | Agregar texto (fuente, tamaño, color, negrita), imágenes y logos, resaltar, tapar zonas (corrector), dibujar a mano alzada |
| Firma | Dibujada, escrita con letra manuscrita o subida desde foto (quita el fondo blanco). Se guarda para reutilizarla |
| Otros | Deshacer y rehacer, zoom, atajos de teclado |

**Atajos:** `V` mover · `T` texto · `H` resaltar · `D` dibujar · `Supr` borrar elemento · `Ctrl+Z` / `Ctrl+Y` deshacer y rehacer · `Ctrl+S` guardar · flechas para mover un elemento (`Shift` = pasos de 10).

**Límites actuales:** no edita el texto original del PDF (se tapa y se escribe encima), no convierte a Word/Excel, la firma es visual (no es firma digital con certificado), no abre PDF protegidos con contraseña.

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

### Opción 2: en tu computadora, sin internet
Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install      # descarga dependencias y copia las librerías a public/vendor
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
| [Electron](https://www.electronjs.org) (MIT) | Versión de escritorio |

Funcionamiento en resumen: al abrir un archivo, cada página se guarda como una referencia (archivo de origen + número de página + giro). Lo que agregas (texto, firmas, resaltados) vive en una capa encima de la página, medida en puntos PDF. Al guardar, pdf-lib copia las páginas originales en un documento nuevo y "estampa" esa capa convirtiendo las coordenadas de pantalla a coordenadas PDF, respetando la rotación.

```
public/
  index.html        estructura de la interfaz
  js/config.js      nombre de la aplicación (configurable)
  css/styles.css    estilos (tema claro y oscuro)
  js/app.js         toda la lógica del editor
  vendor/           librerías copiadas por npm install (no se sube a git)
electron/main.js    ventana de escritorio
electron-builder.config.js  configuración de los instaladores
scripts/            copia de librerías y servidor local
build/icon.png      ícono de la app
```

## Hoja de ruta

- [ ] Rellenar formularios PDF
- [ ] Marca de agua y numeración de páginas
- [ ] Proteger y quitar contraseñas
- [ ] OCR (reconocer texto en documentos escaneados)
- [ ] Abrir PDF con doble clic desde el explorador de archivos (versión de escritorio)
- [ ] Fuentes de firma incluidas para uso 100 % sin conexión

## Contribuir

Las contribuciones son bienvenidas. Abre un *issue* para reportar errores o proponer ideas, o envía un *pull request*. Antes de enviar cambios, prueba con `npm start` que abrir, editar y guardar un PDF siga funcionando.

## Licencia

[MIT](LICENSE). Puedes usarlo, modificarlo y distribuirlo libremente, incluso con fines comerciales.
