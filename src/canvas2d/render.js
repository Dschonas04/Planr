// Alle Zeichenoperationen des Grundrisses. Der Canvas arbeitet in Pixeln,
// das Modell in Zentimetern -- die Umrechnung passiert ausschliesslich ueber
// ctx.setTransform() am Anfang von drawScene().
//
// Derselbe Code zeichnet auch den PDF-Plan: pdf.js stellt einen Kontext mit
// den hier benutzten Canvas-Methoden bereit. Deshalb kommt hier nichts vor,
// was es nur im Browser gibt (keine Muster, keine Filter) -- Schraffuren
// entstehen als echte Linien innerhalb einer Clip-Fläche.

import {
  add,
  angleOf,
  dist,
  normal,
  normalize,
  polygonArea,
  polygonCentroid,
  rectCorners,
  scale,
  sub,
} from '../model/geometry.ts';
import { formatArch, formatArea, formatLength } from '../model/units.ts';
import {
  openingsOfWall,
  pointAlongWall,
  wallAngle,
  wallLength,
  wallVector,
} from '../model/project.ts';
import { clipByClearHeight, roofPlanePolygons, wallBands, wallOutline } from '../model/building.ts';

export const COLORS = {
  bg: '#f5f3ee',
  paper: '#ffffff',
  grid: '#e3ded2',
  gridMajor: '#d2cbba',
  wall: '#1f2427',
  wallSelected: '#c2410c',
  room: 'rgba(126, 160, 190, 0.10)',
  roomText: '#2f3a44',
  furniture: '#a0a0a0',
  furnitureLine: '#4a4a4a',
  selection: '#c2410c',
  dimension: '#33414d',
  opening: '#f5f3ee',
  openingLine: '#1f2427',
  draft: '#c2410c',
  underlay: 'rgba(60, 70, 80, 0.16)',
  roof: '#7a5a3a',
  stair: '#2a3138',
  guide: '#0f766e',
};

/** Füllung und Schraffur je Baustoff, angelehnt an DIN ISO 128-50. */
const MATERIAL_STYLE = {
  ziegel: { fill: '#f6e9df', hatch: [{ angle: 45, px: 5 }] },
  mauerwerk: { fill: '#f1ece4', hatch: [{ angle: 45, px: 5 }] },
  kalksandstein: { fill: '#eeebe6', hatch: [{ angle: 45, px: 3.5 }] },
  beton: { fill: '#e6e6e6', hatch: [{ angle: 45, px: 6 }, { angle: -45, px: 6 }] },
  daemmung: { fill: '#fdf8e6', zigzag: true },
  holz: { fill: '#f3e4cb', hatch: [{ angle: 45, px: 9 }] },
  putz: { fill: '#f8f7f4' },
  gipskarton: { fill: '#f4f4f4' },
  luft: { fill: '#ffffff' },
};

/** Wand als Viereck (vier Eckpunkte in cm), ohne Anschlüsse. */
export function wallQuad(wall) {
  const dir = normalize(wallVector(wall));
  const n = { x: -dir.y, y: dir.x };
  const h = (wall.thicknessCm || 24) / 2;
  const off = scale(n, h);
  return [add(wall.a, off), add(wall.b, off), sub(wall.b, off), sub(wall.a, off)];
}

function pathPolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

/**
 * Text in Weltkoordinaten, aber in konstanter Pixelgroesse -- sonst waere
 * Beschriftung beim Herauszoomen unlesbar und beim Hereinzoomen riesig.
 */
function drawLabel(ctx, text, x, y, view, opts = {}) {
  const { size = 12, color = '#333', align = 'center', baseline = 'middle', angle = 0, bg = null, bold = false } = opts;
  const k = view.textScale || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(1 / view.zoom, 1 / view.zoom);
  const px = size * k;
  ctx.font = `${bold ? '600 ' : ''}${px}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (bg) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = bg;
    const left = align === 'center' ? -w / 2 - 3 : align === 'right' ? -w - 3 : -3;
    const top = baseline === 'bottom' ? -px - 2 : baseline === 'top' ? -2 : -px / 2 - 2;
    ctx.fillRect(left, top, w + 6, px + 4);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Liniendicke in Bildschirmpixeln, unabhängig vom Zoom. */
const lw = (view, px) => (px * (view.lineScale || 1)) / view.zoom;

/** Waagerechter Platz in einem gedrehten Rechteck, grob: bei Schräglage die kürzere Seite. */
function breiteFuerText(w, d, rad) {
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  if (c > 0.97) return w;
  if (s > 0.97) return d;
  return Math.min(w, d);
}

function passenderText(ctx, label, verfuegbar, size) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${size}px ${FONT}`;
  const kurz = label.replace(/\s+\d+(?:[.,]\d+)?\s*[×x]\s*\d+.*$/, '');
  const text = [label, kurz].find((t) => t && ctx.measureText(t).width <= verfuegbar) || null;
  ctx.restore();
  return text;
}

