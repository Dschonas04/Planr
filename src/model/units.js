// Alle Plankoordinaten sind Zentimeter. Der Canvas rechnet erst beim Zeichnen
// in Pixel um, damit der Massstab an genau einer Stelle definiert ist.

export const CM_PER_M = 100;

/** Plan-cm -> Bildschirm-Pixel */
export function cmToPx(cm, zoom) {
  return cm * zoom;
}

/** Bildschirm-Pixel -> Plan-cm */
export function pxToCm(px, zoom) {
  return px / zoom;
}

/** Weltpunkt (cm) -> Canvas-Punkt (px), inkl. Pan */
export function worldToScreen(p, view) {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}

/** Canvas-Punkt (px) -> Weltpunkt (cm) */
export function screenToWorld(p, view) {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom };
}

/** Laenge menschenlesbar: unter 1 m in cm, darueber in m mit zwei Nachkommastellen. */
export function formatLength(cm) {
  const v = Math.abs(cm);
  if (v < CM_PER_M) return `${Math.round(cm)} cm`;
  return `${(cm / CM_PER_M).toFixed(2).replace('.', ',')} m`;
}

/** Flaeche in m2 aus einer Flaeche in cm2. */
export function formatArea(cm2) {
  return `${(cm2 / (CM_PER_M * CM_PER_M)).toFixed(2).replace('.', ',')} m²`;
}

export function formatAngle(rad) {
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return `${deg.toFixed(1).replace('.', ',')}°`;
}

/** Auf ein Vielfaches runden (Raster-Snapping). step <= 0 schaltet das Snapping ab. */
export function snap(value, step) {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}
