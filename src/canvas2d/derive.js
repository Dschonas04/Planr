// Abgeleitete Geometrie eines Geschosses, einmal je Planstand gerechnet.
//
// Räume, Umriss, Wandanschlüsse und Dach hängen nur vom Projekt ab, nicht von
// Ansicht oder Auswahl. Der Bildschirm zeichnet bis zu 60-mal pro Sekunde --
// das hier rechnet er nur, wenn sich das Geschoss tatsächlich geändert hat.

import {
  exteriorSides,
  levelOutlines,
  levelRooms,
  riseFrom,
  roofModel,
  wallCaps,
} from '../model/building.ts';
import { stairGeometry } from '../model/stairs.ts';

const cache = new WeakMap();

export function deriveLevel(project, levelIndex) {
  const level = project.levels[levelIndex];
  const hit = cache.get(level);
  // Das Dach hängt am Projekt, nicht am Geschoss: bei einer Dachänderung
  // bleibt das Geschossobjekt gleich, das Projekt aber nicht.
  if (hit && hit.roofKey === project.roof && hit.levelsKey === project.levels.length) return hit;

  const outlines = levelOutlines(level);
  const rise = riseFrom(project, levelIndex);
  const roof = roofModel(project);
  const derived = {
    roofKey: project.roof,
    levelsKey: project.levels.length,
    rooms: levelRooms(level),
    outlines,
    sides: exteriorSides(level, outlines),
    caps: wallCaps(level),
    stairs: (level.stairs || []).map((s) => ({ stair: s, geo: stairGeometry(s, rise) })),
    roof: roof && roof.level.id === level.id ? roof : null,
    below: levelIndex > 0 ? project.levels[levelIndex - 1] : null,
    // Treppen aus dem Geschoss darunter enden hier in einer Deckenöffnung.
    arriving:
      levelIndex > 0
        ? (project.levels[levelIndex - 1].stairs || []).map((s) => stairGeometry(s, riseFrom(project, levelIndex - 1)))
        : [],
  };
  cache.set(level, derived);
  return derived;
}
