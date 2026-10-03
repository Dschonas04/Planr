import { canRedo, canUndo, commit, getState, redo, setState, undo, useStore } from '../store.js';
import { createLevel, newId } from '../model/project.ts';
import { storeyHeight } from '../model/building.ts';
import { formatLevel } from '../model/units.ts';
import {
  IconDimension,
  IconDoor,
  IconPan,
  IconRedo,
  IconRoom,
  IconSelect,
  IconStair,
  IconUndo,
  IconWall,
  IconWindow,
} from './icons.jsx';

const TOOLS = [
  { id: 'select', label: 'Auswählen', key: 'V', Icon: IconSelect },
  { id: 'wall', label: 'Wand', key: 'W', Icon: IconWall },
  { id: 'door', label: 'Tür', key: 'D', Icon: IconDoor },
  { id: 'window', label: 'Fenster', key: 'F', Icon: IconWindow },
  { id: 'stair', label: 'Treppe', key: 'T', Icon: IconStair },
  { id: 'dimension', label: 'Maß', key: 'M', Icon: IconDimension },
  { id: 'room', label: 'Raum', key: 'N', Icon: IconRoom },
  { id: 'pan', label: 'Verschieben', key: 'H', Icon: IconPan },
];

// Wer nur ansehen darf, braucht nur die Werkzeuge, die nichts aendern.
const NUR_ANSEHEN = new Set(['select', 'pan']);

/** Neues Geschoss über dem obersten oder unter dem untersten. */
export function geschossAnlegen(wo, { waendeUebernehmen = false } = {}) {
  const s = getState();
  const levels = s.project.levels;
  const ref = wo === 'oben' ? levels[levels.length - 1] : levels[0];
  let neu;
  if (wo === 'oben') {
    neu = createLevel(levels.length === 1 ? 'Obergeschoss' : `${levels.length}. Geschoss`, ref.elevationCm + storeyHeight(ref));
  } else {
    neu = createLevel('Kellergeschoss', 0);
    neu.heightCm = 240;
    neu.elevationCm = ref.elevationCm - neu.heightCm - neu.slabCm;
  }
  if (waendeUebernehmen) {
    // Nur die Außenwände: die Innenaufteilung ist in jedem Geschoss anders.
    const outlineIds = new Set(ref.walls.filter((w) => w.typeId?.startsWith('aw-') || w.typeId?.startsWith('kw-')).map((w) => w.id));
    const quelle = outlineIds.size ? ref.walls.filter((w) => outlineIds.has(w.id)) : ref.walls;
    neu.walls = quelle.map((w) => ({ ...structuredClone(w), id: newId('w'), heightCm: neu.heightCm }));
  }
  commit((project) => {
    if (wo === 'oben') project.levels.push(neu);
    else project.levels.unshift(neu);
  });
  const idx = wo === 'oben' ? getState().project.levels.length - 1 : 0;
  setState({ activeLevel: idx, selection: null, draft: null });
}

