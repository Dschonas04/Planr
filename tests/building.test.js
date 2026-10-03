import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areaSchedule,
  clipByClearHeight,
  exteriorSides,
  levelOutlines,
  levelRooms,
  roofModel,
  roofTopAt,
  slabs,
  wallBands,
  wallCaps,
} from '../src/model/building.ts';
import { stairCalc, stairGeometry } from '../src/model/stairs.ts';
import { typeThickness, uValue, wallType } from '../src/model/wallTypes.ts';
import { polygonArea } from '../src/model/geometry.ts';
import { formatArch, formatLevel } from '../src/model/units.ts';
import { createLevel, createProject, defaultRoof, demoProject, deserialize, serialize } from '../src/model/project.ts';
import { parseNumInput } from '../src/canvas2d/parseNumInput.js';

const wall = (id, ax, ay, bx, by, t = 36.5) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thicknessCm: t, heightCm: 250 });

function box(level, w, h, t = 36.5) {
  level.walls.push(wall('t', 0, 0, w, 0, t), wall('r', w, 0, w, h, t), wall('b', w, h, 0, h, t), wall('l', 0, h, 0, 0, t));
  return level;
}

test('lichte Raumfläche zieht die halben Wanddicken ab', () => {
  const level = box(createLevel(), 1000, 800);
  const [room] = levelRooms(level);
  // (1000 − 36,5) × (800 − 36,5) cm
  assert.ok(Math.abs(room.areaCm2 - 963.5 * 763.5) < 1);
});

test('verschieden dicke Wände: jede Kante um ihre eigene halbe Dicke', () => {
  const level = box(createLevel(), 500, 400, 24);
  level.walls.push(wall('i', 250, 0, 250, 400, 11.5));
  const areas = levelRooms(level).map((r) => Math.round(r.areaCm2)).sort((a, b) => a - b);
  // links: (250 − 12 − 5,75) × (400 − 24)
  const erwartet = Math.round((250 - 12 - 5.75) * 376);
  assert.deepEqual(areas, [erwartet, erwartet]);
});

test('Umriss liegt auf der Außenseite der Außenwände', () => {
  const level = box(createLevel(), 1000, 800, 40);
  const [o] = levelOutlines(level);
  assert.ok(Math.abs(Math.abs(polygonArea(o.outer)) - 1040 * 840) < 1);
});

test('Außenseite wird je Wand richtig erkannt', () => {
  const level = box(createLevel(), 1000, 800);
  const sides = exteriorSides(level);
  // Wand t läuft nach +x, ihre Normale zeigt nach +y (ins Haus) → außen ist −1.
  assert.equal(sides.get('t'), -1);
  assert.equal(sides.size, 4);
});

test('Gehrung: äußere Schicht endet an der Gebäudeecke', () => {
  const level = box(createLevel(), 1000, 800, 40);
  level.walls[0].typeId = 'aw-ziegel-365';
  const caps = wallCaps(level);
  const bands = wallBands(level.walls[0], caps.get('t'), -1);
  const aussen = bands[0].points;
  assert.ok(Math.abs(aussen[0].x + 20) < 0.01 && Math.abs(aussen[0].y + 20) < 0.01);
  assert.ok(Math.abs(aussen[1].x - 1020) < 0.01);
});

test('U-Wert der Ziegelwand 36,5 liegt unter der GEG-Referenz', () => {
  const t = wallType('aw-ziegel-365');
  assert.equal(typeThickness(t), 40);
  const u = uValue(t);
  assert.ok(u > 0.19 && u < 0.22, `U = ${u}`);
});

test('Treppe: 2,75 m Geschosshöhe ergibt 16 Steigungen à 17,2 cm nach Schrittmaßregel', () => {
  const st = { id: 's', kind: 'gerade', x: 0, y: 0, rotationDeg: 0, widthCm: 100, treadCm: 0, turn: 1, splitAt: 0 };
  const c = stairCalc(st, 275);
  assert.equal(c.risers, 16);
  assert.ok(Math.abs(c.riserCm - 17.1875) < 1e-6);
  assert.equal(c.treads, 15);
  assert.ok(Math.abs(c.stepRuleCm - 63) < 0.1);
  assert.deepEqual(c.warnings, []);
  const g = stairGeometry(st, 275);
  assert.equal(g.treads.length, 15);
  assert.ok(Math.abs(g.outline[1].x - 15 * c.treadCm) < 1e-6);
});

test('Treppe: zu schmal und zu steil wird gemeldet', () => {
  const st = { id: 's', kind: 'gerade', x: 0, y: 0, rotationDeg: 0, widthCm: 70, treadCm: 20, turn: 1, splitAt: 0 };
  const c = stairCalc(st, 275);
  assert.equal(c.warnings.length >= 2, true);
});

test('U-Treppe hat ein Podest und zwei Läufe', () => {
  const st = { id: 's', kind: 'u', x: 0, y: 0, rotationDeg: 0, widthCm: 100, treadCm: 0, turn: 1, splitAt: 0 };
  const g = stairGeometry(st, 275);
  assert.equal(g.treads.filter((t) => t.landing).length, 1);
  assert.equal(g.treads.length, 15);
  // letzte Stufe eine Steigung unter dem oberen Geschoss
  assert.ok(Math.abs(g.treads[g.treads.length - 1].topCm - (275 - g.calc.riserCm)) < 1e-6);
});

