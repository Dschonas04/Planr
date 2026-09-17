# Änderungen

## 1.0.0 – 2026-09-17

Erste Version für den geschäftlichen Einsatz.

### Neu
- **Konten**: Einrichtung (erstes Konto wird Administrator), Anmeldung,
  Registrierung (standardmäßig geschlossen), Passwortänderung, Sperren,
  Rollen Administrator/Nutzer.
- **Projekte auf dem Server**: Projektliste mit Raumzahl und Fläche, Öffnen,
  Import von `.planr`, Löschen; automatisches Speichern kurz nach jeder
  Änderung mit Anzeige des Speicherstands.
- **Teilen**: Link zum Ansehen samt 3D-Ansicht, ohne Konto, zurückziehbar;
  Exporte des Servers (DXF, PNG, SVG, `.planr`) direkt aus der Oberfläche.
- **Verwaltung**: Konten anlegen, sperren, Passwort setzen, löschen (Projekte
  gehen an den Administrator über); Datensicherung als `tar.gz`.
- **Datenschutz**: Impressum und Datenschutzerklärung (mit Vorlage) pflegbar
  und verlinkt; Export aller eigenen Daten; Konto samt Projekten löschen.
- **Sicherheit**: Anmeldung und Eigentumsprüfung in allen Projekt-, Export- und
  Import-Aufrufen, Content-Security-Policy und weitere Sicherheits-Header,
  CSRF-Schutz, Anfragebremse, bcrypt, gehashte Sitzungen, Projektkennungen mit
  128 statt 32 Bit.
- **Betrieb**: Einstellungen über Umgebungsvariablen, Prometheus-Metriken
  (`PLANR_METRIKEN=ja`), Versionsangabe unter `/healthz`.

### Migration von 0.x
- Beim ersten Aufruf nach dem Update richtet jemand das erste Konto ein; alle
  bestehenden Projekte gehören danach diesem Konto.
- Die REST-API verlangt jetzt eine Anmeldung. Skripte, die `/api/projects`
  ohne Sitzung aufgerufen haben, brauchen ein Konto.
- Bestehende Freigabe-Links bleiben gültig.
