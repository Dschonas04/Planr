// Treppen nach DIN 18065.
//
// Vorgegeben werden Lage, Form, Laufbreite und der gewünschte Auftritt. Die
// Steigungszahl folgt aus der zu überwindenden Höhe: so viele Steigungen, dass
// jede möglichst nahe an 17,5 cm liegt. Den Auftritt schlägt die
// Schrittmaßregel 2s + a = 63 cm vor, solange niemand einen eigenen vorgibt.
//
// Gerechnet wird in einem lokalen System der Treppe: u läuft in Richtung des
// ersten Laufs, v quer dazu. Der Ursprung liegt mittig an der Vorderkante der
// Antrittsstufe.

import { rotate } from './geometry.ts';
import type { Cm, Point, Stair } from './types.ts';

export const STAIR_LIMITS = {
  riserMin: 14,
  riserMax: 20,
  treadMin: 23,
  treadMax: 37,
  widthMin: 80,
  stepRuleMin: 59,
  stepRuleMax: 65,
  /** Lichte Weite zwischen den Läufen einer U-Treppe (Treppenauge). */
  eyeCm: 10,
};

export interface StairCalc {
  risers: number;
  riserCm: Cm;
  treads: number;
  treadCm: Cm;
  /** 2s + a */
  stepRuleCm: Cm;
  /** Stufen im ersten Lauf (bei L und U), sonst alle. */
  firstRun: number;
  warnings: string[];
}

export function stairCalc(stair: Stair, riseCm: Cm): StairCalc {
  const rise = Math.max(riseCm, 20);
  let risers = Math.max(2, Math.round(rise / 17.5));
  // In die zulässige Spanne ziehen, falls die Rundung herausfällt.
  while (rise / risers > STAIR_LIMITS.riserMax) risers++;
  while (risers > 2 && rise / risers < STAIR_LIMITS.riserMin) risers--;
  const riserCm = rise / risers;
  const treadCm = stair.treadCm > 0 ? stair.treadCm : Math.round((63 - 2 * riserCm) * 10) / 10;
  const treads = risers - 1;
  const stepRuleCm = 2 * riserCm + treadCm;

  let firstRun = treads;
  if (stair.kind !== 'gerade') {
    // Ein Podest zählt als Stufe; die übrigen verteilen sich auf zwei Läufe.
    const rest = treads - 1;
    firstRun = stair.splitAt > 0 ? Math.min(Math.max(1, stair.splitAt), rest) : Math.ceil(rest / 2);
  }

  const warnings: string[] = [];
  const f = (v: number) => v.toFixed(1).replace('.', ',');
  if (riserCm < STAIR_LIMITS.riserMin || riserCm > STAIR_LIMITS.riserMax) {
    warnings.push(`Steigung ${f(riserCm)} cm liegt außerhalb 14–20 cm (DIN 18065).`);
  }
  if (treadCm < STAIR_LIMITS.treadMin || treadCm > STAIR_LIMITS.treadMax) {
    warnings.push(`Auftritt ${f(treadCm)} cm liegt außerhalb 23–37 cm (DIN 18065).`);
  }
  if (stair.widthCm < STAIR_LIMITS.widthMin) {
    warnings.push(`Laufbreite ${f(stair.widthCm)} cm ist schmaler als 80 cm.`);
  }
  if (stepRuleCm < STAIR_LIMITS.stepRuleMin || stepRuleCm > STAIR_LIMITS.stepRuleMax) {
    warnings.push(`Schrittmaß 2s+a = ${f(stepRuleCm)} cm, bequem sind 59–65 cm.`);
  }
  return { risers, riserCm, treads, treadCm, stepRuleCm, firstRun, warnings };
}

export interface StairTread {
  /** Vier Eckpunkte in Weltkoordinaten. */
  points: Point[];
  /** Oberkante der Stufe über OKFF des Geschosses. */
  topCm: Cm;
  landing: boolean;
}

