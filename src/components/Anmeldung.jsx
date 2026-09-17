import { useState } from 'react';
import { api } from '../api.js';
import { setState, useStore } from '../store.js';
import { FussLinks } from './Rechtliches.jsx';
import { IconLogo } from './icons.jsx';

/**
 * Anmeldung, Registrierung und die Einrichtung einer frischen Instanz.
 *
 * Solange es kein Konto gibt, steht hier „Blankr einrichten“: das erste Konto
 * wird Administrator. Danach ist die Registrierung geschlossen, es sei denn,
 * der Betreiber öffnet sie ausdrücklich -- in einer Firma legt die Verwaltung
 * die Konten an, nicht jeder, der die Adresse kennt.
 */
export default function Anmeldung() {
  const auth = useStore((s) => s.auth);
  const einrichtung = !!auth?.einrichtung;
  const [modus, setModus] = useState(einrichtung ? 'registrieren' : 'anmelden');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);

  const registrieren = modus === 'registrieren';

  async function absenden(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFehler('');
    try {
      if (registrieren) {
        await api('/api/registrierung', { methode: 'POST', daten: { email, name, passwort } });
      } else {
        await api('/api/anmeldung', { methode: 'POST', daten: { email, passwort } });
      }
      setState({ auth: await api('/api/status') });
    } catch (err) {
      setFehler(err.message);
    } finally {
      setBusy(false);
    }
  }

  const titel = einrichtung ? 'Planr einrichten' : registrieren ? 'Konto anlegen' : 'Anmelden';

  return (
    <div className="anmeldung">
      <form className="anmeldung-karte" onSubmit={absenden}>
        <div className="anmeldung-marke">
          <span className="logo" aria-hidden="true">
            <IconLogo />
          </span>
          <span>Planr</span>
        </div>
        <h1>{titel}</h1>
        {einrichtung && (
          <p className="anmeldung-hinweis">
            Noch gibt es kein Konto. Das erste wird Administrator; weitere legst du danach unter
            „Konto → Verwaltung“ an.
          </p>
        )}

        <label>
          E-Mail-Adresse
          <input
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {registrieren && (
          <label>
            Anzeigename
            <input
              type="text"
              autoComplete="name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wie du angezeigt wirst"
            />
          </label>
        )}
        <label>
          Passwort
          <input
            type="password"
            autoComplete={registrieren ? 'new-password' : 'current-password'}
            required
            minLength={registrieren ? 10 : undefined}
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
          />
          {registrieren && <small>Mindestens 10 Zeichen.</small>}
        </label>

        {fehler && (
          <p className="anmeldung-fehler" role="alert">
            {fehler}
          </p>
        )}

        <button type="submit" className="knopf-primaer" disabled={busy}>
          {busy ? 'Einen Moment …' : einrichtung ? 'Einrichten' : registrieren ? 'Konto anlegen' : 'Anmelden'}
        </button>

        {!einrichtung && auth?.registrierung && (
          <button
            type="button"
            className="knopf-link"
            onClick={() => {
              setModus(registrieren ? 'anmelden' : 'registrieren');
              setFehler('');
            }}
          >
            {registrieren ? 'Schon ein Konto? Anmelden' : 'Noch kein Konto? Registrieren'}
          </button>
        )}
        {!einrichtung && !auth?.registrierung && !registrieren && (
          <p className="anmeldung-klein">Kein Konto? Wende dich an die Verwaltung deiner Planr-Instanz.</p>
        )}
      </form>
      <FussLinks fest />
    </div>
  );
}
