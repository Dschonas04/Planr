import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { newProject, setState, toast, useStore } from '../store.js';
import { jetztSpeichern, projektOeffnen, vergessen } from '../sync.js';

/**
 * Die Projekte auf dem Server.
 *
 * Bis 0.x lag ein Grundriss nur im Browser, in dem er gezeichnet wurde. Hier
 * liegt jetzt, was einem Konto gehört: von jedem Gerät erreichbar, im
 * Hintergrund gespeichert, teilbar.
 */
const flaeche = (cm2) => `${(cm2 / 10000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} m²`;
const datum = (ms) =>
  new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ProjektDialog() {
  const offen = useStore((s) => s.projekteOffen);
  const aktuell = useStore((s) => s.serverProjekt);
  const projektName = useStore((s) => s.project.name);
  const [liste, setListe] = useState(null);
  const [fehler, setFehler] = useState('');
  const dateiRef = useRef(null);

  const laden = useCallback(() => {
    api('/api/projects')
      .then(setListe)
      .catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    if (!offen) return;
    setFehler('');
    laden();
  }, [offen, laden]);

  if (!offen) return null;
  const schliessen = () => setState({ projekteOffen: false });

  async function oeffnen(p) {
    try {
      await projektOeffnen(p.id);
      toast(`„${p.name}“ geöffnet.`);
      schliessen();
    } catch (e) {
      setFehler(e.message);
    }
  }

  async function aktuellesSpeichern() {
    try {
      await jetztSpeichern();
      toast('Auf dem Server gespeichert.');
      laden();
    } catch (e) {
      setFehler(e.message);
    }
  }

  async function loeschen(p) {
    if (!window.confirm(`Projekt „${p.name}“ endgültig löschen?`)) return;
    try {
      await api(`/api/projects/${p.id}`, { methode: 'DELETE' });
      if (aktuell?.id === p.id) {
        setState({ serverProjekt: null, speicherstand: null });
        vergessen();
      }
      laden();
    } catch (e) {
      setFehler(e.message);
    }
  }

  async function importieren(ev) {
    const datei = ev.target.files?.[0];
    ev.target.value = '';
    if (!datei) return;
    setFehler('');
    try {
      const res = await fetch(`/api/import?name=${encodeURIComponent(datei.name.replace(/\.(planr\.)?json$/i, ''))}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'planr', 'Content-Type': 'application/json' },
        body: await datei.text(),
      });
      const antwort = await res.json().catch(() => ({}));
      if (!res.ok) {
        const maengel = antwort.issues?.length ? `: ${antwort.issues.slice(0, 3).join('; ')}` : '';
        throw new Error((antwort.error || 'Import fehlgeschlagen') + maengel);
      }
      await projektOeffnen(antwort.id);
      toast(`„${antwort.name}“ importiert.`);
      schliessen();
    } catch (e) {
      setFehler(e.message);
    }
  }

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog projekt-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Projekte">
        <header>
          <h2>Projekte</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>

        <div className="projekt-aktionen">
          {!aktuell && (
            <button type="button" className="knopf-primaer" onClick={aktuellesSpeichern}>
              „{projektName}“ auf dem Server speichern
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              newProject();
              setState({ serverProjekt: null, speicherstand: null });
              vergessen();
              schliessen();
            }}
          >
            Neues Projekt
          </button>
          <button type="button" onClick={() => dateiRef.current?.click()}>
            .planr importieren
          </button>
          <input ref={dateiRef} type="file" accept=".json,.planr,application/json" hidden onChange={importieren} />
        </div>

        {fehler && <p className="board-error">{fehler}</p>}
        {liste === null && !fehler && <p className="board-hint">Lädt …</p>}

        {liste && (
          <ul className="projekt-liste">
            {liste.map((p) => (
              <li key={p.id} className={aktuell?.id === p.id ? 'current' : ''}>
                <button type="button" className="projekt-oeffnen" onClick={() => oeffnen(p)}>
                  <strong>{p.name}</strong>
                  <span>
                    {p.rooms} {p.rooms === 1 ? 'Raum' : 'Räume'} · {flaeche(p.areaCm2)} · {datum(p.updatedAt)}
                    {p.geteilt ? ' · geteilt' : ''}
                    {!p.eigen && p.besitzer ? ` · gehört ${p.besitzer}` : ''}
                  </span>
                </button>
                <span className="board-actions">
                  <button type="button" className="danger" onClick={() => loeschen(p)}>
                    Löschen
                  </button>
                </span>
              </li>
            ))}
            {!liste.length && <li className="board-empty">Noch keine Projekte auf dem Server.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
