// Trefferpruefung und Snapping -- reine Funktionen ueber Modell + Ansicht.

import { dist, pointInRect, rectCorners, rotate } from '../model/geometry.js';
import { snap } from '../model/units.js';
import { openingsOfWall, pointAlongWall, wallAngle } from '../model/project.js';

/** Pixelabstand in Weltmass umrechnen -- Griffe sollen bei jedem Zoom gleich gross wirken. */
const tol = (px, view) => px / view.zoom;

export function furnitureRotateHandle(f, view) {
  const rad = (f.rotationDeg * Math.PI) / 180;
  const reach = f.depthCm / 2 + 30 / view.zoom;
  return {
    x: f.x + Math.sin(rad) * reach,
    y: f.y - Math.cos(rad) * reach,
  };
}

export function furnitureCornerHandles(f) {
  return rectCorners(f.x, f.y, f.widthCm, f.depthCm, (f.rotationDeg * Math.PI) / 180);
}

/**
 * Was liegt unter dem Punkt? Reihenfolge nach Bedienbarkeit:
 * Griffe der Auswahl vor Objekten, Moebel vor Oeffnungen vor Waenden.
 */
export function hitTest(level, p, view, selection) {
  if (selection?.kind === 'furniture') {
    const f = level.furniture.find((x) => x.id === selection.id);
    if (f) {
      if (dist(p, furnitureRotateHandle(f, view)) <= tol(9, view)) {
        return { kind: 'furniture', id: f.id, part: 'rotate' };
      }
      const corners = furnitureCornerHandles(f);
      for (let i = 0; i < corners.length; i++) {
        if (dist(p, corners[i]) <= tol(8, view)) {
          return { kind: 'furniture', id: f.id, part: 'resize', corner: i };
        }
      }
    }
  }

  if (selection?.kind === 'wall') {
    const w = level.walls.find((x) => x.id === selection.id);
    if (w) {
      if (dist(p, w.a) <= tol(8, view)) return { kind: 'wall', id: w.id, part: 'a' };
      if (dist(p, w.b) <= tol(8, view)) return { kind: 'wall', id: w.id, part: 'b' };
    }
  }

  // Zuletzt platzierte Moebel liegen oben, also von hinten nach vorne pruefen.
  for (let i = level.furniture.length - 1; i >= 0; i--) {
    const f = level.furniture[i];
    if (pointInRect(p, f.x, f.y, f.widthCm, f.depthCm, (f.rotationDeg * Math.PI) / 180)) {
      return { kind: 'furniture', id: f.id, part: 'body' };
    }
  }

  for (const wall of level.walls) {
    const angle = wallAngle(wall);
    for (const op of openingsOfWall(level, wall.id)) {
      const c = pointAlongWall(wall, op.offsetCm);
      if (pointInRect(p, c.x, c.y, op.widthCm, wall.thicknessCm + 6, angle)) {
        return { kind: 'opening', id: op.id, part: 'body' };
      }
    }
  }

  for (const wall of level.walls) {
    const local = rotate(p, -wallAngle(wall), wall.a);
    const l = dist(wall.a, wall.b);
    const halfT = wall.thicknessCm / 2 + tol(2, view);
    if (local.x >= wall.a.x - halfT && local.x <= wall.a.x + l + halfT) {
      if (Math.abs(local.y - wall.a.y) <= halfT) {
        return { kind: 'wall', id: wall.id, part: 'body' };
      }
    }
  }

  return null;
}

/**
 * Fangpunkt fuer das Zeichnen: bestehende Wandenden haben Vorrang vor dem
 * Raster, damit Waende sauber aneinander anschliessen.
 */
export function snapPoint(level, p, settings, view, excludeIds = []) {
  if (!settings.snapEnabled) return { point: p, snapped: null };

  const radius = tol(12, view);
  let best = null;
  let bestDist = radius;
  for (const wall of level.walls) {
    if (excludeIds.includes(wall.id)) continue;
    for (const end of [wall.a, wall.b]) {
      const d = dist(p, end);
      if (d < bestDist) {
        bestDist = d;
        best = end;
      }
    }
  }
  if (best) return { point: { x: best.x, y: best.y }, snapped: { x: best.x, y: best.y } };

  return {
    point: { x: snap(p.x, settings.gridCm), y: snap(p.y, settings.gridCm) },
    snapped: null,
  };
}
