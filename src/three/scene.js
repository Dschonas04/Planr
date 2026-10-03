// Baut aus dem Grundriss eine 3D-Szene des ganzen Hauses.
//
// Koordinaten: der Plan liegt in cm in der XY-Ebene, die 3D-Szene rechnet in
// Metern mit Y nach oben. Abbildung: plan.x -> x, plan.y -> z, Hoehe -> y.
//
// Wände entstehen als Prismen über ihrem Grundriss mit Gehrung -- Stück für
// Stück zwischen den Öffnungen (Brüstung darunter, Sturz darüber). Unter einem
// Steildach folgt die Oberkante jedes Stücks der Dachunterseite; so entstehen
// Kniestock und Giebeldreieck ohne Sonderfall.

import * as THREE from 'three';
import { normal, normalize, sub } from '../model/geometry.ts';
import { openingsOfWall, wallLength } from '../model/project.ts';
import {
  levelRooms,
  riseFrom,
  roofModel,
  roofPlanePolygons,
  roofUndersideAt,
  slabs,
  wallCaps,
  wallOutline,
} from '../model/building.ts';
import { stairGeometry } from '../model/stairs.ts';

const M = 0.01; // cm -> m

const MATERIALS = {
  wall: new THREE.MeshLambertMaterial({ color: 0xece8df, side: THREE.DoubleSide }),
  wallOuter: new THREE.MeshLambertMaterial({ color: 0xf2efe8, side: THREE.DoubleSide }),
  slab: new THREE.MeshLambertMaterial({ color: 0xbdb8ae, side: THREE.DoubleSide }),
  floor: new THREE.MeshLambertMaterial({ color: 0xcbb79a, side: THREE.DoubleSide }),
  tiles: new THREE.MeshLambertMaterial({ color: 0xd9d6d0, side: THREE.DoubleSide }),
  roof: new THREE.MeshLambertMaterial({ color: 0x8a3b2a, side: THREE.DoubleSide }),
  roofEdge: new THREE.MeshLambertMaterial({ color: 0x6d4a34, side: THREE.DoubleSide }),
  stair: new THREE.MeshLambertMaterial({ color: 0xb08a63, side: THREE.DoubleSide }),
  glass: new THREE.MeshLambertMaterial({
    color: 0x9fc7de,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  }),
};

function furnitureMaterial(color) {
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color || '#a0a0a0') });
  // Pro Moebel eigenes Material -> beim Neuaufbau der Szene mit entsorgen.
  mat.userData.disposable = true;
  return mat;
}

/**
 * Prisma über einem Polygon (Planpunkte in cm) mit eigener Unter- und
 * Oberkante je Ecke (cm über ±0). Flache Normalen, damit Kanten hart bleiben.
 */
