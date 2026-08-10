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
    showDimensions: true,
    showRooms: true,
    showFurniture: true,
    wallThicknessCm: 24,
  },
  view3d: false,
  toast: null,
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

let persistTimer = null;
function persist() {
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
export function commit(mutator, { merge = false } = {}) {
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
  if (!history.length) return;
  future.push(state.project);
  const prev = history.pop();
  state = { ...state, project: prev, draft: null, selection: null };
  persist();
  emit();
}

export function redo() {
  if (!future.length) return;
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

export function activeLevel(s = state) {
  return s.project.levels[Math.min(s.activeLevel, s.project.levels.length - 1)];
}

export function loadProject(project) {
  resetHistory();
  state = { ...state, project, activeLevel: 0, selection: null, draft: null };
  persist();
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
