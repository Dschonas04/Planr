// Trefferpruefung und Snapping -- reine Funktionen ueber Modell + Ansicht.

import {
  closestPointOnSegment,
  dist,
  normal,
  normalize,
  pointInPolygon,
  pointInRect,
  rectCorners,
  rotate,
  sub,
} from '../model/geometry.ts';
import { snap } from '../model/units.ts';
import { openingsOfWall, pointAlongWall, wallAngle } from '../model/project.ts';

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
 * Griffe der Auswahl vor Objekten, Beschriftungen vor Moebeln vor Oeffnungen
 * vor Treppen vor Waenden.
 */
export function hitTest(level, p, view, selection, derived) {
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

  // Raumstempel: ein Klick auf die Beschriftung.
  for (const r of level.rooms || []) {
    if (Math.abs(p.x - r.x) <= tol(45, view) && Math.abs(p.y - r.y) <= tol(14, view)) {
      return { kind: 'room', id: r.id, part: 'body' };
    }
  }

  // Maßlinien
  for (const dm of level.dimensions || []) {
    const n = normal(normalize(sub(dm.b, dm.a)));
    const a = { x: dm.a.x + n.x * dm.offsetCm, y: dm.a.y + n.y * dm.offsetCm };
    const b = { x: dm.b.x + n.x * dm.offsetCm, y: dm.b.y + n.y * dm.offsetCm };
    if (closestPointOnSegment(p, a, b).dist <= tol(6, view)) return { kind: 'dimension', id: dm.id, part: 'body' };
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

  for (const s of derived?.stairs || []) {
    if (pointInPolygon(p, s.geo.outline)) return { kind: 'stair', id: s.stair.id, part: 'body' };
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
 * Fangpunkt fuer das Zeichnen. Reihenfolge wie in einem CAD-Programm:
 * Endpunkte, zusaetzliche Punkte (Wandecken, Leibungen), Mittelpunkte, dann
 * die naechste Stelle auf einer Wandachse. Greift nichts davon, richtet die
 * Spurverfolgung den Punkt waagerecht/senkrecht an vorhandenen Endpunkten
 * aus, sonst rastet er aufs Raster.
 *
 * Rueckgabe: { point, snapped: {x, y, kind} | null, guides: [...] }
 */
export function snapPoint(level, p, settings, view, excludeIds = [], extraPoints = []) {
  if (!settings.snapEnabled) return { point: p, snapped: null, guides: [] };

  const radius = tol(12, view);
  const ends = [];
  for (const wall of level.walls) {
    if (excludeIds.includes(wall.id)) continue;
    ends.push(wall.a, wall.b);
  }

  const nearest = (pts, kind) => {
    let best = null;
    let bestDist = radius;
    for (const q of pts) {
      const d = dist(p, q);
      if (d < bestDist) {
        bestDist = d;
        best = { x: q.x, y: q.y, kind };
      }
    }
    return best;
  };

  const end = nearest(ends, 'end') || nearest(extraPoints, 'end');
  if (end) return { point: { x: end.x, y: end.y }, snapped: end, guides: [] };

  const mids = level.walls
    .filter((w) => !excludeIds.includes(w.id))
    .map((w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }));
  const mid = nearest(mids, 'mid');
  if (mid) return { point: { x: mid.x, y: mid.y }, snapped: mid, guides: [] };

  let onWall = null;
  let onDist = tol(7, view);
  for (const w of level.walls) {
    if (excludeIds.includes(w.id)) continue;
    const c = closestPointOnSegment(p, w.a, w.b);
    if (c.dist < onDist) {
      onDist = c.dist;
      onWall = { x: c.point.x, y: c.point.y, kind: 'edge' };
    }
  }
  if (onWall) {
    // Auf der Wand bleibt die Lage entlang der Achse frei, aber im Raster.
    return { point: { x: onWall.x, y: onWall.y }, snapped: onWall, guides: [] };
  }

  const grid = settings.gridCm;
  let x = snap(p.x, grid);
  let y = snap(p.y, grid);
  const guides = [];
  const track = tol(6, view);
  let bx = track;
  let by = track;
  for (const q of ends) {
    if (Math.abs(q.x - p.x) < bx) {
      bx = Math.abs(q.x - p.x);
      x = q.x;
      guides[0] = { axis: 'x', value: q.x };
    }
    if (Math.abs(q.y - p.y) < by) {
      by = Math.abs(q.y - p.y);
      y = q.y;
      guides[1] = { axis: 'y', value: q.y };
    }
  }
  return { point: { x, y }, snapped: null, guides: guides.filter(Boolean) };
}
