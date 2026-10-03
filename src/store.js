// Zentraler State ueber useSyncExternalStore -- kein Redux, keine Zustand-Lib.
// Undo/Redo betrifft nur das Projekt selbst; Ansicht, Werkzeug und Auswahl
// sind fluechtig und landen bewusst nicht in der History.

import { useSyncExternalStore } from 'react';
import { createProject, demoProject, deserialize, serialize } from './model/project.ts';

const STORAGE_KEY = 'planr.project.v1';
const HISTORY_LIMIT = 60;

function loadInitialProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return deserialize(raw);
  } catch (err) {
    console.warn('Gespeichertes Projekt nicht lesbar, starte mit Beispiel:', err);
  }
  return demoProject();
}

let state = {
  project: loadInitialProject(),
  activeLevel: 0,
  tool: 'select',
  pendingCatalogId: null,
  selection: null, // { kind: 'wall'|'furniture'|'opening', id }
  draft: null, // laufende Wandkette: { points: [{x,y}], preview: {x,y}|null }
  view: { zoom: 0.55, panX: 80, panY: 80 },
  settings: {
    snapEnabled: true,
    gridCm: 10,
    angleSnap: true,
    showGrid: true,
    showDimensions: false,
    showRooms: true,
    showFurniture: true,
    wallThicknessCm: 24,
    /** Aufbau für neue Wände; leer = einschalig in wallThicknessCm. */
    wallTypeId: 'aw-ziegel-365',
    /** Darunterliegendes Geschoss grau hinterlegen. */
    showUnderlay: true,
    /** Außenmaßketten automatisch. */
    showExteriorDims: true,
    /** Fenster- und Türmaße an den Öffnungen. */
    showOpeningLabels: true,
    /** Dachaufsicht und Linien der lichten Höhe im Dachgeschoss. */
    showRoof: true,
    /** 3D: nur das aktive Geschoss statt des ganzen Hauses. */
    only3dLevel: false,
  },
  /** Zahleneingabe beim Zeichnen: "450" oder "450;90" (Länge; Winkel). */
  numInput: '',
  /** Hilfslinien der Spurverfolgung: [{ axis: 'x'|'y', value, from }]. */
  guides: [],
  /** Bemaßungswerkzeug: { a, b, offset } während des Setzens. */
  dimDraft: null,
  flaechenOffen: false,
  pdfOffen: false,
  view3d: false,
  toast: null,
  // Konto und Server
  auth: null,
  anmeldungNoetig: false,
  serverProjekt: null, // { id, name, geteilt } -- null: nur in diesem Browser
  speicherstand: null, // 'geaendert' | 'speichert' | 'gespeichert' | 'fehler'
  nurLesen: false,
  geteilterName: null,
  projekteOffen: false,
  teilenOffen: false,
  kontoOffen: false,
  rechtlichesOffen: null,
};

let history = [];
let future = [];
const listeners = new Set();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

/** Flache Aenderung ohne History-Eintrag (Ansicht, Werkzeug, Auswahl ...). */
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  emit();
}

// serverSink meldet dem Abgleich (sync.js), dass sich das Projekt geaendert
// hat. Der Store kennt den Server nicht -- so bleibt die Abhaengigkeit
// einseitig.
let serverSink = null;
export function setServerSink(fn) {
  serverSink = fn;
}

let persistTimer = null;
function persist({ vomServer = false } = {}) {
  if (!vomServer && serverSink) serverSink();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(state.project));
    } catch (err) {
      console.warn('Autosave fehlgeschlagen:', err);
    }
  }, 400);
}

/**
 * Projektaenderung mit History. `mutator` bekommt eine tiefe Kopie und darf
 * sie frei veraendern -- so kann kein Reducer versehentlich den alten Stand
 * mutieren, den die History noch braucht.
 */
function nurLesenMelden() {
  toast('Nur ansehen: Dieser Grundriss lässt sich hier nicht ändern.');
}

export function commit(mutator, { merge = false } = {}) {
  if (state.nurLesen) {
    nurLesenMelden();
    return;
  }
  const snapshot = state.project;
  const draft = structuredClone(snapshot);
  const result = mutator(draft);
  if (result === false) return; // Mutator signalisiert "nichts geaendert"

  // merge fasst zusammengehoerende Schritte (z. B. ein Drag) zu einem
  // History-Eintrag zusammen, statt jeden Mausframe einzeln zu speichern.
  if (!merge || history.length === 0) {
    history.push(snapshot);
    if (history.length > HISTORY_LIMIT) history.shift();
  }
  future = [];
  state = { ...state, project: draft };
  persist();
  emit();
}

