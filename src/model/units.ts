// Alle Plankoordinaten sind Zentimeter. Der Canvas rechnet erst beim Zeichnen
// in Pixel um, damit der Massstab an genau einer Stelle definiert ist.

import type { Cm, Px, Point, Rad, View } from './types.ts';

export const CM_PER_M = 100;

/** Plan-cm -> Bildschirm-Pixel */
export function cmToPx(cm: Cm, zoom: number): Px {
  return cm * zoom;
}

/** Bildschirm-Pixel -> Plan-cm */
export function pxToCm(px: Px, zoom: number): Cm {
  return px / zoom;
}

/** Weltpunkt (cm) -> Canvas-Punkt (px), inkl. Pan */
export function worldToScreen(p: Point, view: View): { x: Px; y: Px } {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}

/** Canvas-Punkt (px) -> Weltpunkt (cm) */
export function screenToWorld(p: { x: Px; y: Px }, view: View): Point {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom };
}

/** Laenge menschenlesbar: unter 1 m in cm, darueber in m mit zwei Nachkommastellen. */
export function formatLength(cm: Cm): string {
  const v = Math.abs(cm);
  if (v < CM_PER_M) return `${Math.round(cm)} cm`;
  return `${(cm / CM_PER_M).toFixed(2).replace('.', ',')} m`;
}

/** Flaeche in m2 aus einer Flaeche in cm2. */
export function formatArea(cm2: number): string {
  return `${(cm2 / (CM_PER_M * CM_PER_M)).toFixed(2).replace('.', ',')} m²`;
}

export function formatAngle(rad: Rad): string {
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return `${deg.toFixed(1).replace('.', ',')}°`;
}

/** Auf ein Vielfaches runden (Raster-Snapping). step <= 0 schaltet das Snapping ab. */
export function snap(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}
