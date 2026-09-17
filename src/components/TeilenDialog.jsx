import { useEffect, useState } from 'react';
import { api, herunterladen } from '../api.js';
import { setState, toast, useStore } from '../store.js';
import { jetztSpeichern } from '../sync.js';

/**
 * Teilen und Export über den Server.
 *
 * Ein Freigabe-Link zeigt den Grundriss nur lesend, ohne Anmeldung, und lässt
 * sich jederzeit zurückziehen. Die Exporte rechnet der Server -- DXF für CAD,
 * PNG in hoher Auflösung, SVG in Millimetern, .planr zum Weitergeben.
 */
export default function TeilenDialog() {
  const offen = useStore((s) => s.teilenOffen);
  const projekt = useStore((s) => s.serverProjekt);
  const [token, setToken] = useState(null);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!offen || !projekt) return;
    setFehler('');
    setToken(null);
    api(`/api/projects/${projekt.id}`)
      .then(({ meta }) => setToken(meta.shareToken || ''))
      .catch((e) => setFehler(e.message));
  }, [offen, projekt?.id]);

  if (!offen) return null;
  const schliessen = () => setState({ teilenOffen: false });

  if (!projekt) {
    return (
      <div className="board-backdrop" onPointerDown={schliessen}>
        <div className="board-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Teilen">
          <header>
            <h2>Teilen und exportieren</h2>
            <button type="button" className="board-close" onClick={schliessen} title="Schließen">
              ×
            </button>
          </header>
          <p className="board-hint">Teilen und die Exporte des Servers gibt es für Projekte, die auf dem Server liegen.</p>
          <button
            type="button"
            className="knopf-primaer"
            onClick={() => jetztSpeichern().then(() => toast('Auf dem Server gespeichert.')).catch(() => {})}
          >
            Jetzt auf dem Server speichern
          </button>
        </div>
      </div>
    );
  }

  const link = token ? `${location.origin}/#/geteilt/${token}` : '';

  async function freigabe(erstellen) {
    setBusy(true);
    setFehler('');
    try {
      if (erstellen) {
        const r = await api(`/api/projects/${projekt.id}/share`, { methode: 'POST' });
        setToken(r.token);
      } else {
        await api(`/api/projects/${projekt.id}/share`, { methode: 'DELETE' });
        setToken('');
        toast('Link zurückgezogen.');
      }
      setState({ serverProjekt: { ...projekt, geteilt: erstellen } });
    } catch (e) {
      setFehler(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportieren(format) {
    // Vor dem Export den aktuellen Stand schreiben, sonst exportiert der
    // Server die Fassung von vor zwei Sekunden.
    await jetztSpeichern().catch(() => {});
    herunterladen(`/api/projects/${projekt.id}/${format}`);
  }

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Teilen">
        <header>
          <h2>„{projekt.name}“ teilen</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>
        {fehler && <p className="board-error">{fehler}</p>}

        <section className="freigabe-zeile">
          <div className="freigabe-kopf">
            <strong>Link zum Ansehen</strong>
            <span>Zeigt den Grundriss samt 3D-Ansicht, ohne Anmeldung und ohne Änderungsmöglichkeit.</span>
          </div>
          {token === null ? (
            <p className="board-hint">Lädt …</p>
          ) : token ? (
            <div className="freigabe-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Freigabe-Link" />
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link)
                    .then(() => toast('Link kopiert.'))
                    .catch(() => toast('Kopieren nicht möglich, Link bitte markieren.', 'error'))
                }
              >
                Kopieren
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => freigabe(false)}>
                Zurückziehen
              </button>
            </div>
          ) : (
            <button type="button" className="knopf-primaer" disabled={busy} onClick={() => freigabe(true)}>
              Link erstellen
            </button>
          )}
        </section>

        <section className="freigabe-zeile">
          <div className="freigabe-kopf">
            <strong>Exportieren</strong>
            <span>Vom Server berechnet: DXF für CAD, PNG in 2000 px, SVG in Millimetern, .planr zum Weitergeben.</span>
          </div>
          <div className="freigabe-link">
            <button type="button" onClick={() => exportieren('dxf')}>DXF</button>
            <button type="button" onClick={() => exportieren('png')}>PNG</button>
            <button type="button" onClick={() => exportieren('svg')}>SVG</button>
            <button type="button" onClick={() => exportieren('planr')}>.planr</button>
          </div>
        </section>
      </div>
    </div>
  );
}
