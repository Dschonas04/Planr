// Das Gebäude hinter dem Grundriss: Geschosse, Umriss, lichte Raumflächen,
// Wandanschlüsse, Decken und Dach.
//
// Alles hier ist reine Rechnung ohne Darstellung. Die 2D-Ansicht, die 3D-Ansicht
// und die Flächenberechnung greifen auf dieselben Funktionen zu -- eine Fläche,
// die im Plan steht, ist dieselbe, die in der Tabelle summiert wird.

import {
  add,
  clipHalfPlane,
  closestPointOnSegment,
  cross,
  dist,
  findFaces,
  lineIntersection,
  normal,
  normalize,
  offsetPolygonEdges,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  scale,
  sub,
} from './geometry.ts';
import { wallLayers } from './wallTypes.ts';
import { stairGeometry } from './stairs.ts';
import type { Cm, Level, Point, Project, Roof, RoomStamp, RoomUsage, Wall } from './types.ts';

const TOL = 1;

// --- Geschosse ------------------------------------------------------------

/** Geschosshöhe: OKFF bis OKFF des nächsten Geschosses. */
export function storeyHeight(level: Level): Cm {
  return level.heightCm + level.slabCm;
}

/** Zu überwindende Höhe einer Treppe aus diesem Geschoss. */
export function riseFrom(project: Project, levelIndex: number): Cm {
  const level = project.levels[levelIndex];
  const above = project.levels[levelIndex + 1];
  if (above) return Math.max(50, above.elevationCm - level.elevationCm);
  return storeyHeight(level);
}

// --- Wandachsen und Kanten ------------------------------------------------

/** Die Wand, auf deren Achse die Strecke a-b liegt. */
export function wallOnSegment(walls: Wall[], a: Point, b: Point): Wall | null {
  for (const w of walls) {
    const ca = closestPointOnSegment(a, w.a, w.b);
    const cb = closestPointOnSegment(b, w.a, w.b);
    if (ca.dist <= TOL && cb.dist <= TOL) return w;
  }
  return null;
}

/** Entfernt Stichkanten (A → B → A), die eine frei endende Wand in einem Raum hinterlässt. */
export function removeSpikes(points: Point[]): Point[] {
  let pts = points.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      if (dist(prev, next) <= TOL) {
        // Spitze und einen der beiden gleichen Nachbarn entfernen.
        const keep = pts.filter((_, j) => j !== i && j !== (i + 1) % pts.length);
        pts = keep;
        changed = true;
        break;
      }
    }
  }
  return pts;
}

function halfThicknesses(points: Point[], walls: Wall[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const w = wallOnSegment(walls, p, q);
    return w ? w.thicknessCm / 2 : 0;
  });
}

// --- Räume ----------------------------------------------------------------

export interface RoomInfo {
  /** Polygon auf den Wandachsen. */
  axis: Point[];
  /** Lichte Fläche: Polygon auf den Wandoberflächen. */
  net: Point[];
  areaCm2: number;
  perimeterCm: number;
  centroid: Point;
  stamp: RoomStamp | null;
}

export function levelRooms(level: Level): RoomInfo[] {
  const faces = findFaces(level.walls.map((w) => ({ a: w.a, b: w.b })));
  const rooms: RoomInfo[] = [];
  for (const f of faces) {
    if (f.area <= 100) continue;
    const axis = removeSpikes(f.points);
    if (axis.length < 3) continue;
    const net = offsetPolygonEdges(axis, halfThicknesses(axis, level.walls));
    const areaCm2 = Math.abs(polygonArea(net));
    const stamp = (level.rooms || []).find((s) => pointInPolygon(s, axis)) || null;
    rooms.push({
      axis,
      net,
      areaCm2,
      perimeterCm: polygonPerimeter(net),
      centroid: polygonCentroid(net),
      stamp,
    });
  }
  return rooms;
}

// --- Gebäudeumriss --------------------------------------------------------

export interface Outline {
  /** Polygon auf der Außenseite der Außenwände. */
  outer: Point[];
  /** Dieselbe Hülle auf den Wandachsen. */
  axis: Point[];
}

