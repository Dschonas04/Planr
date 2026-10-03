import { useMemo } from 'react';
import { activeLevel, commit, removeSelection, setState, useStore } from '../store.js';
import { formatArch, formatArea, formatLength, formatLevel } from '../model/units.ts';
import { wallLength } from '../model/project.ts';
import { GEG_U_AUSSENWAND, WALL_TYPES, typeThickness, uValue, wallType } from '../model/wallTypes.ts';
import { areaSchedule, riseFrom, storeyHeight, USAGE_LABEL } from '../model/building.ts';
import { stairCalc } from '../model/stairs.ts';
import { deriveLevel } from '../canvas2d/derive.js';
import { woflvByRoom } from '../canvas2d/render.js';
import { dist } from '../model/geometry.ts';

const de = (v, digits = 2) => v.toFixed(digits).replace('.', ',');

function NumberField({ label, value, onChange, min = 1, max = 2000, step = 1, unit = 'cm', disabled = false }) {
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
          disabled={disabled}
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

function TextField({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

const mutate = (levelIndex, key, id) => (patch) =>
  commit((project) => {
    const o = project.levels[levelIndex][key].find((x) => x.id === id);
    if (!o) return false;
    Object.assign(o, typeof patch === 'function' ? patch(o) : patch);
  });

function WallProps({ level, wall, levelIndex }) {
  const update = mutate(levelIndex, 'walls', wall.id);
  const type = wallType(wall.typeId);

  const setLength = (newLength) => {
    update((w) => {
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const l = Math.hypot(dx, dy) || 1;
      // Anfangspunkt bleibt fix, das Ende wandert auf die neue Laenge.
      return { b: { x: w.a.x + (dx / l) * newLength, y: w.a.y + (dy / l) * newLength } };
    });
  };

  const openings = level.openings.filter((o) => o.wallId === wall.id).length;
  const u = type ? uValue(type) : null;

  return (
    <>
      <h3>Wand</h3>
      <SelectField
        label="Aufbau"
        value={wall.typeId || ''}
        onChange={(id) => {
          const t = wallType(id);
          update(t ? { typeId: id, thicknessCm: typeThickness(t) } : { typeId: undefined });
        }}
        options={[['', 'Einschalig (frei)'], ...WALL_TYPES.map((t) => [t.id, t.label])]}
      />
      <NumberField label="Länge (Achse)" value={wallLength(wall)} onChange={setLength} min={10} max={5000} />
      <NumberField
        label="Dicke"
        value={wall.thicknessCm}
        onChange={(v) => update({ thicknessCm: v, typeId: undefined })}
        min={5}
        max={100}
        step={0.5}
      />
      <NumberField label="Höhe" value={wall.heightCm} onChange={(v) => update({ heightCm: v })} min={50} max={800} />
      {type && (
        <div className="aufbau">
          <table>
            <thead>
              <tr>
                <th>Schicht {wall.flip ? '(innen → außen)' : '(außen → innen)'}</th>
                <th>d</th>
                <th>λ</th>
              </tr>
            </thead>
            <tbody>
              {type.layers.map((l, i) => (
                <tr key={i}>
                  <td>{l.label}</td>
                  <td>{formatArch(l.thicknessCm)}</td>
                  <td>{de(l.lambda, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`uwert ${type.exterior && u > GEG_U_AUSSENWAND ? 'schlecht' : ''}`}>
            U = {de(u, 3)} W/(m²K)
            {type.exterior && (
              <span>{u <= GEG_U_AUSSENWAND ? ` · GEG-Referenz ${de(GEG_U_AUSSENWAND)} eingehalten` : ` · über GEG-Referenz ${de(GEG_U_AUSSENWAND)}`}</span>
            )}
          </p>
          <button type="button" className="btn" onClick={() => update({ flip: !wall.flip })}>
            Schichtfolge umdrehen
          </button>
        </div>
      )}
      <p className="meta">{openings} Öffnung(en) in dieser Wand</p>
    </>
  );
}

function OpeningProps({ opening, levelIndex }) {
  const update = mutate(levelIndex, 'openings', opening.id);
  return (
    <>
      <h3>{opening.type === 'window' ? 'Fenster' : 'Tür'}</h3>
      <SelectField
        label="Typ"
        value={opening.type}
        onChange={(v) =>
          update(v === 'window' ? { type: 'window', sillCm: opening.sillCm || 90, heightCm: 138.5 } : { type: 'door', sillCm: 0, heightCm: 201 })
        }
        options={[
          ['door', 'Tür'],
          ['window', 'Fenster'],
        ]}
      />
      <NumberField label="Breite (Rohbau)" value={opening.widthCm} onChange={(v) => update({ widthCm: v })} min={30} max={600} step={0.5} />
      <NumberField label="Höhe (Rohbau)" value={opening.heightCm} onChange={(v) => update({ heightCm: v })} min={30} max={400} step={0.5} />
      <NumberField label="Brüstung (BRH)" value={opening.sillCm} onChange={(v) => update({ sillCm: v })} min={0} max={250} step={0.5} />
      <NumberField label="Position (Mitte)" value={opening.offsetCm} onChange={(v) => update({ offsetCm: v })} min={0} max={5000} />
      <p className="meta">
        Sturzhöhe {formatArch(opening.sillCm + opening.heightCm)} über OKFF
      </p>
      {opening.type === 'door' && (
        <button type="button" className="btn" onClick={() => update({ swing: opening.swing === -1 ? 1 : -1 })}>
          Aufschlag spiegeln
        </button>
      )}
    </>
  );
}

function FurnitureProps({ furniture, levelIndex }) {
  const update = mutate(levelIndex, 'furniture', furniture.id);
  return (
    <>
      <h3>{furniture.label}</h3>
      <TextField label="Name" value={furniture.label} onChange={(v) => update({ label: v })} />
      <NumberField label="Breite" value={furniture.widthCm} onChange={(v) => update({ widthCm: v })} min={5} max={1000} />
      <NumberField label="Tiefe" value={furniture.depthCm} onChange={(v) => update({ depthCm: v })} min={5} max={1000} />
      <NumberField label="Höhe" value={furniture.heightCm} onChange={(v) => update({ heightCm: v })} min={1} max={400} />
      <NumberField label="Drehung" value={furniture.rotationDeg} onChange={(v) => update({ rotationDeg: v })} min={0} max={359} step={5} unit="°" />
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

function StairProps({ stair, levelIndex, project }) {
  const update = mutate(levelIndex, 'stairs', stair.id);
  const rise = riseFrom(project, levelIndex);
  const c = stairCalc(stair, rise);
  const lauf = c.treads * c.treadCm;
  return (
    <>
      <h3>Treppe</h3>
      <SelectField
        label="Form"
        value={stair.kind}
        onChange={(v) => update({ kind: v, splitAt: 0 })}
        options={[
          ['gerade', 'Einläufig gerade'],
          ['l', 'L mit Viertelpodest'],
          ['u', 'U mit Halbpodest'],
        ]}
      />
      <NumberField label="Laufbreite" value={stair.widthCm} onChange={(v) => update({ widthCm: v })} min={60} max={300} />
      <NumberField label="Auftritt (0 = auto)" value={stair.treadCm} onChange={(v) => update({ treadCm: v })} min={0} max={45} step={0.5} />
      <NumberField label="Laufrichtung" value={stair.rotationDeg} onChange={(v) => update({ rotationDeg: v })} min={-360} max={360} step={90} unit="°" />
      {stair.kind !== 'gerade' && (
        <>
          <SelectField
            label="Drehsinn"
            value={String(stair.turn)}
            onChange={(v) => update({ turn: v === '-1' ? -1 : 1 })}
            options={[
              ['1', 'Links'],
              ['-1', 'Rechts'],
            ]}
          />
          <NumberField label="Stufen 1. Lauf" value={stair.splitAt || c.firstRun} onChange={(v) => update({ splitAt: Math.round(v) })} min={1} max={c.treads - 2} />
        </>
      )}
      <div className="stats">
        <div>
          <strong>
            {c.risers} × {formatArch(c.riserCm)}
          </strong>
          <span>Steigungen auf {formatArch(rise)}</span>
        </div>
        <div>
          <strong>{formatArch(c.treadCm)}</strong>
          <span>Auftritt</span>
        </div>
        <div>
          <strong>{formatArch(c.stepRuleCm)}</strong>
          <span>Schrittmaß 2s+a</span>
        </div>
        <div>
          <strong>{formatLength(lauf)}</strong>
          <span>Lauflänge gesamt</span>
        </div>
      </div>
      {c.warnings.length > 0 ? (
        <ul className="warnungen">
          {c.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        <p className="meta ok">DIN 18065 für Wohngebäude eingehalten.</p>
      )}
      <p className="hint">R dreht um 90°. Die Deckenöffnung im Geschoss darüber entsteht automatisch.</p>
    </>
  );
}

function DimensionProps({ dimension, levelIndex }) {
  const update = mutate(levelIndex, 'dimensions', dimension.id);
  return (
    <>
      <h3>Maß</h3>
      <p className="gross">{formatArch(dist(dimension.a, dimension.b))}</p>
      <NumberField label="Abstand der Maßlinie" value={dimension.offsetCm} onChange={(v) => update({ offsetCm: v })} min={-2000} max={2000} step={5} />
    </>
  );
}

function RoomProps({ stamp, levelIndex, project }) {
  const update = mutate(levelIndex, 'rooms', stamp.id);
  const d = deriveLevel(project, levelIndex);
  const i = d.rooms.findIndex((r) => r.stamp?.id === stamp.id);
  const room = d.rooms[i];
  const wofl = i >= 0 ? woflvByRoom(d)?.[i] : null;
  return (
    <>
      <h3>Raum</h3>
      <TextField label="Bezeichnung" value={stamp.name} onChange={(v) => update({ name: v })} />
      <SelectField
        label="Nutzung"
        value={stamp.usage}
        onChange={(v) => update({ usage: v })}
        options={Object.entries(USAGE_LABEL)}
      />
      <TextField label="Bodenbelag" value={stamp.floor} onChange={(v) => update({ floor: v })} placeholder="z. B. Parkett" />
      {room ? (
        <div className="stats">
          <div>
            <strong>{formatArea(room.areaCm2)}</strong>
            <span>Grundfläche (licht)</span>
          </div>
          <div>
            <strong>{formatLength(room.perimeterCm)}</strong>
            <span>Umfang</span>
          </div>
          {wofl != null && (
            <div>
              <strong>{de(wofl)} m²</strong>
              <span>Wohnfläche WoFlV</span>
            </div>
          )}
        </div>
      ) : (
        <p className="warnungen">Der Stempel liegt in keinem geschlossenen Raum.</p>
      )}
    </>
  );
}

function ProjectProps({ level, levelIndex, project, settings }) {
  const rows = useMemo(() => areaSchedule(project), [project]);
  const wohn = rows.reduce((s, r) => s + r.woflvM2, 0);
  const nutz = rows.filter((r) => r.usage === 'nutz').reduce((s, r) => s + r.netM2, 0);
  const roof = project.roof;
  const setLevel = (patch) =>
    commit((p) => {
      Object.assign(p.levels[levelIndex], patch);
    });
  const setRoof = (patch) =>
    commit((p) => {
      Object.assign(p.roof, patch);
    });
  const setMeta = (patch) =>
    commit((p) => {
      Object.assign(p.meta, patch);
    });

  return (
    <>
      <h3>Gebäude</h3>
      <div className="stats">
        <div>
          <strong>{de(wohn)} m²</strong>
          <span>Wohnfläche (WoFlV)</span>
        </div>
        <div>
          <strong>{de(nutz)} m²</strong>
          <span>Nutzfläche</span>
        </div>
        <div>
          <strong>{project.levels.length}</strong>
          <span>Geschosse</span>
        </div>
        <div>
          <strong>{rows.length}</strong>
          <span>Räume</span>
        </div>
      </div>
      <div className="knopfreihe">
        <button type="button" className="btn" onClick={() => setState({ flaechenOffen: true })}>
          Flächenberechnung
        </button>
        <button type="button" className="btn" onClick={() => setState({ pdfOffen: true })}>
          Plan als PDF
        </button>
      </div>

      <h3>Geschoss</h3>
      <TextField label="Name" value={level.name} onChange={(v) => setLevel({ name: v })} />
      <NumberField label="OKFF über ±0" value={level.elevationCm} onChange={(v) => setLevel({ elevationCm: v })} min={-2000} max={5000} step={0.5} />
      <NumberField label="Lichte Raumhöhe" value={level.heightCm} onChange={(v) => setLevel({ heightCm: v })} min={180} max={600} step={0.5} />
      <NumberField label="Decke + Fußboden" value={level.slabCm} onChange={(v) => setLevel({ slabCm: v })} min={5} max={80} step={0.5} />
      <p className="meta">
        Geschosshöhe {formatArch(storeyHeight(level))} · OKFF {formatLevel(level.elevationCm)} m
      </p>
      {project.levels.length > 1 && (
        <div className="knopfreihe">
          <button
            type="button"
            className="btn"
            title="Höhenlagen aller Geschosse darüber an diese Geschosshöhe anpassen"
            onClick={() =>
              commit((p) => {
                for (let i = levelIndex + 1; i < p.levels.length; i++) {
                  const below = p.levels[i - 1];
                  p.levels[i].elevationCm = below.elevationCm + below.heightCm + below.slabCm;
                }
              })
            }
          >
            Geschosse darüber anpassen
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              commit((p) => {
                const removed = p.levels[levelIndex];
                p.levels.splice(levelIndex, 1);
                if (p.roof.levelId === removed.id) p.roof.levelId = p.levels[p.levels.length - 1].id;
              });
              setState({ activeLevel: Math.max(0, levelIndex - 1), selection: null });
            }}
          >
            Geschoss löschen
          </button>
        </div>
      )}

      <h3>Dach</h3>
      <SelectField
        label="Dachform"
        value={roof.kind}
        onChange={(v) => setRoof({ kind: v })}
        options={[
          ['keins', 'Kein Dach'],
          ['sattel', 'Satteldach'],
          ['walm', 'Walmdach'],
          ['pult', 'Pultdach'],
          ['flach', 'Flachdach'],
        ]}
      />
      {roof.kind !== 'keins' && (
        <>
          <SelectField label="Auf Geschoss" value={roof.levelId} onChange={(v) => setRoof({ levelId: v })} options={project.levels.map((l) => [l.id, l.name])} />
          {roof.kind !== 'flach' && (
            <>
              <NumberField label="Dachneigung" value={roof.pitchDeg} onChange={(v) => setRoof({ pitchDeg: v })} min={3} max={70} step={0.5} unit="°" />
              <NumberField label="Kniestock" value={roof.kneeWallCm} onChange={(v) => setRoof({ kneeWallCm: v })} min={0} max={300} />
              <SelectField
                label={roof.kind === 'pult' ? 'Gefälle quer zu' : 'Firstrichtung'}
                value={roof.ridgeAlongX ? 'x' : 'y'}
                onChange={(v) => setRoof({ ridgeAlongX: v === 'x' })}
                options={[
                  ['x', 'waagerecht im Plan'],
                  ['y', 'senkrecht im Plan'],
                ]}
              />
              {roof.kind === 'pult' && (
                <SelectField
                  label="Hohe Seite"
                  value={roof.highSidePositive ? '1' : '0'}
                  onChange={(v) => setRoof({ highSidePositive: v === '1' })}
                  options={roof.ridgeAlongX ? [['1', 'unten im Plan'], ['0', 'oben im Plan']] : [['1', 'rechts im Plan'], ['0', 'links im Plan']]}
                />
              )}
            </>
          )}
          <NumberField label="Dachüberstand" value={roof.overhangCm} onChange={(v) => setRoof({ overhangCm: v })} min={0} max={200} />
          <NumberField label="Dachaufbau" value={roof.thicknessCm} onChange={(v) => setRoof({ thicknessCm: v })} min={5} max={80} />
        </>
      )}

      <h3>Plankopf</h3>
      <TextField label="Projekt" value={project.name} onChange={(v) => commit((p) => { p.name = v; })} />
      <TextField label="Bauherr" value={project.meta.bauherr} onChange={(v) => setMeta({ bauherr: v })} />
      <TextField label="Adresse" value={project.meta.adresse} onChange={(v) => setMeta({ adresse: v })} />
      <TextField label="Planverfasser" value={project.meta.planverfasser} onChange={(v) => setMeta({ planverfasser: v })} />
      <TextField label="Plannummer" value={project.meta.planNummer} onChange={(v) => setMeta({ planNummer: v })} />
      <NumberField label="Nordpfeil" value={project.meta.nordDeg} onChange={(v) => setMeta({ nordDeg: v })} min={-360} max={360} step={5} unit="°" />

      <h3>Neue Wände</h3>
      <SelectField
        label="Aufbau"
        value={settings.wallTypeId || ''}
        onChange={(v) => setState({ settings: { ...settings, wallTypeId: v } })}
        options={[['', `Einschalig ${formatArch(settings.wallThicknessCm)} cm`], ...WALL_TYPES.map((t) => [t.id, t.label])]}
      />
      <p className="hint">
        Beim Zeichnen: Länge eintippen und Enter (z. B. „450“ oder „450;90“ mit Winkel). Umschalt zeichnet rechtwinklig, Alt hebt das 15°-Raster auf.
      </p>
    </>
  );
}

export default function PropertiesPanel() {
  const state = useStore();
  const level = activeLevel(state);
  const idx = Math.min(state.activeLevel, state.project.levels.length - 1);
  const sel = state.selection;

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
  const find = (key) => (level[key] || []).find((x) => x.id === sel.id);
  if (sel?.kind === 'wall') {
    const wall = find('walls');
    body = wall ? <WallProps level={level} wall={wall} levelIndex={idx} /> : null;
  } else if (sel?.kind === 'opening') {
    const op = find('openings');
    body = op ? <OpeningProps opening={op} levelIndex={idx} /> : null;
  } else if (sel?.kind === 'furniture') {
    const f = find('furniture');
    body = f ? <FurnitureProps furniture={f} levelIndex={idx} /> : null;
  } else if (sel?.kind === 'stair') {
    const st = find('stairs');
    body = st ? <StairProps stair={st} levelIndex={idx} project={state.project} /> : null;
  } else if (sel?.kind === 'dimension') {
    const dm = find('dimensions');
    body = dm ? <DimensionProps dimension={dm} levelIndex={idx} /> : null;
  } else if (sel?.kind === 'room') {
    const r = find('rooms');
    body = r ? <RoomProps stamp={r} levelIndex={idx} project={state.project} /> : null;
  }

  return (
    <aside className="panel properties">
      {body || <ProjectProps level={level} levelIndex={idx} project={state.project} settings={state.settings} />}
      {sel && body && !state.nurLesen && (
        <div className="prop-actions">
          {sel.kind === 'furniture' && (
            <button type="button" className="btn" onClick={duplicate}>
              Duplizieren
            </button>
          )}
          <button type="button" className="btn danger" onClick={removeSelection}>
            Löschen
          </button>
        </div>
      )}
    </aside>
  );
}
