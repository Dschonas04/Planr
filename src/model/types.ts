/**
 * Die Typen des Grundrissmodells.
 *
 * Der Grund für den Wechsel auf TypeScript ist genau hier zu sehen: Planr
 * rechnet mit Zentimetern, Pixeln, Grad und Bogenmaß gleichzeitig. In
 * JavaScript sind das alles `number` und damit verwechselbar — ein Winkel in
 * Grad, wo Bogenmaß erwartet wird, fällt erst im schiefen Bild auf.
 *
 * Die Einheitentypen unten sind sogenannte Branded Types: zur Laufzeit bleiben
 * es gewöhnliche Zahlen ohne jeden Aufwand, beim Übersetzen sind sie aber
 * unterscheidbar.
 */

declare const einheit: unique symbol;

/** Zentimeter — die Einheit des gesamten Modells. */
export type Cm = number & { readonly [einheit]?: 'cm' };
/** Bildschirmpixel. */
export type Px = number & { readonly [einheit]?: 'px' };
/** Winkel im Bogenmaß. */
export type Rad = number & { readonly [einheit]?: 'rad' };
/** Winkel in Grad — so werden Möbeldrehungen gespeichert. */
export type Deg = number & { readonly [einheit]?: 'deg' };

export interface Point {
  x: Cm;
  y: Cm;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  thicknessCm: Cm;
  heightCm: Cm;
}

export type OpeningType = 'door' | 'window';

export interface Opening {
  id: string;
  wallId: string;
  /** Abstand entlang der Wandmittellinie, von Punkt a aus. */
  offsetCm: Cm;
  widthCm: Cm;
  heightCm: Cm;
  /** Brüstungshöhe; bei Türen 0. */
  sillCm: Cm;
  type: OpeningType;
  /** Anschlagsrichtung: 1 oder -1. */
  swing: 1 | -1;
}

export interface Furniture {
  id: string;
  catalogId: string;
  label: string;
  /** Mittelpunkt. */
  x: Cm;
  y: Cm;
  widthCm: Cm;
  depthCm: Cm;
  heightCm: Cm;
  rotationDeg: Deg;
  color: string;
}

export interface Label {
  id: string;
  x: Cm;
  y: Cm;
  text: string;
}

export interface Level {
  id: string;
  name: string;
  heightCm: Cm;
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  labels: Label[];
}

export interface Project {
  version: number;
  name: string;
  gridCm: Cm;
  levels: Level[];
}

export interface Room {
  points: Point[];
  /** Vorzeichenbehaftete Fläche in cm²; das Vorzeichen zeigt den Umlaufsinn. */
  area: number;
}

export interface Segment {
  a: Point;
  b: Point;
}

/** Ein massives Wandstück zwischen den Öffnungen. */
export interface WallSolid {
  from: Cm;
  to: Cm;
  bottom: Cm;
  top: Cm;
}

/** Ansichtsfenster: Maßstab und Verschiebung. */
export interface View {
  zoom: number;
  panX: Px;
  panY: Px;
}

export interface CatalogItem {
  id: string;
  cat: string;
  label: string;
  w: Cm;
  d: Cm;
  h: Cm;
  shape: 'rect' | 'round' | 'bed';
  color: string;
}
