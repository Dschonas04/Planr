import { activeLevel, commit, setState, useStore } from '../store.js';
import { formatArea, formatLength } from '../model/units.js';
import { wallLength } from '../model/project.js';
import { findRooms } from '../model/geometry.js';
import { useMemo } from 'react';

function NumberField({ label, value, onChange, min = 1, max = 2000, step = 1, unit = 'cm' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={Math.round(value * 10) / 10}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        <em>{unit}</em>
      </span>
    </label>
  );
}

function WallProps({ level, wall, levelIndex }) {
  const update = (patch) =>
    commit((project) => {
      const w = project.levels[levelIndex].walls.find((x) => x.id === wall.id);
      if (!w) return false;
      Object.assign(w, patch);
    });

  const setLength = (newLength) => {
    commit((project) => {
      const w = project.levels[levelIndex].walls.find((x) => x.id === wall.id);
      if (!w) return false;
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const l = Math.hypot(dx, dy) || 1;
      // Anfangspunkt bleibt fix, das Ende wandert auf die neue Laenge.
      w.b = { x: w.a.x + (dx / l) * newLength, y: w.a.y + (dy / l) * newLength };
    });
  };

  const openings = level.openings.filter((o) => o.wallId === wall.id).length;

  return (
    <>
      <h3>Wand</h3>
      <NumberField label="Länge" value={wallLength(wall)} onChange={setLength} min={10} max={5000} />
      <NumberField
        label="Dicke"
        value={wall.thicknessCm}
        onChange={(v) => update({ thicknessCm: v })}
        min={5}
        max={100}
      />
      <NumberField
        label="Höhe"
        value={wall.heightCm}
        onChange={(v) => update({ heightCm: v })}
        min={100}
        max={500}
      />
      <p className="meta">{openings} Öffnung(en) in dieser Wand</p>
    </>
  );
}

function OpeningProps({ opening, levelIndex }) {
  const update = (patch) =>
    commit((project) => {
      const o = project.levels[levelIndex].openings.find((x) => x.id === opening.id);
      if (!o) return false;
      Object.assign(o, patch);
    });

  return (
    <>
      <h3>{opening.type === 'window' ? 'Fenster' : 'Tür'}</h3>
      <label className="field">
        <span>Typ</span>
        <span className="field-input">
          <select
            value={opening.type}
            onChange={(e) =>
              update(
                e.target.value === 'window'
                  ? { type: 'window', sillCm: opening.sillCm || 90, heightCm: 140 }
                  : { type: 'door', sillCm: 0, heightCm: 200 },
              )
            }
          >
            <option value="door">Tür</option>
            <option value="window">Fenster</option>
          </select>
        </span>
      </label>
      <NumberField label="Breite" value={opening.widthCm} onChange={(v) => update({ widthCm: v })} min={40} max={400} />
      <NumberField label="Höhe" value={opening.heightCm} onChange={(v) => update({ heightCm: v })} min={40} max={300} />
      <NumberField
        label="Brüstung"
        value={opening.sillCm}
        onChange={(v) => update({ sillCm: v })}
        min={0}
        max={200}
      />
      <NumberField
        label="Position"
        value={opening.offsetCm}
        onChange={(v) => update({ offsetCm: v })}
        min={0}
        max={5000}
      />
      {opening.type === 'door' && (
        <button type="button" className="btn" onClick={() => update({ swing: opening.swing === -1 ? 1 : -1 })}>
          Anschlag spiegeln
        </button>
      )}
    </>
  );
}