/** Außenhüllen aller zusammenhängenden Wandnetze eines Geschosses. */
export function levelOutlines(level: Level): Outline[] {
  const faces = findFaces(level.walls.map((w) => ({ a: w.a, b: w.b })));
  const out: Outline[] = [];
  for (const f of faces) {
    if (f.area >= -100) continue;
    const axis = removeSpikes(f.points);
    if (axis.length < 3) continue;
    // offsetPolygonEdges schiebt ins Polygon hinein; negative Abstände
    // schieben hinaus auf die Außenseite der Wände.
    out.push({ axis, outer: offsetPolygonEdges(axis, halfThicknesses(axis, level.walls).map((d) => -d)) });
  }
  return out;
}

/**
 * Für jede Wand auf dem Umriss: auf welcher Seite der Achse liegt außen?
 * +1 = links der Richtung a→b (im Sinne der Normalen), -1 = rechts.
 * Innenwände fehlen in der Tabelle.
 */
export function exteriorSides(level: Level, outlines = levelOutlines(level)): Map<string, 1 | -1> {
  const sides = new Map<string, 1 | -1>();
  for (const o of outlines) {
    const sign = polygonArea(o.axis) >= 0 ? 1 : -1;
    for (let i = 0; i < o.axis.length; i++) {
      const p = o.axis[i];
      const q = o.axis[(i + 1) % o.axis.length];
      const w = wallOnSegment(level.walls, p, q);
      if (!w || sides.has(w.id)) continue;
      // Ins Polygon zeigt sign·Normale, nach außen also das Gegenteil.
      const edgeOut = scale(normal(normalize(sub(q, p))), -sign);
      const wallN = normal(normalize(sub(w.b, w.a)));
      sides.set(w.id, edgeOut.x * wallN.x + edgeOut.y * wallN.y >= 0 ? 1 : -1);
    }
  }
  return sides;
}

// --- Wandkörper mit Anschlüssen -------------------------------------------

interface Cap {
  p: Point;
  d: Point;
}

/**
 * Wie eine Wand an ihren Enden abschließt.
 *
 * - Ecke aus genau zwei Wänden: Gehrung. Die Schnittlinie geht durch die
 *   Schnittpunkte der Außen- und der Innenflächen, damit auch verschieden
 *   dicke Wände sauber ineinanderlaufen und jede Schicht ihre Fuge trifft.
 * - Wandende auf der Achse einer durchlaufenden Wand (T-Stoß): Abschluss an
 *   deren Oberfläche, sonst ragte die Schichtung in die andere Wand hinein.
 * - sonst: rechtwinklig.
 */
export function wallCaps(level: Level): Map<string, { a: Cap; b: Cap }> {
  const caps = new Map<string, { a: Cap; b: Cap }>();
  const ends: { wall: Wall; end: 'a' | 'b' }[] = [];
  for (const w of level.walls) ends.push({ wall: w, end: 'a' }, { wall: w, end: 'b' });

  const capFor = (w: Wall, end: 'a' | 'b'): Cap => {
    const at = w[end];
    const other = end === 'a' ? w.b : w.a;
    const dirW = normalize(sub(w.b, w.a));
    const perp: Cap = { p: at, d: normal(dirW) };

    const partners = ends.filter((e) => e.wall.id !== w.id && dist(e.wall[e.end], at) <= TOL);
    if (partners.length === 1) {
      const v = partners[0];
      const u1 = normalize(sub(other, at));
      const vOther = v.end === 'a' ? v.wall.b : v.wall.a;
      const u2 = normalize(sub(vOther, at));
      if (Math.abs(cross(u1, u2)) < 1e-3) return perp;
      const h1 = w.thicknessCm / 2;
      const h2 = v.wall.thicknessCm / 2;
      const n1 = normal(u1);
      const n2 = normal(u2);
      const p1 = lineIntersection(add(at, scale(n1, h1)), u1, add(at, scale(n2, -h2)), u2);
      const p2 = lineIntersection(add(at, scale(n1, -h1)), u1, add(at, scale(n2, h2)), u2);
      if (!p1 || !p2 || dist(p1, p2) < 1e-3) return perp;
      return { p: p1, d: normalize(sub(p2, p1)) };
    }
    if (partners.length === 0) {
      for (const x of level.walls) {
        if (x.id === w.id) continue;
        const c = closestPointOnSegment(at, x.a, x.b);
        const lx = dist(x.a, x.b);
        if (c.dist > TOL || c.t * lx <= TOL || c.t * lx >= lx - TOL) continue;
        const dx = normalize(sub(x.b, x.a));
        const nx = normal(dx);
        // Die Fläche der durchlaufenden Wand auf der Seite, wo die Wand hingeht.
        const side = Math.sign((other.x - at.x) * nx.x + (other.y - at.y) * nx.y) || 1;
        return { p: add(x.a, scale(nx, (side * x.thicknessCm) / 2)), d: dx };
      }
    }
    return perp;
  };

  for (const w of level.walls) caps.set(w.id, { a: capFor(w, 'a'), b: capFor(w, 'b') });
  return caps;
}

