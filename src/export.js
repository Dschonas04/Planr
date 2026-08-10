// Export: PNG ueber denselben Renderer wie die Bildschirmansicht,
// SVG als eigener Vektor-Pfad (fuer Druck und Weiterverarbeitung in CAD).

import { COLORS, drawScene, wallQuad } from './canvas2d/render.js';
import { findRooms, polygonCentroid, rectCorners } from './model/geometry.js';
import { formatArea, formatLength } from './model/units.js';
import {
  openingsOfWall,
  pointAlongWall,
  serialize,
  wallAngle,
  wallLength,
} from './model/project.js';

const PADDING_CM = 120;

/** Umschliessendes Rechteck aller Objekte einer Ebene (in cm). */
export function levelExtent(level) {
  const pts = [];
  for (const w of level.walls) {
    pts.push(w.a, w.b);
  }
  for (const f of level.furniture) {
    pts.push(...rectCorners(f.x, f.y, f.widthCm, f.depthCm, (f.rotationDeg * Math.PI) / 180));
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 500, maxY: 500 };
  const minX = Math.min(...pts.map((p) => p.x)) - PADDING_CM;
  const minY = Math.min(...pts.map((p) => p.y)) - PADDING_CM;
  const maxX = Math.max(...pts.map((p) => p.x)) + PADDING_CM;
  const maxY = Math.max(...pts.map((p) => p.y)) + PADDING_CM;
  return { minX, minY, maxX, maxY };
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst nach dem Klick freigeben, sonst bricht der Download in Firefox ab.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (name) => (name || 'plan').replace(/[^\w\-]+/g, '_').toLowerCase();

export function exportJSON(project) {
  download(new Blob([serialize(project)], { type: 'application/json' }), `${safeName(project.name)}.planr.json`);
}

export function exportPNG(project, level, settings, maxPx = 2400) {
  const ext = levelExtent(level);
  const wCm = ext.maxX - ext.minX;
  const hCm = ext.maxY - ext.minY;
  const zoom = Math.min(maxPx / wCm, maxPx / hCm, 4);
  const width = Math.round(wCm * zoom);
  const height = Math.round(hCm * zoom);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  drawScene(ctx, {
    level,
    view: { zoom, panX: -ext.minX * zoom, panY: -ext.minY * zoom },
    settings: { ...settings, showGrid: false },
    selection: null,
    draft: null,
    snapPoint: null,
    rooms: findRooms(level.walls.map((w) => ({ a: w.a, b: w.b }))),
    canvasSize: { width, height },
    dpr: 1,
  });

  canvas.toBlob((blob) => {
    if (blob) download(blob, `${safeName(project.name)}.png`);
  }, 'image/png');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const poly = (points) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

export function exportSVG(project, level, settings) {
  const ext = levelExtent(level);
  const w = ext.maxX - ext.minX;
  const h = ext.maxY - ext.minY;
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(w / 10).toFixed(0)}mm" height="${(h / 10).toFixed(0)}mm" ` +
      `viewBox="${ext.minX.toFixed(1)} ${ext.minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">`,
  );
  parts.push(`<title>${esc(project.name)}</title>`);
  parts.push(`<rect x="${ext.minX}" y="${ext.minY}" width="${w}" height="${h}" fill="${COLORS.bg}"/>`);

  if (settings.showRooms) {
    for (const room of findRooms(level.walls.map((x) => ({ a: x.a, b: x.b })))) {
      parts.push(`<polygon points="${poly(room.points)}" fill="#7ea0be" fill-opacity="0.16"/>`);
      const c = polygonCentroid(room.points);
      parts.push(
        `<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" font-size="22" text-anchor="middle" fill="${COLORS.roomText}">` +
          `${esc(formatArea(Math.abs(room.area)))}</text>`,
      );
    }
  }

  for (const wall of level.walls) {
    parts.push(`<polygon points="${poly(wallQuad(wall))}" fill="${COLORS.wall}"/>`);
  }

  // Oeffnungen werden wie im Canvas mit der Hintergrundfarbe ausgestanzt.
  for (const wall of level.walls) {
    const angle = (wallAngle(wall) * 180) / Math.PI;
    for (const op of openingsOfWall(level, wall.id)) {
      const c = pointAlongWall(wall, op.offsetCm);
      const th = wall.thicknessCm + 2;
      parts.push(
        `<g transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${angle.toFixed(2)})">` +
          `<rect x="${(-op.widthCm / 2).toFixed(1)}" y="${(-th / 2).toFixed(1)}" width="${op.widthCm}" height="${th}" fill="${COLORS.bg}"/>` +
          (op.type === 'window'
            ? `<line x1="${(-op.widthCm / 2).toFixed(1)}" y1="0" x2="${(op.widthCm / 2).toFixed(1)}" y2="0" stroke="${COLORS.openingLine}" stroke-width="3"/>`
            : `<path d="M ${(-op.widthCm / 2).toFixed(1)} 0 L ${(-op.widthCm / 2).toFixed(1)} ${((op.swing === -1 ? -1 : 1) * op.widthCm).toFixed(1)}" stroke="${COLORS.openingLine}" stroke-width="3" fill="none"/>`) +
          `</g>`,
      );
    }
  }

  if (settings.showFurniture) {
    for (const f of level.furniture) {
      parts.push(
        `<g transform="translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) rotate(${f.rotationDeg.toFixed(1)})">` +
          `<rect x="${(-f.widthCm / 2).toFixed(1)}" y="${(-f.depthCm / 2).toFixed(1)}" width="${f.widthCm}" height="${f.depthCm}" ` +
          `fill="${f.color}" stroke="${COLORS.furnitureLine}" stroke-width="2"/></g>`,
      );
    }
  }

  if (settings.showDimensions) {
    for (const wall of level.walls) {
      const l = wallLength(wall);
      if (l < 20) continue;
      const mx = (wall.a.x + wall.b.x) / 2;
      const my = (wall.a.y + wall.b.y) / 2;
      parts.push(
        `<text x="${mx.toFixed(1)}" y="${(my - 18).toFixed(1)}" font-size="18" text-anchor="middle" fill="${COLORS.dimension}">` +
          `${esc(formatLength(l))}</text>`,
      );
    }
  }

  parts.push('</svg>');
  download(new Blob([parts.join('\n')], { type: 'image/svg+xml' }), `${safeName(project.name)}.svg`);
}
