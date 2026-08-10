import { activeLevel, setState, useStore } from '../store.js';

const HINTS = {
  select: 'Klicken zum Auswählen, ziehen zum Verschieben. R dreht Möbel um 15°.',
  wall: 'Klicken setzt Eckpunkte. Doppelklick oder Rechtsklick beendet den Wandzug, Alt hebt das Winkelraster auf.',
  door: 'Auf eine Wand klicken, um eine Tür einzusetzen.',
  window: 'Auf eine Wand klicken, um ein Fenster einzusetzen.',
  place: 'Auf den Plan klicken, um das gewählte Möbel abzusetzen.',
  pan: 'Ziehen verschiebt die Ansicht. Mausrad zoomt.',
};

export default function StatusBar() {
  const state = useStore();
  const level = activeLevel(state);

  return (
    <footer className="statusbar">
      <span className="status-hint">{state.view3d ? 'Ziehen dreht, Mausrad zoomt, Rechtsklick verschiebt.' : HINTS[state.tool]}</span>
      <span className="status-right">
        <label className="toggle">
          Raster
          <select
            value={state.settings.gridCm}
            onChange={(e) => setState({ settings: { ...state.settings, gridCm: Number(e.target.value) } })}
          >
            <option value={1}>1 cm</option>
            <option value={5}>5 cm</option>
            <option value={10}>10 cm</option>
            <option value={25}>25 cm</option>
            <option value={50}>50 cm</option>
          </select>
        </label>
        <label className="toggle">
          Wanddicke
          <select
            value={state.settings.wallThicknessCm}
            onChange={(e) => setState({ settings: { ...state.settings, wallThicknessCm: Number(e.target.value) } })}
          >
            <option value={11.5}>11,5 cm</option>
            <option value={17.5}>17,5 cm</option>
            <option value={24}>24 cm</option>
            <option value={30}>30 cm</option>
            <option value={36.5}>36,5 cm</option>
          </select>
        </label>
        <span className="zoom">{Math.round(state.view.zoom * 100)} %</span>
        <span className="level-name">{level.name}</span>
      </span>
    </footer>
  );
}
