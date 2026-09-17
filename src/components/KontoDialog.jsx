import { useCallback, useEffect, useState } from 'react';
import { api, herunterladen } from '../api.js';
import { setState, toast, useStore } from '../store.js';

/**
 * Das eigene Konto und, für Administratoren, die Verwaltung der Instanz.
 *
 * Profil: Name und Passwort. Daten: alles herunterladen, Konto löschen --
 * beides verlangt die DSGVO, und beides soll ohne Umweg über eine E-Mail an
 * den Betreiber gehen. Verwaltung: Konten, rechtliche Texte, Sicherung.
 */
export default function KontoDialog() {
  const offen = useStore((s) => s.kontoOffen);
  const konto = useStore((s) => s.auth?.konto);
  const [reiter, setReiter] = useState('profil');

  if (!offen || !konto) return null;
  const admin = konto.rolle === 'admin';
  const schliessen = () => setState({ kontoOffen: false });

  const reiterListe = [
    ['profil', 'Profil'],
    ['daten', 'Meine Daten'],
    ...(admin ? [['konten', 'Konten'], ['rechtliches', 'Rechtliches'], ['sicherung', 'Sicherung']] : []),
  ];

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog konto-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Konto">
        <header>
          <h2>Konto</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>
        <div className="konto-reiter" role="tablist">
          {reiterListe.map(([id, titel]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={reiter === id}
              className={reiter === id ? 'aktiv' : ''}
              onClick={() => setReiter(id)}
            >
              {titel}
            </button>
          ))}
        </div>
        <div className="konto-inhalt">
          {reiter === 'profil' && <Profil konto={konto} />}
          {reiter === 'daten' && <MeineDaten konto={konto} />}
          {reiter === 'konten' && admin && <Konten eigeneId={konto.id} />}
          {reiter === 'rechtliches' && admin && <RechtlicheTexte />}
          {reiter === 'sicherung' && admin && <Sicherung />}
        </div>
      </div>
    </div>
  );
}

async function statusNeu() {
  setState({ auth: await api('/api/status') });
}

