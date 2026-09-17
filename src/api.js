/* ═══════════════════════════════════════
   Planr — Aufrufe an den Server
   ═══════════════════════════════════════

   Alles, was an /api geht, laeuft hierueber. Drei Dinge sind dabei immer
   gleich und sollen nirgends vergessen werden:

   - Das Sitzungs-Cookie geht mit (same-origin).
   - Der Kopf X-Requested-With: planr. Der Server lehnt aendernde Anfragen
     ohne ihn ab -- so kann keine fremde Seite im Namen eines angemeldeten
     Browsers Projekte loeschen.
   - Fehler kommen als Meldung aus der Antwort, nicht als nackter Statuscode.
     "Das Passwort braucht mindestens 10 Zeichen." hilft, "400" nicht. */

export class ApiFehler extends Error {
  constructor(meldung, status) {
    super(meldung);
    this.status = status;
  }
}

export async function api(pfad, { methode = 'GET', daten } = {}) {
  const koepfe = { 'X-Requested-With': 'planr' };
  if (daten !== undefined) koepfe['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(pfad, {
      method: methode,
      credentials: 'same-origin',
      headers: koepfe,
      body: daten !== undefined ? JSON.stringify(daten) : undefined,
    });
  } catch {
    throw new ApiFehler('Der Server ist nicht erreichbar.', 0);
  }
  if (res.status === 204) return null;
  let rumpf = null;
  try {
    rumpf = await res.json();
  } catch {
    // keine JSON-Antwort
  }
  if (!res.ok) {
    throw new ApiFehler(rumpf?.error || `Anfrage fehlgeschlagen (${res.status})`, res.status);
  }
  return rumpf;
}

/** Datei vom Server herunterladen, mit Cookie, ohne die Seite zu verlassen. */
export function herunterladen(pfad) {
  const a = document.createElement('a');
  a.href = pfad;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
