import { useMemo } from 'react';
import { setState, useStore } from '../store.js';
import { areaSchedule, USAGE_LABEL } from '../model/building.ts';
import { dateiSpeichern } from '../datei.js';

const de = (v) => v.toFixed(2).replace('.', ',');

/** Wohn- und Nutzflächenaufstellung nach WoFlV über alle Geschosse. */
export default function FlaechenDialog() {
  const offen = useStore((s) => s.flaechenOffen);
  const project = useStore((s) => s.project);
  const rows = useMemo(() => (offen ? areaSchedule(project) : []), [offen, project]);
  if (!offen) return null;
  const schliessen = () => setState({ flaechenOffen: false });
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);

  const csv = () => {
    const kopf = ['Geschoss', 'Raum', 'Nutzung', 'Bodenbelag', 'Grundfläche m²', 'ab 2 m', '1–2 m', 'WoFlV m²', 'Umfang m'];
    const zeilen = rows.map((r) => [r.level, r.name, USAGE_LABEL[r.usage], r.floor, de(r.netM2), de(r.fullM2), de(r.halfM2), de(r.woflvM2), de(r.perimeterM)]);
    const text = [kopf, ...zeilen].map((z) => z.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    // BOM, damit Excel die Umlaute erkennt.
    dateiSpeichern(`${project.name || 'flaechen'} – Flächen.csv`, new Blob(['﻿' + text], { type: 'text/csv' }));
  };

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog flaechen-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Flächenberechnung">
        <header>
          <h2>Flächenberechnung nach WoFlV</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>
        <div className="tabelle-rahmen">
          <table className="flaechen">
            <thead>
              <tr>
                <th>Geschoss</th>
                <th>Raum</th>
                <th>Nutzung</th>
                <th>Boden</th>
                <th className="zahl">Grundfläche</th>
                <th className="zahl">ab 2 m</th>
                <th className="zahl">1–2 m</th>
                <th className="zahl">WoFlV</th>
                <th className="zahl">Umfang</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i > 0 && rows[i - 1].level !== r.level ? 'neu' : ''}>
                  <td>{i === 0 || rows[i - 1].level !== r.level ? r.level : ''}</td>
                  <td>{r.name}</td>
                  <td>{USAGE_LABEL[r.usage]}</td>
                  <td>{r.floor}</td>
                  <td className="zahl">{de(r.netM2)} m²</td>
                  <td className="zahl">{de(r.fullM2)}</td>
                  <td className="zahl">{de(r.halfM2)}</td>
                  <td className="zahl">
                    <strong>{de(r.woflvM2)} m²</strong>
                  </td>
                  <td className="zahl">{de(r.perimeterM)} m</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>Wohnfläche nach WoFlV</td>
                <td className="zahl">
                  <strong>{de(sum((r) => r.woflvM2))} m²</strong>
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={7}>Nutzfläche</td>
                <td className="zahl">{de(sum((r) => (r.usage === 'nutz' ? r.netM2 : 0)))} m²</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="board-hint">
          Lichte Maße zwischen den Wandoberflächen. Unter Dachschrägen zählt die Fläche ab 2 m lichter Höhe voll, zwischen 1 und 2 m zur Hälfte, darunter nicht. Balkone und Terrassen zu einem Viertel. Räume ohne Stempel gelten als Wohnraum.
        </p>
        <div className="knopfreihe">
          <button type="button" onClick={csv}>
            Als CSV (Excel)
          </button>
          <button type="button" className="knopf-primaer" onClick={() => setState({ flaechenOffen: false, pdfOffen: true })}>
            Mit den Plänen als PDF
          </button>
        </div>
      </div>
    </div>
  );
}