export interface WallBand {
  /** Polygon der Schicht in Weltkoordinaten. */
  points: Point[];
  material: string;
  label: string;
}

/**
 * Zerlegt eine Wand in ihre Schichten als Polygone. `outside` ist die Seite
 * der Achse, auf der außen liegt (siehe exteriorSides).
 */
export function wallBands(wall: Wall, cap: { a: Cap; b: Cap }, outside: 1 | -1): WallBand[] {
  const dir = normalize(sub(wall.b, wall.a));
  const n = normal(dir);
  const t = wall.thicknessCm;
  const layers = wallLayers(wall);
  const sum = layers.reduce((s, l) => s + l.thicknessCm, 0) || t;
  const k = t / sum; // falls jemand die Dicke von Hand verstellt hat
  const side = (wall.flip ? -1 : 1) * outside;

  const corner = (offset: number, c: Cap, end: Point): Point => {
    const base = add(end, scale(n, offset));
    const x = lineIntersection(base, dir, c.p, c.d);
    // Sehr spitze Winkel ergäben Gehrungen weit über die Wand hinaus.
    if (!x || dist(x, base) > 3 * t + 50) return base;
    return x;
  };

  const bands: WallBand[] = [];
  let edge = t / 2;
  for (const layer of layers) {
    const d = layer.thicknessCm * k;
    const o1 = side * edge;
    const o2 = side * (edge - d);
    bands.push({
      points: [corner(o1, cap.a, wall.a), corner(o1, cap.b, wall.b), corner(o2, cap.b, wall.b), corner(o2, cap.a, wall.a)],
      material: layer.material,
      label: layer.label,
    });
    edge -= d;
  }
  return bands;
}

/** Umriss der ganzen Wand mit ihren Anschlüssen. */
export function wallOutline(wall: Wall, cap: { a: Cap; b: Cap }): Point[] {
  const dir = normalize(sub(wall.b, wall.a));
  const n = normal(dir);
  const h = wall.thicknessCm / 2;
  const corner = (offset: number, c: Cap, end: Point): Point => {
    const base = add(end, scale(n, offset));
    const x = lineIntersection(base, dir, c.p, c.d);
    if (!x || dist(x, base) > 3 * wall.thicknessCm + 50) return base;
    return x;
  };
  return [corner(h, cap.a, wall.a), corner(h, cap.b, wall.b), corner(-h, cap.b, wall.b), corner(-h, cap.a, wall.a)];
}

// --- Dach -----------------------------------------------------------------

/** Ebene z = c + gx·x + gy·y (alle Werte in cm, z über ±0). */
export interface Plane {
  c: number;
  gx: number;
  gy: number;
}

export interface RoofModel {
  roof: Roof;
  level: Level;
  /** Außenkante der Außenwände (Rechteck). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Dachfläche bis zur Traufe/zum Ortgang, inkl. Überstand. */
  footprint: Point[];
  planes: Plane[];
  /** Vertikale Stärke des Dachpakets. */
  verticalThickness: number;
}

const zAt = (pl: Plane, p: Point) => pl.c + pl.gx * p.x + pl.gy * p.y;

