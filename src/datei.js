// Dateien speichern und öffnen -- im Browser über Download und Dateiauswahl,
// im Mac-Programm über die nativen Dialoge des Systems.
//
// Die eingebettete WebKit-Ansicht des Desktop-Programms kennt weder
// Downloads noch <input type="file">. Dort reicht die Oberfläche die Datei an
// den lokalen Planr-Prozess weiter, der den Sichern-Dialog von macOS öffnet.

import { api } from './api.js';
import { istDesktop, toast } from './store.js';

async function base64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Speichert einen Blob unter einem vorgeschlagenen Namen. */
export async function dateiSpeichern(name, blob) {
  if (istDesktop()) {
    try {
      const res = await api('/api/desktop/speichern', { methode: 'POST', daten: { name, inhalt: await base64(blob) } });
      if (res?.pfad) toast(`Gespeichert: ${res.pfad}`);
    } catch (err) {
      toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst nach dem Klick freigeben, sonst bricht der Download in Firefox ab.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Lädt eine Datei vom Server (mit Sitzung) und speichert sie. */
export async function serverDateiSpeichern(pfad, name) {
  const res = await fetch(pfad, { credentials: 'same-origin', headers: { 'X-Requested-With': 'planr' } });
  if (!res.ok) {
    toast(`Export fehlgeschlagen (${res.status}).`, 'error');
    return;
  }
  const kopf = res.headers.get('Content-Disposition') || '';
  const m = kopf.match(/filename="?([^";]+)"?/);
  await dateiSpeichern(m ? m[1] : name, await res.blob());
}

/**
 * Öffnet eine Datei und liefert { name, text } oder null bei Abbruch.
 * `endungen` z. B. ['planr', 'json'].
 */
export function dateiOeffnen(endungen) {
  if (istDesktop()) {
    return api('/api/desktop/oeffnen', { methode: 'POST', daten: { endungen } }).then((res) => {
      if (!res?.inhalt) return null;
      const bytes = Uint8Array.from(atob(res.inhalt), (c) => c.charCodeAt(0));
      return { name: res.name, text: new TextDecoder().decode(bytes) };
    });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = endungen.map((e) => `.${e}`).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.click();
  });
}
