// Projektmodell, Serialisierung und die Helfer, die Waende und Oeffnungen
// zusammenbringen. Einheit ueberall: Zentimeter, Winkel im Bogenmass.

import { add, angleOf, dist, len, normalize, scale, sub } from './geometry.ts';
import { catalogItem } from './catalog.ts';
import { typeThickness, wallType } from './wallTypes.ts';
import type { Cm, Level, Opening, Point, Project, Rad, Roof, RoomUsage, Wall, WallSolid } from './types.ts';

/**
 * Version 2 bringt Geschosse mit Höhenlage, Wandaufbauten, Treppen, Maße,
 * Raumstempel, Dach und Plankopf. Version-1-Dateien werden beim Einlesen
 * ergänzt: alle neuen Felder haben Standardwerte.
 */
export const FILE_VERSION = 2;

export const DEFAULTS = {
  wallThicknessCm: 24,
  innerWallThicknessCm: 11.5,
  wallHeightCm: 250,
  doorWidthCm: 90,
  doorHeightCm: 200,
  windowWidthCm: 120,
  windowHeightCm: 140,
  windowSillCm: 90,
  slabCm: 25,
  stairWidthCm: 100,
};

let idCounter = 0;
export function newId(prefix = 'o'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function createLevel(name = 'Erdgeschoss', elevationCm: Cm = 0): Level {
  return {
    id: newId('lvl'),
    name,
    heightCm: DEFAULTS.wallHeightCm,
    elevationCm,
    slabCm: DEFAULTS.slabCm,
    walls: [],
    openings: [],
    furniture: [],
    labels: [],
    stairs: [],
    dimensions: [],
    rooms: [],
  };
}

export function defaultRoof(levelId: string): Roof {
  return {
    kind: 'keins',
    levelId,
    pitchDeg: 38,
    overhangCm: 50,
    kneeWallCm: 100,
    thicknessCm: 30,
    ridgeAlongX: true,
    highSidePositive: true,
  };
}

export function createProject(name = 'Neues Projekt'): Project {
  const level = createLevel();
  return {
    version: FILE_VERSION,
    name,
    gridCm: 10,
    levels: [level],
    roof: defaultRoof(level.id),
    meta: { bauherr: '', adresse: '', planverfasser: '', planNummer: '', nordDeg: 0 },
  };
}

/** Wand mit Aufbau aus dem Katalog; die Dicke folgt aus den Schichten. */
export function typedWall(typeId: string, a: Point, b: Point, heightCm: Cm): Wall {
  const t = wallType(typeId);
  return {
    id: newId('w'),
    a,
    b,
    thicknessCm: t ? typeThickness(t) : DEFAULTS.wallThicknessCm,
    heightCm,
    typeId: t ? typeId : undefined,
  };
}

/**
 * Beispiel: Einfamilienhaus mit Erdgeschoss und ausgebautem Dachgeschoss,
 * Satteldach 38°, Kniestock 1,00 m, U-Treppe mit Podest. Außenmaß rund
 * 10,40 × 8,40 m bei 40 cm Außenwand (Ziegel 36,5 + Putz).
 */
export function demoProject(): Project {
  const project = createProject('Einfamilienhaus Musterweg');
  project.meta = {
    bauherr: 'Familie Muster',
    adresse: 'Musterweg 1, 12345 Musterstadt',
    planverfasser: '',
    planNummer: 'EP-01',
    nordDeg: 0,
  };
  const eg = project.levels[0];
  eg.name = 'Erdgeschoss';
  const dg = createLevel('Dachgeschoss', eg.elevationCm + eg.heightCm + eg.slabCm);
  project.levels.push(dg);
  project.roof = { ...defaultRoof(dg.id), kind: 'sattel', pitchDeg: 38, kneeWallCm: 100, overhangCm: 50 };

  const AW = 'aw-ziegel-365';
  const IT = 'iw-ks-175';
  const IN = 'iw-mw-115';
  const add = (level: Level, typeId: string, ax: Cm, ay: Cm, bx: Cm, by: Cm): Wall => {
    const w = typedWall(typeId, { x: ax, y: ay }, { x: bx, y: by }, level.heightCm);
    level.walls.push(w);
    return w;
  };
  const opening = (level: Level, wall: Wall, offsetCm: Cm, widthCm: Cm, type: 'door' | 'window', heightCm: Cm, sillCm: Cm, swing: 1 | -1 = 1) => {
    level.openings.push({ id: newId('op'), wallId: wall.id, offsetCm, widthCm, heightCm, sillCm, type, swing });
  };
  const stamp = (level: Level, x: Cm, y: Cm, name: string, floor: string, usage: RoomUsage = 'wohnen') => {
    level.rooms.push({ id: newId('rs'), x, y, name, usage, floor });
  };
  const place = (level: Level, catalogId: string, x: Cm, y: Cm, rotationDeg = 0): void => {
    const item = catalogItem(catalogId);
    if (!item) return;
    level.furniture.push({
      id: newId('f'),
      catalogId,
      label: item.label,
      x,
      y,
      widthCm: item.w,
      depthCm: item.d,
      heightCm: item.h,
      rotationDeg,
      color: item.color,
    });
  };

  // --- Erdgeschoss ---
  const top = add(eg, AW, 0, 0, 1000, 0);
  const right = add(eg, AW, 1000, 0, 1000, 800);
  const bottom = add(eg, AW, 1000, 800, 0, 800);
  const left = add(eg, AW, 0, 800, 0, 0);
  const mitte = add(eg, IT, 520, 0, 520, 800);
  const arbeiten = add(eg, IN, 520, 330, 1000, 330);
  const nebenraeume = add(eg, IN, 860, 330, 860, 800);
  add(eg, IN, 860, 560, 1000, 560);

  opening(eg, bottom, 415, 101, 'door', 213.5, 0); // Haustür
  opening(eg, bottom, 740, 251, 'window', 213.5, 0); // Terrassentür
  opening(eg, left, 520, 151, 'window', 138.5, 75);
  opening(eg, top, 260, 151, 'window', 138.5, 75);
  opening(eg, top, 760, 126, 'window', 138.5, 75);
  opening(eg, right, 445, 61, 'window', 88.5, 125);
  opening(eg, right, 680, 76, 'window', 88.5, 125);
  opening(eg, mitte, 420, 88.5, 'door', 201, 0, -1);
  opening(eg, arbeiten, 85, 88.5, 'door', 201, 0, 1);
  opening(eg, nebenraeume, 115, 76, 'door', 201, 0, 1);
  opening(eg, nebenraeume, 350, 76, 'door', 201, 0, 1);

  eg.stairs.push({
    id: newId('st'),
    kind: 'u',
    x: 802,
    y: 760,
    rotationDeg: -90,
    widthCm: 100,
    treadCm: 0,
    turn: 1,
    splitAt: 0,
  });

  stamp(eg, 260, 400, 'Wohnen / Essen / Kochen', 'Parkett');
  stamp(eg, 760, 165, 'Arbeiten', 'Parkett');
  stamp(eg, 600, 600, 'Diele', 'Fliesen');
  stamp(eg, 930, 445, 'WC', 'Fliesen');
  stamp(eg, 930, 680, 'HWR', 'Fliesen', 'nutz');

  place(eg, 'sofa-3', 160, 560, 90);
  place(eg, 'coffeetable', 280, 560, 90);
  place(eg, 'table-160', 300, 200, 0);
  place(eg, 'chair', 270, 140, 0);
  place(eg, 'chair', 330, 140, 0);
  place(eg, 'chair', 270, 260, 180);
  place(eg, 'chair', 330, 260, 180);
  place(eg, 'desk-140', 760, 60, 0);
  place(eg, 'wc', 965, 445, 270);

  // --- Dachgeschoss ---
  const dTop = add(dg, AW, 0, 0, 1000, 0);
  const dRight = add(dg, AW, 1000, 0, 1000, 800);
  add(dg, AW, 1000, 800, 0, 800);
  const dLeft = add(dg, AW, 0, 800, 0, 0);
  const dMitte = add(dg, IT, 520, 0, 520, 800);
  add(dg, IN, 0, 565, 520, 565);
  const dBad = add(dg, IN, 520, 330, 1000, 330);
  const dAbst = add(dg, IN, 860, 330, 860, 800);
  void dTop;

  opening(dg, dLeft, 520, 126, 'window', 138.5, 90);
  opening(dg, dLeft, 120, 101, 'window', 138.5, 90);
  opening(dg, dRight, 165, 101, 'window', 113.5, 110);
  opening(dg, dMitte, 470, 88.5, 'door', 201, 0, -1);
  opening(dg, dMitte, 700, 88.5, 'door', 201, 0, 1);
  opening(dg, dBad, 120, 88.5, 'door', 201, 0, -1);
  opening(dg, dAbst, 200, 76, 'door', 201, 0, 1);

  stamp(dg, 260, 280, 'Schlafen', 'Parkett');
  stamp(dg, 260, 690, 'Kind', 'Parkett');
  stamp(dg, 760, 165, 'Bad', 'Fliesen');
  stamp(dg, 640, 560, 'Flur', 'Parkett');
  stamp(dg, 930, 560, 'Abstellraum', 'Parkett', 'nutz');

  place(dg, 'bed-180', 260, 320, 0);
  place(dg, 'bed-90', 300, 690, 90);
  place(dg, 'bathtub', 900, 110, 0);
  place(dg, 'basin', 640, 60, 0);
  place(dg, 'wc', 780, 60, 0);

  return project;
}

// --- Wand-Helfer -------------------------------------------------------

export function wallVector(wall: Wall): Point {
  return sub(wall.b, wall.a);
}

export function wallLength(wall: Wall): Cm {
  return len(wallVector(wall));
}

export function wallAngle(wall: Wall): Rad {
  return angleOf(wallVector(wall));
}

/** Weltposition eines Offsets entlang der Wandmittellinie. */
export function pointAlongWall(wall: Wall, offsetCm: Cm): Point {
  const dir = normalize(wallVector(wall));
  return add(wall.a, scale(dir, offsetCm));
}

/** Offset eines Weltpunkts entlang der Wand, begrenzt auf die Wandlaenge. */
export function offsetAlongWall(wall: Wall, point: Point): Cm {
  const v = wallVector(wall);
  const l = len(v);
  if (l < 1e-6) return 0;
  const dir = scale(v, 1 / l);
  const t = (point.x - wall.a.x) * dir.x + (point.y - wall.a.y) * dir.y;
  return Math.max(0, Math.min(l, t));
}

export function openingsOfWall(level: Level, wallId: string): Opening[] {
  return level.openings.filter((o) => o.wallId === wallId);
}

/**
 * Zerlegt eine Wand in die massiven Stuecke zwischen den Oeffnungen.
 * Rueckgabe je Stueck: Start-/End-Offset sowie Unter- und Oberkante --
 * daraus baut die 3D-Ansicht Bruestung und Sturz.
 */
export function wallSolids(wall: Wall, openings: Opening[]): WallSolid[] {
  const total = wallLength(wall);
  const height = wall.heightCm || DEFAULTS.wallHeightCm;
  const sorted = [...openings]
    .map((o) => ({
      start: Math.max(0, o.offsetCm - o.widthCm / 2),
      end: Math.min(total, o.offsetCm + o.widthCm / 2),
      sill: o.sillCm || 0,
      top: Math.min(height, (o.sillCm || 0) + o.heightCm),
    }))
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  const solids: WallSolid[] = [];
  let cursor = 0;
  for (const o of sorted) {
    if (o.start > cursor) {
      solids.push({ from: cursor, to: o.start, bottom: 0, top: height });
    }
    if (o.sill > 0) {
      solids.push({ from: o.start, to: o.end, bottom: 0, top: o.sill }); // Bruestung
    }
    if (o.top < height) {
      solids.push({ from: o.start, to: o.end, bottom: o.top, top: height }); // Sturz
    }
    cursor = Math.max(cursor, o.end);
  }
  if (cursor < total) {
    solids.push({ from: cursor, to: total, bottom: 0, top: height });
  }
  return solids;
}

/** Wand, deren Mittellinie dem Punkt am naechsten liegt (innerhalb maxDist). */
export function nearestWall(
  level: Level,
  point: Point,
  maxDist = 40,
): { wall: Wall; offsetCm: Cm; dist: number; point: Point } | null {
  let best: { wall: Wall; offsetCm: Cm; dist: number; point: Point } | null = null;
  let bestDist = maxDist;
  for (const wall of level.walls) {
    const off = offsetAlongWall(wall, point);
    const p = pointAlongWall(wall, off);
    const d = dist(p, point);
    if (d < bestDist) {
      bestDist = d;
      best = { wall, offsetCm: off, dist: d, point: p };
    }
  }
  return best;
}

// --- Serialisierung ----------------------------------------------------

export function serialize(project: Project): string {
  return JSON.stringify({ ...project, version: FILE_VERSION }, null, 2);
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const pt = (p: any): Point => ({ x: num(p?.x, 0), y: num(p?.y, 0) });

/**
 * Liest ein Projekt aus JSON. Fremde oder beschaedigte Felder werden auf
 * Standardwerte gezogen, statt die App mit einem kaputten State zu starten.
 */
export function deserialize(json: string | unknown): Project {
  const raw: any = typeof json === 'string' ? JSON.parse(json) : json;
  if (!raw || typeof raw !== 'object') throw new Error('Datei enthält kein Projekt.');
  const levels = Array.isArray(raw.levels) && raw.levels.length ? raw.levels : [createLevel()];

  // Version 1 kannte keine Höhenlage: Geschosse liegen dann übereinander,
  // jeweils um Raumhöhe plus Decke versetzt.
  let nextElevation = 0;
  const parsedLevels = levels.map((lvl: any): Level => {
      const walls: Wall[] = (Array.isArray(lvl.walls) ? lvl.walls : []).map((w: any) => {
        const wall: Wall = {
          id: w.id || newId('w'),
          a: pt(w.a),
          b: pt(w.b),
          thicknessCm: num(w.thicknessCm, DEFAULTS.wallThicknessCm),
          heightCm: num(w.heightCm, DEFAULTS.wallHeightCm),
        };
        if (typeof w.typeId === 'string' && wallType(w.typeId)) wall.typeId = w.typeId;
        if (w.flip === true) wall.flip = true;
        return wall;
      });
      const wallIds = new Set(walls.map((w) => w.id));
      const heightCm = num(lvl.heightCm, DEFAULTS.wallHeightCm);
      const slabCm = num(lvl.slabCm, DEFAULTS.slabCm);
      const elevationCm = num(lvl.elevationCm, nextElevation);
      nextElevation = elevationCm + heightCm + slabCm;
      return {
        id: lvl.id || newId('lvl'),
        name: typeof lvl.name === 'string' ? lvl.name : 'Ebene',
        heightCm,
        elevationCm,
        slabCm,
        walls,
        // Oeffnungen ohne zugehoerige Wand wuerden beim Rendern ins Leere zeigen.
        openings: (Array.isArray(lvl.openings) ? lvl.openings : [])
          .filter((o: any) => wallIds.has(o.wallId))
          .map((o: any) => ({
            id: o.id || newId('op'),
            wallId: o.wallId,
            offsetCm: num(o.offsetCm, 0),
            widthCm: num(o.widthCm, DEFAULTS.doorWidthCm),
            heightCm: num(o.heightCm, DEFAULTS.doorHeightCm),
            sillCm: num(o.sillCm, 0),
            type: o.type === 'window' ? 'window' : 'door',
            swing: o.swing === -1 ? -1 : 1,
          })),
        furniture: (Array.isArray(lvl.furniture) ? lvl.furniture : []).map((f: any) => {
          const cat = catalogItem(f.catalogId);
          return {
            id: f.id || newId('f'),
            catalogId: f.catalogId || 'box',
            label: typeof f.label === 'string' ? f.label : cat?.label || 'Objekt',
            x: num(f.x, 0),
            y: num(f.y, 0),
            widthCm: num(f.widthCm, cat?.w ?? 100),
            depthCm: num(f.depthCm, cat?.d ?? 100),
            heightCm: num(f.heightCm, cat?.h ?? 100),
            rotationDeg: num(f.rotationDeg, 0),
            color: typeof f.color === 'string' ? f.color : cat?.color || '#a0a0a0',
          };
        }),
        labels: Array.isArray(lvl.labels)
          ? lvl.labels.map((l: any) => ({
              id: l.id || newId('lb'),
              x: num(l.x, 0),
              y: num(l.y, 0),
              text: typeof l.text === 'string' ? l.text : '',
            }))
          : [],
        stairs: (Array.isArray(lvl.stairs) ? lvl.stairs : []).map((st: any) => ({
          id: st.id || newId('st'),
          kind: st.kind === 'l' || st.kind === 'u' ? st.kind : 'gerade',
          x: num(st.x, 0),
          y: num(st.y, 0),
          rotationDeg: num(st.rotationDeg, 0),
          widthCm: num(st.widthCm, DEFAULTS.stairWidthCm),
          treadCm: num(st.treadCm, 0),
          turn: st.turn === -1 ? -1 : 1,
          splitAt: Math.max(0, Math.round(num(st.splitAt, 0))),
        })),
        dimensions: (Array.isArray(lvl.dimensions) ? lvl.dimensions : []).map((d: any) => ({
          id: d.id || newId('dm'),
          a: pt(d.a),
          b: pt(d.b),
          offsetCm: num(d.offsetCm, 50),
        })),
        rooms: (Array.isArray(lvl.rooms) ? lvl.rooms : []).map((r: any) => ({
          id: r.id || newId('rs'),
          x: num(r.x, 0),
          y: num(r.y, 0),
          name: typeof r.name === 'string' ? r.name : 'Raum',
          usage: r.usage === 'aussen' || r.usage === 'nutz' ? r.usage : 'wohnen',
          floor: typeof r.floor === 'string' ? r.floor : '',
        })),
      };
    });

  const levelIds = new Set(parsedLevels.map((l: Level) => l.id));
  const rr: any = raw.roof && typeof raw.roof === 'object' ? raw.roof : {};
  const fallbackRoof = defaultRoof(parsedLevels[parsedLevels.length - 1].id);
  const roof: Roof = {
    kind: ['sattel', 'pult', 'walm', 'flach'].includes(rr.kind) ? rr.kind : 'keins',
    levelId: levelIds.has(rr.levelId) ? rr.levelId : fallbackRoof.levelId,
    pitchDeg: num(rr.pitchDeg, fallbackRoof.pitchDeg),
    overhangCm: num(rr.overhangCm, fallbackRoof.overhangCm),
    kneeWallCm: num(rr.kneeWallCm, fallbackRoof.kneeWallCm),
    thicknessCm: num(rr.thicknessCm, fallbackRoof.thicknessCm),
    ridgeAlongX: rr.ridgeAlongX !== false,
    highSidePositive: rr.highSidePositive !== false,
  };
  const mm: any = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  return {
    version: FILE_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'Importiertes Projekt',
    gridCm: num(raw.gridCm, 10),
    levels: parsedLevels,
    roof,
    meta: {
      bauherr: str(mm.bauherr),
      adresse: str(mm.adresse),
      planverfasser: str(mm.planverfasser),
      planNummer: str(mm.planNummer),
      nordDeg: num(mm.nordDeg, 0),
    },
  };
}
