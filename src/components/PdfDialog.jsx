import { useEffect, useState } from 'react';
import { getState, setState, toast, useStore } from '../store.js';
import { planFits, planPdf } from '../planPdf.js';
import { dateiSpeichern } from '../datei.js';

/** Maßstäbliche Pläne als PDF: Geschosse, Maßstab, Papierformat. */
export default function PdfDialog() {
  const offen = useStore((s) => s.pdfOffen);
  const project = useStore((s) => s.project);
  const aktiv = useStore((s) => s.activeLevel);
  const [auswahl, setAuswahl] = useState([]);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState('A3');
  const [landscape, setLandscape] = useState(true);
  const [flaechen, setFlaechen] = useState(true);
  const [moebel, setMoebel] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (offen) setAuswahl(project.levels.map((_, i) => i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  if (!offen) return null;
  const schliessen = () => setState({ pdfOffen: false });
  const passt = auswahl.map((i) => planFits(project, i, { scale, paper, landscape }));

  async function erstellen() {
    setBusy(true);
    try {
      const s = getState();
      const blob = planPdf(project, {
        levels: auswahl.slice().sort((a, b) => a - b),
        scale,
        paper,
        landscape,
        flaechen,
        settings: { ...s.settings, showFurniture: moebel, showDimensions: false },
      });
      await dateiSpeichern(`${project.name || 'Plan'} – Grundrisse 1-${scale}.pdf`, blob);
      schliessen();
    } catch (e) {
      toast(`PDF konnte nicht erstellt werden: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Plan als PDF">
        <header>
          <h2>Plan als PDF</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>
        <section className="pdf-optionen">
          <div>
            <strong>Geschosse</strong>
            {project.levels.map((l, i) => (
              <label key={l.id} className="toggle">
                <input
                  type="checkbox"
                  checked={auswahl.includes(i)}
                  onChange={(e) => setAuswahl(e.target.checked ? [...auswahl, i] : auswahl.filter((x) => x !== i))}
                />
                {l.name}
                {i === aktiv ? ' (aktiv)' : ''}
              </label>
            ))}
          </div>
          <div>
            <strong>Maßstab</strong>
            {[50, 100, 200].map((m) => (
              <label key={m} className="toggle">
                <input type="radio" name="massstab" checked={scale === m} onChange={() => setScale(m)} />
                1:{m}
              </label>
            ))}
          </div>
          <div>
            <strong>Papier</strong>
            {['A4', 'A3', 'A2', 'A1'].map((p) => (
              <label key={p} className="toggle">
                <input type="radio" name="papier" checked={paper === p} onChange={() => setPaper(p)} />
                {p}
              </label>
            ))}
            <label className="toggle">
              <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} />
              Querformat
            </label>
          </div>
          <div>
            <strong>Inhalt</strong>
            <label className="toggle">
              <input type="checkbox" checked={moebel} onChange={(e) => setMoebel(e.target.checked)} />
              Möblierung
            </label>
            <label className="toggle">
              <input type="checkbox" checked={flaechen} onChange={(e) => setFlaechen(e.target.checked)} />
              Flächenberechnung
            </label>
          </div>
        </section>
        {passt.some((p) => !p) && (
          <p className="board-error">
            Nicht jedes Geschoss passt im Maßstab 1:{scale} auf {paper}
            {landscape ? ' quer' : ' hoch'}. Größeres Papier oder kleineren Maßstab wählen — sonst wird der Plan am Rand abgeschnitten.
          </p>
        )}
        <div className="knopfreihe">
          <button type="button" className="knopf-primaer" disabled={busy || !auswahl.length} onClick={erstellen}>
            {busy ? 'Erstellt …' : 'PDF erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
