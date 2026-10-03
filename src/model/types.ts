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
  /** Wandaufbau aus dem Katalog (wallTypes.ts); ohne Angabe ein einschaliges Mauerwerk. */
  typeId?: string;
  /**
   * Schichtfolge umdrehen. Planr legt die erste Schicht (außen) selbst auf die
   * Gebäudeaußenseite; nur wo das nicht eindeutig ist, hilft der Schalter.
   */
  flip?: boolean;
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

export type StairKind = 'gerade' | 'l' | 'u';

/**
 * Eine Treppe, die vom Geschoss, in dem sie steht, ins nächste führt.
 * Steigungszahl und Auftritt rechnet stairs.ts aus der Geschosshöhe; hier
 * stehen nur die Vorgaben.
 */
export interface Stair {
  id: string;
  kind: StairKind;
  /** Antrittspunkt: Mitte der Antrittsstufe, an der Vorderkante. */
  x: Cm;
  y: Cm;
  /** Laufrichtung des ersten Laufs in Grad, 0 = nach rechts (+x). */
  rotationDeg: Deg;
  /** Laufbreite. */
  widthCm: Cm;
  /** Gewünschter Auftritt; die Steigung folgt aus der Höhe. */
  treadCm: Cm;
  /** Bei L und U: Drehsinn des zweiten Laufs, 1 = links, -1 = rechts. */
  turn: 1 | -1;
  /** Bei L und U: Anzahl der Stufen im ersten Lauf; 0 = automatisch. */
  splitAt: number;
}

/** Eine gezeichnete Maßlinie zwischen zwei Punkten. */
export interface Dimension {
  id: string;
  a: Point;
  b: Point;
  /** Abstand der Maßlinie von der Strecke a–b, senkrecht, vorzeichenbehaftet. */
  offsetCm: Cm;
}

/**
 * Nutzung eines Raums für die Flächenberechnung nach WoFlV.
 * wohnen = voll anrechenbar, aussen = Balkon/Terrasse (25 %),
 * nutz = Keller, Technik, Garage (Nutzfläche, keine Wohnfläche).
 */
export type RoomUsage = 'wohnen' | 'aussen' | 'nutz';

/**
 * Raumstempel. Räume entstehen aus den Wänden und haben deshalb keine feste
 * Kennung; ein Stempel gibt dem Raum, in dem er liegt, Namen und Nutzung.
 */
export interface RoomStamp {
  id: string;
  x: Cm;
  y: Cm;
  name: string;
  usage: RoomUsage;
  floor: string;
}

export interface Level {
  id: string;
  name: string;
  /** Lichte Raumhöhe (Oberkante Fertigfußboden bis Unterkante Decke). */
  heightCm: Cm;
  /** Höhenlage OKFF bezogen auf ±0,00 (in der Regel EG-Fußboden). */
  elevationCm: Cm;
  /** Stärke der Decke über diesem Geschoss inkl. Fußbodenaufbau. */
  slabCm: Cm;
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  labels: Label[];
  stairs: Stair[];
  dimensions: Dimension[];
  rooms: RoomStamp[];
}

export type RoofKind = 'keins' | 'sattel' | 'pult' | 'walm' | 'flach';

export interface Roof {
  kind: RoofKind;
  /** Geschoss, auf dem das Dach sitzt (meist das Dachgeschoss). */
  levelId: string;
  pitchDeg: Deg;
  /** Dachüberstand an Traufe und Ortgang. */
  overhangCm: Cm;
  /** Kniestock: Höhe von OKFF bis Schnittpunkt Wandaußenseite/Dachoberkante. */
  kneeWallCm: Cm;
  /** Stärke des Dachaufbaus senkrecht zur Dachfläche. */
  thicknessCm: Cm;
  /** First parallel zur x-Achse (sonst zur y-Achse). Beim Pultdach: Hochseite. */
  ridgeAlongX: boolean;
  /** Pultdach: Hochseite auf der positiven Seite. */
  highSidePositive: boolean;
}

/** Angaben für den Plankopf. */
export interface ProjectMeta {
  bauherr: string;
  adresse: string;
  planverfasser: string;
  planNummer: string;
  /** Nordrichtung in Grad, 0 = Plan oben. */
  nordDeg: Deg;
}

export interface Project {
  version: number;
  name: string;
  gridCm: Cm;
  levels: Level[];
  roof: Roof;
  meta: ProjectMeta;
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
