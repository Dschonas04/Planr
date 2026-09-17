import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { setState, useStore } from '../store.js';

/**
 * Impressum und Datenschutzerklärung.
 *
 * Der Text kommt vom Server: Administratoren pflegen ihn unter „Konto →
 * Rechtliches“. Für die Datenschutzerklärung liefert Blankr eine Vorlage mit,
 * die beschreibt, was die Anwendung tatsächlich verarbeitet.
 */
const TITEL = { impressum: 'Impressum', datenschutz: 'Datenschutzerklärung' };

export default function Rechtliches() {
  const offen = useStore((s) => s.rechtlichesOffen);
  const [text, setText] = useState(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!offen) return;
    setText(null);
    setFehler('');
    api(`/api/rechtliches/${offen}`)
      .then((r) => setText(r.text))
      .catch((e) => setFehler(e.message));
  }, [offen]);

  if (!offen) return null;
  const schliessen = () => setState({ rechtlichesOffen: null });

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog rechts-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={TITEL[offen]}>
        <header>
          <h2>{TITEL[offen]}</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>
        {fehler && <p className="board-error">{fehler}</p>}
        {text === null && !fehler && <p className="board-hint">Lädt …</p>}
        {text !== null && (
          <div className="rechts-text">
            {text.trim() ? text : 'Der Betreiber dieser Instanz hat noch kein Impressum hinterlegt.'}
          </div>
        )}
      </div>
    </div>
  );
}

export function FussLinks({ fest = false }) {
  return (
    <nav className={'fuss-links' + (fest ? ' fest' : '')}>
      <button type="button" onClick={() => setState({ rechtlichesOffen: 'impressum' })}>
        Impressum
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => setState({ rechtlichesOffen: 'datenschutz' })}>
        Datenschutz
      </button>
    </nav>
  );
}
