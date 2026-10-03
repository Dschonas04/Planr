// PDF-Ausgabe ohne Bibliothek.
//
// PdfCanvas bildet den Teil der Canvas-2D-Schnittstelle nach, den der
// Grundriss-Renderer benutzt, und schreibt statt Pixeln PDF-Operatoren. So
// zeichnet derselbe Code den Bildschirm und den maßstäblichen Plan; nichts
// muss doppelt gepflegt werden. Koordinaten rechnet PdfCanvas selbst in den
// Seitenraum um (eigene Transformationsmatrix), PDF bekommt nur fertige
// Punkte. Einheit der Seite: Punkt (1/72 Zoll).
//
// Schrift: die PDF-Standardschriften Helvetica und Helvetica-Bold mit
// WinAnsi-Kodierung -- die braucht kein Einbetten und kennt ä, ö, ü, ß, ²,
// ±, °. Das hochgestellte ⁵ der Architektenmaße gibt es dort nicht; es wird
// als kleine, angehobene 5 gesetzt.

const MM = 72 / 25.4;

// Unicode → WinAnsi für den Bereich 0x80–0x9F.
const WIN_ANSI = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function pdfString(text) {
  let out = '';
  for (const ch of text) {
    let c = ch.codePointAt(0);
    if (c === 0x2212) c = 0x2d; // Minuszeichen
    if (c >= 0x80 && c <= 0xff && !(c >= 0x80 && c <= 0x9f)) {
      // Latin-1 direkt
    } else if (WIN_ANSI[c]) {
      c = WIN_ANSI[c];
    } else if (c > 0x7f) {
      c = 0x3f; // ?
    }
    const s = String.fromCharCode(c);
    if (s === '(' || s === ')' || s === '\\') out += `\\${s}`;
    else if (c < 0x20 || c > 0x7e) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += s;
  }
  return `(${out})`;
}

function parseColor(str) {
  if (!str || typeof str !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  const s = str.trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s.slice(1).split('').map((c) => c + c).join('') : s.slice(1, 7);
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 };
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map((v) => Number(v.trim()));
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }
  if (s === 'white') return { r: 1, g: 1, b: 1, a: 1 };
  return { r: 0, g: 0, b: 0, a: 1 };
}

const n = (v) => (Math.abs(v) < 1e-6 ? '0' : Number(v.toFixed(3)).toString());

let measureCtx = null;
function measure(text, font) {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  measureCtx.font = font.replace(/system-ui, -apple-system, "Segoe UI", /, '');
  return measureCtx.measureText(text).width;
}

export class PdfCanvas {
  constructor(widthPt, heightPt) {
    this.w = widthPt;
    this.h = heightPt;
    this.ops = [];
    this.alphas = new Map();
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.path = [];
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineJoin = 'miter';
    this.lineCap = 'butt';
    this.globalAlpha = 1;
    this.font = '10px Helvetica';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.dash = [];
  }

  // --- Zustand ---
  save() {
    this.stack.push({
      m: this.m.slice(),
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      dash: this.dash.slice(),
    });
    this.ops.push('q');
  }