function Profil({ konto }) {
  const [name, setName] = useState(konto.name);
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [meldung, setMeldung] = useState('');

  async function nameSpeichern(e) {
    e.preventDefault();
    try {
      await api('/api/konto', { methode: 'PATCH', daten: { name } });
      await statusNeu();
      toast('Name gespeichert');
    } catch (err) {
      setMeldung(err.message);
    }
  }

  async function passwortSpeichern(e) {
    e.preventDefault();
    try {
      await api('/api/konto/passwort', { methode: 'POST', daten: { alt, neu } });
      setAlt('');
      setNeu('');
      setMeldung('');
      toast('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
    } catch (err) {
      setMeldung(err.message);
    }
  }

  async function abmelden() {
    await api('/api/abmeldung', { methode: 'POST' }).catch(() => {});
    window.location.href = '/';
  }

  return (
    <>
      <p className="konto-zeile">
        <span>{konto.email}</span>
        <em>{konto.rolle === 'admin' ? 'Administrator' : 'Nutzer'}</em>
      </p>
      <form className="konto-form" onSubmit={nameSpeichern}>
        <label>
          Anzeigename
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Speichern</button>
      </form>
      <form className="konto-form" onSubmit={passwortSpeichern}>
        <label>
          Bisheriges Passwort
          <input type="password" autoComplete="current-password" value={alt} onChange={(e) => setAlt(e.target.value)} required />
        </label>
        <label>
          Neues Passwort
          <input type="password" autoComplete="new-password" minLength={10} value={neu} onChange={(e) => setNeu(e.target.value)} required />
        </label>
        <button type="submit">Passwort ändern</button>
      </form>
      {meldung && <p className="board-error">{meldung}</p>}
      <button type="button" className="knopf-link" onClick={abmelden}>
        Abmelden
      </button>
    </>
  );
}

function MeineDaten({ konto }) {
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');

  async function loeschen(e) {
    e.preventDefault();
    if (!window.confirm('Konto und alle eigenen Projekte endgültig löschen? Das lässt sich nicht rückgängig machen.')) return;
    try {
      await api('/api/konto', { methode: 'DELETE', daten: { passwort } });
      window.location.href = '/';
    } catch (err) {
      setFehler(err.message);
    }
  }

  return (
    <>
      <section className="konto-abschnitt">
        <h3>Daten herunterladen</h3>
        <p>Deine Kontoangaben und alle Projekte, die dir gehören, samt Grundriss als eine JSON-Datei.</p>
        <button type="button" onClick={() => herunterladen('/api/konto/export')}>
          Herunterladen
        </button>
      </section>
      <section className="konto-abschnitt gefahr">
        <h3>Konto löschen</h3>
        <p>
          Löscht das Konto {konto.email} und alle Projekte, die ihm gehören. Freigabe-Links auf diese Projekte werden
          ungültig.
        </p>
        <form className="konto-form" onSubmit={loeschen}>
          <label>
            Passwort zur Bestätigung
            <input type="password" autoComplete="current-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} required />
          </label>
          <button type="submit" className="danger">
            Konto löschen
          </button>
        </form>
        {fehler && <p className="board-error">{fehler}</p>}
      </section>
    </>
  );
}

function Konten({ eigeneId }) {
  const [liste, setListe] = useState([]);
  const [fehler, setFehler] = useState('');
  const [neu, setNeu] = useState({ email: '', name: '', passwort: '', rolle: 'nutzer' });

  const laden = useCallback(() => {
    api('/api/admin/konten')
      .then(setListe)
      .catch((e) => setFehler(e.message));
  }, []);
  useEffect(laden, [laden]);

  async function anlegen(e) {
    e.preventDefault();
    setFehler('');
    try {
      await api('/api/admin/konten', { methode: 'POST', daten: neu });
      setNeu({ email: '', name: '', passwort: '', rolle: 'nutzer' });
      toast('Konto angelegt. Gib das Passwort auf sicherem Weg weiter.');
      laden();
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function aendern(k, daten) {
    setFehler('');
    try {
      await api(`/api/admin/konten/${k.id}`, { methode: 'PATCH', daten });
      laden();
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function passwortSetzen(k) {
    const pw = window.prompt(`Neues Passwort für ${k.email} (mindestens 10 Zeichen):`);
    if (!pw) return;
    await aendern(k, { passwort: pw });
    toast('Passwort gesetzt, alle Sitzungen des Kontos beendet');
  }

  async function loeschen(k) {
    const behalten = window.confirm(
      `Konto ${k.email} löschen?\n\nOK: Seine ${k.projekte} Projekt(e) gehen an dich über.\nAbbrechen: nichts tun.`,
    );
    if (!behalten) return;
    try {
      await api(`/api/admin/konten/${k.id}`, { methode: 'DELETE' });
      laden();
    } catch (err) {
      setFehler(err.message);
    }
  }

  return (
    <>
      <form className="konto-neu" onSubmit={anlegen}>
        <h3>Konto anlegen</h3>
        <div className="konto-neu-felder">
          <input type="email" placeholder="E-Mail-Adresse" required value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} />
          <input placeholder="Anzeigename" maxLength={40} value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
          <input type="password" autoComplete="new-password" placeholder="Anfangspasswort (min. 10)" minLength={10} required value={neu.passwort} onChange={(e) => setNeu({ ...neu, passwort: e.target.value })} />
          <select value={neu.rolle} onChange={(e) => setNeu({ ...neu, rolle: e.target.value })} aria-label="Rolle">
            <option value="nutzer">Nutzer</option>
            <option value="admin">Administrator</option>
          </select>
          <button type="submit" className="knopf-primaer">
            Anlegen
          </button>
        </div>
      </form>
      {fehler && <p className="board-error">{fehler}</p>}
      <ul className="konto-liste">
        {liste.map((k) => (
          <li key={k.id} className={k.gesperrt ? 'gesperrt' : ''}>
            <div className="konto-liste-name">
              <strong>{k.name}</strong>
              <span>
                {k.email} · {k.projekte} Projekt(e){k.gesperrt ? ' · gesperrt' : ''}
              </span>
            </div>
            <select
              value={k.rolle}
              disabled={k.id === eigeneId}
              onChange={(e) => aendern(k, { rolle: e.target.value })}
              aria-label={`Rolle von ${k.email}`}
            >
              <option value="nutzer">Nutzer</option>
              <option value="admin">Administrator</option>
            </select>
            {k.id !== eigeneId && (
              <span className="board-actions">
                <button type="button" onClick={() => aendern(k, { gesperrt: !k.gesperrt })}>
                  {k.gesperrt ? 'Entsperren' : 'Sperren'}
                </button>
                <button type="button" onClick={() => passwortSetzen(k)}>
                  Passwort
                </button>
                <button type="button" className="danger" onClick={() => loeschen(k)}>
                  Löschen
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function RechtlicheTexte() {
  const [welcher, setWelcher] = useState('impressum');
  const [text, setText] = useState('');
  const [eigen, setEigen] = useState(false);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    setFehler('');
    api(`/api/rechtliches/${welcher}`)
      .then((r) => {
        setText(r.text);
        setEigen(r.eigen);
      })
      .catch((e) => setFehler(e.message));
  }, [welcher]);

  async function speichern() {
    try {
      const r = await api(`/api/rechtliches/${welcher}`, { methode: 'PUT', daten: { text } });
      setText(r.text);
      setEigen(r.eigen);
      await statusNeu();
      toast('Gespeichert');
    } catch (e) {
      setFehler(e.message);
    }
  }

  return (
    <>
      <div className="konto-reiter klein">
        <button type="button" className={welcher === 'impressum' ? 'aktiv' : ''} onClick={() => setWelcher('impressum')}>
          Impressum
        </button>
        <button type="button" className={welcher === 'datenschutz' ? 'aktiv' : ''} onClick={() => setWelcher('datenschutz')}>
          Datenschutzerklärung
        </button>
      </div>
      <p className="board-hint">
        {welcher === 'impressum'
          ? 'Pflichtangaben nach § 5 DDG: Name und Anschrift, Kontakt, ggf. Registergericht und USt-IdNr.'
          : eigen
            ? 'Eigener Text ist hinterlegt. Leeren und speichern stellt die Vorlage wieder her.'
            : 'Das ist die mitgelieferte Vorlage. Sie beschreibt, was Planr verarbeitet – prüfe und ergänze sie.'}
      </p>
      <textarea className="rechts-editor" value={text} onChange={(e) => setText(e.target.value)} rows={14} />
      {fehler && <p className="board-error">{fehler}</p>}
      <button type="button" className="knopf-primaer" onClick={speichern}>
        Speichern
      </button>
    </>
  );
}

function Sicherung() {
  return (
    <section className="konto-abschnitt">
      <h3>Datensicherung</h3>
      <p>
        Lädt das gesamte Datenverzeichnis als tar.gz herunter: Projekte, Konten, rechtliche Texte. Sitzungen sind nicht
        enthalten – nach dem Einspielen meldet sich jeder neu an.
      </p>
      <p>
        Zum Wiederherstellen den Dienst stoppen, das Archiv in das Datenverzeichnis entpacken (Volume <code>/data</code>)
        und den Dienst starten.
      </p>
      <button type="button" className="knopf-primaer" onClick={() => herunterladen('/api/admin/sicherung')}>
        Sicherung herunterladen
      </button>
    </section>
  );
}
