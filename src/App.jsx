import { lazy, Suspense, useEffect, useRef } from 'react';
import Toolbar from './components/Toolbar.jsx';
import CatalogPanel from './components/CatalogPanel.jsx';
import PropertiesPanel from './components/PropertiesPanel.jsx';
import PlanCanvas from './components/PlanCanvas.jsx';
import StatusBar from './components/StatusBar.jsx';
import { IconLogo } from './components/icons.jsx';

// three.js macht den Grossteil des Bundles aus und wird erst gebraucht,
// wenn jemand die 3D-Ansicht oeffnet.
const View3D = lazy(() => import('./components/View3D.jsx'));
import { exportJSON, exportPNG, exportSVG } from './export.js';
import { deserialize } from './model/project.js';
import {
  activeLevel,
  commit,
  loadDemo,
  loadProject,
  newProject,
  redo,
  setState,
  toast,
  undo,
  useStore,
} from './store.js';

const TOOL_KEYS = { v: 'select', w: 'wall', d: 'door', f: 'window', h: 'pan' };

export default function App() {
  const state = useStore();
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (ev) => {
      // In Eingabefeldern gehoeren die Tasten dem Feld.
      const tag = ev.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;

      if (ev.key === 'Escape') {
        setState({ draft: null, selection: null, pendingCatalogId: null, tool: 'select' });
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        const sel = state.selection;
        if (!sel) return;
        ev.preventDefault();
        commit((project) => {
          const lvl = project.levels[state.activeLevel];
          if (sel.kind === 'wall') {
            lvl.walls = lvl.walls.filter((w) => w.id !== sel.id);
            lvl.openings = lvl.openings.filter((o) => o.wallId !== sel.id);
          } else if (sel.kind === 'opening') {
            lvl.openings = lvl.openings.filter((o) => o.id !== sel.id);
          } else if (sel.kind === 'furniture') {
            lvl.furniture = lvl.furniture.filter((f) => f.id !== sel.id);
          }
        });
        setState({ selection: null });
        return;
      }
      if (ev.key.toLowerCase() === 'r' && state.selection?.kind === 'furniture') {
        commit((project) => {
          const f = project.levels[state.activeLevel].furniture.find((x) => x.id === state.selection.id);
          if (!f) return false;
          f.rotationDeg = (f.rotationDeg + (ev.shiftKey ? -15 : 15) + 360) % 360;
        });
        return;
      }
      if (ev.key === '3') {
        setState({ view3d: !state.view3d });
        return;
      }
      const tool = TOOL_KEYS[ev.key.toLowerCase()];
      if (tool) setState({ tool, draft: null, pendingCatalogId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selection, state.activeLevel, state.view3d]);

  const openFile = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      loadProject(deserialize(await file.text()));
      toast(`„${file.name}" geladen.`);
    } catch (err) {
      toast(`Datei konnte nicht gelesen werden: ${err.message}`, 'error');
    }
  };

  const level = activeLevel(state);

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <span className="logo">
            <IconLogo />
          </span>
          <span>Planr</span>
        </div>
        <div className="appbar-actions">
          <button type="button" className="btn" onClick={newProject}>
            Neu
          </button>
          <button type="button" className="btn" onClick={loadDemo}>
            Beispiel
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Öffnen
          </button>
          <button type="button" className="btn" onClick={() => exportJSON(state.project)}>
            Speichern
          </button>
          <span className="divider" />
          <button type="button" className="btn" onClick={() => exportPNG(state.project, level, state.settings)}>
            PNG
          </button>
          <button type="button" className="btn" onClick={() => exportSVG(state.project, level, state.settings)}>
            SVG
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={openFile} />
        </div>
      </header>

      <Toolbar />

      <main className="workspace">
        <CatalogPanel />
        <div className="viewport">
          {state.view3d ? (
            <Suspense fallback={<div className="loading">3D-Ansicht wird geladen …</div>}>
              <View3D />
            </Suspense>
          ) : (
            <PlanCanvas />
          )}
        </div>
        <PropertiesPanel />
      </main>

      <StatusBar />

      {state.toast && <div className={`toast ${state.toast.kind}`}>{state.toast.message}</div>}
    </div>
  );
}
