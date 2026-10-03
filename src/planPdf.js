// Maßstäblicher Plan als PDF: je Geschoss eine Seite mit Plankopf,
// Nordpfeil und Maßstabsleiste, auf Wunsch eine Seite Flächenberechnung.

import { PAPER, PdfCanvas, buildPdf, MM } from './pdf.js';
import { drawScene } from './canvas2d/render.js';
import { deriveLevel } from './canvas2d/derive.js';
import { areaSchedule, USAGE_LABEL } from './model/building.ts';
import { formatLevel } from './model/units.ts';

const RAND = 10; // mm
const KOPF_B = 185;
const KOPF_H = 62;

function extentOf(project, levelIndex) {
  const level = project.levels[levelIndex];
  const d = deriveLevel(project, levelIndex);
  const pts = [];
  for (const w of level.walls) pts.push(w.a, w.b);
  for (const o of d.outlines) pts.push(...o.outer);
  if (d.roof) pts.push(...d.roof.footprint);
  for (const f of level.furniture) pts.push({ x: f.x, y: f.y });
  if (!pts.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  // Platz für die Außenmaßketten (1,50 m) plus Beschriftung.
  const m = 230;
  return {
    minX: Math.min(...pts.map((p) => p.x)) - m,
    minY: Math.min(...pts.map((p) => p.y)) - m,
    maxX: Math.max(...pts.map((p) => p.x)) + m,
    maxY: Math.max(...pts.map((p) => p.y)) + m,
  };
}

/** Passt das Geschoss im Maßstab auf das Blatt? */
export function planFits(project, levelIndex, { scale, paper, landscape }) {
  const [a, b] = PAPER[paper];
  const [wMm, hMm] = landscape ? [a, b] : [b, a];
  const ext = extentOf(project, levelIndex);
  const needW = ((ext.maxX - ext.minX) * 10) / scale;
  const needH = ((ext.maxY - ext.minY) * 10) / scale;
  const areaW = wMm - 2 * RAND;
  const areaH = hMm - 2 * RAND - KOPF_H - 4;
  return needW <= areaW && needH <= areaH;
}

function text(ctx, s, x, y, size, { bold = false, align = 'left', color = '#111' } = {}) {
  ctx.font = `${bold ? '600 ' : ''}${size}px Helvetica`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function line(ctx, x1, y1, x2, y2, w = 0.5) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = w;
  ctx.stroke();
}

function datum() {
  return new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function plankopf(ctx, project, level, scale, pageW, pageH, blatt) {
  const x = pageW - RAND * MM - KOPF_B * MM;
  const y = pageH - RAND * MM - KOPF_H * MM;
  const w = KOPF_B * MM;
  const h = KOPF_H * MM;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const row = (i) => y + i * 9 * MM;
  for (let i = 1; i <= 5; i++) line(ctx, x, row(i), x + w, row(i), 0.4);
  line(ctx, x + w * 0.55, row(2), x + w * 0.55, y + h, 0.4);

  const lab = (s, xx, yy) => text(ctx, s, xx + 1.6 * MM, yy + 3 * MM, 5.5, { color: '#555' });
  const val = (s, xx, yy, size = 9, bold = false) => text(ctx, s, xx + 1.6 * MM, yy + 7.4 * MM, size, { bold });

  lab('Bauvorhaben', x, row(0));
  val(project.name || 'Ohne Namen', x, row(0), 11, true);
  lab('Bauherr · Grundstück', x, row(1));
  val([project.meta.bauherr, project.meta.adresse].filter(Boolean).join(' · ') || '—', x, row(1));
  lab('Planinhalt', x, row(2));
  val(`Grundriss ${level.name}`, x, row(2), 10, true);
  lab('Maßstab', x + w * 0.55, row(2));
  val(`1:${scale}`, x + w * 0.55, row(2), 10, true);
  lab('Höhenlage OKFF', x, row(3));
  val(`${formatLevel(level.elevationCm)} m  ·  lichte Höhe ${(level.heightCm / 100).toFixed(2).replace('.', ',')} m`, x, row(3));
  lab('Datum', x + w * 0.55, row(3));
  val(datum(), x + w * 0.55, row(3));
  lab('Planverfasser', x, row(4));
  val(project.meta.planverfasser || '—', x, row(4));
  lab('Plan-Nr. · Blatt', x + w * 0.55, row(4));
  val(`${project.meta.planNummer || '—'} · ${blatt}`, x + w * 0.55, row(4));
  lab('Stand', x, row(5));
  val('Entwurfsplanung · Maße in m bzw. cm, Rohbaumaße', x, row(5), 8);
  lab('erstellt mit', x + w * 0.55, row(5));
  val('Planr', x + w * 0.55, row(5), 8);
}

function nordpfeil(ctx, cx, cy, deg) {
  const r = 9 * MM;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.32, r * 0.55);
  ctx.lineTo(0, r * 0.3);
  ctx.closePath();
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(-r * 0.32, r * 0.55);
  ctx.lineTo(0, r * 0.3);
  ctx.closePath();
  ctx.stroke();
  text(ctx, 'N', 0, -r - 2 * MM, 9, { bold: true, align: 'center' });
  ctx.restore();
}

/** Maßstabsleiste 0–5 m in Meterfeldern. */
function massstabsleiste(ctx, x, y, scale) {
  const mPt = (1000 / scale) * MM; // 1 m auf dem Papier
  const meters = scale <= 50 ? 5 : 10;
  const step = scale <= 50 ? 1 : 2;
  for (let i = 0; i < meters; i += step) {
    ctx.fillStyle = (i / step) % 2 === 0 ? '#111' : '#ffffff';
    ctx.fillRect(x + i * mPt, y, step * mPt, 1.6 * MM);
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, meters * mPt, 1.6 * MM);
  for (let i = 0; i <= meters; i += step) text(ctx, `${i}`, x + i * mPt, y + 5 * MM, 6.5, { align: 'center' });
  text(ctx, 'm', x + meters * mPt + 3 * MM, y + 5 * MM, 6.5);
}

function planSeite(project, levelIndex, opts, blatt) {
  const { scale, paper, landscape, settings } = opts;
  const [a, b] = PAPER[paper];
  const [wMm, hMm] = landscape ? [a, b] : [b, a];
  const W = wMm * MM;
  const H = hMm * MM;
  const ctx = new PdfCanvas(W, H);
  const level = project.levels[levelIndex];

  // Planfläche: über dem Plankopf, innerhalb des Rands.
  const areaX = RAND * MM;
  const areaY = RAND * MM;
  const areaW = W - 2 * RAND * MM;
  const areaH = H - 2 * RAND * MM - KOPF_H * MM - 4 * MM;
  const zoom = (10 / scale) * MM; // Punkt je cm
  const ext = extentOf(project, levelIndex);
  const panX = areaX + (areaW - (ext.maxX - ext.minX) * zoom) / 2 - ext.minX * zoom;
  const panY = areaY + (areaH - (ext.maxY - ext.minY) * zoom) / 2 - ext.minY * zoom;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(areaX, areaY, areaW, areaH);
  ctx.clip();
  drawScene(ctx, {
    level,
    derived: deriveLevel(project, levelIndex),
    view: { zoom, panX, panY, print: true, lineScale: 0.42, textScale: 0.72 },
    settings: { ...settings, showGrid: false, showUnderlay: false },
    selection: null,
    draft: null,
    canvasSize: { width: W, height: H },
    dpr: 1,
  });
  ctx.restore();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Blattrand
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(RAND * MM - 3, RAND * MM - 3, W - 2 * RAND * MM + 6, H - 2 * RAND * MM + 6);
  plankopf(ctx, project, level, scale, W, H, blatt);
  nordpfeil(ctx, W - RAND * MM - KOPF_B * MM - 16 * MM, H - RAND * MM - 14 * MM, project.meta.nordDeg || 0);
  massstabsleiste(ctx, RAND * MM + 4 * MM, H - RAND * MM - 10 * MM, scale);
  text(ctx, `Grundriss ${level.name}  M 1:${scale}`, RAND * MM + 4 * MM, H - RAND * MM - 14 * MM, 11, { bold: true });
  return ctx;
}

function flaechenSeite(project, paper, landscape, blatt) {
  const [a, b] = PAPER[paper];
  const [wMm, hMm] = landscape ? [a, b] : [b, a];
  const W = wMm * MM;
  const H = hMm * MM;
  const ctx = new PdfCanvas(W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const rows = areaSchedule(project);
  const x0 = 20 * MM;
  let y = 25 * MM;
  text(ctx, `Wohnflächenberechnung nach WoFlV — ${project.name}`, x0, y, 14, { bold: true });
  y += 7 * MM;
  text(ctx, `${project.meta.bauherr || ''} ${project.meta.adresse ? '· ' + project.meta.adresse : ''} · Stand ${datum()} · Blatt ${blatt}`, x0, y, 8, { color: '#444' });
  y += 10 * MM;
  const cols = [
    ['Geschoss', 0, 'left'],
    ['Raum', 28, 'left'],
    ['Nutzung', 78, 'left'],
    ['Boden', 112, 'left'],
    ['Grundfläche', 160, 'right'],
    ['ab 2 m', 182, 'right'],
    ['1–2 m', 202, 'right'],
    ['anrechenbar', 232, 'right'],
    ['Umfang', 254, 'right'],
  ];
  const tableW = 256 * MM;
  for (const [t, cx, al] of cols) text(ctx, t, x0 + cx * MM, y, 8, { bold: true, align: al });
  y += 2 * MM;
  line(ctx, x0, y, x0 + tableW, y, 0.8);
  y += 5 * MM;
  const de = (v) => v.toFixed(2).replace('.', ',');
  let lastLevel = '';
  for (const r of rows) {
    if (r.level !== lastLevel && lastLevel) {
      line(ctx, x0, y - 3.5 * MM, x0 + tableW, y - 3.5 * MM, 0.3);
    }
    const cells = [
      r.level !== lastLevel ? r.level : '',
      r.name,
      USAGE_LABEL[r.usage],
      r.floor,
      `${de(r.netM2)} m²`,
      de(r.fullM2),
      de(r.halfM2),
      `${de(r.woflvM2)} m²`,
      `${de(r.perimeterM)} m`,
    ];
    cells.forEach((c, i) => text(ctx, c, x0 + cols[i][1] * MM, y, 8, { align: cols[i][2] }));
    lastLevel = r.level;
    y += 5.2 * MM;
  }
  line(ctx, x0, y - 3 * MM, x0 + tableW, y - 3 * MM, 0.8);
  y += 3 * MM;
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const wohn = sum((r) => r.woflvM2);
  const nutz = sum((r) => (r.usage === 'nutz' ? r.netM2 : 0));
  const brutto = sum((r) => r.netM2);
  text(ctx, 'Wohnfläche nach WoFlV', x0 + 160 * MM, y, 9, { bold: true, align: 'right' });
  text(ctx, `${de(wohn)} m²`, x0 + 232 * MM, y, 9, { bold: true, align: 'right' });
  y += 6 * MM;
  text(ctx, 'Nutzfläche (Keller, Technik, Abstell)', x0 + 160 * MM, y, 8.5, { align: 'right' });
  text(ctx, `${de(nutz)} m²`, x0 + 232 * MM, y, 8.5, { align: 'right' });
  y += 6 * MM;
  text(ctx, 'Summe Grundflächen (licht)', x0 + 160 * MM, y, 8.5, { align: 'right' });
  text(ctx, `${de(brutto)} m²`, x0 + 232 * MM, y, 8.5, { align: 'right' });
  y += 12 * MM;
  const hinweise = [
    'Grundflächen aus den lichten Maßen zwischen den Wandoberflächen (Rohbau ohne Putzabzug, Fertigmaße bitte prüfen).',
    'WoFlV § 4: lichte Höhe ab 2 m voll, 1–2 m zur Hälfte, unter 1 m nicht angerechnet; Balkone und Terrassen zu einem Viertel.',
    'Treppen mit mehr als drei Steigungen und deren Podeste sind nach § 3 (3) nicht abzuziehen, wenn sie innerhalb des Raumes liegen — hier nicht abgezogen.',
  ];
  for (const h of hinweise) {
    text(ctx, h, x0, y, 7.5, { color: '#444' });
    y += 4.6 * MM;
  }
  return ctx;
}

/**
 * Baut die PDF-Datei. `levels` sind Geschossindizes; die Blätter werden
 * durchnummeriert, die Flächenberechnung kommt zuletzt.
 */
export function planPdf(project, { levels, scale = 100, paper = 'A3', landscape = true, settings, flaechen = true }) {
  const pages = [];
  const total = levels.length + (flaechen ? 1 : 0);
  levels.forEach((i, k) => pages.push(planSeite(project, i, { scale, paper, landscape, settings }, `${k + 1}/${total}`)));
  if (flaechen) pages.push(flaechenSeite(project, paper === 'A4' ? 'A4' : 'A4', true, `${total}/${total}`));
  return buildPdf(pages, { title: `${project.name} — Grundrisse` });
}
