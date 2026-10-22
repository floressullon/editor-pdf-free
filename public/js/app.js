(() => {
"use strict";
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

/* ---------- app name (public/js/config.js) ---------- */
const CFG = Object.assign({ name: "Editor de PDF", highlight: "", tagline: "", showOcrButton: false, showDiagnosisButton: false }, window.APP_CONFIG || {});
document.title = CFG.name;
(() => {
  const h = $("#appName"), i = CFG.highlight ? CFG.name.lastIndexOf(CFG.highlight) : -1;
  if (i < 0) { h.textContent = CFG.name; return; }
  h.append(CFG.name.slice(0, i), el("span", null, CFG.highlight), CFG.name.slice(i + CFG.highlight.length));
})();

/* ---------- libraries ---------- */
const libsOk = typeof window.pdfjsLib !== "undefined" && typeof window.PDFLib !== "undefined";
if (!libsOk) {
  $("#viewer").innerHTML = '<div class="empty"><div class="empty-card"><h2>No se pudieron cargar los componentes</h2><p>Faltan las librerías del editor. Si descargaste el código, ejecuta <code>npm install</code>; si no, conéctate a internet y recarga la página.</p></div></div>';
  return;
}
if (!globalThis.pdfjsWorker && globalThis["pdfjs-dist/build/pdf.worker"]) globalThis.pdfjsWorker = globalThis["pdfjs-dist/build/pdf.worker"];
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } = PDFLib;

/* downloads: inside claude.ai use the platform capability, otherwise a normal browser download */
const dlPromise = (window.claude && typeof window.claude.use === "function")
  ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);

/* ---------- state ---------- */
let _id = 0;
const uid = p => p + (++_id).toString(36) + Math.random().toString(36).slice(2, 5);
const S = {
  sources: new Map(),   // id -> {id,name,bytes,lib,pdf}
  images: new Map(),    // id -> {url,bytes,kind,w,h}
  pages: [],            // {id,src,idx,rot,annots:[]}
  zoom: 1, tool: "select", cur: null, sel: null, editing: null,
  checked: new Set(), undo: [], redo: [], sample: false, docName: "documento"
};
const D = { font: "Helvetica", size: 11, color: "#111111", bold: false, italic: false, hlColor: "#ffe14d", woColor: "#ffffff", inkColor: "#1f3a93", inkWidth: 2 };
const FONTS = {
  Helvetica: { label: "Arial", css: 'Arial, Helvetica, "Liberation Sans", Arimo, sans-serif', base: 0.947, std: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"] },
  Times: { label: "Times New Roman", css: '"Times New Roman", Times, "Liberation Serif", serif', base: 0.9375, std: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"] },
  Courier: { label: "Courier New", css: '"Courier New", Courier, "Liberation Mono", monospace', base: 0.866, std: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"] }
};

const pjsCache = new Map(), dims = new Map(), thumbCache = new Map(), bmpCache = new Map();
const lineCache = new Map(), lineReady = new Map(), sampleCache = new Map();
const pageById = id => S.pages.find(p => p.id === id);
const pageIndex = id => S.pages.findIndex(p => p.id === id);

/* ---------- undo ---------- */
let base = "[]";
const snap = () => JSON.stringify(S.pages);
function commit() {
  const s = snap(); if (s === base) return;
  S.undo.push(base); if (S.undo.length > 100) S.undo.shift();
  S.redo = []; base = s; updUndo(); thumbsAnnotBadges();
}
function resetHistory() { S.undo = []; S.redo = []; base = snap(); savedBase = base; updUndo(); }
let savedBase = "[]";
const isDirty = () => S.pages.length > 0 && !S.sample && base !== savedBase;
function updDocLabel() {
  const l = $("#docLabel"); if (!l) return;
  if (!S.pages.length) { l.hidden = true; return; }
  const dirty = isDirty();
  l.hidden = false; l.textContent = S.docName + ".pdf"; l.classList.toggle("dirty", dirty);
  l.title = dirty ? "Hay cambios sin guardar" : "Sin cambios pendientes";
}
function updateEnabled() {
  const has = S.pages.length > 0;
  ["#bSave", "#bClose", "#pRotL", "#pRotR", "#pDup", "#pDel", "#pBlank", "#pInsert", "#pExtract", "#pSplit", "#bZoomIn", "#bZoomOut", "#bFit"]
    .forEach(s => { const b = $(s); if (b) b.disabled = !has; });
  document.querySelectorAll(".tool").forEach(b => b.disabled = !has);
}
function restore(s) { S.pages = JSON.parse(s); base = s; S.sel = null; stopEditing(false); S.checked.clear(); if (!pageById(S.cur)) S.cur = S.pages[0]?.id || null; renderAll(); updUndo(); }
function undo() { if (!S.undo.length) return; stopEditing(true); S.redo.push(base); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(base); restore(S.redo.pop()); }
function updUndo() { $("#bUndo").disabled = !S.undo.length; $("#bRedo").disabled = !S.redo.length; updDocLabel(); }

/* ---------- toast / busy ---------- */
let toastT;
function toast(msg, opts = {}) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = el("div", "toast" + (opts.err ? " err" : ""), msg);
  if (opts.action) { const b = el("button", null, opts.action.label); b.onclick = () => { opts.action.fn(); t.remove(); }; t.append(b); }
  document.body.append(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), opts.ms || 3800);
}
async function busy(msg, fn) {
  const b = el("div", "busy"), t = el("div", null, msg); b.append(t); document.body.append(b);
  await new Promise(r => setTimeout(r, 30));
  try { return await fn(m => { t.textContent = m; }); } finally { b.remove(); }
}

/* ---------- sources ---------- */
async function getPjs(src, idx) {
  const k = src + ":" + idx;
  if (!pjsCache.has(k)) pjsCache.set(k, S.sources.get(src).pdf.getPage(idx + 1));
  return pjsCache.get(k);
}
async function addSource(bytes, name) {
  let lib;
  try { lib = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test(String(e && e.message))) throw new Error(`"${name}" está protegido con contraseña o restricciones. Quita la protección e inténtalo de nuevo.`);
    throw new Error(`No se pudo leer "${name}". Puede que el archivo esté dañado o no sea un PDF.`);
  }
  let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; }
  catch (e) { throw new Error(`No se pudo mostrar "${name}".`); }
  const id = uid("s");
  S.sources.set(id, { id, name, bytes, lib, pdf });
  const out = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await getPjs(id, i);
    const vp = pg.getViewport({ scale: 1, rotation: 0 });
    dims.set(id + ":" + i, { w: vp.width, h: vp.height, r0: pg.rotate || 0, pg });
    out.push({ id: uid("p"), src: id, idx: i, rot: 0, annots: [] });
  }
  return out;
}
function disp(p) {
  const d = dims.get(p.src + ":" + p.idx);
  const r = ((d.r0 + p.rot) % 360 + 360) % 360;
  return r % 180 === 0 ? { w: d.w, h: d.h, r } : { w: d.h, h: d.w, r };
}
let blankSrc = null;
async function blankPages(n, size) {
  if (!blankSrc) {
    const doc = await PDFDocument.create(); doc.addPage([595.28, 841.89]); doc.addPage([612, 792]);
    const [p] = await addSource(await doc.save(), "en blanco"); blankSrc = p.src;
  }
  const idx = size === "carta" ? 1 : 0;
  return Array.from({ length: n }, () => ({ id: uid("p"), src: blankSrc, idx, rot: 0, annots: [] }));
}
async function readBytes(file) { return new Uint8Array(await file.arrayBuffer()); }
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("imagen")); i.src = url; }); }
async function canvasToPng(c) {
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
/* normalize any image file to png/jpg bytes */
async function prepImage(file) {
  const bytes = await readBytes(file);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50, isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type || "image/png" }));
  let img;
  try { img = await loadImg(url); } catch { URL.revokeObjectURL(url); throw new Error(`No se pudo abrir la imagen "${file.name}".`); }
  if (isPng || isJpg) return { url, bytes, kind: isPng ? "png" : "jpg", w: img.naturalWidth, h: img.naturalHeight };
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const png = await canvasToPng(c); URL.revokeObjectURL(url);
  return { url: URL.createObjectURL(new Blob([png], { type: "image/png" })), bytes: png, kind: "png", w: c.width, h: c.height };
}
function registerImage(im) { const id = uid("i"); S.images.set(id, im); return id; }
async function imageFileToPages(file) {
  const im = await prepImage(file);
  const doc = await PDFDocument.create();
  const emb = im.kind === "png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
  const land = im.w > im.h;
  const W = land ? 841.89 : 595.28, H = land ? 595.28 : 841.89, m = 28;
  const s = Math.min((W - 2 * m) / im.w, (H - 2 * m) / im.h, 1);
  const w = im.w * s, h = im.h * s;
  doc.addPage([W, H]).drawImage(emb, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  return addSource(await doc.save(), file.name);
}
async function filesToPages(files) {
  const all = [], errs = [];
  for (const f of files) {
    try {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (isPdf) all.push(...await addSource(await readBytes(f), f.name));
      else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) all.push(...await imageFileToPages(f));
      else errs.push(`"${f.name}" no es un PDF ni una imagen.`);
    } catch (e) { errs.push(e.message); }
  }
  if (errs.length) toast(errs.join(" "), { err: true, ms: 6000 });
  return all;
}

/* ---------- rendering ---------- */
const viewer = $("#viewer");
const io = new IntersectionObserver(ents => {
  for (const en of ents) if (en.isIntersecting) drawCanvas(en.target);
}, { root: viewer, rootMargin: "800px 0px" });

function bmpKey(p) { return `${p.src}:${p.idx}:${p.rot}:${S.zoom}`; }
async function drawCanvas(wrap) {
  const p = pageById(wrap.dataset.id); if (!p) return;
  const key = bmpKey(p); if (wrap.dataset.rk === key) return;
  wrap.dataset.rk = key;
  const c = wrap.querySelector("canvas");
  const cached = bmpCache.get(key);
  if (cached) { c.width = cached.width; c.height = cached.height; c.getContext("2d").drawImage(cached, 0, 0); return; }
  try {
    const pg = await getPjs(p.src, p.idx);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = pg.getViewport({ scale: S.zoom * dpr, rotation: disp(p).r });
    const off = document.createElement("canvas"); off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
    const ctx = off.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, off.width, off.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    bmpCache.set(key, off);
    if (bmpCache.size > 30) bmpCache.delete(bmpCache.keys().next().value);
    if (wrap.dataset.rk !== key) return;
    c.width = off.width; c.height = off.height; c.getContext("2d").drawImage(off, 0, 0);
  } catch (e) { console.error(e); }
}

function renderAll(keepScroll = true) {
  const ratio = keepScroll && viewer.scrollHeight ? viewer.scrollTop / viewer.scrollHeight : 0;
  io.disconnect(); viewer.innerHTML = "";
  if (S.sample) {
    const n = el("div", "sample-note"); n.style.margin = "0 auto 16px"; n.style.maxWidth = "640px";
    n.innerHTML = "<b>Documento de ejemplo.</b> <span>Prueba las herramientas aquí, o abre tu propio PDF para empezar.</span>";
    const b = el("button", "btn", "Abrir mi PDF"); b.style.height = "30px"; b.onclick = () => pickFiles("open"); n.append(b);
    viewer.append(n);
  }
  if (!S.pages.length) {
    const box = el("div", "empty"), card = el("div", "empty-card");
    card.append(el("h2", null, "Abre un PDF para empezar"),
      el("p", null, "También puedes arrastrar aquí tus PDF o imágenes. Todo se procesa en tu navegador: tus archivos no se suben a ningún servidor."));
    const row = el("div", "row"); row.style.justifyContent = "center";
    const b1 = el("button", "btn primary", "Abrir PDF"); b1.onclick = () => pickFiles("open");
    const b2 = el("button", "btn", "Documento en blanco"); b2.onclick = () => newDoc();
    row.append(b1, b2);
    const b3 = el("button", "linkbtn", "Ver un documento de ejemplo"); b3.onclick = () => loadSample();
    card.append(row, b3); box.append(card); viewer.append(box);
  }
  S.pages.forEach((p, i) => {
    const d = disp(p);
    const slot = el("div", "slot");
    slot.append(el("div", "slot-label", `${i + 1} / ${S.pages.length}`));
    const wrap = el("div", "pg" + (p.id === S.cur ? " cur" : ""));
    wrap.dataset.id = p.id;
    wrap.style.width = d.w * S.zoom + "px"; wrap.style.height = d.h * S.zoom + "px";
    const layer = el("div", "layer");
    wrap.append(el("canvas"), layer); slot.append(wrap); viewer.append(slot);
    renderLayer(p, layer);
    io.observe(wrap);
  });
  if (keepScroll) viewer.scrollTop = ratio * viewer.scrollHeight;
  renderThumbs(); updateStatus(); renderProps(true); updateEnabled(); updDocLabel();
}
function layerOf(pid) { return viewer.querySelector(`.pg[data-id="${pid}"] .layer`); }