export default function Toolbar() {
  const state = useStore();
  const werkzeuge = state.nurLesen ? TOOLS.filter((t) => NUR_ANSEHEN.has(t.id)) : TOOLS;
  const levels = state.project.levels;
  const toggle = (key) => (e) => setState({ settings: { ...state.settings, [key]: e.target.checked } });

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {werkzeuge.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool ${state.tool === t.id ? 'active' : ''}`}
            title={`${t.label} (${t.key})`}
            onClick={() => setState({ tool: t.id, draft: null, dimDraft: null, pendingCatalogId: null, numInput: '' })}
          >
            <span className="tool-icon">
              <t.Icon />
            </span>
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </div>

      {!state.nurLesen && (
        <div className="toolbar-group">
          <button type="button" className="tool" disabled={!canUndo()} onClick={undo} title="Rückgängig (⌘Z)">
            <span className="tool-icon">
              <IconUndo />
            </span>
          </button>
          <button type="button" className="tool" disabled={!canRedo()} onClick={redo} title="Wiederholen (⇧⌘Z)">
            <span className="tool-icon">
              <IconRedo />
            </span>
          </button>
        </div>
      )}

      <div className="toolbar-group geschosse" title="Geschoss wählen">
        {[...levels].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
          <button
            key={l.id}
            type="button"
            className={`geschoss ${state.activeLevel === i ? 'active' : ''}`}
            onClick={() => setState({ activeLevel: i, selection: null, draft: null, dimDraft: null })}
            title={`${l.name}, OKFF ${formatLevel(l.elevationCm)} m`}
          >
            <span>{kurzname(l.name)}</span>
            <em>{formatLevel(l.elevationCm)}</em>
          </button>
        ))}
        {!state.nurLesen && (
          <details className="geschoss-neu">
            <summary title="Geschoss hinzufügen">+</summary>
            <div className="menu">
              <button type="button" onClick={(e) => { e.currentTarget.closest('details').open = false; geschossAnlegen('oben', { waendeUebernehmen: true }); }}>
                Geschoss darüber (Außenwände übernehmen)
              </button>
              <button type="button" onClick={(e) => { e.currentTarget.closest('details').open = false; geschossAnlegen('oben'); }}>
                Leeres Geschoss darüber
              </button>
              <button type="button" onClick={(e) => { e.currentTarget.closest('details').open = false; geschossAnlegen('unten', { waendeUebernehmen: true }); }}>
                Keller darunter
              </button>
            </div>
          </details>
        )}
      </div>

      <div className="toolbar-group toolbar-toggles">
        <label className="toggle" title="Am Raster und an Bauteilen einrasten">
          <input type="checkbox" checked={state.settings.snapEnabled} onChange={toggle('snapEnabled')} />
          Fang
        </label>
        <label className="toggle" title="Außenmaßketten">
          <input type="checkbox" checked={state.settings.showExteriorDims} onChange={toggle('showExteriorDims')} />
          Maßketten
        </label>
        <label className="toggle" title="Wandlängen an jeder Wand">
          <input type="checkbox" checked={state.settings.showDimensions} onChange={toggle('showDimensions')} />
          Wandlängen
        </label>
        <label className="toggle" title="Fenster- und Türmaße, Brüstungshöhen">
          <input type="checkbox" checked={state.settings.showOpeningLabels} onChange={toggle('showOpeningLabels')} />
          Öffnungen
        </label>
        <label className="toggle" title="Raumstempel und Flächen">
          <input type="checkbox" checked={state.settings.showRooms} onChange={toggle('showRooms')} />
          Räume
        </label>
        <label className="toggle" title="Möbel ein- und ausblenden">
          <input type="checkbox" checked={state.settings.showFurniture} onChange={toggle('showFurniture')} />
          Möbel
        </label>
        <label className="toggle" title="Dachaufsicht und lichte Höhen">
          <input type="checkbox" checked={state.settings.showRoof} onChange={toggle('showRoof')} />
          Dach
        </label>
        <label className="toggle" title="Geschoss darunter grau hinterlegen">
          <input type="checkbox" checked={state.settings.showUnderlay} onChange={toggle('showUnderlay')} />
          Unterlage
        </label>
      </div>

      <div className="toolbar-group toolbar-right">
        <div className="segmented">
          <button type="button" className={!state.view3d ? 'active' : ''} onClick={() => setState({ view3d: false })}>
            2D
          </button>
          <button type="button" className={state.view3d ? 'active' : ''} onClick={() => setState({ view3d: true })}>
            3D
          </button>
        </div>
      </div>
    </div>
  );
}

function kurzname(name) {
  const n = name.toLowerCase();
  if (n.startsWith('keller')) return 'KG';
  if (n.startsWith('erd')) return 'EG';
  if (n.startsWith('ober')) return 'OG';
  if (n.startsWith('dach')) return 'DG';
  const m = name.match(/^(\d+)\./);
  if (m) return `${m[1]}. OG`;
  return name.slice(0, 3).toUpperCase();
}
