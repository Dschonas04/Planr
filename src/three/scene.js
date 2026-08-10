// Baut aus dem Grundriss eine 3D-Szene.
//
// Koordinaten: der Plan liegt in cm in der XY-Ebene, die 3D-Szene rechnet in
// Metern mit Y nach oben. Abbildung: plan.x -> x, plan.y -> z, Hoehe -> y.
// Oeffnungen werden nicht ausgeschnitten (kein CSG), sondern die Wand wird in
// massive Stuecke zerlegt -- Bruestung unter dem Fenster, Sturz darueber.

import * as THREE from 'three';
import { findRooms, normalize, sub } from '../model/geometry.js';
import { openingsOfWall, wallSolids, wallLength, wallAngle } from '../model/project.js';

const M = 0.01; // cm -> m

const MATERIALS = {
  wall: new THREE.MeshLambertMaterial({ color: 0xe8e4dc }),
  // Die Bodenflaeche entsteht aus einer ShapeGeometry in der XY-Ebene und wird
  // um +90 Grad gekippt -- dabei zeigt ihre Normale nach unten. DoubleSide
  // sorgt dafuer, dass die sichtbare Oberseite trotzdem beleuchtet wird.
  floor: new THREE.MeshLambertMaterial({ color: 0xcbb79a, side: THREE.DoubleSide }),
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

function addWalls(group, level) {
  for (const wall of level.walls) {
    const total = wallLength(wall);
    if (total < 1) continue;
    const angle = wallAngle(wall);
    const dir = normalize(sub(wall.b, wall.a));
    const thickness = (wall.thicknessCm || 24) * M;

    for (const solid of wallSolids(wall, openingsOfWall(level, wall.id))) {
      const lengthM = (solid.to - solid.from) * M;
      const heightM = (solid.top - solid.bottom) * M;
      if (lengthM <= 0.001 || heightM <= 0.001) continue;

      const geo = new THREE.BoxGeometry(lengthM, heightM, thickness);
      const mesh = new THREE.Mesh(geo, MATERIALS.wall);
      const midOffset = (solid.from + solid.to) / 2;
      mesh.position.set(
        (wall.a.x + dir.x * midOffset) * M,
        (solid.bottom + solid.top) / 2 * M,
        (wall.a.y + dir.y * midOffset) * M,
      );
      // Der Plan-Winkel dreht in der XY-Ebene, die Szene um die Y-Achse --
      // daher das negative Vorzeichen.
      mesh.rotation.y = -angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Glasflaeche in die Fensteroeffnungen, damit sie nicht als Loch wirkt.
    for (const op of openingsOfWall(level, wall.id)) {
      if (op.type !== 'window') continue;
      const geo = new THREE.PlaneGeometry(op.widthCm * M, op.heightCm * M);
      const mesh = new THREE.Mesh(geo, MATERIALS.glass);
      mesh.position.set(
        (wall.a.x + dir.x * op.offsetCm) * M,
        (op.sillCm + op.heightCm / 2) * M,
        (wall.a.y + dir.y * op.offsetCm) * M,
      );
      mesh.rotation.y = -angle;
      group.add(mesh);
    }
  }
}

function addFloors(group, level) {
  const rooms = findRooms(level.walls.map((w) => ({ a: w.a, b: w.b })));
  for (const room of rooms) {
    const shape = new THREE.Shape();
    room.points.forEach((p, i) => {
      if (i === 0) shape.moveTo(p.x * M, p.y * M);
      else shape.lineTo(p.x * M, p.y * M);
    });
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, MATERIALS.floor);
    // ShapeGeometry liegt in XY -- flach in die XZ-Ebene kippen.
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.005;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return rooms;
}

function addFurniture(group, level) {
  for (const f of level.furniture) {
    const w = f.widthCm * M;
    const d = f.depthCm * M;
    const h = Math.max(f.heightCm, 2) * M;
    const round = f.catalogId === 'table-round' || f.catalogId === 'officechair' || f.catalogId === 'plant';
    const geo = round
      ? new THREE.CylinderGeometry(w / 2, w / 2, h, 24)
      : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, furnitureMaterial(f.color));
    mesh.position.set(f.x * M, h / 2, f.y * M);
    mesh.rotation.y = -(f.rotationDeg * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furnitureId = f.id;
    group.add(mesh);
  }
}

/** Erzeugt die Geometrie-Gruppe fuer eine Ebene. */
export function buildLevelGroup(level) {
  const group = new THREE.Group();
  addFloors(group, level);
  addWalls(group, level);
  addFurniture(group, level);
  return group;
}

/** Entsorgt Geometrien einer Gruppe -- Materialien sind geteilt und bleiben. */
export function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material && obj.material.userData?.disposable) obj.material.dispose();
  });
}

/** Bounding-Sphere der Ebene, damit die Kamera sinnvoll einrastet. */
export function levelBounds(level) {
  const box = new THREE.Box3();
  const pts = [];
  for (const w of level.walls) {
    pts.push(new THREE.Vector3(w.a.x * M, 0, w.a.y * M));
    pts.push(new THREE.Vector3(w.b.x * M, 0, w.b.y * M));
  }
  for (const f of level.furniture) pts.push(new THREE.Vector3(f.x * M, 0, f.y * M));
  if (!pts.length) return { center: new THREE.Vector3(), radius: 8 };
  box.setFromPoints(pts);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { center, radius: Math.max(4, Math.max(size.x, size.z) * 0.75) };
}
