/*
 * Borrado real de texto en el contenido de una página PDF.
 *
 * Recibe el "content stream" ya descomprimido de una página (bytes) y una lista
 * de rectángulos en coordenadas de usuario PDF. Elimina las instrucciones que
 * dibujan texto (Tj, TJ, ', ") cuyo punto de inicio cae dentro de algún
 * rectángulo, de modo que el texto desaparece de verdad del archivo (no solo se
 * tapa). Todo lo demás del contenido se copia byte a byte, sin tocarlo.
 *
 * Regla de seguridad: dentro de una misma línea, si después de un texto borrado
 * viene otro texto que se conserva y que depende de la posición del anterior
 * (sin reposicionarse), se cancela el borrado de esa línea para no desplazar
 * nada. En ese caso el editor tapa la zona como respaldo.
 *
 * Sin dependencias. Funciona en el navegador (window.PdfTextRemover) y en Node.
 */
(function (root) {
  "use strict";

  const WS = new Uint8Array(256), DELIM = new Uint8Array(256);
  for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
  for (const c of "()<>[]{}/%") DELIM[c.charCodeAt(0)] = 1;

  /* ---------- tokenizer: devuelve operaciones con su rango de bytes ---------- */
  function parseOps(b) {
    const n = b.length, ops = [];
    let i = 0, operands = [], opStart = -1;

    const skipWs = () => {
      while (i < n) {
        const c = b[i];
        if (WS[c]) { i++; continue; }
        if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // % comentario
        break;
      }
    };
    const readLiteralString = () => { // b[i] === '('
      let depth = 0;
      for (; i < n; i++) {
        const c = b[i];
        if (c === 92) { i++; continue; }          // \ escape
        if (c === 40) depth++;
        else if (c === 41) { depth--; if (depth === 0) { i++; return; } }
      }
    };
    const readHexString = () => { while (i < n && b[i] !== 62) i++; i++; };
    const readRegular = () => { const s = i; while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++; return s; };

    // lee un objeto operando (número, nombre, string, array, dict). Devuelve su valor simplificado.
    const readObject = () => {
      const c = b[i];
      if (c === 40) { readLiteralString(); return { t: "str" }; }
      if (c === 60) {
        if (b[i + 1] === 60) { // diccionario
          i += 2; let depth = 1;
          while (i < n && depth > 0) {
            skipWs();
            if (b[i] === 60 && b[i + 1] === 60) { depth++; i += 2; }
            else if (b[i] === 62 && b[i + 1] === 62) { depth--; i += 2; }
            else if (b[i] === 40) readLiteralString();
            else if (b[i] === 60) readHexString();
            else if (b[i] === 91 || b[i] === 93 || b[i] === 47) i++;
            else if (i < n) { const s = readRegular(); if (s === i) i++; }
          }
          return { t: "dict" };
        }
        readHexString(); return { t: "str" };
      }
      if (c === 91) { // array
        i++; const items = [];
        while (i < n) {
          skipWs();
          if (b[i] === 93) { i++; break; }
          if (i >= n) break;
          items.push(readObject());
        }
        return { t: "arr", v: items };
      }
      if (c === 47) { i++; readRegular(); return { t: "name" }; }
      if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) { i++; return { t: "junk" }; }
      const s = readRegular();
      if (s === i) { i++; return { t: "junk" }; }
      let word = "";
      for (let k = s; k < i; k++) word += String.fromCharCode(b[k]);
      const num = Number(word);
      if (word !== "" && !isNaN(num) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: num };
      return { t: "kw", v: word };
    };

    while (i < n) {
      skipWs();
      if (i >= n) break;
      const start = i;
      const obj = readObject();
      if (obj.t === "kw" && obj.v !== "true" && obj.v !== "false" && obj.v !== "null") {
        if (obj.v === "BI") { // imagen en línea: BI ... ID <datos> EI
          let j = i;
          while (j < n - 1) {
            if (b[j] === 73 && b[j + 1] === 68 && (j === 0 || WS[b[j - 1]] || DELIM[b[j - 1]]) && (j + 2 >= n || WS[b[j + 2]])) break;
            j++;
          }
          j += 3;
          while (j < n - 1) {
            if (WS[b[j - 1]] && b[j] === 69 && b[j + 1] === 73 && (j + 2 >= n || WS[b[j + 2]] || DELIM[b[j + 2]])) { j += 2; break; }
            j++;
          }
          i = Math.min(j, n);
          ops.push({ op: "BI", args: [], start: opStart >= 0 ? opStart : start, end: i });
        } else {
          ops.push({ op: obj.v, args: operands, start: opStart >= 0 ? opStart : start, end: i });
        }
        operands = []; opStart = -1;
      } else {
        if (opStart < 0) opStart = start;
        operands.push(obj);
      }
    }
    return ops;
  }

  /* ---------- matrices ---------- */
  const mul = (m, n) => [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
  ];
  const nums = (args, k) => { const out = []; for (let j = args.length - k; j < args.length; j++) out.push(args[j] && args[j].t === "num" ? args[j].v : 0); return out; };

  /**
   * @param {Uint8Array} bytes  contenido descomprimido de la página
   * @param {Array<[number,number,number,number]>} rects  [x0,y0,x1,y1] en coordenadas de usuario
   * @param {number} [tol=1.5]  tolerancia en puntos
   * @returns {{bytes: Uint8Array, removed: number[], changed: boolean}}
   */
  function removeTextInRects(bytes, rects, tol) {
    tol = tol == null ? 1.5 : tol;
    const removed = rects.map(() => 0);
    let ops;
    try { ops = parseOps(bytes); } catch (e) { return { bytes, removed, changed: false }; }

    let ctm = [1, 0, 0, 1, 0, 0], stack = [], tm = [1, 0, 0, 1, 0, 0], tlm = tm, TL = 0, chain = 0;
    const shows = []; // {op, chain, hit}
    const td = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; chain++; };
    const hitTest = () => {
      const m = mul(tm, ctm), x = m[4], y = m[5];
      for (let r = 0; r < rects.length; r++) {
        const R = rects[r];
        if (x >= R[0] - tol && x <= R[2] + tol && y >= R[1] - tol && y <= R[3] + tol) return r;
      }
      return -1;
    };

    for (const o of ops) {
      switch (o.op) {
        case "q": stack.push(ctm); break;
        case "Q": if (stack.length) ctm = stack.pop(); break;
        case "cm": ctm = mul(nums(o.args, 6), ctm); break;
        case "BT": tm = tlm = [1, 0, 0, 1, 0, 0]; chain++; break;
        case "Td": { const [x, y] = nums(o.args, 2); td(x, y); break; }
        case "TD": { const [x, y] = nums(o.args, 2); TL = -y; td(x, y); break; }
        case "Tm": tm = tlm = nums(o.args, 6); chain++; break;
        case "TL": TL = nums(o.args, 1)[0]; break;
        case "T*": td(0, -TL); break;
        case "'": case "\"": td(0, -TL); shows.push({ o, chain, hit: hitTest() }); break;
        case "Tj": case "TJ": shows.push({ o, chain, hit: hitTest() }); break;
      }
    }

    // regla de seguridad por cadena (línea sin reposicionar)
    const byChain = new Map();
    for (const s of shows) { if (!byChain.has(s.chain)) byChain.set(s.chain, []); byChain.get(s.chain).push(s); }
    for (const list of byChain.values()) {
      let seenRemoved = false, unsafe = false;
      for (const s of list) { if (s.hit >= 0) seenRemoved = true; else if (seenRemoved) { unsafe = true; break; } }
      if (unsafe) for (const s of list) s.hit = -1;
    }

    const cut = [];
    for (const s of shows) if (s.hit >= 0) {
      // ' y " también mueven a la línea siguiente (y " fija espaciados): se conserva ese efecto
      let repl = " ";
      if (s.o.op === "'") repl = " T* ";
      else if (s.o.op === "\"") { const [aw, ac] = nums(s.o.args.slice(0, 2), 2); repl = ` ${aw} Tw ${ac} Tc T* `; }
      cut.push({ start: s.o.start, end: s.o.end, repl });
      removed[s.hit]++;
    }
    if (!cut.length) return { bytes, removed, changed: false };

    cut.sort((a, b) => a.start - b.start);
    const parts = []; let pos = 0, total = 0;
    const enc = s => { const u = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k); return u; };
    for (const c of cut) {
      if (c.start > pos) { const p = bytes.subarray(pos, c.start); parts.push(p); total += p.length; }
      const r = enc(c.repl); parts.push(r); total += r.length;
      pos = c.end;
    }
    if (pos < bytes.length) { const p = bytes.subarray(pos); parts.push(p); total += p.length; }
    const out = new Uint8Array(total); let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return { bytes: out, removed, changed: true };
  }

  const api = { removeTextInRects, parseOps };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PdfTextRemover = api;
})(this);
