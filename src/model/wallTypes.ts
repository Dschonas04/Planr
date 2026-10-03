// Wandaufbauten mit Schichtfolge und Wärmeschutz.
//
// Jede Schicht hat eine Dicke und eine Wärmeleitfähigkeit λ. Daraus ergibt
// sich der U-Wert nach DIN EN ISO 6946: U = 1 / (Rsi + Σ d/λ + Rse).
// Die Schichten stehen von außen nach innen; bei Innenwänden ist die
// Reihenfolge gleichgültig.

import type { Cm } from './types.ts';

export type Material = 'putz' | 'mauerwerk' | 'ziegel' | 'kalksandstein' | 'beton' | 'daemmung' | 'holz' | 'gipskarton' | 'luft';

export interface Layer {
  material: Material;
  label: string;
  thicknessCm: Cm;
  /** Wärmeleitfähigkeit in W/(m·K). */
  lambda: number;
}

export interface WallType {
  id: string;
  label: string;
  /** Außenwand: bekommt Rse = 0,04 und wird mit der GEG-Referenz verglichen. */
  exterior: boolean;
  /** Tragende Wand -- nur zur Beschriftung und für die Plandarstellung. */
  loadBearing: boolean;
  layers: Layer[];
}

const putzAussen = (d = 2): Layer => ({ material: 'putz', label: 'Außenputz', thicknessCm: d, lambda: 0.87 });
const putzInnen = (d = 1.5): Layer => ({ material: 'putz', label: 'Innenputz', thicknessCm: d, lambda: 0.51 });

export const WALL_TYPES: WallType[] = [
  {
    id: 'aw-ziegel-365',
    label: 'Außenwand Ziegel 36,5 monolithisch',
    exterior: true,
    loadBearing: true,
    layers: [
      { material: 'putz', label: 'Leichtputz', thicknessCm: 2, lambda: 0.25 },
      { material: 'ziegel', label: 'Hochlochziegel, gefüllt', thicknessCm: 36.5, lambda: 0.08 },
      putzInnen(),
    ],
  },
  {
    id: 'aw-ziegel-425',
    label: 'Außenwand Ziegel 42,5 monolithisch',
    exterior: true,
    loadBearing: true,
    layers: [
      { material: 'putz', label: 'Leichtputz', thicknessCm: 2, lambda: 0.25 },
      { material: 'ziegel', label: 'Hochlochziegel, gefüllt', thicknessCm: 42.5, lambda: 0.075 },
      putzInnen(),
    ],
  },
  {
    id: 'aw-ks-wdvs',
    label: 'Außenwand KS 17,5 + WDVS 16',
    exterior: true,
    loadBearing: true,
    layers: [
      putzAussen(1),
      { material: 'daemmung', label: 'WDVS Mineralwolle WLG 035', thicknessCm: 16, lambda: 0.035 },
      { material: 'kalksandstein', label: 'Kalksandstein', thicknessCm: 17.5, lambda: 0.99 },
      putzInnen(),
    ],
  },
  {
    id: 'aw-holzrahmen',
    label: 'Außenwand Holzrahmenbau',
    exterior: true,
    loadBearing: true,
    layers: [
      putzAussen(1),
      { material: 'daemmung', label: 'Holzfaserdämmplatte', thicknessCm: 6, lambda: 0.045 },
      { material: 'holz', label: 'Ständer 6/24 + Zellulose', thicknessCm: 24, lambda: 0.048 },
      { material: 'holz', label: 'OSB 15 mm', thicknessCm: 1.5, lambda: 0.13 },
      { material: 'gipskarton', label: 'Gipskarton', thicknessCm: 1.25, lambda: 0.25 },
    ],
  },
  {
    id: 'kw-beton',
    label: 'Kelleraußenwand WU-Beton 30 + Perimeter 12',
    exterior: true,
    loadBearing: true,
    layers: [
      { material: 'daemmung', label: 'Perimeterdämmung XPS', thicknessCm: 12, lambda: 0.035 },
      { material: 'beton', label: 'WU-Stahlbeton', thicknessCm: 30, lambda: 2.3 },
    ],
  },
  {
    id: 'iw-ks-175',
    label: 'Innenwand tragend KS 17,5',
    exterior: false,
    loadBearing: true,
    layers: [putzInnen(), { material: 'kalksandstein', label: 'Kalksandstein', thicknessCm: 17.5, lambda: 0.99 }, putzInnen()],
  },
  {
    id: 'iw-mw-115',
    label: 'Innenwand Mauerwerk 11,5',
    exterior: false,
    loadBearing: false,
    layers: [putzInnen(), { material: 'mauerwerk', label: 'Mauerwerk', thicknessCm: 11.5, lambda: 0.5 }, putzInnen()],
  },
  {
    id: 'iw-trockenbau-125',
    label: 'Trockenbauwand 12,5',
    exterior: false,
    loadBearing: false,
    layers: [
      { material: 'gipskarton', label: 'Gipskarton', thicknessCm: 1.25, lambda: 0.25 },
      { material: 'daemmung', label: 'Metallständer CW 100 + Mineralwolle', thicknessCm: 10, lambda: 0.04 },
      { material: 'gipskarton', label: 'Gipskarton', thicknessCm: 1.25, lambda: 0.25 },
    ],
  },
];

/** Referenzwert des GEG-Referenzgebäudes für Außenwände gegen Außenluft. */
export const GEG_U_AUSSENWAND = 0.28;

export function wallType(id: string | undefined): WallType | undefined {
  return id ? WALL_TYPES.find((t) => t.id === id) : undefined;
}

export function typeThickness(t: WallType): Cm {
  return Math.round(t.layers.reduce((s, l) => s + l.thicknessCm, 0) * 100) / 100;
}

/**
 * U-Wert in W/(m²·K). Innenwände rechnen beidseitig mit Rsi = 0,13, weil sie
 * nicht an Außenluft grenzen.
 */
export function uValue(t: WallType): number {
  const rsi = 0.13;
  const rse = t.exterior ? 0.04 : 0.13;
  const r = t.layers.reduce((s, l) => s + l.thicknessCm / 100 / l.lambda, 0);
  return 1 / (rsi + r + rse);
}

/**
 * Schichten einer Wand. Eine Wand ohne Aufbau ist ein einziger Mauerwerkskörper
 * in ihrer Dicke -- so sehen alte Pläne genauso aus wie vorher.
 */
export function wallLayers(wall: { typeId?: string; thicknessCm: Cm }): Layer[] {
  const t = wallType(wall.typeId);
  if (t) return t.layers;
  return [{ material: 'mauerwerk', label: 'Mauerwerk', thicknessCm: wall.thicknessCm, lambda: 0.5 }];
}