function FurnitureProps({ furniture, levelIndex }) {
  const update = (patch) =>
    commit((project) => {
      const f = project.levels[levelIndex].furniture.find((x) => x.id === furniture.id);
      if (!f) return false;
      Object.assign(f, patch);
    });

  return (
    <>
      <h3>{furniture.label}</h3>
      <label className="field">
        <span>Name</span>
        <span className="field-input">
          <input type="text" value={furniture.label} onChange={(e) => update({ label: e.target.value })} />
        </span>
      </label>
      <NumberField label="Breite" value={furniture.widthCm} onChange={(v) => update({ widthCm: v })} min={5} max={1000} />
      <NumberField label="Tiefe" value={furniture.depthCm} onChange={(v) => update({ depthCm: v })} min={5} max={1000} />
      <NumberField label="Höhe" value={furniture.heightCm} onChange={(v) => update({ heightCm: v })} min={1} max={400} />
      <NumberField
        label="Drehung"
        value={furniture.rotationDeg}
        onChange={(v) => update({ rotationDeg: v })}
        min={0}
        max={359}
        step={5}
        unit="°"
      />
      <label className="field">
        <span>Farbe</span>
        <span className="field-input">
          <input type="color" value={furniture.color} onChange={(e) => update({ color: e.target.value })} />
        </span>
      </label>
      <NumberField label="X" value={furniture.x} onChange={(v) => update({ x: v })} min={-100000} max={100000} />
      <NumberField label="Y" value={furniture.y} onChange={(v) => update({ y: v })} min={-100000} max={100000} />
    </>
  );
}

function ProjectProps({ level, levelIndex, project }) {
  const rooms = useMemo(
    () => findRooms(level.walls.map((w) => ({ a: w.a, b: w.b }))),
    [level.walls],
  );
  const total = rooms.reduce((sum, r) => sum + Math.abs(r.area), 0);

  return (
    <>
      <h3>Projekt</h3>
      <label className="field">
        <span>Name</span>
        <span className="field-input">
          <input
            type="text"
            value={project.name}
            onChange={(e) =>
              commit((p) => {
                p.name = e.target.value;
              })
            }
          />
        </span>
      </label>
      <NumberField
        label="Deckenhöhe"
        value={level.heightCm}
        onChange={(v) =>
          commit((p) => {
            p.levels[levelIndex].heightCm = v;
          })
        }
        min={180}
        max={500}
      />
      <div className="stats">
        <div>
          <strong>{rooms.length}</strong>
          <span>Räume erkannt</span>
        </div>
        <div>
          <strong>{formatArea(total)}</strong>
          <span>Gesamtfläche</span>
        </div>
        <div>
          <strong>{level.walls.length}</strong>
          <span>Wände</span>
        </div>
        <div>
          <strong>{level.furniture.length}</strong>
          <span>Möbel</span>
        </div>
      </div>
      <p className="hint">
        Nichts ausgewählt. Klicke ein Objekt im Plan an, um seine Maße zu bearbeiten.
      </p>
    </>
  );
}

export default function PropertiesPanel() {
  const state = useStore();
  const level = activeLevel(state);
  const idx = state.activeLevel;
  const sel = state.selection;

  const remove = () => {
    if (!sel) return;
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
      }
    });
    setState({ selection: null });
  };

  const duplicate = () => {
    if (sel?.kind !== 'furniture') return;
    commit((project) => {
      const lvl = project.levels[idx];
      const f = lvl.furniture.find((x) => x.id === sel.id);
      if (!f) return false;
      lvl.furniture.push({ ...f, id: `${f.id}_c${lvl.furniture.length}`, x: f.x + 30, y: f.y + 30 });
    });
  };

  let body = null;
  if (sel?.kind === 'wall') {
    const wall = level.walls.find((w) => w.id === sel.id);
    body = wall ? <WallProps level={level} wall={wall} levelIndex={idx} /> : null;
  } else if (sel?.kind === 'opening') {
    const op = level.openings.find((o) => o.id === sel.id);
    body = op ? <OpeningProps opening={op} levelIndex={idx} /> : null;
  } else if (sel?.kind === 'furniture') {
    const f = level.furniture.find((x) => x.id === sel.id);
    body = f ? <FurnitureProps furniture={f} levelIndex={idx} /> : null;
  }

  return (
    <aside className="panel properties">
      {body || <ProjectProps level={level} levelIndex={idx} project={state.project} />}
      {sel && body && (
        <div className="prop-actions">
          {sel.kind === 'furniture' && (
            <button type="button" className="btn" onClick={duplicate}>
              Duplizieren
            </button>
          )}
          <button type="button" className="btn danger" onClick={remove}>
            Löschen
          </button>
        </div>
      )}
    </aside>
  );
}