  restore() {
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, s);
    this.ops.push('Q');
  }

  setTransform(a, b, c, d, e, f) {
    this.m = [a, b, c, d, e, f];
  }

  transform(a, b, c, d, e, f) {
    const [A, B, C, D, E, F] = this.m;
    this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }

  translate(x, y) {
    this.transform(1, 0, 0, 1, x, y);
  }

  scale(x, y) {
    this.transform(x, 0, 0, y, 0, 0);
  }

  rotate(r) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    this.transform(c, s, -s, c, 0, 0);
  }

  setLineDash(d) {
    this.dash = d || [];
  }

  /** Canvas-Gerätekoordinaten (y nach unten) → PDF (y nach oben). */
  pt(x, y) {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, this.h - (b * x + d * y + f)];
  }

  scaleFactor() {
    const [a, b, c, d] = this.m;
    return Math.sqrt(Math.abs(a * d - b * c)) || 1;
  }

  // --- Pfade ---
  beginPath() {
    this.path = [];
  }

  moveTo(x, y) {
    this.path.push(['m', ...this.pt(x, y)]);
  }

  lineTo(x, y) {
    this.path.push(['l', ...this.pt(x, y)]);
  }

  closePath() {
    this.path.push(['h']);
  }

  rect(x, y, w, h) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    // In höchstens 90°-Stücke zerlegen, jedes als kubische Bézierkurve.
    let start = a0;
    let end = a1;
    if (!ccw && end < start) end += Math.PI * 2;
    if (ccw && start < end) start += Math.PI * 2;
    const total = end - start;
    const segs = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
    const step = total / segs;
    const k = (4 / 3) * Math.tan(step / 4);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const P = (t) => {
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      return [cx + x * cr - y * sr, cy + x * sr + y * cr];
    };
    const D = (t) => {
      const x = -rx * Math.sin(t);
      const y = ry * Math.cos(t);
      return [x * cr - y * sr, x * sr + y * cr];
    };
    const [sx, sy] = P(start);
    if (this.path.length && this.path[this.path.length - 1][0] !== 'h') this.lineTo(sx, sy);
    else this.moveTo(sx, sy);
    for (let i = 0; i < segs; i++) {
      const t0 = start + i * step;
      const t1 = t0 + step;
      const [x0, y0] = P(t0);
      const [x1, y1] = P(t1);
      const [dx0, dy0] = D(t0);
      const [dx1, dy1] = D(t1);
      this.path.push(['c', ...this.pt(x0 + k * dx0, y0 + k * dy0), ...this.pt(x1 - k * dx1, y1 - k * dy1), ...this.pt(x1, y1)]);
    }
  }

  arc(cx, cy, r, a0, a1, ccw = false) {
    this.ellipse(cx, cy, r, r, 0, a0, a1, ccw);
  }

  pathOps() {
    return this.path
      .map((p) => {
        if (p[0] === 'm') return `${n(p[1])} ${n(p[2])} m`;
        if (p[0] === 'l') return `${n(p[1])} ${n(p[2])} l`;
        if (p[0] === 'c') return `${p.slice(1).map(n).join(' ')} c`;
        return 'h';
      })
      .join('\n');
  }

  alphaState(a) {
    const key = Math.round(a * 100) / 100;
    if (key >= 0.999) return '/GSopak gs';
    if (!this.alphas.has(key)) this.alphas.set(key, `GS${this.alphas.size}`);
    return `/${this.alphas.get(key)} gs`;
  }

  fill(rule) {
    if (!this.path.length) return;
    const c = parseColor(this.fillStyle);
    this.ops.push(this.alphaState(c.a * this.globalAlpha), `${n(c.r)} ${n(c.g)} ${n(c.b)} rg`, this.pathOps(), rule === 'evenodd' ? 'f*' : 'f');
  }

  stroke() {
    if (!this.path.length) return;
    const c = parseColor(this.strokeStyle);
    const k = this.scaleFactor();
    const dash = this.dash.length ? `[${this.dash.map((d) => n(d * k)).join(' ')}] 0 d` : '[] 0 d';
    const join = { miter: 0, round: 1, bevel: 2 }[this.lineJoin] ?? 0;
    const cap = { butt: 0, round: 1, square: 2 }[this.lineCap] ?? 0;
    this.ops.push(
      this.alphaState(c.a * this.globalAlpha),
      `${n(c.r)} ${n(c.g)} ${n(c.b)} RG`,
      `${n(Math.max(this.lineWidth * k, 0.1))} w ${join} j ${cap} J ${dash}`,
      this.pathOps(),
      'S',
    );
  }

  clip(rule) {
    this.ops.push(this.pathOps(), rule === 'evenodd' ? 'W* n' : 'W n');
  }

  fillRect(x, y, w, h) {
    const saved = this.path;
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    this.path = saved;
  }

  strokeRect(x, y, w, h) {
    const saved = this.path;
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    this.path = saved;
  }

  // --- Text ---
  fontInfo() {
    const m = this.font.match(/(\d+(?:\.\d+)?)px/);
    const size = m ? Number(m[1]) : 10;
    const bold = /\b(600|700|bold)\b/.test(this.font);
    return { size, bold };
  }

  /** Text in Stücke zerlegen: normale Zeichen und hochgestellte Fünfen. */
  pieces(text) {
    return text.split(/(⁵)/).filter((p) => p !== '');
  }

  measureText(text) {
    const { size, bold } = this.fontInfo();
    const f = (px) => `${bold ? '600 ' : ''}${px}px Helvetica, Arial, sans-serif`;
    let w = 0;
    for (const p of this.pieces(text)) w += p === '⁵' ? measure('5', f(size * 0.62)) : measure(p, f(size));
    return { width: w };
  }

  fillText(text, x, y) {
    const { size, bold } = this.fontInfo();
    const width = this.measureText(text).width;
    let dx = 0;
    if (this.textAlign === 'center') dx = -width / 2;
    else if (this.textAlign === 'right' || this.textAlign === 'end') dx = -width;
    let dy = 0;
    if (this.textBaseline === 'middle') dy = size * 0.35;
    else if (this.textBaseline === 'top' || this.textBaseline === 'hanging') dy = size * 0.78;
    else if (this.textBaseline === 'bottom') dy = -size * 0.22;

    const c = parseColor(this.fillStyle);
    const [a, b, cc, d] = this.m;
    // Richtung und Größe der Schrift im Seitenraum (y gespiegelt).
    const ux = [a, -b];
    const uy = [-cc, d];
    const font = bold ? 'F2' : 'F1';
    this.ops.push(this.alphaState(c.a * this.globalAlpha), `${n(c.r)} ${n(c.g)} ${n(c.b)} rg`);
    let cursor = x + dx;
    for (const p of this.pieces(text)) {
      const sup = p === '⁵';
      const s = sup ? size * 0.62 : size;
      const txt = sup ? '5' : p;
      const [px, py] = this.pt(cursor, y + dy - (sup ? size * 0.38 : 0));
      this.ops.push(
        `BT /${font} 1 Tf ${n(ux[0] * s)} ${n(ux[1] * s)} ${n(uy[0] * s)} ${n(uy[1] * s)} ${n(px)} ${n(py)} Tm ${pdfString(txt)} Tj ET`,
      );
      cursor += sup ? measure('5', `${s}px Helvetica`) : measure(txt, `${bold ? '600 ' : ''}${s}px Helvetica, Arial, sans-serif`);
    }
  }

  content() {
    return this.ops.join('\n');
  }
}