test('Satteldach: Traufe auf Kniestockhöhe, First über der Mitte', () => {
  const p = createProject();
  const dg = box(p.levels[0], 1000, 800, 40);
  p.roof = { ...defaultRoof(dg.id), kind: 'sattel', pitchDeg: 45, kneeWallCm: 100, overhangCm: 0 };
  const m = roofModel(p);
  // Außenkante bei y = −20 → Traufe 100 cm
  assert.ok(Math.abs(roofTopAt(m, { x: 500, y: -20 }) - 100) < 1e-6);
  // 45°: First 420 cm weiter innen → 520 cm
  assert.ok(Math.abs(roofTopAt(m, { x: 500, y: 400 }) - 520) < 1e-6);
});

test('WoFlV: unter 1 m nichts, 1–2 m halb', () => {
  const p = createProject();
  const dg = box(p.levels[0], 1000, 800, 40);
  p.roof = { ...defaultRoof(dg.id), kind: 'pult', pitchDeg: 45, kneeWallCm: 50, overhangCm: 0, thicknessCm: 0.0001, ridgeAlongX: true, highSidePositive: true };
  const m = roofModel(p);
  const room = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 400 }, { x: 0, y: 400 }];
  // Lichte Höhe = 50 + (y + 20) − Dachpaket (mind. 5 cm, senkrecht 5/cos 45°)
  const vt = 5 / Math.cos(Math.PI / 4);
  const ab1 = Math.abs(polygonArea(clipByClearHeight(m, room, 100)));
  const ab2 = Math.abs(polygonArea(clipByClearHeight(m, room, 200)));
  assert.ok(Math.abs(ab1 - 100 * (400 - (30 + vt))) < 1, `ab1 ${ab1}`);
  assert.ok(Math.abs(ab2 - 100 * (400 - (130 + vt))) < 1, `ab2 ${ab2}`);
});

test('Flächenaufstellung zählt Nutzflächen nicht zur Wohnfläche', () => {
  const p = createProject();
  const eg = box(p.levels[0], 600, 500, 24);
  eg.rooms.push({ id: 'r', x: 300, y: 250, name: 'Keller', usage: 'nutz', floor: '' });
  const rows = areaSchedule(p);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].woflvM2, 0);
  assert.ok(rows[0].netM2 > 13);
});

test('Treppe schneidet die Decke darüber auf', () => {
  const p = createProject();
  box(p.levels[0], 800, 600, 24);
  const og = createLevel('OG', 275);
  box(og, 800, 600, 24);
  p.levels.push(og);
  p.levels[0].stairs.push({ id: 's', kind: 'gerade', x: 100, y: 300, rotationDeg: 0, widthCm: 100, treadCm: 0, turn: 1, splitAt: 0 });
  const decke = slabs(p).find((s) => s.topCm === 275);
  assert.equal(decke.holes.length, 1);
});

test('Beispielhaus: zwei Geschosse, Dach, plausible Wohnfläche', () => {
  const p = demoProject();
  assert.equal(p.levels.length, 2);
  assert.equal(p.roof.kind, 'sattel');
  const wohn = areaSchedule(p).reduce((s, r) => s + r.woflvM2, 0);
  assert.ok(wohn > 100 && wohn < 140, `Wohnfläche ${wohn}`);
});

test('Version-1-Datei bekommt Höhenlagen und Standarddach', () => {
  const v1 = {
    version: 1,
    name: 'Alt',
    gridCm: 10,
    levels: [
      { id: 'a', name: 'EG', heightCm: 250, walls: [], openings: [], furniture: [] },
      { id: 'b', name: 'OG', heightCm: 240, walls: [], openings: [], furniture: [] },
    ],
  };
  const p = deserialize(v1);
  assert.equal(p.levels[1].elevationCm, 275);
  assert.equal(p.roof.kind, 'keins');
  assert.equal(p.version, 2);
  const zurueck = deserialize(serialize(p));
  assert.equal(zurueck.levels[1].elevationCm, 275);
});

test('Architektenmaße mit hochgestellter Fünf', () => {
  assert.equal(formatArch(36.5), '36⁵');
  assert.equal(formatArch(24), '24');
  assert.equal(formatArch(436.5), '4,36⁵');
  assert.equal(formatArch(1040), '10,40');
  assert.equal(formatLevel(0), '±0,00');
  assert.equal(formatLevel(275), '+2,75');
  assert.equal(formatLevel(-260), '−2,60');
});

test('Zahleneingabe: Länge und optional Winkel', () => {
  assert.deepEqual(parseNumInput('450'), { length: 450, angle: null });
  assert.deepEqual(parseNumInput('436,5;90'), { length: 436.5, angle: 90 });
  assert.deepEqual(parseNumInput('300<-45'), { length: 300, angle: -45 });
  assert.equal(parseNumInput('abc'), null);
});
