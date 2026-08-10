import { canRedo, canUndo, redo, setState, undo, useStore } from '../store.js';
import {
  IconDoor,
  IconPan,
  IconRedo,
  IconSelect,
  IconUndo,
  IconWall,
  IconWindow,
} from './icons.jsx';

const TOOLS = [
  { id: 'select', label: 'Auswählen', key: 'V', Icon: IconSelect },
  { id: 'wall', label: 'Wand', key: 'W', Icon: IconWall },
  { id: 'door', label: 'Tür', key: 'D', Icon: IconDoor },
  { id: 'window', label: 'Fenster', key: 'F', Icon: IconWindow },
  { id: 'pan', label: 'Verschieben', key: 'H', Icon: IconPan },
];

export default function Toolbar() {
  const state = useStore();

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool ${state.tool === t.id ? 'active' : ''}`}
            title={`${t.label} (${t.key})`}
            onClick={() => setState({ tool: t.id, draft: null, pendingCatalogId: null })}
          >
            <span className="tool-icon">
              <t.Icon />
            </span>
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button type="button" className="tool" disabled={!canUndo()} onClick={undo} title="Rückgängig (Strg+Z)">
          <span className="tool-icon">
            <IconUndo />
          </span>
        </button>
        <button type="button" className="tool" disabled={!canRedo()} onClick={redo} title="Wiederholen (Strg+Umschalt+Z)">
          <span className="tool-icon">
            <IconRedo />
          </span>
        </button>
      </div>

      <div className="toolbar-group toolbar-toggles">
        <label className="toggle" title="Am Raster einrasten">
          <input
            type="checkbox"
            checked={state.settings.snapEnabled}
            onChange={(e) => setState({ settings: { ...state.settings, snapEnabled: e.target.checked } })}
          />
          Raster
        </label>
        <label className="toggle" title="Wandlängen einblenden">
          <input
            type="checkbox"
            checked={state.settings.showDimensions}
            onChange={(e) => setState({ settings: { ...state.settings, showDimensions: e.target.checked } })}
          />
          Maße
        </label>
        <label className="toggle" title="Raumflächen einblenden">
          <input
            type="checkbox"
            checked={state.settings.showRooms}
            onChange={(e) => setState({ settings: { ...state.settings, showRooms: e.target.checked } })}
          />
          Räume
        </label>
        <label className="toggle" title="Möbel ein- und ausblenden">
          <input
            type="checkbox"
            checked={state.settings.showFurniture}
            onChange={(e) => setState({ settings: { ...state.settings, showFurniture: e.target.checked } })}
          />
          Möbel
        </label>
      </div>

      <div className="toolbar-group toolbar-right">
        <div className="segmented">
          <button
            type="button"
            className={!state.view3d ? 'active' : ''}
            onClick={() => setState({ view3d: false })}
          >
            2D
          </button>
          <button
            type="button"
            className={state.view3d ? 'active' : ''}
            onClick={() => setState({ view3d: true })}
          >
            3D
          </button>
        </div>
      </div>
    </div>
  );
}