function prism(points, bottoms, tops) {
  const n = points.length;
  const pos = [];
  const v = (i, top) => [points[i].x * M, (top ? tops[i] : bottoms[i]) * M, points[i].y * M];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const flat = points.map((p) => new THREE.Vector2(p.x, p.y));
  const faces = THREE.ShapeUtils.triangulateShape(flat, []);
  for (const [a, b, c] of faces) {
    tri(v(a, true), v(b, true), v(c, true));
    tri(v(c, false), v(b, false), v(a, false));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(v(i, false), v(j, false), v(j, true));
    tri(v(i, false), v(j, true), v(i, true));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function addWalls(group, level, roof) {
  const caps = wallCaps(level);
  const base = level.elevationCm;
  const underRoof = roof && roof.level.id === level.id;
  const topAt = (p, wall) => {
    if (!underRoof) return base + (wall.heightCm || level.heightCm);
    return Math.max(base + 10, roofUndersideAt(roof, p));
  };

  for (const wall of level.walls) {
    const total = wallLength(wall);
    if (total < 1) continue;
    const cap = caps.get(wall.id);
    const dir = normalize(sub(wall.b, wall.a));
    const nrm = normal(dir);
    const h = wall.thicknessCm / 2;
    const outline = wallOutline(wall, cap);
    const ops = openingsOfWall(level, wall.id)
      .map((o) => ({ s0: Math.max(0, o.offsetCm - o.widthCm / 2), s1: Math.min(total, o.offsetCm + o.widthCm / 2), o }))
      .filter((o) => o.s1 > o.s0);

    // Schnittstellen entlang der Wand: Öffnungskanten, unter dem Dach dazu
    // ein feines Raster, damit die Oberkante dem Knick am First folgt.
    const cuts = new Set([0, total]);
    for (const o of ops) {
      cuts.add(o.s0);
      cuts.add(o.s1);
    }
    if (underRoof) for (let s = 25; s < total; s += 25) cuts.add(s);
    const sorted = [...cuts].sort((a, b) => a - b);

    const at = (s, side) => {
      if (s <= 0.01) return side > 0 ? outline[0] : outline[3];
      if (s >= total - 0.01) return side > 0 ? outline[1] : outline[2];
      return { x: wall.a.x + dir.x * s + nrm.x * h * side, y: wall.a.y + dir.y * s + nrm.y * h * side };
    };

    for (let i = 0; i < sorted.length - 1; i++) {
      const s0 = sorted[i];
      const s1 = sorted[i + 1];
      if (s1 - s0 < 0.05) continue;
      const quad = [at(s0, 1), at(s1, 1), at(s1, -1), at(s0, -1)];
      const tops = quad.map((p) => topAt(p, wall));
      const mid = (s0 + s1) / 2;
      const op = ops.find((o) => mid > o.s0 && mid < o.s1)?.o;
      const mat = MATERIALS.wall;
      if (!op) {
        group.add(mesh(prism(quad, quad.map(() => base), tops), mat));
        continue;
      }
      const sill = base + (op.sillCm || 0);
      const head = base + (op.sillCm || 0) + op.heightCm;
      if (op.sillCm > 0) group.add(mesh(prism(quad, quad.map(() => base), quad.map(() => sill)), mat));
      if (tops.some((t) => t > head + 0.5)) {
        group.add(mesh(prism(quad, quad.map(() => head), tops.map((t) => Math.max(t, head))), mat));
      }
      if (op.type === 'window') {
        const c = { x: (quad[0].x + quad[2].x) / 2, y: (quad[0].y + quad[2].y) / 2 };
        const top = Math.min(head, Math.min(...tops));
        const glassH = top - sill;
        if (glassH > 1) {
          const geo = new THREE.PlaneGeometry((s1 - s0) * M, glassH * M);
          const g = new THREE.Mesh(geo, MATERIALS.glass);
          g.position.set(c.x * M, ((sill + top) / 2) * M, c.y * M);
          g.rotation.y = -Math.atan2(dir.y, dir.x);
          group.add(g);
        }
      }
    }
  }
}

function addFloors(group, level) {
  for (const room of levelRooms(level)) {
    if (room.net.length < 3) continue;
    const shape = new THREE.Shape(room.net.map((p) => new THREE.Vector2(p.x * M, p.y * M)));
    const geo = new THREE.ShapeGeometry(shape);
    const fliesen = /fliese|stein/i.test(room.stamp?.floor || '');
    const m = new THREE.Mesh(geo, fliesen ? MATERIALS.tiles : MATERIALS.floor);
    // ShapeGeometry liegt in XY -- flach in die XZ-Ebene kippen.
    m.rotation.x = Math.PI / 2;
    m.position.y = (level.elevationCm + 0.6) * M;
    m.receiveShadow = true;
    group.add(m);
  }
}

function addSlab(group, slab) {
  const shape = new THREE.Shape(slab.outline.map((p) => new THREE.Vector2(p.x * M, p.y * M)));
  for (const hole of slab.holes) {
    shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x * M, p.y * M))));
  }
  const depth = (slab.topCm - slab.bottomCm) * M;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const m = mesh(geo, MATERIALS.slab);
  // Extrusion läuft entlang +z; gekippt um +90° zeigt sie nach unten.
  m.rotation.x = Math.PI / 2;
  m.position.y = slab.topCm * M;
  group.add(m);
}