export function roofModel(project: Project): RoofModel | null {
  const roof = project.roof;
  if (!roof || roof.kind === 'keins') return null;
  const level = project.levels.find((l) => l.id === roof.levelId) || project.levels[project.levels.length - 1];
  const outer = levelOutlines(level).flatMap((o) => o.outer);
  if (outer.length < 3) return null;
  const minX = Math.min(...outer.map((p) => p.x));
  const maxX = Math.max(...outer.map((p) => p.x));
  const minY = Math.min(...outer.map((p) => p.y));
  const maxY = Math.max(...outer.map((p) => p.y));
  const o = Math.max(0, roof.overhangCm);
  const footprint = [
    { x: minX - o, y: minY - o },
    { x: maxX + o, y: minY - o },
    { x: maxX + o, y: maxY + o },
    { x: minX - o, y: maxY + o },
  ];

  const pitch = Math.min(Math.max(roof.pitchDeg, 0), 75);
  const m = Math.tan((pitch * Math.PI) / 180);
  const cosP = Math.cos((pitch * Math.PI) / 180);
  const t = Math.max(roof.thicknessCm, 5);
  const verticalThickness = roof.kind === 'flach' ? t : t / cosP;

  // Traufhöhe: Dachoberkante an der Wandaußenseite.
  const h0 = level.elevationCm + roof.kneeWallCm;
  const planes: Plane[] = [];
  // z steigt von der Kante nach innen: z = h0 + m·(Abstand zur Kante).
  const fromMinY = { c: h0 - m * minY, gx: 0, gy: m };
  const fromMaxY = { c: h0 + m * maxY, gx: 0, gy: -m };
  const fromMinX = { c: h0 - m * minX, gx: m, gy: 0 };
  const fromMaxX = { c: h0 + m * maxX, gx: -m, gy: 0 };

  switch (roof.kind) {
    case 'sattel':
      planes.push(...(roof.ridgeAlongX ? [fromMinY, fromMaxY] : [fromMinX, fromMaxX]));
      break;
    case 'walm':
      planes.push(fromMinY, fromMaxY, fromMinX, fromMaxX);
      break;
    case 'pult':
      if (roof.ridgeAlongX) planes.push(roof.highSidePositive ? fromMinY : fromMaxY);
      else planes.push(roof.highSidePositive ? fromMinX : fromMaxX);
      break;
    case 'flach':
      planes.push({ c: level.elevationCm + level.heightCm + t, gx: 0, gy: 0 });
      break;
    default:
      return null;
  }
  return { roof, level, minX, minY, maxX, maxY, footprint, planes, verticalThickness };
}

/** Dachoberkante an einem Punkt. */
export function roofTopAt(model: RoofModel, p: Point): number {
  return Math.min(...model.planes.map((pl) => zAt(pl, p)));
}

/** Unterkante des Dachpakets an einem Punkt. */
export function roofUndersideAt(model: RoofModel, p: Point): number {
  return roofTopAt(model, p) - model.verticalThickness;
}

/** Die Teilfläche einer Dachebene, auf der sie die oberste ist. */
export function roofPlanePolygons(model: RoofModel): { plane: Plane; points: Point[] }[] {
  return model.planes.map((pl, i) => {
    let poly = model.footprint.slice();
    model.planes.forEach((other, j) => {
      if (i === j) return;
      // pl ≤ other  ⇔  (other − pl) ≥ 0
      poly = clipHalfPlane(poly, other.gx - pl.gx, other.gy - pl.gy, other.c - pl.c);
    });
    return { plane: pl, points: poly };
  });
}

/**
 * Teil eines Polygons, in dem die lichte Höhe unter dem Dach mindestens
 * minHeight beträgt (gemessen ab OKFF des Dachgeschosses).
 */
export function clipByClearHeight(model: RoofModel, poly: Point[], minHeight: number): Point[] {
  let out = poly.slice();
  for (const pl of model.planes) {
    // pl(x,y) − Dachstärke − OKFF ≥ minHeight
    out = clipHalfPlane(out, pl.gx, pl.gy, pl.c - model.verticalThickness - model.level.elevationCm - minHeight);
    if (out.length < 3) return [];
  }
  return out;
}

