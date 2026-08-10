// Alle Zeichenoperationen des Grundrisses. Der Canvas arbeitet in Pixeln,
// das Modell in Zentimetern -- die Umrechnung passiert ausschliesslich ueber
// ctx.setTransform() am Anfang von drawScene().

import {
  add,
  angleOf,
  normalize,
  polygonCentroid,
  rectCorners,
  scale,
  sub,
} from '../model/geometry.js';
import { formatArea, formatLength } from '../model/units.js';
import {
  openingsOfWall,
  pointAlongWall,
  wallAngle,
  wallLength,
  wallVector,
} from '../model/project.js';

export const COLORS = {
  bg: '#f5f3ee',
  grid: '#e3ded2',
  gridMajor: '#d2cbba',
  wall: '#2f3438',
  wallSelected: '#c2410c',
  room: 'rgba(126, 160, 190, 0.16)',
  roomText: '#4a5560',
  furniture: '#a0a0a0',
  furnitureLine: '#4a4a4a',
  selection: '#c2410c',
  dimension: '#7b8794',
  opening: '#f5f3ee',
  openingLine: '#3d6b8c',
  draft: '#c2410c',
};

/** Wand als Viereck (vier Eckpunkte in cm). */
export function wallQuad(wall) {
  const dir = normalize(wallVector(wall));
  const n = { x: -dir.y, y: dir.x };
  const h = (wall.thicknessCm || 24) / 2;
  const off = scale(n, h);
  return [
    add(wall.a, off),
    add(wall.b, off),
    sub(wall.b, off),
    sub(wall.a, off),
  ];
}

function pathPolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/**
 * Text in Weltkoordinaten, aber in konstanter Pixelgroesse -- sonst waere
 * Beschriftung beim Herauszoomen unlesbar und beim Hereinzoomen riesig.
 */