function drawGrid(ctx, view, canvasSize, gridCm) {
  const left = -view.panX / view.zoom;
  const top = -view.panY / view.zoom;
  const right = left + canvasSize.width / view.zoom;
  const bottom = top + canvasSize.height / view.zoom;

  // Unter ~4 px Rasterabstand wird das Gitter zu Grafikrauschen -- dann nur
  // noch das Meterraster zeichnen.
  const fine = gridCm * view.zoom >= 4 ? gridCm : 0;
  const major = 100;

  ctx.lineWidth = 1 / view.zoom;
  if (fine) {
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (let x = Math.floor(left / fine) * fine; x < right; x += fine) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = Math.floor(top / fine) * fine; y < bottom; y += fine) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = COLORS.gridMajor;
  ctx.beginPath();
  for (let x = Math.floor(left / major) * major; x < right; x += major) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = Math.floor(top / major) * major; y < bottom; y += major) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
}

// --- Schraffur ---------------------------------------------------------

function bboxOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Parallele Linien unter `angle` Grad im Abstand von `px` Bildschirmpixeln, auf das Polygon beschnitten. */
function hatchLines(ctx, points, angleDeg, px, view) {
  const step = Math.max(px / view.zoom, 0.5);
  const b = bboxOf(points);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const r = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + step;
  const a = (angleDeg * Math.PI) / 180;
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const n = { x: -d.y, y: d.x };
  // An einem festen Weltraster ausrichten, damit die Schraffur beim
  // Verschieben einer Wand nicht über benachbarte Wände "wandert".
  const base = Math.floor((cx * n.x + cy * n.y - r) / step) * step;
  ctx.beginPath();
  for (let o = base; o <= cx * n.x + cy * n.y + r; o += step) {
    const along = cx * d.x + cy * d.y;
    const p = { x: n.x * o + d.x * (along - r), y: n.y * o + d.y * (along - r) };
    const q = { x: n.x * o + d.x * (along + r), y: n.y * o + d.y * (along + r) };
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
}

/** Dämmung: Zickzack entlang der Schicht, Höhe = Schichtdicke. */
function zigzag(ctx, band, view) {
  const [p0, p1, p2, p3] = band.points;
  const a = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
  const b = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const len = dist(a, b);
  const th = (dist(p0, p3) + dist(p1, p2)) / 2;
  if (len < 1 || th < 0.5) return;
  const dir = normalize(sub(b, a));
  const n = normal(dir);
  const period = Math.max(th, 4 / view.zoom);
  ctx.beginPath();
  let i = 0;
  for (let s = 0; s <= len + period; s += period / 2, i++) {
    const side = i % 2 === 0 ? -0.42 : 0.42;
    const p = add(add(a, scale(dir, s)), scale(n, side * th));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function fillBand(ctx, band, view) {
  const style = MATERIAL_STYLE[band.material] || MATERIAL_STYLE.mauerwerk;
  pathPolygon(ctx, band.points);
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (!style.hatch && !style.zigzag) return;
  // Unter ~3 px Bandbreite wird jede Schraffur zu Brei.
  const th = Math.min(dist(band.points[0], band.points[3]), dist(band.points[1], band.points[2]));
  if (th * view.zoom < 3) return;
  ctx.save();
  pathPolygon(ctx, band.points);
  ctx.clip();
  ctx.strokeStyle = '#5b5f63';
  ctx.lineWidth = lw(view, 0.6);
  if (style.zigzag) zigzag(ctx, band, view);
  for (const h of style.hatch || []) hatchLines(ctx, band.points, h.angle, h.px, view);
  ctx.restore();
}

// --- Bauteile ------------------------------------------------------------

function drawUnderlay(ctx, below, view) {
  if (!below) return;
  ctx.fillStyle = COLORS.underlay;
  for (const w of below.walls) {
    pathPolygon(ctx, wallQuad(w));
    ctx.fill();
  }
}

function drawRoomFills(ctx, rooms) {
  for (const room of rooms) {
    if (room.net.length < 3) continue;
    pathPolygon(ctx, room.net);
    ctx.fillStyle = room.stamp?.usage === 'aussen' ? 'rgba(120, 170, 120, 0.12)' : room.stamp?.usage === 'nutz' ? 'rgba(150, 150, 150, 0.10)' : COLORS.room;
    ctx.fill();
  }
}

function drawRoof(ctx, d, view) {
  const model = d.roof;
  if (!model) return;
  // Linien gleicher lichter Höhe: was darunter liegt, zählt nach WoFlV nur halb
  // (1–2 m) oder gar nicht (< 1 m).
  for (const o of d.outlines) {
    for (const [h, color, txt] of [
      [100, 'rgba(185, 28, 28, 0.08)', '1,00'],
      [200, 'rgba(202, 138, 4, 0.06)', '2,00'],
    ]) {
      const area = clipByClearHeight(model, o.outer, h);
      ctx.save();
      pathPolygon(ctx, o.outer);
      ctx.clip();
      // Bereich unterhalb der Höhe tönen: alles minus die freigeschnittene Fläche.
      ctx.beginPath();
      ctx.moveTo(o.outer[0].x, o.outer[0].y);
      for (const p of o.outer.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      if (area.length >= 3) {
        ctx.moveTo(area[0].x, area[0].y);
        for (let i = area.length - 1; i >= 1; i--) ctx.lineTo(area[i].x, area[i].y);
        ctx.closePath();
      }
      ctx.fillStyle = color;
      ctx.fill('evenodd');
      if (area.length >= 3) {
        ctx.setLineDash([lw(view, 6), lw(view, 4)]);
        ctx.strokeStyle = h === 100 ? '#b91c1c' : '#b45309';
        ctx.lineWidth = lw(view, 1);
        pathPolygon(ctx, area);
        ctx.stroke();
        ctx.setLineDash([]);
        const b = bboxOf(area);
        // Innerhalb der Außenwand anschreiben, sonst deckt die Wand den Text zu.
        const ob = bboxOf(o.outer);
        const lx = Math.max(b.minX, ob.minX) + 60;
        const ly = h === 100 ? b.minY + 12 / view.zoom : b.minY + 12 / view.zoom;
        drawLabel(ctx, `lichte Höhe ${txt} m`, lx, ly, view, {
          size: 9.5,
          color: h === 100 ? '#991b1b' : '#92400e',
          align: 'left',
        });
      }
      ctx.restore();
    }
  }

  // Dachaufsicht: Traufe/Ortgang strichpunktiert, First und Grate gestrichelt.
  ctx.strokeStyle = COLORS.roof;
  ctx.lineWidth = lw(view, 1.1);
  ctx.setLineDash([lw(view, 12), lw(view, 3), lw(view, 2), lw(view, 3)]);
  pathPolygon(ctx, model.footprint);
  ctx.stroke();
  ctx.setLineDash([lw(view, 5), lw(view, 4)]);
  ctx.lineWidth = lw(view, 0.9);
  for (const pp of roofPlanePolygons(model)) {
    if (pp.points.length < 3) continue;
    pathPolygon(ctx, pp.points);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawStairs(ctx, d, view, selection) {
  for (const geo of d.arriving) {
    // Deckenöffnung der ankommenden Treppe: Umriss mit Diagonalen (Luftraum).
    pathPolygon(ctx, geo.outline);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.strokeStyle = COLORS.stair;
    ctx.lineWidth = lw(view, 1);
    ctx.stroke();
    const b = geo.outline;
    ctx.setLineDash([lw(view, 6), lw(view, 4)]);
    ctx.beginPath();
    ctx.moveTo(b[0].x, b[0].y);
    ctx.lineTo(b[Math.floor(b.length / 2)].x, b[Math.floor(b.length / 2)].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const { stair, geo } of d.stairs) {
    const selected = selection?.kind === 'stair' && selection.id === stair.id;
    ctx.lineWidth = lw(view, 0.9);
    ctx.strokeStyle = selected ? COLORS.selection : COLORS.stair;
    for (const t of geo.treads) {
      pathPolygon(ctx, t.points);
      ctx.fillStyle = t.landing ? '#f3f1ec' : '#fbfaf7';
      ctx.fill();
      ctx.stroke();
    }
    pathPolygon(ctx, geo.outline);
    ctx.lineWidth = lw(view, selected ? 2.2 : 1.4);
    ctx.stroke();

    // Lauflinie mit Antrittskreis und Pfeil am Austritt.
    const wl = geo.walkline;
    ctx.lineWidth = lw(view, 1);
    ctx.beginPath();
    ctx.moveTo(wl[0].x, wl[0].y);
    for (const p of wl.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(wl[0].x, wl[0].y, lw(view, 4), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    const end = wl[wl.length - 1];
    const prev = wl[wl.length - 2];
    const dir = normalize(sub(end, prev));
    const n = normal(dir);
    const s = lw(view, 9);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - dir.x * s + n.x * s * 0.45, end.y - dir.y * s + n.y * s * 0.45);
    ctx.lineTo(end.x - dir.x * s - n.x * s * 0.45, end.y - dir.y * s - n.y * s * 0.45);
    ctx.closePath();
    ctx.fill();

    const c = geo.calc;
    const lab = `${c.risers} STG ${formatArch(c.riserCm)}/${formatArch(c.treadCm)}`;
    const mid = geo.treads[Math.min(1, geo.treads.length - 1)];
    if (mid) {
      const center = polygonCentroid(geo.treads[0].points);
      const dirRun = normalize(sub(polygonCentroid(mid.points), center));
      const ang = angleOf(dirRun);
      let a = ang;
      if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;
      const at = add(wl[0], scale(normal(dirRun), stair.widthCm / 2 + 12 / view.zoom));
      drawLabel(ctx, lab, at.x, at.y, view, { size: 9.5, color: COLORS.stair, angle: a, bg: 'rgba(255,255,255,0.8)' });
    }
    if (c.warnings.length && !view.print) {
      const p = polygonCentroid(geo.outline);
      drawLabel(ctx, '⚠', p.x, p.y, view, { size: 14, color: '#b45309' });
    }
  }
}

function drawWalls(ctx, level, d, view, selection) {
  ctx.lineJoin = 'miter';
  for (const wall of level.walls) {
    const cap = d.caps.get(wall.id);
    if (!cap) continue;
    const outside = d.sides.get(wall.id) || 1;
    for (const band of wallBands(wall, cap, outside)) fillBand(ctx, band, view);
    // Schichtfugen dünn, die Schnittkante kräftig.
    ctx.strokeStyle = '#6b7075';
    ctx.lineWidth = lw(view, 0.5);
    for (const band of wallBands(wall, cap, outside).slice(0, -1)) {
      ctx.beginPath();
      ctx.moveTo(band.points[2].x, band.points[2].y);
      ctx.lineTo(band.points[3].x, band.points[3].y);
      ctx.stroke();
    }
  }
  // Kanten erst nach allen Füllungen, sonst überdeckt die nächste Wand die
  // Kante der vorigen an der Gehrung.
  for (const wall of level.walls) {
    const cap = d.caps.get(wall.id);
    if (!cap) continue;
    const selected = selection?.kind === 'wall' && selection.id === wall.id;
    const o = wallOutline(wall, cap);
    ctx.strokeStyle = selected ? COLORS.wallSelected : COLORS.wall;
    ctx.lineWidth = lw(view, selected ? 2.6 : 1.6);
    // Nur die Längsseiten: die Stirnseiten an Anschlüssen sind keine Kanten.
    ctx.beginPath();
    ctx.moveTo(o[0].x, o[0].y);
    ctx.lineTo(o[1].x, o[1].y);
    ctx.moveTo(o[2].x, o[2].y);
    ctx.lineTo(o[3].x, o[3].y);
    ctx.stroke();
    const freeEnd = (end, c) => Math.abs(c.d.x * normal(normalize(sub(wall.b, wall.a))).x + c.d.y * normal(normalize(sub(wall.b, wall.a))).y) > 0.999 && dist(c.p, end) < 0.5;
    ctx.beginPath();
    if (freeEnd(wall.a, cap.a)) {
      ctx.moveTo(o[3].x, o[3].y);
      ctx.lineTo(o[0].x, o[0].y);
    }
    if (freeEnd(wall.b, cap.b)) {
      ctx.moveTo(o[1].x, o[1].y);
      ctx.lineTo(o[2].x, o[2].y);
    }
    ctx.stroke();
  }

  // Öffnungen ausstanzen und Symbole zeichnen.
  for (const wall of level.walls) {
    const openings = openingsOfWall(level, wall.id);
    if (!openings.length) continue;
    const angle = wallAngle(wall);
    const th = wall.thicknessCm || 24;
    const outside = d.sides.get(wall.id) || 0;
    for (const op of openings) {
      const center = pointAlongWall(wall, op.offsetCm);
      const corners = rectCorners(center.x, center.y, op.widthCm, th + 0.6, angle);
      pathPolygon(ctx, corners);
      ctx.fillStyle = view.print ? COLORS.paper : COLORS.bg;
      ctx.fill();
      drawOpeningSymbol(ctx, op, center, angle, th, view, selection, outside);
    }
  }
}

function drawOpeningSymbol(ctx, op, center, angle, th, view, selection, outside) {
  const selected = selection?.kind === 'opening' && selection.id === op.id;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  const col = selected ? COLORS.selection : COLORS.openingLine;
  ctx.strokeStyle = col;

  const hw = op.widthCm / 2;
  const hh = th / 2;

  // Leibungen sind Schnittkanten der Wand.
  ctx.lineWidth = lw(view, 1.6);
  ctx.beginPath();
  ctx.moveTo(-hw, -hh);
  ctx.lineTo(-hw, hh);
  ctx.moveTo(hw, -hh);
  ctx.lineTo(hw, hh);
  ctx.stroke();

  if (op.type === 'window') {
    // Rahmen und Glas: zwei Linien in Wandmitte, außen die Fensterbank.
    ctx.lineWidth = lw(view, 0.9);
    const g = Math.min(4, hh / 3);
    ctx.beginPath();
    ctx.moveTo(-hw, -g);
    ctx.lineTo(hw, -g);
    ctx.moveTo(-hw, g);
    ctx.lineTo(hw, g);
    ctx.stroke();
    if (outside) {
      const s = outside * (hh + 3);
      ctx.lineWidth = lw(view, 0.7);
      ctx.beginPath();
      ctx.moveTo(-hw - 2, s);
      ctx.lineTo(hw + 2, s);
      ctx.stroke();
    }
    if (op.sillCm <= 1) {
      // Bodentiefes Element: Schwelle andeuten.
      ctx.setLineDash([lw(view, 3), lw(view, 3)]);
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    // Tür: Blatt am Anschlag plus Aufschlagbogen; schlägt zur Seite `swing` auf.
    const swing = op.swing === -1 ? -1 : 1;
    const y0 = swing * hh;
    ctx.lineWidth = lw(view, 1.3);
    ctx.beginPath();
    ctx.moveTo(-hw, y0);
    ctx.lineTo(-hw, y0 + swing * op.widthCm);
    ctx.stroke();
    ctx.lineWidth = lw(view, 0.7);
    ctx.beginPath();
    ctx.arc(-hw, y0, op.widthCm, swing > 0 ? 0 : -Math.PI / 2, swing > 0 ? Math.PI / 2 : 0);
    ctx.stroke();
  }

  if (selected) {
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = lw(view, 1.5);
    ctx.strokeRect(-hw, -hh, op.widthCm, th);
  }
  ctx.restore();
}

/** Rohbaumaße an den Öffnungen: Breite/Höhe, darunter die Brüstungshöhe. */
function drawOpeningLabels(ctx, level, d, view) {
  for (const wall of level.walls) {
    const openings = openingsOfWall(level, wall.id);
    if (!openings.length) continue;
    const dir = normalize(wallVector(wall));
    const n = normal(dir);
    const outside = d.sides.get(wall.id) || 0;
    // Innen anschreiben; bei Innenwänden auf die Seite, zu der die Normale zeigt.
    const side = outside ? -outside : 1;
    let ang = angleOf(dir);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    for (const op of openings) {
      const c = pointAlongWall(wall, op.offsetCm);
      const off = wall.thicknessCm / 2 + 11 / view.zoom;
      const p = add(c, scale(n, side * off));
      const txt = `${formatArch(op.widthCm)}/${formatArch(op.heightCm)}`;
      drawLabel(ctx, txt, p.x, p.y, view, { size: 9, color: COLORS.dimension, angle: ang });
      if (op.type === 'window') {
        const q = add(c, scale(n, side * (off + 11 / view.zoom)));
        drawLabel(ctx, `BRH ${formatArch(op.sillCm)}`, q.x, q.y, view, { size: 8.5, color: COLORS.dimension, angle: ang });
      }
    }
  }
}

function drawFurniture(ctx, level, view, selection) {
  for (const f of level.furniture) {
    const rad = (f.rotationDeg * Math.PI) / 180;
    const selected = selection?.kind === 'furniture' && selection.id === f.id;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(rad);
    ctx.fillStyle = view.print ? '#ffffff' : f.color || COLORS.furniture;
    ctx.strokeStyle = selected ? COLORS.selection : COLORS.furnitureLine;
    ctx.lineWidth = lw(view, selected ? 2.5 : view.print ? 0.6 : 1.2);

    const w = f.widthCm;
    const dd = f.depthCm;
    if (f.catalogId === 'table-round' || f.catalogId === 'officechair' || f.catalogId === 'plant') {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, dd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-w / 2, -dd / 2, w, dd);
      ctx.strokeRect(-w / 2, -dd / 2, w, dd);
      if (f.catalogId?.startsWith('bed-')) {
        // Kopfkissen-Andeutung, damit die Ausrichtung des Betts erkennbar ist.
        ctx.beginPath();
        ctx.moveTo(-w / 2, -dd / 2 + 40);
        ctx.lineTo(w / 2, -dd / 2 + 40);
        ctx.stroke();
      }
    }

    if (!view.print && view.zoom * Math.min(w, dd) > 20) {
      const text = passenderText(ctx, f.label, breiteFuerText(w, dd, rad) * view.zoom - 8, 11);
      if (text) {
        ctx.rotate(-rad);
        drawLabel(ctx, text, 0, 0, view, { size: 11, color: '#2f3438' });
      }
    }
    ctx.restore();
  }
}

/** Raumstempel: Name, lichte Fläche, Bodenbelag; im Dachgeschoss die WoFlV-Fläche dazu. */
function drawRoomLabels(ctx, d, view, selection, areaByRoom) {
  d.rooms.forEach((room, i) => {
    const at = room.stamp ? { x: room.stamp.x, y: room.stamp.y } : room.centroid;
    const selected = selection?.kind === 'room' && room.stamp && selection.id === room.stamp.id;
    const name = room.stamp?.name || '';
    const lines = [];
    if (name) lines.push({ t: name, size: 12, bold: true });
    lines.push({ t: formatArea(room.areaCm2), size: 11 });
    const wofl = areaByRoom?.[i];
    if (wofl != null && Math.abs(wofl - room.areaCm2 / 10000) > 0.005) {
      lines.push({ t: `WoFl ${wofl.toFixed(2).replace('.', ',')} m²`, size: 9.5 });
    }
    if (room.stamp?.floor) lines.push({ t: room.stamp.floor, size: 9.5 });
    const k = view.textScale || 1;
    const lh = (sz) => (sz * k + 3) / view.zoom;
    let y = at.y - lines.reduce((s, l) => s + lh(l.size), 0) / 2 + lh(lines[0].size) / 2;
    for (const l of lines) {
      drawLabel(ctx, l.t, at.x, y, view, {
        size: l.size,
        bold: l.bold,
        color: selected ? COLORS.selection : COLORS.roomText,
        bg: view.print ? null : 'rgba(245, 243, 238, 0.78)',
      });
      y += lh(l.size);
    }
  });
}

function drawWallDimensions(ctx, level, view) {
  const offsetPx = 16;
  for (const wall of level.walls) {
    const l = wallLength(wall);
    if (l < 20) continue;
    const dir = normalize(wallVector(wall));
    const n = { x: -dir.y, y: dir.x };
    const mid = add(wall.a, scale(dir, l / 2));
    const off = scale(n, wall.thicknessCm / 2 + offsetPx / view.zoom);
    const p = add(mid, off);
    let angle = angleOf(dir);
    // Text nie auf dem Kopf.
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    drawLabel(ctx, formatLength(l), p.x, p.y, view, {
      size: 11,
      color: COLORS.dimension,
      angle,
      bg: view.print ? null : COLORS.bg,
    });
  }
}

// --- Bemaßung ----------------------------------------------------------

/**
 * Eine Maßkette: Punkte entlang einer Geraden, Maßlinie im Abstand `offset`
 * zur Bezugslinie. Architektenart mit Schrägstrichen statt Pfeilen.
 */
export function drawChain(ctx, pts, offsetVec, view, opts = {}) {
  if (pts.length < 2) return;
  const { color = COLORS.dimension, selected = false, extFrom = null } = opts;
  const dir = normalize(sub(pts[pts.length - 1], pts[0]));
  const onLine = pts.map((p) => add(p, offsetVec));
  ctx.strokeStyle = selected ? COLORS.selection : color;
  ctx.lineWidth = lw(view, 0.8);
  ctx.beginPath();
  // Maßlinie etwas über die Enden hinaus.
  const over = lw(view, 6);
  const first = onLine[0];
  const last = onLine[onLine.length - 1];
  ctx.moveTo(first.x - dir.x * over, first.y - dir.y * over);
  ctx.lineTo(last.x + dir.x * over, last.y + dir.y * over);
  // Hilfslinien vom Bauteil (oder vom gemeinsamen Ansatz) bis knapp über die Maßlinie.
  const offLen = Math.hypot(offsetVec.x, offsetVec.y) || 1;
  const on = scale(offsetVec, 1 / offLen);
  pts.forEach((p, i) => {
    const start = extFrom ? add(p, scale(on, extFrom)) : add(p, scale(on, lw(view, 4)));
    const end = add(onLine[i], scale(on, lw(view, 4)));
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  });
  ctx.stroke();
  // Schrägstriche
  ctx.lineWidth = lw(view, 1.4);
  ctx.beginPath();
  const t = lw(view, 4);
  const diag = normalize(add(dir, on));
  for (const p of onLine) {
    ctx.moveTo(p.x - diag.x * t, p.y - diag.y * t);
    ctx.lineTo(p.x + diag.x * t, p.y + diag.y * t);
  }
  ctx.stroke();
  let angle = angleOf(dir);
  let flip = false;
  if (angle > Math.PI / 2 + 0.01 || angle < -Math.PI / 2 + 0.01) {
    angle += Math.PI;
    flip = true;
  }
  for (let i = 0; i < onLine.length - 1; i++) {
    const a = onLine[i];
    const b = onLine[i + 1];
    const l = dist(pts[i], pts[i + 1]);
    if (l < 0.5) continue;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Zahl über die Maßlinie, auf der von der Bezugslinie abgewandten Seite.
    const up = scale(on, lw(view, 7));
    const tp = add(m, up);
    drawLabel(ctx, formatArch(l), tp.x, tp.y, view, {
      size: 9.5,
      color: selected ? COLORS.selection : color,
      angle,
      baseline: 'middle',
      bg: view.print ? null : 'rgba(245,243,238,0.85)',
    });
    void flip;
  }
}

function drawDimensions(ctx, level, view, selection) {
  for (const dm of level.dimensions || []) {
    const dir = normalize(sub(dm.b, dm.a));
    const n = normal(dir);
    drawChain(ctx, [dm.a, dm.b], scale(n, dm.offsetCm), view, {
      selected: selection?.kind === 'dimension' && selection.id === dm.id,
    });
  }
}

/**
 * Außenmaßketten an allen vier Seiten des Gebäudes: innen die Öffnungen,
 * außen das Gesamtmaß. Funktioniert für rechtwinklige Umrisse; schräge
 * Außenwände bekommen nur das Gesamtmaß über die Hülle.
 */
function drawExteriorDims(ctx, level, d, view) {
  const outer = d.outlines.flatMap((o) => o.outer);
  if (outer.length < 3) return;
  const b = bboxOf(outer);
  const gap1 = 90;
  const gap2 = 150;
  const sides = [
    { axis: 'x', at: b.minY, from: b.minX, to: b.maxX, out: { x: 0, y: -1 } },
    { axis: 'x', at: b.maxY, from: b.minX, to: b.maxX, out: { x: 0, y: 1 } },
    { axis: 'y', at: b.minX, from: b.minY, to: b.maxY, out: { x: -1, y: 0 } },
    { axis: 'y', at: b.maxX, from: b.minY, to: b.maxY, out: { x: 1, y: 0 } },
  ];
  for (const s of sides) {
    const ticks = [s.from, s.to];
    for (const wall of level.walls) {
      const outside = d.sides.get(wall.id);
      if (!outside) continue;
      const dir = normalize(sub(wall.b, wall.a));
      const n = normal(dir);
      const face = add(wall.a, scale(n, (outside * wall.thicknessCm) / 2));
      const parallel = s.axis === 'x' ? Math.abs(dir.y) < 1e-3 : Math.abs(dir.x) < 1e-3;
      const onSide = s.axis === 'x' ? Math.abs(face.y - s.at) < 1 : Math.abs(face.x - s.at) < 1;
      if (!parallel || !onSide) continue;
      for (const op of openingsOfWall(level, wall.id)) {
        for (const e of [op.offsetCm - op.widthCm / 2, op.offsetCm + op.widthCm / 2]) {
          const p = add(wall.a, scale(dir, e));
          ticks.push(s.axis === 'x' ? p.x : p.y);
        }
      }
      // Ecken von Vor- und Rücksprüngen ebenfalls bemaßen.
      for (const end of [wall.a, wall.b]) {
        const p = add(end, scale(n, (outside * wall.thicknessCm) / 2));
        const v = s.axis === 'x' ? p.x : p.y;
        if (v > s.from + 1 && v < s.to - 1) ticks.push(v);
      }
    }
    const sorted = [...new Set(ticks.map((v) => Math.round(v * 2) / 2))].sort((x, y) => x - y);
    const pt = (v) => (s.axis === 'x' ? { x: v, y: s.at } : { x: s.at, y: v });
    if (sorted.length > 2) {
      drawChain(ctx, sorted.map(pt), scale(s.out, gap1), view, { extFrom: 20 });
    }
    drawChain(ctx, [pt(s.from), pt(s.to)], scale(s.out, gap2), view, { extFrom: 20 });
  }
}

// --- Auswahl und Entwürfe ------------------------------------------------

function drawSelectionHandles(ctx, level, selection, view) {
  if (!selection) return;
  const r = 5 / view.zoom;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 2 / view.zoom;

  if (selection.kind === 'furniture') {
    const f = level.furniture.find((x) => x.id === selection.id);
    if (!f) return;
    const rad = (f.rotationDeg * Math.PI) / 180;
    for (const c of rectCorners(f.x, f.y, f.widthCm, f.depthCm, rad)) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Drehgriff ueber der Vorderkante.
    const handle = add(
      { x: f.x, y: f.y },
      { x: Math.sin(rad) * (f.depthCm / 2 + 30 / view.zoom), y: -Math.cos(rad) * (f.depthCm / 2 + 30 / view.zoom) },
    );
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, r * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.selection;
    ctx.fill();
  }

  if (selection.kind === 'wall') {
    const w = level.walls.find((x) => x.id === selection.id);
    if (!w) return;
    for (const p of [w.a, w.b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (selection.kind === 'dimension') {
    const dm = (level.dimensions || []).find((x) => x.id === selection.id);
    if (!dm) return;
    for (const p of [dm.a, dm.b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawDraft(ctx, draft, view, thicknessCm) {
  if (!draft || !draft.points.length) return;
  const pts = [...draft.points];
  if (draft.preview) pts.push(draft.preview);

  ctx.strokeStyle = COLORS.draft;
  ctx.lineWidth = Math.max(thicknessCm, 4);
  ctx.globalAlpha = 0.35;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (pts.length >= 2) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    let deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    drawLabel(ctx, `${formatArch(l)}  ∠ ${deg.toFixed(1).replace('.', ',')}°`, mid.x, mid.y - 18 / view.zoom, view, {
      size: 12,
      color: COLORS.draft,
      bg: COLORS.bg,
    });
  }

  ctx.fillStyle = COLORS.draft;
  for (const p of draft.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 / view.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDimDraft(ctx, dimDraft, view) {
  if (!dimDraft?.a) return;
  const b = dimDraft.b || dimDraft.preview;
  if (!b) return;
  const n = normal(normalize(sub(b, dimDraft.a)));
  drawChain(ctx, [dimDraft.a, b], scale(n, dimDraft.offset || 0), view, { color: COLORS.draft });
}

function drawGuides(ctx, guides, view, canvasSize) {
  if (!guides?.length) return;
  const left = -view.panX / view.zoom;
  const top = -view.panY / view.zoom;
  const right = left + canvasSize.width / view.zoom;
  const bottom = top + canvasSize.height / view.zoom;
  ctx.strokeStyle = COLORS.guide;
  ctx.lineWidth = 1 / view.zoom;
  ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
  ctx.beginPath();
  for (const g of guides) {
    if (g.axis === 'x') {
      ctx.moveTo(g.value, top);
      ctx.lineTo(g.value, bottom);
    } else {
      ctx.moveTo(left, g.value);
      ctx.lineTo(right, g.value);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSnapMarker(ctx, snapPoint, view) {
  if (!snapPoint) return;
  const r = 7 / view.zoom;
  ctx.strokeStyle = COLORS.guide;
  ctx.lineWidth = 2 / view.zoom;
  ctx.beginPath();
  if (snapPoint.kind === 'mid') {
    ctx.moveTo(snapPoint.x, snapPoint.y - r);
    ctx.lineTo(snapPoint.x + r, snapPoint.y + r * 0.8);
    ctx.lineTo(snapPoint.x - r, snapPoint.y + r * 0.8);
    ctx.closePath();
  } else if (snapPoint.kind === 'edge') {
    ctx.moveTo(snapPoint.x - r, snapPoint.y - r);
    ctx.lineTo(snapPoint.x + r, snapPoint.y + r);
    ctx.lineTo(snapPoint.x - r, snapPoint.y + r);
    ctx.lineTo(snapPoint.x + r, snapPoint.y - r);
  } else {
    ctx.rect(snapPoint.x - r * 0.8, snapPoint.y - r * 0.8, r * 1.6, r * 1.6);
  }
  ctx.stroke();
}

/** Fläche nach WoFlV je Raum (gleiche Reihenfolge wie d.rooms) -- null, wenn gleich der lichten Fläche. */
export function woflvByRoom(d) {
  if (!d.roof || d.roof.roof.kind === 'flach') return null;
  return d.rooms.map((r) => {
    if ((r.stamp?.usage || 'wohnen') !== 'wohnen') return null;
    const full = Math.abs(polygonArea(clipByClearHeight(d.roof, r.net, 200))) / 10000;
    const one = Math.abs(polygonArea(clipByClearHeight(d.roof, r.net, 100))) / 10000;
    return full + Math.max(0, one - full) / 2;
  });
}

/** Zeichnet den kompletten Grundriss. Wird bei jedem Frame aufgerufen. */
export function drawScene(ctx, opts) {
  const { level, derived: d, view, settings, selection, draft, canvasSize, dpr, snapPoint } = opts;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = view.print ? COLORS.paper : COLORS.bg;
  ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY);

  if (settings.showGrid && !view.print) drawGrid(ctx, view, canvasSize, settings.gridCm);
  if (settings.showUnderlay && !view.print) drawUnderlay(ctx, d.below, view);
  if (settings.showRooms) drawRoomFills(ctx, d.rooms);
  if (settings.showRoof) drawRoof(ctx, d, view);
  drawStairs(ctx, d, view, selection);
  drawWalls(ctx, level, d, view, selection);
  if (settings.showFurniture) drawFurniture(ctx, level, view, selection);
  if (settings.showRooms) drawRoomLabels(ctx, d, view, selection, woflvByRoom(d));
  if (settings.showOpeningLabels) drawOpeningLabels(ctx, level, d, view);
  if (settings.showDimensions) drawWallDimensions(ctx, level, view);
  drawDimensions(ctx, level, view, selection);
  if (settings.showExteriorDims) drawExteriorDims(ctx, level, d, view);
  if (view.print) return;
  drawSelectionHandles(ctx, level, selection, view);
  drawDraft(ctx, draft, view, settings.wallThicknessCm);
  drawDimDraft(ctx, opts.dimDraft, view);
  drawGuides(ctx, opts.guides, view, canvasSize);
  drawSnapMarker(ctx, snapPoint, view);
}
