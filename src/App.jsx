import { lazy, Suspense, useEffect, useState } from 'react';
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
import FlaechenDialog from './components/FlaechenDialog.jsx';
import PdfDialog from './components/PdfDialog.jsx';
import Bestaetigung from './components/Bestaetigung.jsx';
import { applyNumInput, finishDraftRef } from './canvas2d/events.js';
import { dateiOeffnen } from './datei.js';

// three.js macht den Grossteil des Bundles aus und wird erst gebraucht,
// wenn jemand die 3D-Ansicht oeffnet.
const View3D = lazy(() => import('./components/View3D.jsx'));
import { exportJSON, exportPNG, exportSVG } from './export.js';
import { deserialize } from './model/project.ts';
import {
  activeLevel,
  commit,
  einpassen,
  getState,
  istDesktop,
  loadProject,
  redo,
  removeSelection,
  setState,
  toast,
  undo,
  useStore,
} from './store.js';

const TOOL_KEYS = { v: 'select', w: 'wall', d: 'door', f: 'window', t: 'stair', m: 'dimension', n: 'room', h: 'pan' };

const GETEILT = /^#\/geteilt\/([0-9a-f]{32})$/;

const SPEICHERSTAND = {
  geaendert: 'Änderungen …',
  speichert: 'Speichert …',
  gespeichert: 'Gespeichert',
  fehler: 'Nicht gespeichert',
};

export default function App() {
  const state = useStore();
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
      if (mod && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (getState().serverProjekt) jetztSpeichern().catch(() => {});
        else setState({ projekteOffen: true });
        return;
      }
      if (mod && ev.key.toLowerCase() === 'p') {
        ev.preventDefault();
        setState({ pdfOffen: true });
        return;
      }
      if (mod) return;

      // Zahleneingabe beim Wandzeichnen: Ziffern, Komma, Strichpunkt sammeln.
      const s = getState();
      if (s.tool === 'wall' && s.draft?.points.length) {
        if (/^[0-9.,;<-]$/.test(ev.key)) {
          ev.preventDefault();
          setState({ numInput: s.numInput + ev.key });
          return;
        }
        if (ev.key === 'Backspace' && s.numInput) {
          ev.preventDefault();
          setState({ numInput: s.numInput.slice(0, -1) });
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (s.numInput) applyNumInput();
          else finishDraftRef.current?.();
          return;
        }
        if (ev.key === 'Escape' && s.numInput) {
          setState({ numInput: '' });
          return;
        }
      }

      if (ev.key === 'Escape') {
        setState({ draft: null, dimDraft: null, selection: null, pendingCatalogId: null, tool: 'select', numInput: '', guides: [] });
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (!state.selection) return;
        ev.preventDefault();
        removeSelection();
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
      if (ev.key.toLowerCase() === 'r' && state.selection?.kind === 'stair') {
        commit((project) => {
          const st = project.levels[state.activeLevel].stairs.find((x) => x.id === state.selection.id);
          if (!st) return false;
          st.rotationDeg = (st.rotationDeg + (ev.shiftKey ? -90 : 90) + 360) % 360;
        });
        return;
      }
      if (ev.key === '0') {
        const c = document.querySelector('.plan-canvas')?.getBoundingClientRect();
        if (c) einpassen(c.width, c.height);
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

  const openFile = async () => {
    try {
      const datei = await dateiOeffnen(['planr', 'json']);
      if (!datei) return;
      loadProject(deserialize(datei.text));
      setState({ serverProjekt: null, speicherstand: null });
      toast(`„${datei.name}" geladen.`);
    } catch (err) {
      toast(`Datei konnte nicht gelesen werden: ${err.message}`, 'error');
    }
  };

  const levelIndex = Math.min(state.activeLevel, state.project.levels.length - 1);
  const desktop = istDesktop(state);

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
            {!state.serverProjekt && <span className="speicherstand lokal">{desktop ? 'noch nicht gespeichert' : 'nur in diesem Browser'}</span>}
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
                {desktop ? 'Exportieren' : 'Teilen'}
              </button>
              <button type="button" className="btn" onClick={() => setState({ pdfOffen: true })} title="Maßstäblicher Plan mit Plankopf (⌘P)">
                PDF
              </button>
              <span className="divider" />
              <button type="button" className="btn" onClick={openFile} title="Datei öffnen, ohne sie zu speichern">
                Öffnen
              </button>
              <button type="button" className="btn" onClick={() => exportJSON(state.project)} title="Als .planr-Datei sichern">
                Sichern
              </button>
            </>
          )}
          <span className="divider" />
          <button type="button" className="btn" onClick={() => exportPNG(state.project, levelIndex, state.settings)}>
            PNG
          </button>
          <button type="button" className="btn" onClick={() => exportSVG(state.project, state.project.levels[levelIndex], state.settings)}>
            SVG
          </button>
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
      <FlaechenDialog />
      <PdfDialog />
      <Bestaetigung />
      {!desktop && <Rechtliches />}
    </div>
  );
}