function drawLabel(ctx, text, x, y, view, opts = {}) {
  const { size = 12, color = '#333', align = 'center', baseline = 'middle', angle = 0, bg = null } = opts;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(1 / view.zoom, 1 / view.zoom);
  ctx.font = `${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (bg) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = bg;
    const px = align === 'center' ? -w / 2 - 3 : -3;
    ctx.fillRect(px, -size / 2 - 2, w + 6, size + 4);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
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

function drawRoomFills(ctx, rooms) {
  for (const room of rooms) {
    pathPolygon(ctx, room.points);
    ctx.fillStyle = COLORS.room;
    ctx.fill();
  }
}

// Die Flaechenangabe kommt zuletzt, sonst verschwindet sie unter Moebeln.
function drawRoomLabels(ctx, rooms, view) {
  for (const room of rooms) {
    const c = polygonCentroid(room.points);
    drawLabel(ctx, formatArea(Math.abs(room.area)), c.x, c.y, view, {
      size: 13,
      color: COLORS.roomText,
      bg: 'rgba(245, 243, 238, 0.82)',
    });
  }
}

function drawWalls(ctx, level, view, selection) {
  ctx.lineJoin = 'miter';
  for (const wall of level.walls) {
    const quad = wallQuad(wall);
    const selected = selection?.kind === 'wall' && selection.id === wall.id;
    pathPolygon(ctx, quad);
    ctx.fillStyle = selected ? COLORS.wallSelected : COLORS.wall;
    ctx.fill();
  }

  // Oeffnungen ausstanzen: der Wandkoerper ist bereits gefuellt, hier wird
  // der Durchbruch mit der Hintergrundfarbe ueberdeckt.
  for (const wall of level.walls) {
    const openings = openingsOfWall(level, wall.id);
    if (!openings.length) continue;
    const angle = wallAngle(wall);
    const th = wall.thicknessCm || 24;
    for (const op of openings) {
      const center = pointAlongWall(wall, op.offsetCm);
      const corners = rectCorners(center.x, center.y, op.widthCm, th + 2, angle);
      pathPolygon(ctx, corners);
      ctx.fillStyle = COLORS.opening;
      ctx.fill();
      drawOpeningSymbol(ctx, op, wall, center, angle, th, view, selection);
    }
  }
}

function drawOpeningSymbol(ctx, op, wall, center, angle, th, view, selection) {
  const selected = selection?.kind === 'opening' && selection.id === op.id;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.lineWidth = 2 / view.zoom;
  ctx.strokeStyle = selected ? COLORS.selection : COLORS.openingLine;

  const hw = op.widthCm / 2;
  const hh = th / 2;

  if (op.type === 'window') {
    // Fenster: Glasebene plus die beiden Wandanschlaege.
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(-hw, hh);
    ctx.moveTo(hw, -hh);
    ctx.lineTo(hw, hh);
    ctx.stroke();
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(hw, 0);
    ctx.stroke();
  } else {
    // Tuer: Blatt am Anschlag plus Aufschlagbogen.
    const swing = op.swing === -1 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(-hw, swing * op.widthCm);
    ctx.stroke();
    ctx.lineWidth = 1.2 / view.zoom;
    ctx.setLineDash([6 / view.zoom, 5 / view.zoom]);
    ctx.beginPath();
    ctx.arc(-hw, 0, op.widthCm, swing > 0 ? 0 : -Math.PI / 2, swing > 0 ? Math.PI / 2 : 0);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (selected) {
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.strokeRect(-hw, -hh, op.widthCm, th);
  }
  ctx.restore();
}

function drawFurniture(ctx, level, view, selection) {
  for (const f of level.furniture) {
    const rad = (f.rotationDeg * Math.PI) / 180;
    const selected = selection?.kind === 'furniture' && selection.id === f.id;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(rad);
    ctx.fillStyle = f.color || COLORS.furniture;
    ctx.strokeStyle = selected ? COLORS.selection : COLORS.furnitureLine;
    ctx.lineWidth = (selected ? 2.5 : 1.2) / view.zoom;

    const w = f.widthCm;
    const d = f.depthCm;
    if (f.catalogId === 'table-round' || f.catalogId === 'officechair' || f.catalogId === 'plant') {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      if (f.catalogId?.startsWith('bed-')) {
        // Kopfkissen-Andeutung, damit die Ausrichtung des Betts erkennbar ist.
        ctx.beginPath();
        ctx.moveTo(-w / 2, -d / 2 + 40);
        ctx.lineTo(w / 2, -d / 2 + 40);
        ctx.stroke();
      }
    }

    // Beschriftung nur, wenn sie ins Objekt passt.
    if (view.zoom * Math.min(w, d) > 42) {
      ctx.rotate(-rad);
      drawLabel(ctx, f.label, 0, 0, view, { size: 11, color: '#2f3438' });
    }
    ctx.restore();
  }
}

function drawWallDimensions(ctx, level, view) {
  const offsetPx = 16;
  for (const wall of level.walls) {
    const l = wallLength(wall);
    if (l < 20) continue;
    const dir = normalize(wallVector(wall));
    const n = { x: -dir.y, y: dir.x };
    const mid = add(wall.a, scale(dir, l / 2));
    const off = scale(n, (wall.thicknessCm / 2 + offsetPx / view.zoom));
    const p = add(mid, off);
    let angle = angleOf(dir);
    // Text nie auf dem Kopf.
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    drawLabel(ctx, formatLength(l), p.x, p.y, view, {
      size: 11,
      color: COLORS.dimension,
      angle,
      bg: COLORS.bg,
    });
  }
}

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
    drawLabel(ctx, formatLength(l), mid.x, mid.y - 18 / view.zoom, view, {
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

function drawSnapMarker(ctx, snapPoint, view) {
  if (!snapPoint) return;
  const r = 7 / view.zoom;
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2 / view.zoom;
  ctx.beginPath();
  ctx.moveTo(snapPoint.x - r, snapPoint.y - r);
  ctx.lineTo(snapPoint.x + r, snapPoint.y + r);
  ctx.moveTo(snapPoint.x + r, snapPoint.y - r);
  ctx.lineTo(snapPoint.x - r, snapPoint.y + r);
  ctx.stroke();
}

/** Zeichnet den kompletten Grundriss. Wird bei jedem Frame aufgerufen. */
export function drawScene(ctx, opts) {
  const { level, view, settings, selection, draft, rooms, canvasSize, dpr, snapPoint } = opts;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY);

  if (settings.showGrid) drawGrid(ctx, view, canvasSize, settings.gridCm);
  if (settings.showRooms) drawRoomFills(ctx, rooms);
  drawWalls(ctx, level, view, selection);
  if (settings.showFurniture) drawFurniture(ctx, level, view, selection);
  if (settings.showRooms) drawRoomLabels(ctx, rooms, view);
  if (settings.showDimensions) drawWallDimensions(ctx, level, view);
  drawSelectionHandles(ctx, level, selection, view);
  drawDraft(ctx, draft, view, settings.wallThicknessCm);
  drawSnapMarker(ctx, snapPoint, view);
}