// --- Wohnfläche nach WoFlV --------------------------------------------------

export const USAGE_LABEL: Record<RoomUsage, string> = {
  wohnen: 'Wohnfläche',
  aussen: 'Balkon / Terrasse',
  nutz: 'Nutzfläche',
};

export interface AreaRow {
  level: string;
  name: string;
  usage: RoomUsage;
  floor: string;
  /** Lichte Grundfläche in m². */
  netM2: number;
  /** Davon mit lichter Höhe ≥ 2 m bzw. 1–2 m (nur unter Dachschrägen verschieden). */
  fullM2: number;
  halfM2: number;
  /** Nach WoFlV anrechenbar. */
  woflvM2: number;
  perimeterM: number;
}

/**
 * Flächenaufstellung über alle Geschosse.
 *
 * WoFlV § 4: Flächen mit lichter Höhe ≥ 2 m voll, 1–2 m zur Hälfte, unter 1 m
 * gar nicht. Balkone, Loggien, Dachgärten und Terrassen in der Regel zu einem
 * Viertel. Nutzflächen (Keller, Technik, Garage) zählen nicht zur Wohnfläche.
 */
export function areaSchedule(project: Project): AreaRow[] {
  const model = roofModel(project);
  const rows: AreaRow[] = [];
  for (const level of project.levels) {
    const underRoof = model && model.roof.kind !== 'flach' && model.level.id === level.id;
    levelRooms(level).forEach((r, i) => {
      const usage: RoomUsage = r.stamp?.usage || 'wohnen';
      const net = r.areaCm2 / 10000;
      let full = net;
      let half = 0;
      if (underRoof && model) {
        full = Math.abs(polygonArea(clipByClearHeight(model, r.net, 200))) / 10000;
        const oneUp = Math.abs(polygonArea(clipByClearHeight(model, r.net, 100))) / 10000;
        half = Math.max(0, oneUp - full);
      }
      let woflv = 0;
      if (usage === 'wohnen') woflv = full + half / 2;
      else if (usage === 'aussen') woflv = net * 0.25;
      rows.push({
        level: level.name,
        name: r.stamp?.name || `Raum ${i + 1}`,
        usage,
        floor: r.stamp?.floor || '',
        netM2: net,
        fullM2: full,
        halfM2: half,
        woflvM2: woflv,
        perimeterM: r.perimeterCm / 100,
      });
    });
  }
  return rows;
}

// --- Decken ---------------------------------------------------------------

export interface Slab {
  outline: Point[];
  holes: Point[][];
  /** Oberkante und Unterkante über ±0. */
  topCm: number;
  bottomCm: number;
}

/**
 * Decken unter jedem Geschoss (beim untersten die Bodenplatte) und, wenn kein
 * Steildach darüber sitzt, die Decke über dem obersten. Treppen des Geschosses
 * darunter schneiden ihre Öffnung in die Decke.
 */
export function slabs(project: Project): Slab[] {
  const out: Slab[] = [];
  const levels = project.levels;
  levels.forEach((level, i) => {
    const below = levels[i - 1];
    const thickness = below ? below.slabCm : 25;
    const holes = below
      ? (below.stairs || []).map((s) => stairGeometry(s, riseFrom(project, i - 1)).outline)
      : [];
    for (const o of levelOutlines(level)) {
      out.push({ outline: o.outer, holes, topCm: level.elevationCm, bottomCm: level.elevationCm - thickness });
    }
  });
  const top = levels[levels.length - 1];
  const model = roofModel(project);
  const roofOnTop = model && model.level.id === top.id;
  if (top && !roofOnTop) {
    const holes = (top.stairs || []).map((s) => stairGeometry(s, riseFrom(project, levels.length - 1)).outline);
    for (const o of levelOutlines(top)) {
      out.push({
        outline: o.outer,
        holes,
        topCm: top.elevationCm + top.heightCm + top.slabCm,
        bottomCm: top.elevationCm + top.heightCm,
      });
    }
  }
  return out;
}

export { polygonArea };