function addStairs(group, project, levelIndex) {
  const level = project.levels[levelIndex];
  const rise = riseFrom(project, levelIndex);
  for (const st of level.stairs || []) {
    const geo = stairGeometry(st, rise);
    const r = geo.calc.riserCm;
    for (const t of geo.treads) {
      const top = level.elevationCm + t.topCm;
      // Gefaltete Platte: jede Stufe reicht eine Steigung tiefer als die vorige.
      const bottom = t.landing ? top - 20 : Math.max(level.elevationCm, top - r - 16);
      group.add(mesh(prism(t.points, t.points.map(() => bottom), t.points.map(() => top)), MATERIALS.stair));
    }
  }
}

function addRoof(group, model) {
  for (const { plane, points } of roofPlanePolygons(model)) {
    if (points.length < 3) continue;
    const tops = points.map((p) => plane.c + plane.gx * p.x + plane.gy * p.y);
    const bottoms = tops.map((t) => t - model.verticalThickness);
    group.add(mesh(prism(points, bottoms, tops), model.roof.kind === 'flach' ? MATERIALS.slab : MATERIALS.roof));
  }
}

function addFurniture(group, level) {
  for (const f of level.furniture) {
    const w = f.widthCm * M;
    const d = f.depthCm * M;
    const h = Math.max(f.heightCm, 2) * M;
    const round = f.catalogId === 'table-round' || f.catalogId === 'officechair' || f.catalogId === 'plant';
    const geo = round ? new THREE.CylinderGeometry(w / 2, w / 2, h, 24) : new THREE.BoxGeometry(w, h, d);
    const m = mesh(geo, furnitureMaterial(f.color));
    m.position.set(f.x * M, level.elevationCm * M + h / 2, f.y * M);
    m.rotation.y = -(f.rotationDeg * Math.PI) / 180;
    m.userData.furnitureId = f.id;
    group.add(m);
  }
}

/**
 * Das ganze Haus oder nur ein Geschoss. Bei nur einem Geschoss entfallen die
 * Decke darüber und das Dach (sonst sähe man nicht hinein).
 */
export function buildHouseGroup(project, { only = null, showRoof = true } = {}) {
  const group = new THREE.Group();
  const roof = roofModel(project);
  project.levels.forEach((level, i) => {
    if (only != null && only !== i) return;
    addFloors(group, level);
    addWalls(group, level, roof);
    addStairs(group, project, i);
    addFurniture(group, level);
  });
  for (const s of slabs(project)) {
    if (only != null) {
      const lvl = project.levels[only];
      // Nur die Decke unter dem gezeigten Geschoss.
      if (Math.abs(s.topCm - lvl.elevationCm) > 0.5) continue;
    }
    addSlab(group, s);
  }
  if (roof && showRoof && only == null) addRoof(group, roof);
  return group;
}

/** Entsorgt Geometrien einer Gruppe -- Materialien sind geteilt und bleiben. */
export function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material && obj.material.userData?.disposable) obj.material.dispose();
  });
}

/** Mittelpunkt und Ausdehnung des Hauses, damit die Kamera sinnvoll einrastet. */
export function houseBounds(project) {
  const box = new THREE.Box3();
  const pts = [];
  for (const level of project.levels) {
    for (const w of level.walls) {
      pts.push(new THREE.Vector3(w.a.x * M, level.elevationCm * M, w.a.y * M));
      pts.push(new THREE.Vector3(w.b.x * M, (level.elevationCm + level.heightCm) * M, w.b.y * M));
    }
  }
  if (!pts.length) return { center: new THREE.Vector3(), radius: 8 };
  box.setFromPoints(pts);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { center, radius: Math.max(5, Math.max(size.x, size.y, size.z) * 0.9) };
}