export function undo() {
  if (state.nurLesen || !history.length) return;
  future.push(state.project);
  const prev = history.pop();
  state = { ...state, project: prev, draft: null, selection: null };
  persist();
  emit();
}

export function redo() {
  if (state.nurLesen || !future.length) return;
  history.push(state.project);
  const next = future.pop();
  state = { ...state, project: next, draft: null, selection: null };
  persist();
  emit();
}

export function canUndo() {
  return history.length > 0;
}

export function canRedo() {
  return future.length > 0;
}

export function resetHistory() {
  history = [];
  future = [];
}

/** Im Desktop-Programm (Mac) statt im Browser? */
export function istDesktop(s = state) {
  return Boolean(s.auth?.desktop);
}

export function activeLevel(s = state) {
  return s.project.levels[Math.min(s.activeLevel, s.project.levels.length - 1)];
}

export function loadProject(project, { vomServer = false } = {}) {
  resetHistory();
  state = { ...state, project, activeLevel: 0, selection: null, draft: null, ladeZaehler: (state.ladeZaehler || 0) + 1 };
  persist({ vomServer });
  emit();
}

export function newProject() {
  loadProject(createProject());
}

export function loadDemo() {
  loadProject(demoProject());
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  clearTimeout(toastTimer);
  setState({ toast: { message, kind, at: Date.now() } });
  toastTimer = setTimeout(() => setState({ toast: null }), 3200);
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/** Löscht das ausgewählte Objekt im aktiven Geschoss. */
export function removeSelection() {
  const sel = state.selection;
  if (!sel) return;
  const idx = state.activeLevel;
  commit((project) => {
    const lvl = project.levels[idx];
    if (sel.kind === 'wall') {
      lvl.walls = lvl.walls.filter((w) => w.id !== sel.id);
      // Oeffnungen ohne Wand haetten keine Position mehr.
      lvl.openings = lvl.openings.filter((o) => o.wallId !== sel.id);
    } else if (sel.kind === 'opening') {
      lvl.openings = lvl.openings.filter((o) => o.id !== sel.id);
    } else if (sel.kind === 'furniture') {
      lvl.furniture = lvl.furniture.filter((f) => f.id !== sel.id);
    } else if (sel.kind === 'stair') {
      lvl.stairs = lvl.stairs.filter((s) => s.id !== sel.id);
    } else if (sel.kind === 'dimension') {
      lvl.dimensions = lvl.dimensions.filter((d) => d.id !== sel.id);
    } else if (sel.kind === 'room') {
      lvl.rooms = lvl.rooms.filter((r) => r.id !== sel.id);
    } else {
      return false;
    }
  });
  setState({ selection: null });
}

/**
 * Rückfrage in der Oberfläche statt window.confirm -- das eingebettete
 * WebKit des Mac-Programms zeigt keine Browser-Dialoge an.
 */
export function bestaetigen(text, ja = 'OK') {
  return new Promise((resolve) => {
    setState({ bestaetigung: { text, ja, resolve } });
  });
}

export function bestaetigungBeantworten(antwort) {
  const b = state.bestaetigung;
  setState({ bestaetigung: null });
  b?.resolve(antwort);
}

/** Ansicht so wählen, dass das ganze Geschoss mit Maßketten sichtbar ist. */
export function einpassen(breite, hoehe) {
  const s = state;
  const level = activeLevel(s);
  const pts = [];
  for (const l of s.project.levels) for (const w of l.walls) pts.push(w.a, w.b);
  for (const w of level.walls) pts.push(w.a, w.b);
  if (!pts.length || !breite || !hoehe) return;
  const rand = 260;
  const minX = Math.min(...pts.map((p) => p.x)) - rand;
  const maxX = Math.max(...pts.map((p) => p.x)) + rand;
  const minY = Math.min(...pts.map((p) => p.y)) - rand;
  const maxY = Math.max(...pts.map((p) => p.y)) + rand;
  const zoom = Math.min(breite / (maxX - minX), hoehe / (maxY - minY), 3);
  setState({
    view: {
      zoom,
      panX: (breite - (maxX - minX) * zoom) / 2 - minX * zoom,
      panY: (hoehe - (maxY - minY) * zoom) / 2 - minY * zoom,
    },
  });
}
