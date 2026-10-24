# Créditos y licencias de terceros

Este proyecto se distribuye bajo la licencia [MIT](LICENSE). Usa los siguientes componentes de código abierto, cada uno bajo su propia licencia. Todas permiten el uso, la modificación y la redistribución, también con fines comerciales, siempre que se conserven estos avisos.

| Componente | Uso en el proyecto | Licencia | Proyecto |
|---|---|---|---|
| pdf.js (pdfjs-dist) | Mostrar las páginas y leer el texto del PDF | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pdf-lib | Crear y modificar el PDF guardado | MIT | https://github.com/Hopding/pdf-lib |
| JSZip | Empaquetar en .zip al dividir | MIT o GPL-3.0 (se usa bajo MIT) | https://github.com/Stuk/jszip |
| Tesseract.js | Reconocimiento de texto (OCR) en el navegador | Apache-2.0 | https://github.com/naptha/tesseract.js |
| tesseract.js-core | Motor Tesseract compilado a WebAssembly | Apache-2.0 | https://github.com/naptha/tesseract.js-core |
| Datos de idioma de Tesseract (español, inglés) | Modelos de reconocimiento | Apache-2.0 | https://github.com/tesseract-ocr/tessdata |
| Electron | Aplicación de escritorio | MIT | https://github.com/electron/electron |
| electron-builder | Generar los instaladores | MIT | https://github.com/electron-userland/electron-builder |

## Fuentes tipográficas

Vienen incluidas con `npm install` (paquetes de Fontsource) y se usan solo en la interfaz y en la firma escrita. Si no están instaladas, la versión web las carga desde Google Fonts.

| Fuente | Licencia |
|---|---|
| IBM Plex Sans, IBM Plex Mono | SIL Open Font License 1.1 |
| Bricolage Grotesque | SIL Open Font License 1.1 |
| Caveat, Dancing Script, Great Vibes | SIL Open Font License 1.1 |

El texto que se escribe dentro de los PDF usa las 14 fuentes estándar del formato PDF (Helvetica, Times, Courier y sus variantes), que todos los lectores de PDF incluyen; el proyecto no distribuye esos archivos de fuente.

## Textos completos de las licencias

- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
- MIT: https://opensource.org/license/mit
- SIL Open Font License 1.1: https://openfontlicense.org

Los archivos de cada librería, tal como se instalan con `npm install`, conservan sus propios avisos de copyright.