/** Setzt Seiten zu einer PDF-Datei zusammen. */
export function buildPdf(pages, { title = 'Planr' } = {}) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const enc = new TextEncoder();
  const latin1 = (s) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };

  const kids = [];
  for (const page of pages) {
    const gs = [`/GSopak << /Type /ExtGState /ca 1 /CA 1 >>`];
    for (const [a, name] of page.alphas) gs.push(`/${name} << /Type /ExtGState /ca ${a} /CA ${a} >>`);
    const stream = page.content();
    const contentObj = add({ stream });
    const pageObj = add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(page.w)} ${n(page.h)}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /ExtGState << ${gs.join(' ')} >> >> /Contents ${contentObj} 0 R >>`,
    );
    kids.push(pageObj);
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfString(title)} /Producer (Planr) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);

  const chunks = [];
  let length = 0;
  const push = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  push(latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(length);
    if (obj && typeof obj === 'object' && 'stream' in obj) {
      const data = latin1(obj.stream);
      push(latin1(`${i + 1} 0 obj\n<< /Length ${data.length} >>\nstream\n`));
      push(data);
      push(latin1('\nendstream\nendobj\n'));
    } else {
      push(latin1(`${i + 1} 0 obj\n${obj}\nendobj\n`));
    }
  });
  const xref = length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) table += `${String(off).padStart(10, '0')} 00000 n \n`;
  table += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(latin1(table));
  void enc;
  return new Blob(chunks, { type: 'application/pdf' });
}

export const PAPER = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
};

export { MM };
