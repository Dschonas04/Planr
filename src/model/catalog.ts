// Moebelkatalog. Alle Masse in Zentimetern und an handelsueblichen Groessen
// orientiert -- w = Breite, d = Tiefe, h = Hoehe.
// "shape" steuert nur die Darstellung: rect, round oder bed.

import type { CatalogItem } from './types.ts';

export interface Category {
  id: string;
  label: string;
}

export const CATEGORIES: Category[] = [
  { id: 'schlafen', label: 'Schlafen' },
  { id: 'wohnen', label: 'Wohnen' },
  { id: 'essen', label: 'Essen' },
  { id: 'arbeiten', label: 'Arbeiten' },
  { id: 'kueche', label: 'Küche' },
  { id: 'bad', label: 'Bad' },
  { id: 'stauraum', label: 'Stauraum' },
  { id: 'sonstiges', label: 'Sonstiges' },
];

export const CATALOG: CatalogItem[] = [
  // --- Schlafen ---
  { id: 'bed-90', cat: 'schlafen', label: 'Einzelbett 90×200', w: 90, d: 200, h: 50, shape: 'bed', color: '#8fa6c4' },
  { id: 'bed-140', cat: 'schlafen', label: 'Bett 140×200', w: 140, d: 200, h: 50, shape: 'bed', color: '#8fa6c4' },
  { id: 'bed-160', cat: 'schlafen', label: 'Bett 160×200', w: 160, d: 200, h: 50, shape: 'bed', color: '#8fa6c4' },
  { id: 'bed-180', cat: 'schlafen', label: 'Bett 180×200', w: 180, d: 200, h: 50, shape: 'bed', color: '#8fa6c4' },
  { id: 'nightstand', cat: 'schlafen', label: 'Nachttisch', w: 45, d: 40, h: 55, shape: 'rect', color: '#b39b7d' },

  // --- Wohnen ---
  { id: 'sofa-2', cat: 'wohnen', label: 'Sofa 2-Sitzer', w: 160, d: 90, h: 85, shape: 'rect', color: '#7fa88a' },
  { id: 'sofa-3', cat: 'wohnen', label: 'Sofa 3-Sitzer', w: 210, d: 95, h: 85, shape: 'rect', color: '#7fa88a' },
  { id: 'sofa-corner', cat: 'wohnen', label: 'Ecksofa', w: 260, d: 200, h: 85, shape: 'rect', color: '#7fa88a' },
  { id: 'armchair', cat: 'wohnen', label: 'Sessel', w: 80, d: 85, h: 85, shape: 'rect', color: '#7fa88a' },
  { id: 'coffeetable', cat: 'wohnen', label: 'Couchtisch', w: 110, d: 60, h: 45, shape: 'rect', color: '#b39b7d' },
  { id: 'tvboard', cat: 'wohnen', label: 'TV-Board', w: 160, d: 40, h: 45, shape: 'rect', color: '#8a8a8a' },
  { id: 'rug-200', cat: 'wohnen', label: 'Teppich 200×300', w: 200, d: 300, h: 1, shape: 'rect', color: '#d8c9b0' },
  { id: 'plant', cat: 'wohnen', label: 'Zimmerpflanze', w: 50, d: 50, h: 140, shape: 'round', color: '#6f9c5f' },

  // --- Essen ---
  { id: 'table-160', cat: 'essen', label: 'Esstisch 160×90', w: 160, d: 90, h: 75, shape: 'rect', color: '#b39b7d' },
  { id: 'table-200', cat: 'essen', label: 'Esstisch 200×100', w: 200, d: 100, h: 75, shape: 'rect', color: '#b39b7d' },
  { id: 'table-round', cat: 'essen', label: 'Tisch rund Ø120', w: 120, d: 120, h: 75, shape: 'round', color: '#b39b7d' },
  { id: 'chair', cat: 'essen', label: 'Stuhl', w: 45, d: 50, h: 90, shape: 'rect', color: '#a58868' },
  { id: 'sideboard', cat: 'essen', label: 'Sideboard', w: 180, d: 45, h: 80, shape: 'rect', color: '#b39b7d' },

  // --- Arbeiten ---
  { id: 'desk-140', cat: 'arbeiten', label: 'Schreibtisch 140×70', w: 140, d: 70, h: 75, shape: 'rect', color: '#9a8fb5' },
  { id: 'desk-180', cat: 'arbeiten', label: 'Schreibtisch 180×80', w: 180, d: 80, h: 75, shape: 'rect', color: '#9a8fb5' },
  { id: 'officechair', cat: 'arbeiten', label: 'Bürostuhl', w: 60, d: 60, h: 110, shape: 'round', color: '#6f6f6f' },
  { id: 'shelf-80', cat: 'arbeiten', label: 'Regal 80×30', w: 80, d: 30, h: 180, shape: 'rect', color: '#b39b7d' },

  // --- Kueche ---
  { id: 'kitchen-60', cat: 'kueche', label: 'Unterschrank 60', w: 60, d: 60, h: 90, shape: 'rect', color: '#c2c2c2' },
  { id: 'kitchen-100', cat: 'kueche', label: 'Unterschrank 100', w: 100, d: 60, h: 90, shape: 'rect', color: '#c2c2c2' },
  { id: 'sink', cat: 'kueche', label: 'Spüle', w: 80, d: 60, h: 90, shape: 'rect', color: '#a9c3d1' },
  { id: 'stove', cat: 'kueche', label: 'Herd', w: 60, d: 60, h: 90, shape: 'rect', color: '#8a8a8a' },
  { id: 'fridge', cat: 'kueche', label: 'Kühlschrank', w: 60, d: 65, h: 185, shape: 'rect', color: '#d5d5d5' },
  { id: 'dishwasher', cat: 'kueche', label: 'Geschirrspüler', w: 60, d: 60, h: 85, shape: 'rect', color: '#d5d5d5' },
  { id: 'kitchen-island', cat: 'kueche', label: 'Kücheninsel', w: 180, d: 90, h: 90, shape: 'rect', color: '#c2c2c2' },

  // --- Bad ---
  { id: 'wc', cat: 'bad', label: 'WC', w: 40, d: 70, h: 80, shape: 'rect', color: '#e2e8ec' },
  { id: 'basin', cat: 'bad', label: 'Waschbecken', w: 60, d: 50, h: 85, shape: 'rect', color: '#e2e8ec' },
  { id: 'basin-double', cat: 'bad', label: 'Doppelwaschbecken', w: 120, d: 50, h: 85, shape: 'rect', color: '#e2e8ec' },
  { id: 'shower-90', cat: 'bad', label: 'Dusche 90×90', w: 90, d: 90, h: 200, shape: 'rect', color: '#c8dbe6' },
  { id: 'bathtub', cat: 'bad', label: 'Badewanne 170×75', w: 170, d: 75, h: 55, shape: 'rect', color: '#c8dbe6' },
  { id: 'washer', cat: 'bad', label: 'Waschmaschine', w: 60, d: 60, h: 85, shape: 'rect', color: '#d5d5d5' },

  // --- Stauraum ---
  { id: 'wardrobe-100', cat: 'stauraum', label: 'Schrank 100×60', w: 100, d: 60, h: 200, shape: 'rect', color: '#b39b7d' },
  { id: 'wardrobe-200', cat: 'stauraum', label: 'Kleiderschrank 200×60', w: 200, d: 60, h: 220, shape: 'rect', color: '#b39b7d' },
  { id: 'dresser', cat: 'stauraum', label: 'Kommode 120×45', w: 120, d: 45, h: 85, shape: 'rect', color: '#b39b7d' },
  { id: 'shoerack', cat: 'stauraum', label: 'Schuhschrank', w: 90, d: 35, h: 110, shape: 'rect', color: '#b39b7d' },

  // --- Sonstiges ---
  { id: 'stairs', cat: 'sonstiges', label: 'Treppe', w: 100, d: 250, h: 250, shape: 'rect', color: '#9c9c9c' },
  { id: 'radiator', cat: 'sonstiges', label: 'Heizkörper', w: 120, d: 10, h: 60, shape: 'rect', color: '#d9d9d9' },
  { id: 'box', cat: 'sonstiges', label: 'Freies Rechteck', w: 100, d: 100, h: 100, shape: 'rect', color: '#a0a0a0' },
];

const byId = new Map<string, CatalogItem>(CATALOG.map((c) => [c.id, c]));

export function catalogItem(id: string): CatalogItem | null {
  return byId.get(id) || null;
}

export function catalogByCategory(catId: string): CatalogItem[] {
  return CATALOG.filter((c) => c.cat === catId);
}
