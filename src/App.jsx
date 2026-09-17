import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { geteiltOeffnen, jetztSpeichern, letztesProjektOeffnen } from './sync.js';
import Anmeldung from './components/Anmeldung.jsx';
import KontoDialog from './components/KontoDialog.jsx';
import ProjektDialog from './components/ProjektDialog.jsx';
import Rechtliches from './components/Rechtliches.jsx';
import TeilenDialog from './components/TeilenDialog.jsx';
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
import { deserialize } from './model/project.ts';
import {
  activeLevel,
  commit,
  getState,
  loadDemo,
  loadProject,
  redo,
  setState,
  toast,
  undo,
  useStore,
} from './store.js';

const TOOL_KEYS = { v: 'select', w: 'wall', d: 'door', f: 'window', h: 'pan' };

const GETEILT = /^#\/geteilt\/([0-9a-f]{32})$/;

const SPEICHERSTAND = {
  geaendert: 'Änderungen …',
  speichert: 'Speichert …',
  gespeichert: 'Gespeichert',
  fehler: 'Nicht gespeichert',
};

export default function App() {
  const state = useStore();
  const fileRef = useRef(null);
  const geteiltToken = (location.hash.match(GETEILT) || [])[1] || null;
  const [geteiltFehler, setGeteiltFehler] = useState('');
  const kontoId = state.auth?.konto?.id;

  // Zuerst: wer ist man? Ein geteilter Grundriss braucht keine Anmeldung.
  useEffect(() => {
    if (geteiltToken) {
      geteiltOeffnen(geteiltToken).catch((e) => setGeteiltFehler(e.message));
      return;
    }
    api('/api/status')
      .then((status) => setState({ auth: status }))
      .catch(() => setState({ auth: { offline: true } }));
  }, [geteiltToken]);

  // Nach der Anmeldung dort weitermachen, wo man aufgehoert hat.
  useEffect(() => {
    if (!kontoId || geteiltToken) return;
    setState({ anmeldungNoetig: false });
    letztesProjektOeffnen();
  }, [kontoId, geteiltToken]);

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
      // In der geteilten Ansicht gibt es nur Werkzeuge, die nichts aendern.
      if (tool && getState().nurLesen && tool !== 'select' && tool !== 'pan') return;
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

  if (geteiltToken && geteiltFehler) {
    return (
      <div className="anmeldung">
        <div className="anmeldung-karte">
          <h1>Link nicht verfügbar</h1>
          <p className="anmeldung-hinweis">{geteiltFehler} Bitte die Person, die dir den Link gegeben hat, um einen neuen.</p>
          <button type="button" className="knopf-primaer" onClick={() => { location.hash = ''; location.reload(); }}>
            Zu Planr
          </button>
        </div>
        <Rechtliches />
      </div>
    );
  }

  if (!geteiltToken) {
    if (!state.auth) return <div className="anmeldung"><p className="anmeldung-laedt">Planr lädt …</p></div>;
    if (!state.auth.offline && (!kontoId || state.anmeldungNoetig)) {
      return (
        <>
          <Anmeldung />
          <Rechtliches />
        </>
      );
    }
  }

  const nurLesen = state.nurLesen;

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <span className="logo">
            <IconLogo />
          </span>
          <span>Planr</span>
        </div>
        {nurLesen ? (
          <span className="projekt-titel">
            <span className="nur-lesen-marke">Nur ansehen</span>
            <span className="projekt-name">{state.geteilterName}</span>
          </span>
        ) : (
          <span className="projekt-titel">
            <span className="projekt-name">{state.serverProjekt ? state.serverProjekt.name : state.project.name}</span>
            {!state.serverProjekt && <span className="speicherstand lokal">nur in diesem Browser</span>}
            {state.speicherstand && (
              <span className={`speicherstand ${state.speicherstand}`}>{SPEICHERSTAND[state.speicherstand]}</span>
            )}
          </span>
        )}
        <div className="appbar-actions">
          {!nurLesen && (
            <>
              <button type="button" className="btn" onClick={() => setState({ projekteOffen: true })}>
                Projekte
              </button>
              <button type="button" className="btn" onClick={() => (state.serverProjekt ? jetztSpeichern().catch(() => {}) : setState({ projekteOffen: true }))}>
                Speichern
              </button>
              <button type="button" className="btn" onClick={() => setState({ teilenOffen: true })}>
                Teilen
              </button>
              <span className="divider" />
              <button type="button" className="btn" onClick={loadDemo} title="Beispielwohnung in dieses Projekt laden">
                Beispiel
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="Datei nur im Browser öffnen">
                Datei öffnen
              </button>
              <button type="button" className="btn" onClick={() => exportJSON(state.project)} title="Als Datei herunterladen">
                JSON
              </button>
            </>
          )}
          <span className="divider" />
          <button type="button" className="btn" onClick={() => exportPNG(state.project, level, state.settings)}>
            PNG
          </button>
          <button type="button" className="btn" onClick={() => exportSVG(state.project, level, state.settings)}>
            SVG
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={openFile} />
          {state.auth?.konto && (
            <button
              type="button"
              className="konto-knopf"
              onClick={() => setState({ kontoOffen: true })}
              title={`Konto: ${state.auth.konto.email}`}
            >
              {(state.auth.konto.name || '?').trim().charAt(0).toUpperCase()}
            </button>
          )}
        </div>
      </header>

      <Toolbar />

      <main className={`workspace${nurLesen ? ' nur-lesen' : ''}`}>
        {!nurLesen && <CatalogPanel />}
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
      <ProjektDialog />
      <TeilenDialog />
      <KontoDialog />
      <Rechtliches />
    </div>
  );
}
