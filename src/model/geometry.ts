// Reine Geometrie -- keine React-, Canvas- oder Store-Abhaengigkeiten,
// damit das hier ohne Browser testbar bleibt.

import type { Cm, Point, Rad, Room, Segment } from './types.ts';

export const EPS = 1e-6;

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export function normalize(a: Point): Point {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Normale (90 Grad links) eines Vektors. */
export function normal(a: Point): Point {
  return { x: -a.y, y: a.x };
}

export function rotate(p: Point, rad: Rad, origin: Point = { x: 0, y: 0 }): Point {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const d = sub(p, origin);
  return { x: origin.x + d.x * c - d.y * s, y: origin.y + d.x * s + d.y * c };
}

export function angleOf(v: Point): Rad {
  return Math.atan2(v.y, v.x);
}

/** Winkel auf ein Vielfaches von stepRad einrasten. */
export function snapAngle(a: Point, b: Point, stepRad: Rad): Point {
  const v = sub(b, a);
  const l = len(v);
  if (l < EPS) return b;
  const snapped = Math.round(angleOf(v) / stepRad) * stepRad;
  return { x: a.x + Math.cos(snapped) * l, y: a.y + Math.sin(snapped) * l };
}

/** Punkt auf einer Strecke, der p am naechsten liegt -- plus Parameter t in [0,1]. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { point: { ...a }, t: 0, dist: dist(p, a) };
  let t = dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  return { point, t, dist: dist(p, point) };
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  return closestPointOnSegment(p, a, b).dist;
}

/** Schnittpunkt zweier Strecken oder null. */
export function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(b1, a1), s) / denom;
  const u = cross(sub(b1, a1), r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return add(a1, scale(r, t));
}

