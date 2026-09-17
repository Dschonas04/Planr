// Abgleich mit dem Server.
//
// Ein Projekt, das auf dem Server liegt, wird kurz nach jeder Aenderung dort
// gespeichert. Der Store kennt den Server nicht; er meldet nur "hat sich
// geaendert", und hier wird entschieden, ob und wann geschrieben wird. Der
// localStorage bleibt als Netz darunter: faellt der Server kurz aus, ist im
// Browser nichts verloren.

import { api } from './api.js';
import { deserialize, serialize } from './model/project.ts';
import { getState, loadProject, setServerSink, setState, toast } from './store.js';

const LETZTES = 'planr.serverProjekt';
const VERZOEGERUNG = 1500;

let timer = null;
let laeuft = null;

setServerSink(() => {
  const s = getState();
  if (!s.serverProjekt || s.nurLesen) return;
  setState({ speicherstand: 'geaendert' });
  clearTimeout(timer);
  timer = setTimeout(() => {
    jetztSpeichern().catch(() => {});
  }, VERZOEGERUNG);
});

/** Sofort speichern. Legt das Projekt an, wenn es noch nicht auf dem Server liegt. */
export async function jetztSpeichern() {
  clearTimeout(timer);
  const s = getState();
  if (s.nurLesen) return null;
  // Nicht zwei Schreibvorgaenge ueberlappen lassen: sonst kann ein aelterer
  // Stand nach einem neueren ankommen.
  if (laeuft) await laeuft.catch(() => {});
  const aktuell = getState();
  const daten = { name: aktuell.project.name, plan: JSON.parse(serialize(aktuell.project)) };
  setState({ speicherstand: 'speichert' });
  laeuft = (async () => {
    try {
      const meta = aktuell.serverProjekt
        ? await api(`/api/projects/${aktuell.serverProjekt.id}`, { methode: 'PUT', daten })
        : await api('/api/projects', { methode: 'POST', daten });
      merken(meta.id);
      setState({ serverProjekt: { id: meta.id, name: meta.name, geteilt: meta.geteilt }, speicherstand: 'gespeichert' });
      return meta;
    } catch (err) {
      setState({ speicherstand: 'fehler' });
      if (err.status === 401) setState({ anmeldungNoetig: true });
      else if (err.status === 404) {
        // Auf dem Server geloescht oder nicht mehr zugaenglich: lokal
        // weiterarbeiten, statt immer wieder ins Leere zu schreiben.
        setState({ serverProjekt: null });
        toast('Das Projekt gibt es auf dem Server nicht mehr. Speichere es neu.', 'error');
      } else {
        toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
      }
      throw err;
    }
  })();
  return laeuft;
}

export async function projektOeffnen(id) {
  const { meta, plan } = await api(`/api/projects/${encodeURIComponent(id)}`);
  loadProject(deserialize(plan), { vomServer: true });
  merken(meta.id);
  setState({ serverProjekt: { id: meta.id, name: meta.name, geteilt: meta.geteilt }, speicherstand: 'gespeichert' });
  return meta;
}

/** Nach der Anmeldung dort weitermachen, wo man aufgehoert hat. */
export async function letztesProjektOeffnen() {
  let id = null;
  try {
    id = localStorage.getItem(LETZTES);
  } catch {
    return;
  }
  if (!id) return;
  try {
    await projektOeffnen(id);
  } catch {
    vergessen();
  }
}

export function vergessen() {
  try {
    localStorage.removeItem(LETZTES);
  } catch {
    // ohne Gedaechtnis
  }
}

function merken(id) {
  try {
    localStorage.setItem(LETZTES, id);
  } catch {
    // ohne Gedaechtnis
  }
}

/** Ein geteilter Grundriss, nur lesend, ohne Anmeldung. */
export async function geteiltOeffnen(token) {
  const geteilt = await api(`/api/shared/${encodeURIComponent(token)}`);
  loadProject(deserialize(geteilt.plan), { vomServer: true });
  setState({ nurLesen: true, geteilterName: geteilt.name, serverProjekt: null, speicherstand: null, tool: 'select' });
  return geteilt;
}
