import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closestPointOnSegment,
  findRooms,
  pointInRect,
  polygonArea,
  rectCorners,
  snapAngle,
} from '../src/model/geometry.ts';
import { formatArea, formatLength, snap } from '../src/model/units.ts';
import {
  deserialize,
  offsetAlongWall,
  serialize,
  wallSolids,
  demoProject,
} from '../src/model/project.ts';

test('polygonArea liefert die Flaeche eines Rechtecks', () => {
  const area = polygonArea([
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ]);
  assert.equal(Math.abs(area), 120000); // 400 x 300 cm = 12 m2
});

test('findRooms erkennt einen einzelnen geschlossenen Raum', () => {
  const walls = [
    { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
    { a: { x: 400, y: 0 }, b: { x: 400, y: 300 } },
    { a: { x: 400, y: 300 }, b: { x: 0, y: 300 } },
    { a: { x: 0, y: 300 }, b: { x: 0, y: 0 } },
  ];
  const rooms = findRooms(walls);
  assert.equal(rooms.length, 1);
  assert.equal(Math.abs(rooms[0].area), 120000);
});

test('findRooms trennt zwei Raeume an einer Zwischenwand', () => {
  const walls = [
    { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } },
    { a: { x: 600, y: 0 }, b: { x: 600, y: 300 } },
    { a: { x: 600, y: 300 }, b: { x: 0, y: 300 } },
    { a: { x: 0, y: 300 }, b: { x: 0, y: 0 } },
    { a: { x: 300, y: 0 }, b: { x: 300, y: 300 } },
  ];
  const rooms = findRooms(walls);
  assert.equal(rooms.length, 2);
  for (const r of rooms) assert.equal(Math.abs(r.area), 90000);
});

test('findRooms ignoriert eine offene Wandkette', () => {
  const walls = [
    { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
    { a: { x: 400, y: 0 }, b: { x: 400, y: 300 } },
  ];
  assert.equal(findRooms(walls).length, 0);
});

test('wallSolids laesst unter und ueber einem Fenster Mauerwerk stehen', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thicknessCm: 24, heightCm: 250 };
  const solids = wallSolids(wall, [
    { offsetCm: 200, widthCm: 100, sillCm: 90, heightCm: 140 },
  ]);
  // links, Bruestung, Sturz, rechts
  assert.equal(solids.length, 4);
  const sill = solids.find((s) => s.bottom === 0 && s.top === 90);
  const lintel = solids.find((s) => s.bottom === 230);
  assert.ok(sill, 'Bruestung fehlt');
  assert.ok(lintel, 'Sturz fehlt');
  assert.equal(lintel.top, 250);
});

test('wallSolids stanzt eine Tuer bis zum Boden durch', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, thicknessCm: 24, heightCm: 250 };
  const solids = wallSolids(wall, [{ offsetCm: 150, widthCm: 90, sillCm: 0, heightCm: 200 }]);
  assert.ok(!solids.some((s) => s.bottom === 0 && s.from >= 105 && s.to <= 195));
});

test('offsetAlongWall begrenzt auf die Wandlaenge', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
  assert.equal(offsetAlongWall(wall, { x: 50, y: 20 }), 50);
  assert.equal(offsetAlongWall(wall, { x: 500, y: 0 }), 100);
  assert.equal(offsetAlongWall(wall, { x: -80, y: 0 }), 0);
});

test('pointInRect beruecksichtigt die Drehung', () => {
  assert.equal(pointInRect({ x: 0, y: 45 }, 0, 0, 100, 20, Math.PI / 2), true);
  assert.equal(pointInRect({ x: 45, y: 0 }, 0, 0, 100, 20, Math.PI / 2), false);
});

test('rectCorners liefert vier Ecken mit korrekter Ausdehnung', () => {
  const c = rectCorners(0, 0, 200, 100, 0);
  assert.equal(c.length, 4);
  assert.equal(Math.min(...c.map((p) => p.x)), -100);
  assert.equal(Math.max(...c.map((p) => p.y)), 50);
});

test('closestPointOnSegment klemmt ausserhalb der Strecke', () => {
  const r = closestPointOnSegment({ x: 200, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 });
  assert.equal(r.t, 1);
  assert.equal(r.point.x, 100);
});

test('snapAngle rastet auf 15 Grad ein und behaelt die Laenge', () => {
  const a = { x: 0, y: 0 };
  const p = snapAngle(a, { x: 100, y: 4 }, Math.PI / 12);
  assert.ok(Math.abs(p.y) < 1e-9, 'sollte auf 0 Grad einrasten');
  assert.ok(Math.abs(Math.hypot(p.x, p.y) - Math.hypot(100, 4)) < 1e-9);
});

test('snap rundet auf das Raster, 0 schaltet ab', () => {
  assert.equal(snap(37, 10), 40);
  assert.equal(snap(37, 0), 37);
});

test('Formatierung nutzt deutsche Schreibweise', () => {
  assert.equal(formatLength(85), '85 cm');
  assert.equal(formatLength(250), '2,50 m');
  assert.equal(formatArea(120000), '12,00 m²');
});

test('Projekt ueberlebt Speichern und Laden', () => {
  const project = demoProject();
  const round = deserialize(serialize(project));
  assert.equal(round.levels[0].walls.length, project.levels[0].walls.length);
  assert.equal(round.levels[0].furniture.length, project.levels[0].furniture.length);
  assert.equal(round.name, project.name);
});

test('deserialize verwirft Oeffnungen ohne zugehoerige Wand', () => {
  const project = deserialize({
    name: 'Test',
    levels: [
      {
        walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
        openings: [
          { id: 'o1', wallId: 'w1', offsetCm: 50, widthCm: 80, heightCm: 200, type: 'door' },
          { id: 'o2', wallId: 'weg', offsetCm: 10, widthCm: 80, heightCm: 200, type: 'door' },
        ],
        furniture: [],
      },
    ],
  });
  assert.equal(project.levels[0].openings.length, 1);
  assert.equal(project.levels[0].openings[0].id, 'o1');
});

test('deserialize faengt kaputte Zahlenwerte ab', () => {
  const project = deserialize({
    levels: [
      {
        walls: [{ id: 'w1', a: { x: 'kaputt' }, b: null, thicknessCm: NaN }],
        furniture: [{ catalogId: 'bed-140', x: null, y: undefined }],
      },
    ],
  });
  const wall = project.levels[0].walls[0];
  assert.equal(wall.a.x, 0);
  assert.equal(wall.thicknessCm, 24);
  const f = project.levels[0].furniture[0];
  assert.equal(f.widthCm, 140);
  assert.equal(f.x, 0);
});