/** Flaeche eines Polygons (positiv bei mathematisch positivem Umlaufsinn). */
export function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonCentroid(points: Point[]): Point {
  const a = polygonArea(points);
  if (Math.abs(a) < EPS) {
    // Entartetes Polygon: einfacher Mittelwert statt Division durch ~0.
    const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(sum, 1 / Math.max(points.length, 1));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    const intersects =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + EPS) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Achsparallele Huelle einer Punktmenge. */
export function bboxOf(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Die vier Eckpunkte eines gedrehten Rechtecks (Mittelpunkt, Breite, Tiefe, Winkel). */
export function rectCorners(cx: Cm, cy: Cm, w: Cm, d: Cm, rad: Rad): Point[] {
  const hw = w / 2;
  const hd = d / 2;
  const c = { x: cx, y: cy };
  return [
    rotate({ x: cx - hw, y: cy - hd }, rad, c),
    rotate({ x: cx + hw, y: cy - hd }, rad, c),
    rotate({ x: cx + hw, y: cy + hd }, rad, c),
    rotate({ x: cx - hw, y: cy + hd }, rad, c),
  ];
}

/** Liegt p im gedrehten Rechteck? Rechnet in dessen lokalem System. */
export function pointInRect(p: Point, cx: Cm, cy: Cm, w: Cm, d: Cm, rad: Rad): boolean {
  const local = rotate(p, -rad, { x: cx, y: cy });
  return (
    local.x >= cx - w / 2 &&
    local.x <= cx + w / 2 &&
    local.y >= cy - d / 2 &&
    local.y <= cy + d / 2
  );
}

/**
 * Zerlegt Strecken an allen Beruehrpunkten ("Noding").
 *
 * Ohne diesen Schritt haengt eine Zwischenwand, die mitten auf einer
 * durchgehenden Aussenwand endet, im Graphen in der Luft: der T-Stoss waere
 * kein Knoten, und die Flaechensuche wuerde beide Raeume als einen sehen.
 * Beruecksichtigt werden Endpunkte anderer Strecken auf der Strecke sowie
 * echte Kreuzungen.
 */
export function nodeSegments(segments: Segment[], tol = 1): Segment[] {
  const endpoints = [];
  for (const s of segments) {
    endpoints.push(s.a, s.b);
  }

  const result: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const l = dist(seg.a, seg.b);
    if (l < tol) continue;

    const cuts: number[] = [];
    const addCut = (p: Point) => {
      const { t, dist: d } = closestPointOnSegment(p, seg.a, seg.b);
      const along = t * l;
      // Nur echte Zwischenpunkte -- die eigenen Enden teilen nichts.
      if (d <= tol && along > tol && along < l - tol) cuts.push(along);
    };

    for (const p of endpoints) addCut(p);
    for (let j = 0; j < segments.length; j++) {
      if (j === i) continue;
      const x = segmentIntersection(seg.a, seg.b, segments[j].a, segments[j].b);
      if (x) addCut(x);
    }

    cuts.sort((a, b) => a - b);
    const dir = scale(sub(seg.b, seg.a), 1 / l);
    let prev = 0;
    for (const cut of cuts) {
      if (cut - prev < tol) continue;
      result.push({ a: add(seg.a, scale(dir, prev)), b: add(seg.a, scale(dir, cut)) });
      prev = cut;
    }
    if (l - prev > tol) {
      result.push({ a: add(seg.a, scale(dir, prev)), b: { ...seg.b } });
    }
  }
  return result;
}

/**
 * Findet die geschlossenen Raeume in einem Wandnetz.
 *
 * Die Wandmittellinien bilden einen planaren Graphen; jede innere Flaeche
 * dieses Graphen ist ein Raum. Ermittelt wird sie ueber Half-Edge-Traversal:
 * an jedem Knoten wird immer die naechste Kante im Uhrzeigersinn genommen,
 * dadurch laeuft man die minimalen Zyklen ab. Die Aussenflaeche faellt weg,
 * weil sie als einzige den umgekehrten Umlaufsinn hat.
 *
 * @param {Array<{a:{x,y}, b:{x,y}}>} segments Wandmittellinien
 * @param {number} tol Knoten naeher als tol (cm) gelten als derselbe Punkt
 * @returns {Array<{points: Array<{x,y}>, area: number}>} Raumpolygone, cm bzw. cm2
 */
export function findRooms(segments: Segment[], tol = 1): Room[] {
  const noded = nodeSegments(segments, tol);
  const nodes: Point[] = [];
  const keyOf = (p: Point) => {
    for (let i = 0; i < nodes.length; i++) {
      if (dist(nodes[i], p) <= tol) return i;
    }
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };

  const halfEdges: { from: number; to: number; angle: Rad; visited: boolean }[] = [];
  const outgoing = new Map<number, number[]>(); // Knoten -> Indizes der ausgehenden Half-Edges

  for (const seg of noded) {
    const from = keyOf(seg.a);
    const to = keyOf(seg.b);
    if (from === to) continue;
    for (const [s, e] of [
      [from, to],
      [to, from],
    ]) {
      const idx = halfEdges.length;
      halfEdges.push({
        from: s,
        to: e,
        angle: angleOf(sub(nodes[e], nodes[s])),
        visited: false,
      });
      if (!outgoing.has(s)) outgoing.set(s, []);
      outgoing.get(s)!.push(idx);
    }
  }

  // Ausgehende Kanten je Knoten nach Winkel sortieren -- Voraussetzung fuer
  // "naechste Kante im Uhrzeigersinn".
  for (const list of outgoing.values()) {
    list.sort((i, j) => halfEdges[i].angle - halfEdges[j].angle);
  }

  const twinOf = (idx: number) => (idx % 2 === 0 ? idx + 1 : idx - 1);

  const nextEdge = (idx: number) => {
    const he = halfEdges[idx];
    const list = outgoing.get(he.to) || [];
    if (!list.length) return -1;
    const backAngle = angleOf(sub(nodes[he.from], nodes[he.to]));
    // Die Kante, die im Winkel direkt vor der Rueckrichtung liegt.
    let best = -1;
    let bestDelta = Infinity;
    for (const cand of list) {
      let delta = backAngle - halfEdges[cand].angle;
      while (delta <= EPS) delta += Math.PI * 2;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = cand;
      }
    }
    // Sackgasse: nur die Zwillingskante vorhanden -> zurueck.
    return best === -1 ? twinOf(idx) : best;
  };

  const rooms: Room[] = [];
  for (let start = 0; start < halfEdges.length; start++) {
    if (halfEdges[start].visited) continue;
    const cycle: number[] = [];
    let cur = start;
    let guard = 0;
    while (!halfEdges[cur].visited && guard++ < halfEdges.length + 2) {
      halfEdges[cur].visited = true;
      cycle.push(cur);
      cur = nextEdge(cur);
      if (cur < 0) break;
    }
    if (cycle.length < 3) continue;
    const points = cycle.map((i) => ({ ...nodes[halfEdges[i].from] }));
    const area = polygonArea(points);
    // Nur Flaechen mit positivem Umlaufsinn sind Innenraeume; die Aussenhuelle
    // laeuft andersherum und wird hier verworfen.
    if (area > 100) rooms.push({ points, area });
  }
  return rooms;
}