function renderLayer(p, layer) {
  layer = layer || layerOf(p.id); if (!layer) return;
  layer.innerHTML = "";
  if (S.tool === "edittext") addLineBoxes(p, layer);
  for (const a of p.annots) layer.append(annotEl(a, p));
}
function annotEl(a, p) {
  const z = S.zoom, e = el("div", "an an-" + a.type);
  e.dataset.aid = a.id;
  if (a.type === "text") {
    const f = FONTS[a.font] || FONTS.Helvetica;
    const tx = el("div", "an-tx"); tx.textContent = a.text; e.append(tx);
    Object.assign(e.style, { left: a.x * z + "px", top: a.y * z + "px", fontFamily: f.css, fontSize: a.size * z + "px", color: a.color, fontWeight: a.bold ? "700" : "400", fontStyle: a.italic ? "italic" : "normal" });
  } else if (a.type === "textedit") {
    const vp = vpOf(p), [x0, y0, x1, y1] = a.rect, b = dispBox(vp, a.rect), R = disp(p).r;
    const W = (x1 - x0) * z, H = (y1 - y0) * z, f = FONTS[a.font] || FONTS.Helvetica;
    Object.assign(e.style, { left: b.x * z + "px", top: b.y * z + "px", width: b.w * z + "px", height: b.h * z + "px" });
    const inn = el("div", "te-in");
    Object.assign(inn.style, { width: W + "px", height: H + "px", left: (b.w * z - W) / 2 + "px", top: (b.h * z - H) / 2 + "px", background: a.bg, transform: R ? `rotate(${R}deg)` : "" });
    const tx = el("div", "an-tx"); tx.textContent = a.text;
    if (a.align && a.align !== "left") Object.assign(tx.style, { width: a.aw * z + "px", textAlign: a.align });
    Object.assign(tx.style, { left: (a.bx - x0) * z + "px", top: ((y1 - a.by) - a.size * f.base) * z + "px", fontFamily: f.css, fontSize: a.size * z + "px", color: a.color, fontWeight: a.bold ? "700" : "400", fontStyle: a.italic ? "italic" : "normal" });
    inn.append(tx); e.append(inn);
  } else if (a.type === "image") {
    const im = S.images.get(a.img); const i = el("img"); i.alt = ""; i.draggable = false; if (im) i.src = im.url; e.append(i);
    Object.assign(e.style, { left: a.x * z + "px", top: a.y * z + "px", width: a.w * z + "px", height: a.h * z + "px" });
  } else if (a.type === "rect") {
    if (a.mode === "hl") e.classList.add("hl");
    Object.assign(e.style, { left: a.x * z + "px", top: a.y * z + "px", width: a.w * z + "px", height: a.h * z + "px", background: a.color, opacity: a.mode === "hl" ? 0.45 : 1 });
  } else if (a.type === "ink") {
    const bb = inkBox(a), pad = a.width / 2 + 2;
    Object.assign(e.style, { left: (bb.x - pad) * z + "px", top: (bb.y - pad) * z + "px", width: (bb.w + 2 * pad) * z + "px", height: (bb.h + 2 * pad) * z + "px" });
    e.innerHTML = inkSvg(a, bb.x - pad, bb.y - pad, bb.w + 2 * pad, bb.h + 2 * pad, z);
  }
  if (S.sel && S.sel.aid === a.id) {
    e.classList.add("sel");
    if (a.type === "text") { const mv = el("div", "an-move" + (a.y * z < 26 ? " below" : ""), "Mover"); mv.title = "Arrastra para mover el texto"; e.append(mv); }
    if (a.type !== "ink" && a.type !== "textedit") { const h = el("div", "an-h"); h.title = "Cambiar tamaño"; e.append(h); }
    const x = el("button", "an-x", "×"); x.title = a.type === "textedit" ? "Restaurar el texto original" : "Eliminar"; x.setAttribute("aria-label", x.title); e.append(x);
  }
  return e;
}
function inkBox(a) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of a.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function inkSvg(a, ox, oy, w, h, z) {
  const pts = a.pts.map(([x, y]) => `${((x - ox) * z).toFixed(1)},${((y - oy) * z).toFixed(1)}`).join(" ");
  return `<svg width="${w * z}" height="${h * z}"><polyline points="${pts}" fill="none" stroke="${a.color}" stroke-width="${a.width * z}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ---------- thumbnails ---------- */
const thumbsEl = $("#thumbs");
function sizeName(p) {
  const d = disp(p), mw = d.w * 25.4 / 72, mh = d.h * 25.4 / 72;
  const a = Math.min(mw, mh), b = Math.max(mw, mh), near = (x, y) => Math.abs(a - x) < 3 && Math.abs(b - y) < 3;
  if (near(210, 297)) return "A4"; if (near(215.9, 279.4)) return "Carta"; if (near(215.9, 355.6)) return "Oficio";
  if (near(148, 210)) return "A5"; if (near(297, 420)) return "A3";
  return `${Math.round(mw)}×${Math.round(mh)} mm`;
}
function renderThumbs() {
  thumbsEl.innerHTML = "";
  S.pages.forEach((p, i) => {
    const t = el("div", "th" + (p.id === S.cur ? " cur" : ""));
    t.dataset.id = p.id; t.draggable = true; t.tabIndex = 0;
    t.setAttribute("aria-label", `Página ${i + 1}`);
    const d = disp(p), W = 132, sc = W / Math.max(d.w, d.h * 0.78);
    const tc = el("div", "tc"); tc.style.width = d.w * sc + "px"; tc.style.height = d.h * sc + "px";
    const img = el("img"); img.alt = ""; img.draggable = false; img.style.width = "100%"; img.style.height = "100%"; tc.append(img);
    const cb = el("input"); cb.type = "checkbox"; cb.checked = S.checked.has(p.id); cb.title = "Marcar página"; cb.setAttribute("aria-label", `Marcar página ${i + 1}`);
    const meta = el("div", "meta"); meta.append(el("b", null, String(i + 1)), el("span", null, sizeName(p)));
    const mv = el("div", "mv");
    mv.innerHTML = '<button data-mv="-1" title="Mover arriba" aria-label="Mover arriba"><svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg></button><button data-mv="1" title="Mover abajo" aria-label="Mover abajo"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>';
    t.append(cb, tc, meta, mv);
    if (p.annots.length) { const bd = el("span", "badge", String(p.annots.length)); bd.title = "Elementos agregados"; t.append(bd); }
    thumbsEl.append(t);
    fillThumb(p, img, sc);
  });
  $("#pageCount").textContent = S.pages.length + (S.pages.length === 1 ? " pág." : " págs.");
  updateTargetNote();
}
function thumbsAnnotBadges() {
  thumbsEl.querySelectorAll(".th").forEach(t => {
    const p = pageById(t.dataset.id); if (!p) return;
    let b = t.querySelector(".badge");
    if (!p.annots.length) { b && b.remove(); return; }
    if (!b) { b = el("span", "badge"); b.title = "Elementos agregados"; t.append(b); }
    b.textContent = p.annots.length;
  });
}
async function fillThumb(p, img, sc) {
  const key = `${p.src}:${p.idx}:${p.rot}`;
  if (thumbCache.has(key)) { img.src = thumbCache.get(key); return; }
  try {
    const pg = await getPjs(p.src, p.idx);
    const vp = pg.getViewport({ scale: sc * 2, rotation: disp(p).r });
    const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const url = c.toDataURL("image/jpeg", 0.8); thumbCache.set(key, url); img.src = url;
  } catch (e) { console.error(e); }
}
thumbsEl.addEventListener("click", e => {
  const t = e.target.closest(".th"); if (!t) return;
  const id = t.dataset.id;
  if (e.target.matches("input[type=checkbox]")) {
    e.target.checked ? S.checked.add(id) : S.checked.delete(id); updateTargetNote(); return;
  }
  const mvb = e.target.closest("[data-mv]");
  if (mvb) { movePage(id, +mvb.dataset.mv); return; }
  setCur(id, true);
});
thumbsEl.addEventListener("keydown", e => {
  const t = e.target.closest(".th"); if (!t) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCur(t.dataset.id, true); }
});
let dragPid = null;
thumbsEl.addEventListener("dragstart", e => {
  const t = e.target.closest(".th"); if (!t) return;
  dragPid = t.dataset.id; t.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-page", dragPid);
});
thumbsEl.addEventListener("dragend", () => { dragPid = null; thumbsEl.querySelectorAll(".th").forEach(t => t.classList.remove("dragging", "drop-before", "drop-after")); });
thumbsEl.addEventListener("dragover", e => {
  if (!dragPid) return; e.preventDefault();
  const t = e.target.closest(".th");
  thumbsEl.querySelectorAll(".th").forEach(x => x.classList.remove("drop-before", "drop-after"));
  if (!t || t.dataset.id === dragPid) return;
  const r = t.getBoundingClientRect(), horiz = getComputedStyle(thumbsEl).flexDirection === "row";
  const after = horiz ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  t.classList.add(after ? "drop-after" : "drop-before");
});
thumbsEl.addEventListener("drop", e => {
  if (!dragPid) return; e.preventDefault(); e.stopPropagation();
  const t = thumbsEl.querySelector(".drop-before,.drop-after");
  if (t) {
    const after = t.classList.contains("drop-after");
    const from = pageIndex(dragPid); const [p] = S.pages.splice(from, 1);
    let to = pageIndex(t.dataset.id) + (after ? 1 : 0);
    S.pages.splice(to, 0, p); commit(); renderAll(); setCur(p.id, false);
  }
  dragPid = null;
});
function movePage(id, dir) {
  const i = pageIndex(id), j = i + dir; if (j < 0 || j >= S.pages.length) return;
  [S.pages[i], S.pages[j]] = [S.pages[j], S.pages[i]]; commit(); renderAll(); setCur(id, false);
  const t = thumbsEl.querySelector(`.th[data-id="${id}"] [data-mv="${dir}"]`); t && t.focus();
}

/* ---------- current page ---------- */
function setCur(id, scroll) {
  if (!id) return; S.cur = id;
  viewer.querySelectorAll(".pg").forEach(w => w.classList.toggle("cur", w.dataset.id === id));
  thumbsEl.querySelectorAll(".th").forEach(t => t.classList.toggle("cur", t.dataset.id === id));
  if (scroll) { const w = viewer.querySelector(`.pg[data-id="${id}"]`); w && w.parentElement.scrollIntoView({ block: "start", behavior: "smooth" }); }
  const t = thumbsEl.querySelector(`.th[data-id="${id}"]`);
  if (t) { const r = t.getBoundingClientRect(), rr = thumbsEl.getBoundingClientRect(); if (r.top < rr.top || r.bottom > rr.bottom || r.left < rr.left || r.right > rr.right) t.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  updateTargetNote(); updateStatus();
}
let scrollT;
viewer.addEventListener("scroll", () => {
  clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    const vr = viewer.getBoundingClientRect(), mid = vr.top + vr.height * 0.35;
    let best = null, bd = Infinity;
    viewer.querySelectorAll(".pg").forEach(w => { const r = w.getBoundingClientRect(); const dd = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid)); if (dd < bd) { bd = dd; best = w; } });
    if (best && best.dataset.id !== S.cur) setCur(best.dataset.id, false);
  }, 90);
});
function targets() {
  const ids = S.checked.size ? S.pages.filter(p => S.checked.has(p.id)).map(p => p.id) : (S.cur ? [S.cur] : []);
  return ids;
}
function updateTargetNote() {
  const n = S.checked.size;
  $("#targetNote").textContent = n ? `${n} marcada${n > 1 ? "s" : ""} · acciones sobre ellas` : (S.cur ? `Acciones sobre la página ${pageIndex(S.cur) + 1}` : "");
}
function updateStatus() {
  const st = $("#status"); st.innerHTML = "";
  if (!S.pages.length) { st.append(el("span", "hint", "Sin documento abierto")); return; }
  const p = pageById(S.cur) || S.pages[0];
  st.append(el("span", null, `Página ${pageIndex(p.id) + 1} de ${S.pages.length}`), el("span", null, sizeName(p)), el("span", null, `Zoom ${Math.round(S.zoom * 100)}%`));
  const hints = { select: "Arrastra para mover · doble clic en un texto para editarlo · Supr para borrar", text: "Clic en la página para escribir · arrastra un texto (o su pestaña Mover) para cambiarlo de lugar", highlight: "Arrastra sobre el texto que quieres resaltar", whiteout: "Arrastra para tapar una zona; luego puedes escribir encima con Texto", draw: "Dibuja con el mouse o con el dedo", edittext: "Clic en una línea para corregirla · deja el texto vacío para borrarla · la × restaura el original" };
  st.append(el("span", "hint", hints[S.tool] || ""));
  $("#zoomVal").textContent = Math.round(S.zoom * 100) + "%";
}

/* ---------- zoom ---------- */
function setZoom(z) { z = Math.max(0.25, Math.min(4, z)); if (Math.abs(z - S.zoom) < 0.001) return; stopEditing(true); S.zoom = z; renderAll(); }
function fitWidth() {
  if (!S.pages.length) return;
  const maxW = Math.max(...S.pages.map(p => disp(p).w));
  setZoom(Math.min(2, (viewer.clientWidth - 40) / maxW));
}
$("#bZoomIn").onclick = () => setZoom(Math.round((S.zoom + 0.15) * 20) / 20);
$("#bZoomOut").onclick = () => setZoom(Math.round((S.zoom - 0.15) * 20) / 20);
$("#bFit").onclick = fitWidth;

/* ---------- tools ---------- */
document.querySelectorAll(".tool").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.tool) setTool(b.dataset.tool);
  else if (b.dataset.act === "sign") openSign();
  else if (b.dataset.act === "image") { if (!S.pages.length) return toast("Primero abre un PDF."); $("#imgIn").click(); }
}));
function setTool(t) {
  stopEditing(true); const prev = S.tool; S.tool = t; viewer.dataset.tool = t;
  document.querySelectorAll(".tool[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
  if (t !== "select" && S.sel) { const p = pageById(S.sel.pid); S.sel = null; p && renderLayer(p); }
  if ((t === "edittext") !== (prev === "edittext")) S.pages.forEach(p => renderLayer(p));
  renderProps(); updateStatus();
}
function selAnnot() { if (!S.sel) return null; const p = pageById(S.sel.pid); const a = p && p.annots.find(x => x.id === S.sel.aid); return a ? { p, a } : null; }
function select(pid, aid) {
  const old = S.sel; S.sel = aid ? { pid, aid } : null;
  if (old && old.pid !== pid) { const op = pageById(old.pid); op && renderLayer(op); }
  const p = pageById(pid); p && renderLayer(p);
  renderProps();
}

/* properties bar */
let propsKey = "";
function renderProps(force) {
  const box = $("#props");
  const s = selAnnot();
  const kind = s ? (s.a.type === "rect" ? (s.a.mode === "hl" ? "highlight" : "whiteout") : s.a.type === "ink" ? "draw" : s.a.type) : S.tool;
  const curLines = S.cur && pageById(S.cur) ? lineReady.get(pageById(S.cur).src + ":" + pageById(S.cur).idx) : null;
  const key = kind + "|" + (s ? s.a.id : "") + "|" + S.pages.length + "|" + (kind === "edittext" ? S.cur + ":" + (curLines ? curLines.length : "?") : "");
  if (!force && key === propsKey) return;
  propsKey = key; box.innerHTML = "";
  const src = s ? s.a : null;
  const upd = (fn) => { const cs = selAnnot(); if (cs) { fn(cs.a); renderLayer(cs.p); if (S.editing) reEdit(); commit(); } };
  const color = (val, onch) => { const i = el("input"); i.type = "color"; i.value = val; i.oninput = () => onch(i.value); return i; };
  const lab = (t, ctrl) => { const l = el("label"); l.append(el("span", null, t), ctrl); return l; };
  if (kind === "text" || kind === "textedit") {
    const sel = el("select"); sel.setAttribute("aria-label", "Fuente");
    for (const [k, f] of Object.entries(FONTS)) { const o = el("option", null, f.label); o.value = k; sel.append(o); }
    sel.value = src ? src.font : D.font;
    sel.onchange = () => { if (!s || s.a.type === "text") D.font = sel.value; upd(a => a.font = sel.value); };
    const sz = el("input"); sz.type = "number"; sz.min = 4; sz.max = 144; sz.step = 0.5; sz.value = src ? src.size : D.size; sz.setAttribute("aria-label", "Tamaño");
    sz.onchange = () => { const v = Math.max(4, Math.min(144, Math.round((+sz.value || 12) * 10) / 10)); if (!s || s.a.type === "text") D.size = v; upd(a => a.size = v); };
    const bold = el("button", "toggle", "B"); bold.title = "Negrita"; bold.setAttribute("aria-pressed", String(src ? src.bold : D.bold));
    bold.onclick = () => { const v = bold.getAttribute("aria-pressed") !== "true"; bold.setAttribute("aria-pressed", String(v)); if (!s || s.a.type === "text") D.bold = v; upd(a => a.bold = v); };
    const ital = el("button", "toggle", "I"); ital.style.fontStyle = "italic"; ital.title = "Cursiva"; ital.setAttribute("aria-pressed", String(src ? !!src.italic : D.italic));
    ital.onclick = () => { const v = ital.getAttribute("aria-pressed") !== "true"; ital.setAttribute("aria-pressed", String(v)); if (!s || s.a.type === "text") D.italic = v; upd(a => a.italic = v); };
    box.append(sel, lab("pt", sz), bold, ital, color(src ? src.color : D.color, v => { if (!s || s.a.type === "text") D.color = v; upd(a => a.color = v); }));
    if (s && s.a.type === "text") { const b = el("button", "btn", "Editar texto"); b.style.height = "30px"; b.onclick = () => startEditing(s.p, s.a); box.append(b); }
    if (s && s.a.type === "textedit") {
      const er = el("button", "btn danger", "Borrar línea"); er.style.height = "30px"; er.title = "Quita esta línea del documento";
      er.onclick = () => { const cs = selAnnot(); if (!cs) return; S.editing = null; cs.a.text = ""; renderLayer(cs.p); commit(); startEditing(cs.p, cs.a); };
      const rs = el("button", "btn", "Restaurar original"); rs.style.height = "30px"; rs.onclick = () => deleteAnnot(s.p.id, s.a.id);
      box.append(er, rs);
      if (s.a.fl) { const o = el("span", "small", `Original: ${s.a.fl} · ${s.a.o.size} pt`); o.title = "Fuente detectada en el PDF. Se usa la más parecida disponible."; box.append(o); }
    }
  } else if (kind === "edittext") {
    const msg = curLines && !curLines.length
      ? (CFG.showOcrButton ? "Esta página no tiene texto seleccionable. Si es un escaneo, usa Reconocer texto." : "Esta página no tiene texto editable (puede ser un escaneo o una imagen).")
      : "Haz clic en una línea del documento para corregirla o borrarla.";
    box.append(el("span", null, msg));
    const ob = el("button", "btn", "Reconocer texto (OCR)"); ob.style.height = "30px"; ob.title = "Detecta el texto de una página escaneada para poder editarlo";
    ob.onclick = () => { const p = pageById(S.cur); if (p) runOcr(p); };
    const db = el("button", "btn", "¿Qué hay en esta página?"); db.style.height = "30px"; db.title = "Muestra cómo está guardado el contenido de la página";
    db.onclick = () => { const p = pageById(S.cur); if (p) showDiagnosis(p); };
    if (CFG.showOcrButton) box.append(ob);
    if (CFG.showDiagnosisButton) box.append(db);
  } else if (kind === "highlight") {
    box.append(lab("Color", color(src ? src.color : D.hlColor, v => { D.hlColor = v; upd(a => a.color = v); })));
  } else if (kind === "whiteout") {
    box.append(lab("Relleno", color(src ? src.color : D.woColor, v => { D.woColor = v; upd(a => a.color = v); })));
    if (!s) box.append(el("span", null, "Consejo: para corregir el texto del PDF usa Editar texto."));
  } else if (kind === "draw") {
    const r = el("input"); r.type = "range"; r.min = 0.5; r.max = 12; r.step = 0.5; r.value = src ? src.width : D.inkWidth; r.setAttribute("aria-label", "Grosor");
    r.oninput = () => { D.inkWidth = +r.value; upd(a => a.width = +r.value); };
    box.append(lab("Color", color(src ? src.color : D.inkColor, v => { D.inkColor = v; upd(a => a.color = v); })), lab("Grosor", r));
  } else if (kind === "image") {
    box.append(el("span", null, "Arrastra para mover. Usa la esquina para cambiar el tamaño."));
  } else {
    box.append(el("span", null, S.pages.length ? "Elige una herramienta para editar, o selecciona un elemento que ya agregaste." : "Abre un PDF para empezar."));
  }
  if (s && s.a.type !== "textedit") {
    const dup = el("button", "btn", "Duplicar"); dup.style.height = "30px"; dup.onclick = () => duplicateAnnot(s.p, s.a);
    const del = el("button", "btn danger", "Eliminar"); del.style.height = "30px"; del.onclick = () => deleteAnnot(s.p.id, s.a.id);
    box.append(dup, del);
  }
}
function deleteAnnot(pid, aid) {
  const p = pageById(pid); if (!p) return;
  if (S.editing && S.editing.aid === aid) S.editing = null;
  p.annots = p.annots.filter(a => a.id !== aid); S.sel = null; renderLayer(p); renderProps(); commit();
}
function duplicateAnnot(p, a) {
  const c = JSON.parse(JSON.stringify(a)); c.id = uid("a");
  if (c.type === "ink") c.pts = c.pts.map(([x, y]) => [x + 12, y + 12]); else { c.x += 12; c.y += 12; }
  p.annots.push(c); S.sel = { pid: p.id, aid: c.id }; renderLayer(p); renderProps(); commit();
}

/* ---------- text editing ---------- */
function startEditing(p, a) {
  stopEditing(true);
  S.sel = { pid: p.id, aid: a.id }; S.editing = { pid: p.id, aid: a.id };
  renderLayer(p); renderProps(); reEdit(true);
}
function reEdit(place) {
  if (!S.editing) return;
  const e = viewer.querySelector(`.an[data-aid="${S.editing.aid}"]`); if (!e) { S.editing = null; return; }
  e.classList.add("editing"); e.querySelectorAll(".an-h,.an-x").forEach(x => x.remove());
  const tx = e.querySelector(".an-tx");
  try { tx.contentEditable = "plaintext-only"; } catch { }
  if (tx.contentEditable !== "plaintext-only") tx.contentEditable = "true";
  tx.spellcheck = false;
  tx.oninput = () => { const s = selAnnot(); if (s) s.a.text = tx.innerText.replace(/\n$/, ""); };
  tx.onblur = () => setTimeout(() => { if (S.editing && S.editing.aid === e.dataset.aid && document.activeElement !== tx && !movingText) stopEditing(true); }, 0);
  tx.focus();
  if (place) { const r = document.createRange(); r.selectNodeContents(tx); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); }
}
function stopEditing(save) {
  if (!S.editing) return;
  const { pid, aid } = S.editing; S.editing = null;
  const p = pageById(pid); if (!p) return;
  const a = p.annots.find(x => x.id === aid);
  const unchanged = a && a.type === "textedit" && a.text === a.orig && a.font === a.o.font && a.size === a.o.size && !!a.bold === !!a.o.bold && !!a.italic === !!a.o.italic && a.color === a.o.color;
  if (a && ((a.type === "text" && !a.text.trim()) || unchanged)) { p.annots = p.annots.filter(x => x !== a); if (S.sel && S.sel.aid === aid) S.sel = null; }
  renderLayer(p); renderProps();
  if (save) commit();
}

/* ---------- pointer interaction on pages ---------- */
function ptIn(layer, ev) { const r = layer.getBoundingClientRect(); return { x: (ev.clientX - r.left) / S.zoom, y: (ev.clientY - r.top) / S.zoom }; }
viewer.addEventListener("dblclick", e => {
  const an = e.target.closest(".an-text"); if (!an || an.classList.contains("editing")) return;
  const wrap = an.closest(".pg"), p = pageById(wrap.dataset.id), a = p.annots.find(x => x.id === an.dataset.aid);
  if (a) startEditing(p, a);
});
viewer.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  const wrap = e.target.closest(".pg");
  if (!wrap) { if (S.editing) stopEditing(true); if (S.sel) select(S.sel.pid, null); return; }
  const p = pageById(wrap.dataset.id), layer = wrap.querySelector(".layer");
  if (S.cur !== p.id) setCur(p.id, false);
  const anEl = e.target.closest(".an");
  const onMove = !!e.target.closest(".an-move");
  if (anEl && anEl.classList.contains("editing") && !onMove) return;          // caret placement inside text
  if (e.target.closest(".an-x")) { e.preventDefault(); deleteAnnot(p.id, anEl.dataset.aid); return; }
  if (onMove && S.editing && S.editing.aid === anEl.dataset.aid) {
    // move the box while typing, then keep typing
    e.preventDefault();
    const a = p.annots.find(x => x.id === anEl.dataset.aid); if (!a) return;
    movingText = true;
    dragAnnot(e, p, a, anEl, layer, false, null, tp => { movingText = false; const aa = tp.annots.find(x => x.id === a.id); if (aa) { S.editing = null; startEditing(tp, aa); } });
    return;
  }
  if (S.editing) stopEditing(true);

  const tl = e.target.closest(".tl");
  if (tl && S.tool === "edittext") {
    e.preventDefault();
    const L = (lineReady.get(p.src + ":" + p.idx) || []).find(l => l.key === tl.dataset.lk);
    if (L) editLine(p, L, e.clientX, e.clientY);
    return;
  }
  if (anEl) {
    e.preventDefault();
    const a = p.annots.find(x => x.id === anEl.dataset.aid); if (!a) return;
    if (a.type === "textedit") { startEditing(p, a); placeCaret(a.id, e.clientX, e.clientY); return; }
    if (!S.sel || S.sel.aid !== a.id) select(p.id, a.id);
    const target = viewer.querySelector(`.an[data-aid="${a.id}"]`);
    const resizing = !!e.target.closest(".an-h");
    // with the Text tool: drag moves the box, a simple click edits it
    const onClick = (S.tool === "text" && a.type === "text" && !resizing) ? () => startEditing(p, a) : null;
    dragAnnot(e, p, a, target, layer, resizing, onClick);
    return;
  }
  if (S.sel) select(p.id, null);
  const start = ptIn(layer, e);
  if (S.tool === "text") {
    e.preventDefault();
    const a = { id: uid("a"), type: "text", x: start.x, y: start.y - D.size * 0.6, text: "", font: D.font, size: D.size, color: D.color, bold: D.bold };
    p.annots.push(a); startEditing(p, a);
  } else if (S.tool === "highlight" || S.tool === "whiteout") {
    e.preventDefault(); drawRect(e, p, layer, start);
  } else if (S.tool === "draw") {
    e.preventDefault(); drawInk(e, p, layer, start);
  }
});
function track(onMove, onUp) {
  const mv = ev => onMove(ev), up = ev => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); onUp(ev); };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}
let movingText = false;
function pageUnder(x, y) {
  for (const w of viewer.querySelectorAll(".pg")) { const r = w.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return w; }
  return null;
}
function dragAnnot(e, p, a, target, layer, resizing, onClick, onEnd) {
  const s0 = ptIn(layer, e), orig = JSON.parse(JSON.stringify(a)); let moved = false;
  const z = S.zoom, l0 = parseFloat(target.style.left) || 0, t0 = parseFloat(target.style.top) || 0;
  // origin of the element (top-left) and where inside it the pointer grabbed it
  const o0 = a.type === "ink" ? (() => { const b = inkBox(a); return { x: b.x, y: b.y }; })() : { x: a.x, y: a.y };
  const grab = { x: s0.x - o0.x, y: s0.y - o0.y };
  let tp = p, tLayer = layer, lastEv = e, raf = 0;

  const apply = ev => {
    if (resizing) {
      const pt = ptIn(layer, ev), dx = pt.x - s0.x, dy = pt.y - s0.y;
      if (a.type === "text") {
        const w0 = Math.max(10, (target.offsetWidth / z) || 10);
        a.size = Math.max(4, Math.min(144, Math.round(orig.size * (w0 + dx) / w0 * 2) / 2));
        target.style.fontSize = a.size * z + "px";
      } else {
        let w = Math.max(6, orig.w + dx), h = Math.max(6, orig.h + dy);
        if (a.type === "image" && !ev.shiftKey) { h = w * orig.h / orig.w; }
        a.w = w; a.h = h; target.style.width = w * z + "px"; target.style.height = h * z + "px";
      }
      return;
    }
    // moving: the element follows the pointer, also onto other pages
    const w = pageUnder(ev.clientX, ev.clientY);
    if (w && w.dataset.id !== tp.id) {
      const np = pageById(w.dataset.id);
      if (np) { tp = np; tLayer = w.querySelector(".layer"); tLayer.append(target); if (S.cur !== np.id) setCur(np.id, false); }
    }
    const d = disp(tp), pt = ptIn(tLayer, ev);
    const bw = a.type === "ink" ? inkBox(orig).w : a.type === "text" ? target.offsetWidth / z : a.w;
    const bh = a.type === "ink" ? inkBox(orig).h : a.type === "text" ? target.offsetHeight / z : a.h;
    const nx = Math.max(-bw + 12, Math.min(d.w - 12, pt.x - grab.x));
    const ny = Math.max(-bh + 12, Math.min(d.h - 12, pt.y - grab.y));
    if (a.type === "ink") {
      const dx = nx - o0.x, dy = ny - o0.y;
      a.pts = orig.pts.map(([x, y]) => [x + dx, y + dy]);
      target.style.left = l0 + dx * z + "px"; target.style.top = t0 + dy * z + "px";
    } else {
      a.x = nx; a.y = ny; target.style.left = nx * z + "px"; target.style.top = ny * z + "px";
    }
  };
  // scroll the document when the pointer is near the top or bottom edge, so the element can reach any page
  const autoScroll = () => {
    raf = 0; if (!moved || resizing) return;
    const vr = viewer.getBoundingClientRect(), edge = 48, y = lastEv.clientY;
    let v = 0;
    if (y < vr.top + edge) v = -Math.ceil((vr.top + edge - y) / 3);
    else if (y > vr.bottom - edge) v = Math.ceil((y - (vr.bottom - edge)) / 3);
    if (v) { viewer.scrollTop += Math.max(-24, Math.min(24, v)); apply(lastEv); raf = requestAnimationFrame(autoScroll); }
  };
  track(ev => {
    lastEv = ev;
    if (!moved) { const pt = ptIn(layer, ev); if (Math.hypot(pt.x - s0.x, pt.y - s0.y) * z < 3) return; moved = true; }
    apply(ev);
    if (!raf) raf = requestAnimationFrame(autoScroll);
  }, () => {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (moved) {
      if (tp !== p) {
        p.annots = p.annots.filter(x => x.id !== a.id); tp.annots.push(a);
        S.sel = { pid: tp.id, aid: a.id };
        if (S.editing && S.editing.aid === a.id) S.editing.pid = tp.id;
        renderLayer(p);
      }
      renderLayer(tp); renderProps(true); commit();
    } else if (onClick) onClick();
    if (onEnd) onEnd(tp);
  });
}
function drawRect(e, p, layer, s0) {
  const dr = el("div", "draft"); layer.append(dr); let r = null;
  const hl = S.tool === "highlight";
  dr.style.background = hl ? D.hlColor : D.woColor; dr.style.opacity = hl ? 0.45 : 1;
  track(ev => {
    const pt = ptIn(layer, ev);
    r = { x: Math.min(s0.x, pt.x), y: Math.min(s0.y, pt.y), w: Math.abs(pt.x - s0.x), h: Math.abs(pt.y - s0.y) };
    Object.assign(dr.style, { left: r.x * S.zoom + "px", top: r.y * S.zoom + "px", width: r.w * S.zoom + "px", height: r.h * S.zoom + "px" });
  }, () => {
    dr.remove();
    if (!r || r.w < 3 || r.h < 3) { toast(hl ? "Arrastra sobre la zona que quieres resaltar." : "Arrastra para dibujar el recuadro que tapa."); return; }
    p.annots.push({ id: uid("a"), type: "rect", mode: hl ? "hl" : "wo", color: hl ? D.hlColor : D.woColor, ...r });
    renderLayer(p); commit();
  });
}
function drawInk(e, p, layer, s0) {
  const pts = [[s0.x, s0.y]];
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  const pl = document.createElementNS(svgNS, "polyline");
  pl.setAttribute("fill", "none"); pl.setAttribute("stroke", D.inkColor); pl.setAttribute("stroke-width", D.inkWidth * S.zoom);
  pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
  svg.append(pl); layer.append(svg);
  const upd = () => pl.setAttribute("points", pts.map(([x, y]) => `${x * S.zoom},${y * S.zoom}`).join(" "));
  upd();
  track(ev => {
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (const ce of (evs.length ? evs : [ev])) { const pt = ptIn(layer, ce); const l = pts[pts.length - 1]; if (Math.hypot(pt.x - l[0], pt.y - l[1]) > 0.8) pts.push([pt.x, pt.y]); }
    upd();
  }, () => {
    svg.remove();
    if (pts.length === 1) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
    p.annots.push({ id: uid("a"), type: "ink", color: D.inkColor, width: D.inkWidth, pts: simplify(pts, 0.35).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]) });
    renderLayer(p); commit();
  });
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const sq = tol * tol, keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) { const [x, y] = pts[i]; let t = ((x - x1) * dx + (y - y1) * dy) / L; t = Math.max(0, Math.min(1, t)); const ex = x1 + t * dx - x, ey = y1 + t * dy - y, d = ex * ex + ey * ey; if (d > md) { md = d; mi = i; } }
    if (md > sq) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* place an image annotation in the visible part of the current page */
function placeImage(imgId, widthPt) {
  const p = pageById(S.cur) || S.pages[0]; if (!p) return;
  const im = S.images.get(imgId), d = disp(p);
  let w = Math.min(widthPt, d.w * 0.6), h = w * im.h / im.w;
  if (h > d.h * 0.5) { h = d.h * 0.5; w = h * im.w / im.h; }
  let cy = d.h / 2;
  const wrap = viewer.querySelector(`.pg[data-id="${p.id}"]`);
  if (wrap) {
    const r = wrap.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
    const top = Math.max(r.top, vr.top), bot = Math.min(r.bottom, vr.bottom);
    if (bot > top) cy = ((top + bot) / 2 - r.top) / S.zoom;
  }
  const a = { id: uid("a"), type: "image", img: imgId, w, h, x: (d.w - w) / 2, y: Math.max(0, Math.min(d.h - h, cy - h / 2)) };
  p.annots.push(a);
  if (S.tool !== "select") setTool("select");
  S.sel = { pid: p.id, aid: a.id }; renderLayer(p); renderProps(); commit();
  toast("Listo. Arrástralo a su lugar y ajusta el tamaño desde la esquina.");
}
$("#imgIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { const id = registerImage(await prepImage(f)); placeImage(id, 200); } catch (err) { toast(err.message, { err: true }); }
});

/* ---------- edit existing text (digital PDFs) ---------- */
function vpOf(p, scale = 1, rotation) {
  const d = dims.get(p.src + ":" + p.idx);
  return d.pg.getViewport({ scale, rotation: rotation == null ? disp(p).r : rotation });
}
function dispBox(vp, r) {
  const pts = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].map(([x, y]) => vp.convertToViewportPoint(x, y));
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function lineGeom(x0, x1, by, size, top, bottom) {
  return {
    rect: [x0 - 0.6, Math.min(bottom == null ? Infinity : bottom, by - 0.24 * size), x1 + 0.6, Math.max(top == null ? -Infinity : top, by + 0.9 * size)],   // zona a tapar
    band: [x0 - 1, by - 0.45 * size, x1 + 1, by + 0.45 * size]                          // zona donde se borra el texto real
  };
}
function getLines(p) {
  const k = p.src + ":" + p.idx;
  if (!lineCache.has(k)) {
    lineCache.set(k, (async () => {
      let lines = [];
      try {
        const pg = await getPjs(p.src, p.idx);
        const tc = await pg.getTextContent();
        lines = groupLines(tc, pg, k);
      } catch (e) { console.error(e); }
      try { lines = lines.concat(annotLines(await (await getPjs(p.src, p.idx)).getAnnotations({ intent: "display" }), k)); } catch (e) { console.error(e); }
      const prev = lineReady.get(k) || [];
      lineReady.set(k, prev.concat(lines));
      return lineReady.get(k);
    })());
  }
  return lineCache.get(k);
}
function groupLines(tc, pg, k) {
  const items = [];
  for (const it of tc.items) {
    if (!it || typeof it.str !== "string" || !it.str.trim().length) continue;   // los espacios en blanco no unen columnas
    const [a, b, c, d, e, f] = it.transform;
    if (!(a > 0 && d > 0) || Math.abs(b) > 0.02 * a || Math.abs(c) > 0.02 * d) continue;   // solo texto horizontal
    const st = tc.styles[it.fontName] || {};
    if (st.vertical) continue;
    items.push({ str: it.str, x0: e, x1: e + (it.width || 0), by: f, size: d, fontName: it.fontName, st });
  }
  items.sort((p, q) => q.by - p.by || p.x0 - q.x0);
  const rows = [];
  for (const it of items) {
    const r = rows.find(r => Math.abs(r.by - it.by) <= 0.35 * Math.min(r.size, it.size));
    if (r) r.items.push(it); else rows.push({ by: it.by, size: it.size, items: [it] });
  }
  const lines = [];
  for (const r of rows) {
    r.items.sort((p, q) => p.x0 - q.x0);
    let seg = null;
    const flush = () => { if (seg && seg.text.trim()) lines.push(seg); seg = null; };
    for (const it of r.items) {
      if (seg && (it.x0 - seg.x1 > 1.5 * Math.max(seg.size, it.size) || Math.max(seg.size, it.size) / Math.min(seg.size, it.size) > 1.3)) flush();   // columnas, celdas o etiquetas de otro tamaño
      if (!seg) { seg = { x0: it.x0, x1: it.x1, text: it.str, main: it, size: it.size }; continue; }
      const gap = it.x0 - seg.x1;
      if (gap > 0.15 * it.size && !/\s$/.test(seg.text) && !/^\s/.test(it.str)) seg.text += gap > 2.5 * it.size ? "  " : " ";
      seg.text += it.str; seg.x1 = Math.max(seg.x1, it.x1);
      if (it.str.trim().length > seg.main.str.trim().length) seg.main = it;
      seg.size = Math.max(seg.size, it.size);
    }
    flush();
  }
  return lines.map((L, i) => {
    const m = L.main, size = Math.round(m.size * 10) / 10;
    const fi = fontInfo(pg, m.fontName, m.st);
    return Object.assign({ key: k + "#" + i, text: L.text.replace(/\s+$/, ""), x0: L.x0, x1: L.x1, by: m.by, size }, fi, lineGeom(L.x0, L.x1, m.by, size));
  });
}
/* text that lives in form fields or text boxes placed over the page (filled forms, "typewriter" text) */
function annotLines(anns, k) {
  const out = [];
  anns.forEach((a, i) => {
    if (!a || a.hidden || !a.rect) return;
    const isField = a.subtype === "Widget" && a.fieldType === "Tx";
    const isBox = a.subtype === "FreeText";
    if (!isField && !isBox) return;
    const rich = a.richText && (a.richText.str || "");
    let text = isField ? (typeof a.fieldValue === "string" ? a.fieldValue : Array.isArray(a.fieldValue) ? a.fieldValue.join(", ") : "")
      : ((a.contentsObj && a.contentsObj.str) || rich || (Array.isArray(a.textContent) ? a.textContent.join("\n") : "") || "");
    text = String(text).replace(/\r\n?/g, "\n");
    const x0 = Math.min(a.rect[0], a.rect[2]), x1 = Math.max(a.rect[0], a.rect[2]), y0 = Math.min(a.rect[1], a.rect[3]), y1 = Math.max(a.rect[1], a.rect[3]);
    const h = y1 - y0, w = x1 - x0; if (w < 4 || h < 4) return;
    const da = a.defaultAppearanceData || {}, nl = Math.max(1, text.split("\n").length);
    const multi = isBox || !!a.multiLine || nl > 1;
    let size = da.fontSize > 0 ? da.fontSize : multi ? (h - 4) / (nl * 1.17) : h * 0.62;
    size = Math.round(Math.max(5, Math.min(multi ? 14 : 12, size)) * 2) / 2;
    const fname = String(da.fontName || "");
    const font = /cour/i.test(fname) ? "Courier" : /tim|tiro|serif/i.test(fname) ? "Times" : "Helvetica";
    const by = multi ? y1 - 2 - 0.86 * size : y0 + (h - size) / 2 + 0.22 * size;
    const align = isField ? (a.textAlignment === 1 ? "center" : a.textAlignment === 2 ? "right" : "left") : "left";
    out.push({
      key: k + "#a" + i, ann: { sub: a.subtype, rect: [x0, y0, x1, y1] }, align, aw: w - 4,
      text, x0: x0 + 2, x1: x1 - 2, by, size, font, bold: /bold|bd/i.test(fname), italic: false,
      fontLabel: isField ? `campo de formulario${a.fieldName ? " «" + a.fieldName + "»" : ""}` : "cuadro de texto",
      rect: [x0 + 0.8, y0 + 0.8, x1 - 0.8, y1 - 0.8], band: [x0, y0, x1, y1]
    });
  });
  return out;
}
function fontInfo(pg, fontName, st) {
  let name = "", bold = false, italic = false;
  try { if (pg.commonObjs.has(fontName)) { const f = pg.commonObjs.get(fontName); name = f.name || ""; bold = !!(f.bold || f.black); italic = !!f.italic; } } catch { }
  const fam = (st && st.fontFamily) || "";
  const font = fam === "monospace" || /courier|mono|consol/i.test(name) ? "Courier"
    : fam === "serif" || /times|serif|georgia|garamond|cambria|roman|palatino|book|cmr|lmr|minion/i.test(name) ? "Times" : "Helvetica";
  if (/bold|black|heavy|semibold|demi/i.test(name)) bold = true;
  if (/italic|oblique|cmti|lmri/i.test(name)) italic = true;
  return { font, bold, italic, fontLabel: name.replace(/^[A-Z]{6}\+/, "") };
}
function addLineBoxes(p, layer) {
  const k = p.src + ":" + p.idx, lines = lineReady.get(k);
  if (!lines || !lineCache.has(k)) {
    getLines(p).then(() => { if (S.tool === "edittext" && layerOf(p.id) === layer) { renderLayer(p, layer); renderProps(); } });
    return;
  }
  const taken = new Set(p.annots.filter(a => a.type === "textedit").map(a => a.lk));
  const vp = vpOf(p), z = S.zoom;
  for (const L of lines) {
    if (taken.has(L.key)) continue;
    const b = dispBox(vp, L.rect), d = el("div", "tl" + (L.ocr ? " ocr" : "") + (L.ann ? " field" : ""));
    d.dataset.lk = L.key; d.title = L.fontLabel ? `Clic para editar · ${L.fontLabel} ${L.size} pt` : "Clic para editar";
    Object.assign(d.style, { left: b.x * z + "px", top: b.y * z + "px", width: b.w * z + "px", height: b.h * z + "px" });
    layer.append(d);
  }
}
async function pageBitmap(p) {
  const k = p.src + ":" + p.idx;
  if (!sampleCache.has(k)) {
    sampleCache.set(k, (async () => {
      const pg = await getPjs(p.src, p.idx), vp = pg.getViewport({ scale: 2, rotation: 0 });
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      return { c, ctx, vp };
    })());
    while (sampleCache.size > 4) sampleCache.delete(sampleCache.keys().next().value);
  }
  return sampleCache.get(k);
}
const toHex = (r, g, b) => "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
async function sampleColors(p, rect) {
  const dflt = { bg: "#ffffff", fg: "#000000" };
  try {
    const { c, ctx, vp } = await pageBitmap(p);
    const [ax, ay] = vp.convertToViewportPoint(rect[0], rect[3]), [bx, by] = vp.convertToViewportPoint(rect[2], rect[1]);
    const X0 = Math.max(0, Math.floor(Math.min(ax, bx)) - 3), Y0 = Math.max(0, Math.floor(Math.min(ay, by)) - 3);
    const X1 = Math.min(c.width, Math.ceil(Math.max(ax, bx)) + 3), Y1 = Math.min(c.height, Math.ceil(Math.max(ay, by)) + 3);
    const w = X1 - X0, h = Y1 - Y0; if (w < 8 || h < 8) return dflt;
    const d = ctx.getImageData(X0, Y0, w, h).data;
    const buckets = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x > 1 && y > 1 && x < w - 2 && y < h - 2) continue;   // solo el borde exterior
      const i = (y * w + x) * 4, key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
      const bk = buckets.get(key) || [0, 0, 0, 0]; bk[0] += d[i]; bk[1] += d[i + 1]; bk[2] += d[i + 2]; bk[3]++; buckets.set(key, bk);
    }
    let best = null; for (const v of buckets.values()) if (!best || v[3] > best[3]) best = v;
    const bg = [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
    let maxd = 0;
    const dist = i => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) maxd = Math.max(maxd, dist((y * w + x) * 4));
    let fg = [0, 0, 0];
    if (maxd > 60) {
      let n = 0, s0 = 0, s1 = 0, s2 = 0;
      for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) { const i = (y * w + x) * 4; if (dist(i) >= 0.75 * maxd) { s0 += d[i]; s1 += d[i + 1]; s2 += d[i + 2]; n++; } }
      if (n) fg = [s0 / n, s1 / n, s2 / n];
    }
    const grey = Math.max(...fg) - Math.min(...fg) < 24, lum = (fg[0] + fg[1] + fg[2]) / 3;
    if (grey && lum < 100) fg = [0, 0, 0];                          // el antialiasing aclara el negro
    const bgHex = bg.every(v => v > 246) ? "#ffffff" : toHex(...bg);
    return { bg: bgHex, fg: toHex(...fg) };
  } catch (e) { console.error(e); return dflt; }
}
async function editLine(p, L, cx, cy) {
  stopEditing(true);
  const col = await sampleColors(p, L.rect);
  const a = {
    id: uid("a"), type: "textedit", lk: L.key, ocr: !!L.ocr, ann: L.ann || null, align: L.align || "left", aw: L.aw || 0, rect: L.rect, band: L.band, bx: L.x0, by: L.by,
    size: L.size, font: L.font, bold: L.bold, italic: L.italic, color: col.fg, bg: col.bg, orig: L.text, text: L.text
  };
  a.o = { font: a.font, size: a.size, bold: a.bold, italic: a.italic, color: a.color }; a.fl = L.fontLabel || "";
  if (!pageById(p.id)) return;
  p.annots.push(a); startEditing(p, a);
  placeCaret(a.id, cx, cy);
}
function placeCaret(aid, cx, cy) {
  const tx = viewer.querySelector(`.an[data-aid="${aid}"] .an-tx`); if (!tx || cx == null) return;
  let r = null;
  try {
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(cx, cy);
    else if (document.caretPositionFromPoint) { const cp = document.caretPositionFromPoint(cx, cy); if (cp) { r = document.createRange(); r.setStart(cp.offsetNode, cp.offset); r.collapse(true); } }
  } catch { r = null; }
  if (r && tx.contains(r.startContainer)) { const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); }
}
/* page diagnosis: explains how the page content is stored (helps when something can't be edited) */
const ANN_NAMES = { FreeText: "cuadros de texto", Widget: "campos de formulario", Stamp: "sellos", Ink: "trazos a mano", Square: "rectángulos", Circle: "círculos", Line: "líneas", Polygon: "polígonos", PolyLine: "polilíneas", Highlight: "resaltados", Underline: "subrayados", StrikeOut: "tachados", Squiggly: "ondulados", Text: "notas", Link: "enlaces", Popup: "ventanas de notas", FileAttachment: "adjuntos", Caret: "marcas de inserción", Redact: "zonas de redacción" };
async function showDiagnosis(p) {
  const info = await busy("Analizando la página…", async () => {
    const pg = await getPjs(p.src, p.idx), k = p.src + ":" + p.idx;
    const lines = await getLines(p);
    const tc = await pg.getTextContent();
    const anns = await pg.getAnnotations({ intent: "display" });
    let ops = { text: 0, paths: 0, images: 0, forms: 0 };
    try {
      const ol = await pg.getOperatorList(), O = pdfjsLib.OPS || {};
      for (const f of ol.fnArray) {
        if (f === O.showText || f === O.showSpacedText || f === O.nextLineShowText || f === O.nextLineSetSpacingShowText) ops.text++;
        else if (f === O.constructPath) ops.paths++;
        else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject || f === O.paintJpegXObject) ops.images++;
        else if (f === O.paintFormXObjectBegin) ops.forms++;
      }
    } catch (e) { ops = null; }
    const byType = {};
    for (const a of anns) { const t = a.subtype || "?"; byType[t] = (byType[t] || 0) + 1; }
    const sample = anns.filter(a => a.subtype !== "Link" && a.subtype !== "Popup").slice(0, 12).map(a => ({
      tipo: a.subtype, campo: a.fieldType || undefined, nombre: a.fieldName || undefined,
      texto: (typeof a.fieldValue === "string" ? a.fieldValue : "") || (a.contentsObj && a.contentsObj.str) || (a.richText && a.richText.str) || "",
      oculto: !!a.hidden, rect: (a.rect || []).map(v => Math.round(v))
    }));
    const raw = tc.items.filter(i => typeof i.str === "string" && i.str.trim()).length;
    return { k, page: pageIndex(p.id) + 1, lines: lines.filter(L => !L.ann && !L.ocr).length, fields: lines.filter(L => L.ann).length, raw, byType, ops, sample, pdfjs: pdfjsLib.version };
  });
  const body = el("div"); body.style.display = "flex"; body.style.flexDirection = "column"; body.style.gap = "10px";
  const list = el("ul"); list.style.margin = "0"; list.style.paddingLeft = "18px"; list.style.lineHeight = "1.6";
  const li = t => list.append(el("li", null, t));
  li(`Líneas de texto del documento editables: ${info.lines} (fragmentos de texto: ${info.raw})`);
  li(`Campos y cuadros de texto editables: ${info.fields}`);
  const others = Object.entries(info.byType).filter(([t]) => t !== "Link" && t !== "Popup");
  li(others.length ? "Elementos añadidos encima del documento: " + others.map(([t, n]) => `${n} ${ANN_NAMES[t] || t}`).join(", ") : "Elementos añadidos encima del documento: ninguno");
  if (info.ops) li(`Contenido dibujado: ${info.ops.text} instrucciones de texto, ${info.ops.paths} trazos vectoriales, ${info.ops.images} imágenes`);
  body.append(list);
  const tips = [];
  if (!info.raw && info.ops && info.ops.images) tips.push("La página parece un escaneo o una imagen: usa Reconocer texto (OCR).");
  if (info.ops && info.ops.paths > 200 && info.raw < 20) tips.push("Parte del texto podría estar convertido en dibujo (trazos). Eso ya no es texto: solo se puede tapar y escribir encima, o usar OCR.");
  if (others.some(([t]) => !["FreeText", "Widget"].includes(t))) tips.push("Los sellos, trazos y otras marcas añadidas no son texto editable: se pueden tapar y reemplazar con la herramienta Texto.");
  if (tips.length) { const t = el("p", "small"); t.style.margin = "0"; t.textContent = tips.join(" "); body.append(t); }
  const details = JSON.stringify({ pdfjs: info.pdfjs, pagina: info.page, lineas: info.lines, fragmentos: info.raw, campos: info.fields, anotaciones: info.byType, operaciones: info.ops, muestra: info.sample }, null, 1);
  const pre = el("pre", null, details);
  Object.assign(pre.style, { margin: "0", maxHeight: "160px", overflow: "auto", fontFamily: "var(--f-mono)", fontSize: "11px", background: "var(--raised)", border: "1px solid var(--line)", borderRadius: "8px", padding: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word" });
  const hint = el("p", "small", "Si algo no se puede editar, copia estos detalles y compártelos con quien te ayuda con el editor. No incluyen el contenido del documento salvo el texto de los campos añadidos."); hint.style.margin = "0";
  body.append(pre, hint);
  modal(`Página ${info.page}: qué contiene`, body, [
    { label: "Copiar detalles", fn: async () => { try { await navigator.clipboard.writeText(details); toast("Detalles copiados."); } catch { const r = document.createRange(); r.selectNodeContents(pre); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); toast("Selecciona y copia los detalles con Ctrl+C."); } } },
    { label: "Cerrar", primary: true, fn: c => c() }
  ]);
}
/* remove form fields / text boxes (annotations) from a page, matched by type and position */
function removeAnnots(out, page, anns) {
  const found = anns.map(() => false);
  if (!anns.length) return found;
  try {
    const { PDFName, PDFArray, PDFDict, PDFNumber } = PDFLib;
    const arr = page.node.lookup(PDFName.of("Annots"));
    if (!(arr instanceof PDFArray)) return found;
    const keep = [];
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i), d = out.context.lookup(ref);
      let drop = false;
      if (d instanceof PDFDict) {
        const sub = String(d.get(PDFName.of("Subtype")) || "");
        const r = d.lookup(PDFName.of("Rect"));
        const v = r instanceof PDFArray ? r.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : NaN)) : [];
        if (v.length === 4) {
          const R = [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
          anns.forEach((a, j) => {
            if (!found[j] && sub === "/" + a.sub && R.every((x, n) => Math.abs(x - a.rect[n]) < 0.6)) { found[j] = true; drop = true; }
          });
        }
      }
      if (!drop) keep.push(ref);
    }
    if (found.some(Boolean)) page.node.set(PDFName.of("Annots"), out.context.obj(keep));
  } catch (e) { console.error(e); }
  return found;
}
/* remove the original text from the page content (true deletion, not just covering it) */
function stripText(out, page, bands) {
  const zeros = bands.map(() => 0);
  try {
    const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
    if (!window.PdfTextRemover || !decodePDFRawStream) return zeros;
    const contents = page.node.Contents(); if (!contents) return zeros;
    const streams = [];
    if (contents instanceof PDFArray) for (let i = 0; i < contents.size(); i++) streams.push(out.context.lookup(contents.get(i)));
    else streams.push(contents);
    const chunks = [];
    for (const st of streams) {
      if (st instanceof PDFRawStream) chunks.push(decodePDFRawStream(st).decode());
      else if (st && typeof st.getUnencodedContents === "function") chunks.push(st.getUnencodedContents());
      else return zeros;
    }
    let total = 0; for (const c of chunks) total += c.length + 1;
    const all = new Uint8Array(total); let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; all[off++] = 10; }
    const res = PdfTextRemover.removeTextInRects(all, bands, 1);
    if (res.changed) page.node.set(PDFName.of("Contents"), out.context.obj([out.context.register(out.context.flateStream(res.bytes))]));
    return res.removed;
  } catch (e) { console.error(e); return zeros; }
}

/* ---------- OCR (scanned pages) — Tesseract.js, Apache 2.0 ---------- */
let ocrWorker = null, ocrProgress = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); }
async function urlExists(u) {
  if (!/^https?:/.test(location.protocol)) return false;
  try { const r = await fetch(u, { method: "HEAD", cache: "no-store" }); return r.ok; } catch { return false; }
}
async function getOcr() {
  if (!window.Tesseract) {
    if (await urlExists("vendor/tesseract/tesseract.min.js")) { try { await loadScript("vendor/tesseract/tesseract.min.js"); } catch { } }
    if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  }
  if (ocrWorker) return ocrWorker;
  const abs = u => new URL(u, location.href).href;
  const opts = { logger: m => ocrProgress && ocrProgress(m) };
  let langs = ["spa", "eng"];
  if (await urlExists("vendor/tesseract/worker.min.js")) Object.assign(opts, { workerPath: abs("vendor/tesseract/worker.min.js"), corePath: abs("vendor/tesseract/core") });
  const have = [];
  for (const l of ["spa", "eng"]) if (await urlExists(`vendor/tesseract/lang/${l}.traineddata.gz`)) have.push(l);
  if (have.length) { opts.langPath = abs("vendor/tesseract/lang"); langs = have; }
  else if (await urlExists("lang/eng-traineddata.wasm")) {
    // vista previa alojada: solo hay inglés, publicado con otra extensión (el "?" hace que se ignore el resto de la ruta)
    opts.langPath = abs("lang/eng-traineddata.wasm") + "?f="; langs = ["eng"];
  }
  ocrWorker = await Tesseract.createWorker(langs, 1, opts);
  ocrWorker.langs = langs;
  return ocrWorker;
}
async function runOcr(p) {
  const k = p.src + ":" + p.idx;
  const d = dims.get(k);
  if (d.r0) { toast("Esta página tiene una rotación interna que el OCR todavía no admite.", { err: true }); return; }
  stopEditing(true);
  await getLines(p);
  try {
    const found = await busy("Preparando el reconocimiento de texto…", async say => {
      ocrProgress = m => { if (m && m.status) say(m.status === "recognizing text" ? `Reconociendo texto… ${Math.round((m.progress || 0) * 100)}%` : "Cargando el reconocimiento de texto…"); };
      const w = await getOcr();
      const pg = await getPjs(p.src, p.idx);
      const scale = Math.min(3, 3500 / Math.max(d.w, d.h));
      const vp = pg.getViewport({ scale, rotation: 0 });
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      say("Preparando la página…");
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const { data } = await w.recognize(c);
      const out = [];
      for (const l of data.lines || []) {
        const text = (l.text || "").replace(/\s+$/, "");
        if (!text.trim() || (l.confidence != null && l.confidence < 35)) continue;
        const bb = l.bbox, hasBase = l.baseline && l.baseline.has_baseline !== false && l.baseline.y0 != null;
        const baseY = hasBase ? (l.baseline.y0 + l.baseline.y1) / 2 : bb.y1 - (bb.y1 - bb.y0) * 0.22;
        const [ux0, uTop] = vp.convertToPdfPoint(bb.x0, bb.y0), [ux1, uBot] = vp.convertToPdfPoint(bb.x1, bb.y1);
        const [, uby] = vp.convertToPdfPoint(bb.x0, baseY);
        const size = Math.max(4, Math.min(72, Math.round(((baseY - bb.y0) / scale / 0.72) * 2) / 2));
        out.push(Object.assign({ key: k + "#o" + out.length, ocr: true, text, x0: ux0, x1: ux1, by: uby, size, font: "Helvetica", bold: false, italic: false, fontLabel: "" },
          lineGeom(ux0, ux1, uby, size, uTop + 1, uBot - 1)));
      }
      const prev = (lineReady.get(k) || []).filter(L => !L.ocr);
      const inside = (L, R) => { const cx = (L.rect[0] + L.rect[2]) / 2, cy = (L.rect[1] + L.rect[3]) / 2; return cx > R.rect[0] && cx < R.rect[2] && cy > R.rect[1] && cy < R.rect[3]; };
      const fresh = out.filter(L => !prev.some(Q => inside(L, Q) || inside(Q, L)));
      out.length = 0; out.push(...fresh);
      lineReady.set(k, prev.concat(out)); if (!lineCache.has(k)) lineCache.set(k, Promise.resolve(lineReady.get(k)));
      return out.length;
    });
    S.pages.filter(q => q.src === p.src && q.idx === p.idx).forEach(q => renderLayer(q));
    renderProps(true);
    toast(found ? `Se reconocieron ${found} línea${found > 1 ? "s" : ""}. Haz clic en una para editarla.` : "No se encontró texto legible en esta página.");
  } catch (e) {
    console.error("[OCR]", e); ocrWorker = null;
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /github\.io$/.test(location.hostname);
    toast(local ? "No se pudo iniciar el reconocimiento de texto. Revisa tu conexión a internet y vuelve a intentarlo."
      : "El reconocimiento de texto no está disponible en esta vista. Funciona en la versión instalada (npm start), en la de escritorio o en GitHub Pages.", { err: true, ms: 9000 });
  } finally { ocrProgress = null; }
}

/* ---------- page operations ---------- */
function rotTransform(a, d, cw) {
  // d = display size before rotation; returns annot in the new display space
  if (a.type === "textedit") return; // stored in PDF coordinates, follows the page by itself
  const W = d.w, H = d.h;
  const tp = cw ? ([x, y]) => [H - y, x] : ([x, y]) => [y, W - x];
  if (a.type === "ink") { a.pts = a.pts.map(tp); return; }
  if (a.type === "rect") {
    const [x1, y1] = tp([a.x, a.y]), [x2, y2] = tp([a.x + a.w, a.y + a.h]);
    a.x = Math.min(x1, x2); a.y = Math.min(y1, y2); a.w = Math.abs(x2 - x1); a.h = Math.abs(y2 - y1); return;
  }
  const w = a.type === "text" ? (a.w || 40) : a.w, h = a.type === "text" ? (a.h || a.size * 1.2) : a.h;
  const [cx, cy] = tp([a.x + w / 2, a.y + h / 2]); a.x = cx - w / 2; a.y = cy - h / 2;
}
function measureTexts() {
  viewer.querySelectorAll(".an-text").forEach(e => {
    const p = pageById(e.closest(".pg").dataset.id), a = p && p.annots.find(x => x.id === e.dataset.aid);
    if (a) { a.w = e.offsetWidth / S.zoom; a.h = e.offsetHeight / S.zoom; }
  });
}
function rotatePages(dir) {
  const ids = targets(); if (!ids.length) return;
  stopEditing(true); measureTexts();
  for (const id of ids) {
    const p = pageById(id), d = disp(p);
    p.annots.forEach(a => rotTransform(a, d, dir > 0));
    p.rot = ((p.rot + dir * 90) % 360 + 360) % 360;
  }
  commit(); renderAll();
}
function deletePages() {
  const ids = targets(); if (!ids.length) return;
  if (ids.length >= S.pages.length) { toast("No puedes eliminar todas las páginas. Debe quedar al menos una.", { err: true }); return; }
  stopEditing(true);
  const first = pageIndex(ids[0]);
  S.pages = S.pages.filter(p => !ids.includes(p.id)); S.checked.clear(); S.sel = null;
  S.cur = (S.pages[Math.min(first, S.pages.length - 1)] || {}).id || null;
  commit(); renderAll();
  toast(ids.length > 1 ? `${ids.length} páginas eliminadas.` : "Página eliminada.", { action: { label: "Deshacer", fn: undo } });
}
function duplicatePages() {
  const ids = targets(); if (!ids.length) return;
  stopEditing(true);
  const last = Math.max(...ids.map(pageIndex));
  const copies = ids.map(id => { const c = JSON.parse(JSON.stringify(pageById(id))); c.id = uid("p"); c.annots.forEach(a => a.id = uid("a")); return c; });
  S.pages.splice(last + 1, 0, ...copies); commit(); renderAll(); setCur(copies[0].id, true);
}
function insertAfterIndex() { const ids = targets(); return ids.length ? Math.max(...ids.map(pageIndex)) + 1 : S.pages.length; }
async function insertBlank() {
  if (!S.pages.length) return;
  stopEditing(true);
  const ref = pageById(S.cur) || S.pages[0], name = sizeName(ref);
  const at = insertAfterIndex();
  const [np] = await blankPages(1, name === "Carta" ? "carta" : "a4");
  S.pages.splice(at, 0, np); commit(); renderAll(); setCur(np.id, true);
}
$("#pRotL").onclick = () => rotatePages(-1);
$("#pRotR").onclick = () => rotatePages(1);
$("#pDup").onclick = duplicatePages;
$("#pDel").onclick = deletePages;
$("#pBlank").onclick = insertBlank;
$("#pInsert").onclick = () => pickFiles(S.pages.length && !S.sample ? "insert" : "open");
$("#pExtract").onclick = async () => {
  if (!S.pages.length) return;
  const ids = S.checked.size ? targets() : null;
  if (!ids) { toast("Marca las casillas de las páginas que quieres extraer y vuelve a pulsar Extraer."); return; }
  const list = S.pages.filter(p => ids.includes(p.id));
  await exportPages(list, `${S.docName}-extracto.pdf`);
};
$("#pSplit").onclick = openSplit;

/* ---------- open / add files ---------- */
let pickMode = "open";
function pickFiles(mode) { pickMode = mode; $("#fileIn").click(); }
$("#bOpen").onclick = () => pickFiles("open");
$("#bAppend").onclick = () => pickFiles(S.pages.length && !S.sample ? "append" : "open");
$("#fileIn").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = ""; if (files.length) await handleFiles(files, pickMode);
});
async function handleFiles(files, mode, force) {
  if (mode === "open" && !force && isDirty()) { guardDirty(() => handleFiles(files, mode, true)); return; }
  stopEditing(true);
  const pdfFirst = files.find(f => /\.pdf$/i.test(f.name)) || files[0];
  const oldSources = mode === "open" ? new Set(S.sources.keys()) : null;
  const pages = await busy(files.length > 1 ? `Abriendo ${files.length} archivos…` : "Abriendo…", () => filesToPages(files));
  if (!pages.length) return;
  if (mode === "open") {
    S.pages = []; freeSources(oldSources);
    S.pages = pages; S.sample = false; S.checked.clear(); S.sel = null; S.cur = pages[0].id;
    S.docName = pdfFirst.name.replace(/\.[^.]+$/, "") || "documento";
    resetHistory(); renderAll(false); viewer.scrollTop = 0; fitWidth();
    toast(`${files.length > 1 ? files.length + " archivos abiertos" : "Archivo abierto"} · ${pages.length} página${pages.length > 1 ? "s" : ""}.`);
  } else {
    const at = mode === "insert" ? insertAfterIndex() : S.pages.length;
    S.pages.splice(at, 0, ...pages); S.sample = false; commit(); renderAll(); setCur(pages[0].id, true);
    toast(`Se agregaron ${pages.length} página${pages.length > 1 ? "s" : ""}.`);
  }
}
/* ---------- document lifecycle: new / close ---------- */
function freeSources(ids) {
  for (const id of ids) {
    const s = S.sources.get(id); if (!s) continue;
    try { s.pdf.destroy(); } catch { }
    S.sources.delete(id);
    for (const m of [pjsCache, dims, thumbCache, lineCache, lineReady, sampleCache]) for (const k of [...m.keys()]) if (k.startsWith(id + ":")) m.delete(k);
    if (blankSrc === id) blankSrc = null;
  }
  for (const k of [...bmpCache.keys()]) if (!S.sources.has(k.split(":")[0])) bmpCache.delete(k);
  for (const im of S.images.values()) if (im.url && im.url.startsWith("blob:")) URL.revokeObjectURL(im.url);
  S.images.clear();
}
function clearDoc() {
  stopEditing(false);
  S.pages = []; S.sel = null; S.cur = null; S.checked.clear(); S.sample = false; S.docName = "documento";
  freeSources([...S.sources.keys()]);
}
function guardDirty(action) {
  if (!isDirty()) return action();
  stopEditing(true);
  const body = el("p"); body.style.margin = "0";
  body.append("Tienes cambios sin guardar en ", el("b", null, S.docName + ".pdf"), ". Si continúas sin guardar, se perderán.");
  modal("¿Guardar los cambios?", body, [
    { label: "Cancelar", fn: c => c() },
    { label: "No guardar", fn: c => { c(); action(); } },
    { label: "Guardar", primary: true, fn: async c => { c(); if (await exportPages(S.pages, `${S.docName}-editado.pdf`)) action(); } }
  ]);
}
function closeDoc() {
  if (!S.pages.length) return;
  guardDirty(() => { clearDoc(); resetHistory(); renderAll(false); toast("Documento cerrado."); });
}
function newDoc() {
  guardDirty(async () => {
    clearDoc();
    S.pages = await blankPages(1, "a4"); S.cur = S.pages[0].id; S.docName = "documento-nuevo";
    resetHistory(); renderAll(false); fitWidth();
    toast("Documento en blanco listo. Agrega texto, firmas o más páginas.");
  });
}
$("#bNew").onclick = newDoc;
$("#bClose").onclick = closeDoc;
window.addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

/* drag & drop files */
let dragDepth = 0;
const isFileDrag = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
document.addEventListener("dragenter", e => { if (!isFileDrag(e)) return; dragDepth++; viewer.classList.add("dropping"); });
document.addEventListener("dragleave", e => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; viewer.classList.remove("dropping"); } });
document.addEventListener("dragover", e => { if (isFileDrag(e)) e.preventDefault(); });
document.addEventListener("drop", e => {
  if (!isFileDrag(e)) return; e.preventDefault(); dragDepth = 0; viewer.classList.remove("dropping");
  const files = [...e.dataTransfer.files]; if (!files.length) return;
  const onThumbs = e.target.closest && e.target.closest("#thumbs");
  handleFiles(files, !S.pages.length || S.sample ? "open" : (onThumbs ? "insert" : "append"));
});

/* ---------- export ---------- */
const hexRgb = h => { const n = parseInt((h || "#000000").slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
function safeText(font, s) {
  let out = "";
  for (const ch of s) { if (ch === "\t") { out += "    "; continue; } try { font.encodeText(ch); out += ch; } catch { out += "?"; } }
  return out;
}
async function buildPdf(list) {
  const out = await PDFDocument.create();
  const bySrc = new Map();
  list.forEach((p, i) => { if (!bySrc.has(p.src)) bySrc.set(p.src, []); bySrc.get(p.src).push(i); });
  const copied = new Array(list.length);
  for (const [src, idxs] of bySrc) {
    const arr = await out.copyPages(S.sources.get(src).lib, idxs.map(i => list[i].idx));
    idxs.forEach((pi, k) => copied[pi] = arr[k]);
  }
  const fonts = {}, embImgs = new Map();
  const getFont = async (name, bold, italic) => { const k = FONTS[name].std[(bold ? 1 : 0) + (italic ? 2 : 0)]; if (!fonts[k]) fonts[k] = await out.embedFont(StandardFonts[k]); return fonts[k]; };
  buildPdf.stats = { removed: 0, covered: 0 };
  for (let i = 0; i < list.length; i++) {
    const p = list[i], page = copied[i];
    out.addPage(page);
    const pjs = await getPjs(p.src, p.idx), R = disp(p).r;
    page.setRotation(degrees(R));
    const vp = pjs.getViewport({ scale: 1, rotation: R });
    const P = (x, y) => { const [px, py] = vp.convertToPdfPoint(x, y); return { x: px, y: py }; };
    const rot = degrees(R);
    const edits = p.annots.filter(a => a.type === "textedit");
    if (edits.length) {
      const inPage = edits.filter(a => !a.ann), onTop = edits.filter(a => a.ann);
      const r1 = stripText(out, page, inPage.map(a => a.band)), r2 = removeAnnots(out, page, onTop.map(a => a.ann));
      const removed = edits.map(a => a.ann ? (r2[onTop.indexOf(a)] ? 1 : 0) : r1[inPage.indexOf(a)]);
      for (let k = 0; k < edits.length; k++) {
        const a = edits[k], [x0, y0, x1, y1] = a.rect;
        if (removed[k] > 0) buildPdf.stats.removed++;
        else {
          page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, color: hexRgb(a.bg), borderWidth: 0 });
          if (!a.ocr) buildPdf.stats.covered++;
        }
        if (!a.text) continue;
        const font = await getFont(a.font in FONTS ? a.font : "Helvetica", a.bold, a.italic);
        a.text.split("\n").forEach((line, j) => {
          if (!line) return;
          const t = safeText(font, line);
          let x = a.bx;
          if (a.align === "center" || a.align === "right") { const tw = font.widthOfTextAtSize(t, a.size); x = a.align === "center" ? a.bx + (a.aw - tw) / 2 : a.bx + a.aw - tw; }
          page.drawText(t, { x, y: a.by - j * a.size * 1.2, size: a.size, font, color: hexRgb(a.color) });
        });
      }
    }
    for (const a of p.annots) {
      if (a.type === "text") {
        const font = await getFont(a.font in FONTS ? a.font : "Helvetica", a.bold, a.italic), f = FONTS[a.font] || FONTS.Helvetica;
        a.text.split("\n").forEach((line, j) => {
          if (!line) return;
          const o = P(a.x, a.y + a.size * f.base + j * a.size * 1.2);
          page.drawText(safeText(font, line), { x: o.x, y: o.y, size: a.size, font, color: hexRgb(a.color), rotate: rot });
        });
      } else if (a.type === "image") {
        let emb = embImgs.get(a.img);
        if (!emb) { const im = S.images.get(a.img); emb = im.kind === "png" ? await out.embedPng(im.bytes) : await out.embedJpg(im.bytes); embImgs.set(a.img, emb); }
        const o = P(a.x, a.y + a.h);
        page.drawImage(emb, { x: o.x, y: o.y, width: a.w, height: a.h, rotate: rot });
      } else if (a.type === "rect") {
        const o = P(a.x, a.y + a.h);
        const opt = { x: o.x, y: o.y, width: a.w, height: a.h, color: hexRgb(a.color), rotate: rot, borderWidth: 0 };
        if (a.mode === "hl") { opt.opacity = 0.45; if (BlendMode) opt.blendMode = BlendMode.Multiply; }
        page.drawRectangle(opt);
      } else if (a.type === "ink") {
        const c = hexRgb(a.color);
        for (let k = 1; k < a.pts.length; k++) {
          const lo = { start: P(...a.pts[k - 1]), end: P(...a.pts[k]), thickness: a.width, color: c };
          if (LineCapStyle) lo.lineCap = LineCapStyle.Round;
          page.drawLine(lo);
        }
      }
    }
  }
  out.setProducer(CFG.name); out.setCreator(CFG.name);
  return out.save();
}
async function saveFile(name, data, mime) {
  const blob = new Blob([data], { type: mime });
  const dl = await dlPromise;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); toast(`Guardado: ${name}`); return true; }
    catch (e) {
      if (e && e.code === "declined") { toast("Descarga cancelada."); return false; }
      if (e && e.code === "rate_limited") { toast("Ya hay una descarga esperando tu confirmación.", { err: true }); return false; }
    }
  }
  const url = URL.createObjectURL(blob), a = el("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`Descargando ${name}`);
  return true;
}
async function exportPages(list, name) {
  stopEditing(true);
  try {
    const state = base;
    const bytes = await busy("Generando PDF…", () => buildPdf(list));
    const ok = await saveFile(name, bytes, "application/pdf");
    if (ok && list === S.pages) { savedBase = state; updDocLabel(); }
    const st = buildPdf.stats || {};
    if (ok && st.covered) toast(`Guardado. ${st.covered === 1 ? "1 línea editada se tapó" : st.covered + " líneas editadas se taparon"} en lugar de borrarse: el texto original sigue dentro del archivo, oculto.`, { ms: 9000 });
    return ok;
  } catch (e) { console.error(e); toast("No se pudo generar el PDF: " + (e.message || e), { err: true, ms: 7000 }); return false; }
}
$("#bSave").onclick = () => { if (!S.pages.length) return toast("No hay nada que guardar todavía."); exportPages(S.pages, `${S.docName}${S.sample ? "" : "-editado"}.pdf`); };

/* ---------- modal helper ---------- */
function modal(title, bodyEl, buttons, leftEl) {
  const bg = el("div", "modal-bg"), m = el("div", "modal"); m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", title);
  const hd = el("header"); hd.append(el("h2", null, title));
  const x = el("button", "icon-btn"); x.setAttribute("aria-label", "Cerrar"); x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'; hd.append(x);
  const bd = el("div", "body"); bd.append(bodyEl);
  const ft = el("footer"); if (leftEl) { const l = el("div", "left"); l.append(leftEl); ft.append(l); }
  const close = () => { bg.remove(); document.removeEventListener("keydown", esc); };
  const esc = e => { if (e.key === "Escape") close(); };
  for (const b of buttons) { const btn = el("button", "btn" + (b.primary ? " primary" : ""), b.label); btn.onclick = () => b.fn(close); ft.append(btn); }
  x.onclick = close; bg.addEventListener("pointerdown", e => { if (e.target === bg) close(); });
  m.append(hd, bd, ft); bg.append(m); document.body.append(bg); document.addEventListener("keydown", esc);
  return close;
}

/* ---------- split ---------- */
function parseRanges(str, n) {
  const parts = str.split(/[,;]+/).map(s => s.trim()).filter(Boolean); if (!parts.length) throw new Error("Escribe al menos un rango, por ejemplo 1-3, 4-6.");
  return parts.map(s => {
    const m = s.match(/^(\d+)\s*(?:-\s*(\d+|fin))?$/i); if (!m) throw new Error(`"${s}" no es un rango válido. Usa números como 1-3 o 5.`);
    const a = +m[1], b = m[2] ? (/fin/i.test(m[2]) ? n : +m[2]) : a;
    if (a < 1 || b > n || a > b) throw new Error(`El rango "${s}" no existe: el documento tiene ${n} páginas.`);
    return [a, b];
  });
}
function openSplit() {
  if (!S.pages.length) return;
  const n = S.pages.length, body = el("div");
  body.innerHTML = `<div class="radio-list">
    <label><input type="radio" name="sm" value="ranges" checked> <span><b>Por rangos de páginas</b><br><span class="small">Cada rango se guarda como un PDF aparte.</span></span></label>
    <input class="field" id="rangeIn" placeholder="Ej.: 1-3, 4-${Math.max(4, n)}" value="${n > 1 ? "1-" + Math.ceil(n / 2) + ", " + (Math.ceil(n / 2) + 1) + "-" + n : "1"}">
    <label><input type="radio" name="sm" value="each"> <span><b>Cada página en un archivo</b><br><span class="small">${n} archivos PDF.</span></span></label>
  </div><p class="small">El documento tiene ${n} página${n > 1 ? "s" : ""}. Si salen varios archivos, se descargan juntos en un .zip.</p><div class="err-text" id="splitErr"></div>`;
  modal("Dividir PDF", body, [
    { label: "Cancelar", fn: c => c() },
    { label: "Dividir y descargar", primary: true, fn: async close => {
      const mode = body.querySelector("input[name=sm]:checked").value; let ranges;
      try { ranges = mode === "each" ? S.pages.map((_, i) => [i + 1, i + 1]) : parseRanges(body.querySelector("#rangeIn").value, n); }
      catch (e) { body.querySelector("#splitErr").textContent = e.message; return; }
      close(); stopEditing(true);
      try {
        const files = await busy("Dividiendo…", async () => {
          const res = [];
          for (const [a, b] of ranges) res.push({ name: `${S.docName}-${a === b ? "pag" + a : "pags" + a + "-" + b}.pdf`, bytes: await buildPdf(S.pages.slice(a - 1, b)) });
          return res;
        });
        if (files.length === 1) return saveFile(files[0].name, files[0].bytes, "application/pdf");
        if (typeof JSZip === "undefined") throw new Error("no se cargó el compresor .zip");
        const zip = new JSZip(); files.forEach(f => zip.file(f.name, f.bytes));
        const z = await busy("Comprimiendo…", () => zip.generateAsync({ type: "uint8array" }));
        await saveFile(`${S.docName}-dividido.zip`, z, "application/zip");
      } catch (e) { console.error(e); toast("No se pudo dividir: " + e.message, { err: true }); }
    } }
  ]);
  body.querySelector("#rangeIn").addEventListener("focus", () => body.querySelector("input[value=ranges]").checked = true);
}

/* ---------- signature ---------- */
const SIG_KEY = "epf-firmas-v1";
const loadSigs = () => { try { return JSON.parse(localStorage.getItem(SIG_KEY) || "[]"); } catch { return []; } };
const storeSigs = list => { try { localStorage.setItem(SIG_KEY, JSON.stringify(list.slice(0, 6))); return true; } catch { return false; } };
function trimCanvas(c) {
  const ctx = c.getContext("2d"), { width: w, height: h } = c, d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
}
async function insertSignatureCanvas(c, save) {
  const t = trimCanvas(c); if (!t) return false;
  const png = await canvasToPng(t), url = t.toDataURL("image/png");
  const id = registerImage({ url, bytes: png, kind: "png", w: t.width, h: t.height });
  if (save) { const list = loadSigs().filter(s => s !== url); list.unshift(url); storeSigs(list); }
  placeImage(id, 160); return true;
}
async function dataUrlToCanvas(url) { const i = await loadImg(url); const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d").drawImage(i, 0, 0); return c; }
function openSign() {
  if (!S.pages.length) return toast("Primero abre un PDF.");
  stopEditing(true);
  const body = el("div"); body.style.display = "flex"; body.style.flexDirection = "column"; body.style.gap = "12px";
  const saved = loadSigs();
  if (saved.length) {
    const wrap = el("div"); wrap.append(el("div", "small", "Tus firmas guardadas en este navegador · haz clic para usar una"));
    const row = el("div", "saved"); row.style.marginTop = "6px";
    saved.forEach((u, i) => {
      const b = el("div", "sv"); b.tabIndex = 0; b.setAttribute("role", "button"); b.setAttribute("aria-label", "Usar firma guardada " + (i + 1));
      const im = el("img"); im.src = u; im.alt = ""; const rm = el("button", "rm", "×"); rm.title = "Borrar esta firma";
      rm.onclick = ev => { ev.stopPropagation(); storeSigs(loadSigs().filter(s => s !== u)); b.remove(); };
      const use = async () => { closeM(); await insertSignatureCanvas(await dataUrlToCanvas(u), false); };
      b.onclick = use; b.onkeydown = ev => { if (ev.key === "Enter") use(); };
      b.append(im, rm); row.append(b);
    });
    wrap.append(row); body.append(wrap);
  }
  const tabs = el("div", "tabs"); tabs.setAttribute("role", "tablist");
  const panes = {};
  const mk = (k, label) => { const b = el("button", null, label); b.setAttribute("role", "tab"); b.dataset.k = k; tabs.append(b); panes[k] = el("div"); panes[k].style.display = "flex"; panes[k].style.flexDirection = "column"; panes[k].style.gap = "10px"; return b; };
  mk("draw", "Dibujar"); mk("type", "Escribir"); mk("upload", "Subir imagen");
  body.append(tabs, ...Object.values(panes));
  let mode = "draw";
  const show = k => { mode = k; tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.k === k))); for (const [kk, p] of Object.entries(panes)) p.hidden = kk !== k; if (k === "draw") sizePad(); };
  tabs.onclick = e => { const b = e.target.closest("button"); if (b) show(b.dataset.k); };
  const COLORS = [["#111111", "Negro"], ["#1f3a93", "Azul"], ["#0b5f8a", "Azul petróleo"]];
  let sigColor = "#1f3a93";
  const swatches = onPick => { const r = el("div", "row"); r.append(el("span", "small", "Tinta")); COLORS.forEach(([c, n]) => { const s = el("button", "swatch"); s.style.background = c; s.title = n; s.setAttribute("aria-label", n); s.setAttribute("aria-pressed", String(c === sigColor)); s.onclick = () => { sigColor = c; r.querySelectorAll(".swatch").forEach(x => x.setAttribute("aria-pressed", String(x === s))); onPick(); }; r.append(s); }); return r; };

  /* draw */
  const padWrap = el("div", "sigline"), pad = el("canvas", "sigpad"); padWrap.append(pad);
  const strokes = []; let pw = 2.6;
  const ctl = el("div", "row");
  const thick = el("input"); thick.type = "range"; thick.min = 1.2; thick.max = 5; thick.step = 0.2; thick.value = pw; thick.setAttribute("aria-label", "Grosor"); thick.oninput = () => { pw = +thick.value; redraw(); };
  const clr = el("button", "btn", "Borrar"); clr.style.height = "30px"; clr.onclick = () => { strokes.length = 0; redraw(); };
  const tl = el("label"); tl.append(el("span", null, "Grosor"), thick);
  ctl.append(swatches(() => redraw()), tl, clr);
  panes.draw.append(padWrap, ctl, el("div", "small", "Firma con el mouse, un lápiz táctil o el dedo."));
  function sizePad() { const r = pad.getBoundingClientRect(); if (!r.width) return; const dpr = Math.min(devicePixelRatio || 1, 2); pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr); redraw(); }
  function redraw(target, scale) {
    const c = target || pad, ctx = c.getContext("2d"), k = scale || (pad.width / (pad.getBoundingClientRect().width || 1));
    ctx.clearRect(0, 0, c.width, c.height); ctx.strokeStyle = sigColor; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = pw * k;
    for (const s of strokes) {
      ctx.beginPath(); ctx.moveTo(s[0][0] * k, s[0][1] * k);
      if (s.length === 1) ctx.lineTo(s[0][0] * k + 0.1, s[0][1] * k);
      for (let i = 1; i < s.length - 1; i++) { const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2; ctx.quadraticCurveTo(s[i][0] * k, s[i][1] * k, mx * k, my * k); }
      if (s.length > 1) ctx.lineTo(s[s.length - 1][0] * k, s[s.length - 1][1] * k);
      ctx.stroke();
    }
  }
  pad.addEventListener("pointerdown", e => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect(), s = [[e.clientX - r.left, e.clientY - r.top]]; strokes.push(s); redraw();
    const mv = ev => { for (const ce of (ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev])) s.push([ce.clientX - r.left, ce.clientY - r.top]); redraw(); };
    const up = () => { pad.removeEventListener("pointermove", mv); pad.removeEventListener("pointerup", up); pad.removeEventListener("pointercancel", up); };
    pad.addEventListener("pointermove", mv); pad.addEventListener("pointerup", up); pad.addEventListener("pointercancel", up);
  });

  /* type */
  const SFONTS = [["Caveat", "Caveat"], ["Dancing Script", "Dancing Script"], ["Great Vibes", "Great Vibes"]];
  let sfont = "Dancing Script";
  const nameIn = el("input", "field"); nameIn.placeholder = "Escribe tu nombre"; nameIn.setAttribute("aria-label", "Nombre para la firma");
  const fo = el("div", "fontopts");
  const refreshFo = () => fo.querySelectorAll(".fontopt").forEach(b => { b.textContent = nameIn.value || "Tu firma"; b.style.color = sigColor; });
  SFONTS.forEach(([f]) => { const b = el("button", "fontopt"); b.style.fontFamily = `"${f}", cursive`; b.setAttribute("aria-pressed", String(f === sfont)); b.onclick = () => { sfont = f; fo.querySelectorAll(".fontopt").forEach(x => x.setAttribute("aria-pressed", String(x === b))); }; fo.append(b); });
  nameIn.oninput = refreshFo;
  panes.type.append(nameIn, fo, swatches(refreshFo)); refreshFo();

  /* upload */
  let upImg = null;
  const upBtn = el("button", "btn", "Elegir imagen de la firma"); const upIn = el("input"); upIn.type = "file"; upIn.accept = "image/*"; upIn.hidden = true;
  const prev = el("div", "upprev"); prev.append(el("span", "small", "Sube una foto o escaneo de tu firma sobre papel blanco."));
  const wb = el("input"); wb.type = "checkbox"; wb.checked = true; const wbl = el("label"); wbl.append(wb, el("span", null, "Quitar el fondo blanco"));
  const renderUp = () => { if (!upImg) return; const c = uploadCanvas(); prev.innerHTML = ""; const i = el("img"); i.alt = "Vista previa"; i.src = c.toDataURL(); prev.append(i); };
  const uploadCanvas = () => {
    const c = document.createElement("canvas"); const sc = Math.min(1, 1400 / upImg.naturalWidth); c.width = Math.round(upImg.naturalWidth * sc); c.height = Math.round(upImg.naturalHeight * sc);
    const ctx = c.getContext("2d"); ctx.drawImage(upImg, 0, 0, c.width, c.height);
    if (wb.checked) { const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 225) d[i + 3] = 0; else if (l > 160) d[i + 3] = Math.round(d[i + 3] * (225 - l) / 65); } ctx.putImageData(id, 0, 0); }
    return c;
  };
  upBtn.onclick = () => upIn.click();
  upIn.onchange = async () => { const f = upIn.files[0]; if (!f) return; try { upImg = await loadImg(URL.createObjectURL(f)); renderUp(); } catch { toast("No se pudo abrir esa imagen.", { err: true }); } };
  wb.onchange = renderUp;
  panes.upload.append(el("div", "row"), prev, wbl, upIn); panes.upload.firstChild.append(upBtn);

  const saveCb = el("input"); saveCb.type = "checkbox"; saveCb.checked = true; saveCb.id = "sigSave";
  const sl = el("label"); sl.htmlFor = "sigSave"; sl.textContent = "Guardar para la próxima vez";
  const left = el("span"); left.style.display = "inline-flex"; left.style.gap = "6px"; left.append(saveCb, sl);
  const errT = el("div", "err-text"); body.append(errT);

  const closeM = modal("Agregar firma", body, [
    { label: "Cancelar", fn: c => c() },
    { label: "Insertar firma", primary: true, fn: async close => {
      errT.textContent = "";
      let c;
      if (mode === "draw") {
        if (!strokes.length) { errT.textContent = "Dibuja tu firma en el recuadro."; return; }
        const r = pad.getBoundingClientRect(); c = document.createElement("canvas"); const k = 3; c.width = r.width * k; c.height = r.height * k; redraw(c, k);
      } else if (mode === "type") {
        const name = nameIn.value.trim(); if (!name) { errT.textContent = "Escribe tu nombre."; return; }
        try { await document.fonts.load(`120px "${sfont}"`); } catch { }
        c = document.createElement("canvas"); const ctx0 = c.getContext("2d"); ctx0.font = `120px "${sfont}", cursive`;
        const w = Math.ceil(ctx0.measureText(name).width) + 80; c.width = w; c.height = 240;
        const ctx = c.getContext("2d"); ctx.font = `120px "${sfont}", cursive`; ctx.fillStyle = sigColor; ctx.textBaseline = "middle"; ctx.fillText(name, 40, 120);
      } else {
        if (!upImg) { errT.textContent = "Elige una imagen de tu firma."; return; }
        c = uploadCanvas();
      }
      close();
      const ok = await insertSignatureCanvas(c, saveCb.checked);
      if (!ok) toast("La firma está vacía. Inténtalo de nuevo.", { err: true });
    } }
  ], left);
  show("draw");
  requestAnimationFrame(sizePad);
}

/* ---------- keyboard ---------- */
document.addEventListener("keydown", e => {
  const typing = e.target.closest && e.target.closest("input,select,textarea,[contenteditable='true'],[contenteditable='plaintext-only']");
  if (document.querySelector(".modal-bg")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && !typing && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); $("#bSave").click(); return; }
  if (e.key === "Escape") { if (S.editing) { stopEditing(true); return; } if (S.sel) { select(S.sel.pid, null); return; } if (S.tool !== "select") setTool("select"); return; }
  if (typing || mod) return;
  if ((e.key === "Delete" || e.key === "Backspace") && S.sel) {
    e.preventDefault(); const cs = selAnnot();
    if (cs && cs.a.type === "textedit") { cs.a.text = ""; renderLayer(cs.p); renderProps(true); commit(); } else deleteAnnot(S.sel.pid, S.sel.aid);
    return;
  }
  const s = selAnnot();
  if (s && s.a.type !== "textedit" && e.key.startsWith("Arrow")) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0;
    if (s.a.type === "ink") s.a.pts = s.a.pts.map(([x, y]) => [x + dx, y + dy]); else { s.a.x += dx; s.a.y += dy; }
    renderLayer(s.p); commit(); return;
  }
  const map = { v: "select", t: "text", h: "highlight", d: "draw", e: "edittext" };
  if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
});
$("#bUndo").onclick = undo; $("#bRedo").onclick = redo;
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => updateStatus(), 150); });

/* ---------- sample document ---------- */
async function makeSample() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, ink = rgb(0.12, 0.13, 0.17), mute = rgb(0.42, 0.45, 0.52);
  const wrap = (text, size, maxW) => { const words = text.split(" "), lines = []; let l = ""; for (const w of words) { const t = l ? l + " " + w : w; if (f.widthOfTextAtSize(t, size) > maxW) { lines.push(l); l = w; } else l = t; } if (l) lines.push(l); return lines; };
  const para = (pg, text, y, size = 11) => { for (const ln of wrap(text, size, W - 144)) { pg.drawText(ln, { x: 72, y, size, font: f, color: ink }); y -= size * 1.55; } return y - 8; };
  let pg = doc.addPage([W, H]);
  pg.drawText("DOCUMENTO DE EJEMPLO", { x: 72, y: H - 70, size: 9, font: fb, color: mute });
  pg.drawText("Contrato de prestación de servicios", { x: 72, y: H - 100, size: 20, font: fb, color: ink });
  pg.drawLine({ start: { x: 72, y: H - 114 }, end: { x: W - 72, y: H - 114 }, thickness: 0.8, color: mute });
  let y = H - 145;
  y = para(pg, "Conste por el presente documento el contrato de prestación de servicios que celebran, de una parte, EL CLIENTE, y de la otra parte, EL PROVEEDOR, en los términos y condiciones siguientes.", y);
  pg.drawText("PRIMERA. Objeto", { x: 72, y, size: 11, font: fb, color: ink }); y -= 18;
  y = para(pg, "EL PROVEEDOR se obliga a prestar servicios de diseño y maquetación de documentos durante un plazo de tres meses, contados desde la firma del presente contrato.", y);
  pg.drawText("SEGUNDA. Retribución", { x: 72, y, size: 11, font: fb, color: ink }); y -= 18;
  const hl = { x: 70, y: H - y - 11 * 0.95, w: Math.min(W - 140, f.widthOfTextAtSize(wrap("Como contraprestación, EL CLIENTE pagará a EL PROVEEDOR la suma de S/ 2 500,00 (dos mil quinientos y 00/100 soles) en dos armadas iguales.", 11, W - 144)[0], 11) + 4), h: 11 * 1.3 };
  y = para(pg, "Como contraprestación, EL CLIENTE pagará a EL PROVEEDOR la suma de S/ 2 500,00 (dos mil quinientos y 00/100 soles) en dos armadas iguales.", y);
  pg.drawText("TERCERA. Confidencialidad", { x: 72, y, size: 11, font: fb, color: ink }); y -= 18;
  y = para(pg, "Las partes se comprometen a no divulgar la información a la que tengan acceso con motivo de la ejecución del presente contrato.", y);
  pg = doc.addPage([W, H]); y = H - 90;
  pg.drawText("CUARTA. Disposiciones finales", { x: 72, y, size: 11, font: fb, color: ink }); y -= 18;
  y = para(pg, "En señal de conformidad, las partes firman el presente documento en dos ejemplares de igual valor, en la ciudad de Lima.", y);
  y -= 120;
  for (const [x, t] of [[72, "EL CLIENTE"], [W / 2 + 20, "EL PROVEEDOR"]]) {
    pg.drawLine({ start: { x, y }, end: { x: x + 190, y }, thickness: 0.8, color: ink });
    pg.drawText(t, { x, y: y - 16, size: 10, font: fb, color: ink });
    pg.drawText("Nombre y DNI:", { x, y: y - 31, size: 9, font: f, color: mute });
  }
  return { bytes: await doc.save(), hl };
}
function loadSample() {
  guardDirty(async () => {
    try {
      clearDoc();
      const { bytes, hl } = await makeSample();
      S.pages = await addSource(bytes, "ejemplo.pdf");
      const p1 = S.pages[0];
      p1.annots.push({ id: uid("a"), type: "rect", mode: "hl", color: "#ffe14d", ...hl });
      S.cur = p1.id; S.sample = true; S.docName = "ejemplo";
      resetHistory(); renderAll(false); fitWidth();
    } catch (e) { console.error(e); toast("No se pudo crear el ejemplo.", { err: true }); renderAll(false); }
  });
}
resetHistory(); renderAll(false);
setTool("select");
updUndo();
})();
