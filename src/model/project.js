// Projektmodell, Serialisierung und die Helfer, die Waende und Oeffnungen
// zusammenbringen. Einheit ueberall: Zentimeter, Winkel im Bogenmass.

import { add, angleOf, dist, len, normalize, scale, sub } from './geometry.js';
import { catalogItem } from './catalog.js';

export const FILE_VERSION = 1;

export const DEFAULTS = {
  wallThicknessCm: 24,
  innerWallThicknessCm: 11.5,
  wallHeightCm: 250,
  doorWidthCm: 90,
  doorHeightCm: 200,
  windowWidthCm: 120,
  windowHeightCm: 140,
  windowSillCm: 90,
};

let idCounter = 0;
export function newId(prefix = 'o') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function createLevel(name = 'Erdgeschoss') {
  return {
    id: newId('lvl'),
    name,
    heightCm: DEFAULTS.wallHeightCm,
    walls: [],
    openings: [],
    furniture: [],
    labels: [],
  };
}

export function createProject(name = 'Neues Projekt') {
  return {
    version: FILE_VERSION,
    name,
    gridCm: 10,
    levels: [createLevel()],
  };
}

/** Kleine Beispielwohnung, damit der Editor nicht leer startet. */
export function demoProject() {
  const project = createProject('Beispielwohnung');
  const level = project.levels[0];
  const t = DEFAULTS.wallThicknessCm;
  const ti = DEFAULTS.innerWallThicknessCm;

  const wall = (ax, ay, bx, by, thickness = t) => {
    const w = {
      id: newId('w'),
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      thicknessCm: thickness,
      heightCm: level.heightCm,
    };
    level.walls.push(w);
    return w;
  };

  // Aussenhuelle 900 x 600 cm
  const top = wall(0, 0, 900, 0);
  wall(900, 0, 900, 600);
  const bottom = wall(900, 600, 0, 600);
  const left = wall(0, 600, 0, 0);

  // Innenwaende: Flur trennt Wohnen (links) von Schlafen/Bad (rechts)
  const divider = wall(560, 0, 560, 600, ti);
  const bathWall = wall(560, 360, 900, 360, ti);

  level.openings.push(
    {
      id: newId('op'),
      wallId: bottom.id,
      offsetCm: 300,
      widthCm: 100,
      heightCm: DEFAULTS.doorHeightCm,
      sillCm: 0,
      type: 'door',
      swing: 1,
    },
    {
      id: newId('op'),
      wallId: top.id,
      offsetCm: 180,
      widthCm: 140,
      heightCm: DEFAULTS.windowHeightCm,
      sillCm: DEFAULTS.windowSillCm,
      type: 'window',
    },
    {
      id: newId('op'),
      wallId: top.id,
      offsetCm: 700,
      widthCm: 120,
      heightCm: DEFAULTS.windowHeightCm,
      sillCm: DEFAULTS.windowSillCm,
      type: 'window',
    },
    {
      id: newId('op'),
      wallId: left.id,
      offsetCm: 250,
      widthCm: 120,
      heightCm: DEFAULTS.windowHeightCm,
      sillCm: DEFAULTS.windowSillCm,
      type: 'window',
    },
    {
      id: newId('op'),
      wallId: divider.id,
      offsetCm: 120,
      widthCm: 90,
      heightCm: DEFAULTS.doorHeightCm,
      sillCm: 0,
      type: 'door',
      swing: 1,
    },
    {
      id: newId('op'),
      wallId: bathWall.id,
      offsetCm: 160,
      widthCm: 80,
      heightCm: DEFAULTS.doorHeightCm,
      sillCm: 0,
      type: 'door',
      swing: -1,
    },
  );

  const place = (catalogId, x, y, rotationDeg = 0) => {
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

  place('sofa-3', 200, 460, 0);
  place('coffeetable', 200, 350, 0);
  place('tvboard', 200, 40, 0);
  place('table-160', 400, 150, 0);
  place('chair', 400, 85, 0);
  place('chair', 400, 215, 180);
  place('bed-140', 740, 130, 0);
  place('wardrobe-200', 700, 320, 180);
  place('shower-90', 620, 420, 0);
  place('wc', 860, 420, 180);
  place('basin', 620, 560, 180);

  return project;
}

// --- Wand-Helfer -------------------------------------------------------

export function wallVector(wall) {
  return sub(wall.b, wall.a);
}

export function wallLength(wall) {
  return len(wallVector(wall));
}

export function wallAngle(wall) {
  return angleOf(wallVector(wall));
}

/** Weltposition eines Offsets entlang der Wandmittellinie. */
export function pointAlongWall(wall, offsetCm) {
  const dir = normalize(wallVector(wall));
  return add(wall.a, scale(dir, offsetCm));
}

/** Offset eines Weltpunkts entlang der Wand, begrenzt auf die Wandlaenge. */
export function offsetAlongWall(wall, point) {
  const v = wallVector(wall);
  const l = len(v);
  if (l < 1e-6) return 0;
  const dir = scale(v, 1 / l);
  const t = (point.x - wall.a.x) * dir.x + (point.y - wall.a.y) * dir.y;
  return Math.max(0, Math.min(l, t));
}

export function openingsOfWall(level, wallId) {
  return level.openings.filter((o) => o.wallId === wallId);
}

/**
 * Zerlegt eine Wand in die massiven Stuecke zwischen den Oeffnungen.
 * Rueckgabe je Stueck: Start-/End-Offset sowie Unter- und Oberkante --
 * daraus baut die 3D-Ansicht Bruestung und Sturz.
 */
export function wallSolids(wall, openings) {
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

  const solids = [];
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
export function nearestWall(level, point, maxDist = 40) {
  let best = null;
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

export function serialize(project) {
  return JSON.stringify({ ...project, version: FILE_VERSION }, null, 2);
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const pt = (p) => ({ x: num(p?.x, 0), y: num(p?.y, 0) });

/**
 * Liest ein Projekt aus JSON. Fremde oder beschaedigte Felder werden auf
 * Standardwerte gezogen, statt die App mit einem kaputten State zu starten.
 */
export function deserialize(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (!raw || typeof raw !== 'object') throw new Error('Datei enthält kein Projekt.');
  const levels = Array.isArray(raw.levels) && raw.levels.length ? raw.levels : [createLevel()];

  return {
    version: FILE_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'Importiertes Projekt',
    gridCm: num(raw.gridCm, 10),
    levels: levels.map((lvl) => {
      const walls = (Array.isArray(lvl.walls) ? lvl.walls : []).map((w) => ({
        id: w.id || newId('w'),
        a: pt(w.a),
        b: pt(w.b),
        thicknessCm: num(w.thicknessCm, DEFAULTS.wallThicknessCm),
        heightCm: num(w.heightCm, DEFAULTS.wallHeightCm),
      }));
      const wallIds = new Set(walls.map((w) => w.id));
      return {
        id: lvl.id || newId('lvl'),
        name: typeof lvl.name === 'string' ? lvl.name : 'Ebene',
        heightCm: num(lvl.heightCm, DEFAULTS.wallHeightCm),
        walls,
        // Oeffnungen ohne zugehoerige Wand wuerden beim Rendern ins Leere zeigen.
        openings: (Array.isArray(lvl.openings) ? lvl.openings : [])
          .filter((o) => wallIds.has(o.wallId))
          .map((o) => ({
            id: o.id || newId('op'),
            wallId: o.wallId,
            offsetCm: num(o.offsetCm, 0),
            widthCm: num(o.widthCm, DEFAULTS.doorWidthCm),
            heightCm: num(o.heightCm, DEFAULTS.doorHeightCm),
            sillCm: num(o.sillCm, 0),
            type: o.type === 'window' ? 'window' : 'door',
            swing: o.swing === -1 ? -1 : 1,
          })),
        furniture: (Array.isArray(lvl.furniture) ? lvl.furniture : []).map((f) => {
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
          ? lvl.labels.map((l) => ({
              id: l.id || newId('lb'),
              x: num(l.x, 0),
              y: num(l.y, 0),
              text: typeof l.text === 'string' ? l.text : '',
            }))
          : [],
      };
    }),
  };
}