export interface StairGeometry {
  calc: StairCalc;
  treads: StairTread[];
  /** Grundriss der ganzen Treppe -- daraus wird die Deckenöffnung. */
  outline: Point[];
  /** Lauflinie vom Antritt bis zum Austritt. */
  walkline: Point[];
}

type Local = [number, number];

export function stairGeometry(stair: Stair, riseCm: Cm): StairGeometry {
  const calc = stairCalc(stair, riseCm);
  const a = calc.treadCm;
  const w = stair.widthCm;
  const h = calc.riserCm;
  // Quer zur Laufrichtung: v > 0 liegt im Plan rechts von der Laufrichtung
  // (y zeigt nach unten). Eine Linkstreppe dreht deshalb zu negativem v.
  const s = stair.turn === 1 ? -1 : 1;
  const rad = (stair.rotationDeg * Math.PI) / 180;
  const origin = { x: stair.x, y: stair.y };
  const toWorld = ([u, v]: Local): Point => rotate({ x: origin.x + u, y: origin.y + v }, rad, origin);
  const rect = (u0: number, u1: number, v0: number, v1: number): Point[] =>
    ([[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Local[]).map(toWorld);

  const treads: StairTread[] = [];
  let outline: Local[];
  let walk: Local[];
  const k = calc.firstRun;

  if (stair.kind === 'gerade') {
    for (let i = 0; i < calc.treads; i++) {
      treads.push({ points: rect(i * a, (i + 1) * a, -w / 2, w / 2), topCm: (i + 1) * h, landing: false });
    }
    const l = calc.treads * a;
    outline = [[0, -w / 2], [l, -w / 2], [l, w / 2], [0, w / 2]];
    walk = [[0, 0], [l, 0]];
  } else if (stair.kind === 'l') {
    for (let i = 0; i < k; i++) {
      treads.push({ points: rect(i * a, (i + 1) * a, -w / 2, w / 2), topCm: (i + 1) * h, landing: false });
    }
    const u0 = k * a;
    treads.push({ points: rect(u0, u0 + w, -w / 2, w / 2), topCm: (k + 1) * h, landing: true });
    const second = calc.treads - k - 1;
    for (let j = 0; j < second; j++) {
      const v0 = w / 2 + j * a;
      const v1 = w / 2 + (j + 1) * a;
      treads.push({
        points: rect(u0, u0 + w, s * v0, s * v1),
        topCm: (k + 2 + j) * h,
        landing: false,
      });
    }
    const l2 = w / 2 + second * a;
    outline = [[0, -s * w / 2], [u0 + w, -s * w / 2], [u0 + w, s * l2], [u0, s * l2], [u0, s * w / 2], [0, s * w / 2]];
    walk = [[0, 0], [u0 + w / 2, 0], [u0 + w / 2, s * l2]];
  } else {
    const eye = STAIR_LIMITS.eyeCm;
    for (let i = 0; i < k; i++) {
      treads.push({ points: rect(i * a, (i + 1) * a, -w / 2, w / 2), topCm: (i + 1) * h, landing: false });
    }
    const u0 = k * a;
    const vFar = w / 2 + eye + w;
    treads.push({ points: rect(u0, u0 + w, -s * w / 2, s * vFar), topCm: (k + 1) * h, landing: true });
    const second = calc.treads - k - 1;
    for (let j = 0; j < second; j++) {
      treads.push({
        points: rect(u0 - (j + 1) * a, u0 - j * a, s * (w / 2 + eye), s * vFar),
        topCm: (k + 2 + j) * h,
        landing: false,
      });
    }
    const uMin = Math.min(0, u0 - second * a);
    outline = [[uMin, -s * w / 2], [u0 + w, -s * w / 2], [u0 + w, s * vFar], [uMin, s * vFar]];
    const vMid2 = s * (w / 2 + eye + w / 2);
    walk = [[0, 0], [u0 + w / 2, 0], [u0 + w / 2, vMid2], [u0 - second * a, vMid2]];
  }

  return { calc, treads, outline: outline.map(toWorld), walkline: walk.map(toWorld) };
}
