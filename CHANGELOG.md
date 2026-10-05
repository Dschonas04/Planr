# Änderungen

## Unveröffentlicht

## 2.0.0 – 2026-10-03

Planr plant jetzt ganze Einfamilienhäuser und läuft als Mac-Programm.

### Neu
- **Geschosse** mit Höhenlage, lichter Höhe und Deckenstärke; Geschossleiste,
  neues Geschoss mit übernommenen Außenwänden, Unterlage des Geschosses darunter.
- **Wandaufbauten** mit Schichten, Schraffur, Gehrung und T-Stoß; U-Wert nach
  DIN EN ISO 6946 und Vergleich mit der GEG-Referenz.
- **Treppen** (gerade, L, U) nach DIN 18065 mit Prüfung und automatischer
  Deckenöffnung.
- **Dach** (Sattel, Walm, Pult, Flach) mit Kniestock und Überstand; Linien der
  lichten Höhe im Dachgeschoss.
- **Bemaßung**: automatische Außenmaßketten, freie Maßlinien,
  Öffnungsbeschriftung mit Brüstungshöhe, Architektenschreibweise.
- **Präzises Zeichnen**: Zahleneingabe für Länge und Winkel, rechtwinklig mit
  Umschalt, Fang an Endpunkten, Mitten, Wandachsen und Spurlinien.
- **Raumstempel** und **Wohnflächenberechnung nach WoFlV** (Tabelle, CSV, PDF).
- **PDF-Pläne** im Maßstab mit Plankopf, Nordpfeil und Maßstabsleiste.
- **3D** des ganzen Hauses mit Decken, Treppen und Dach.
- **Mac-Programm** (`.dmg`): eingebetteter Server im Einzelplatz-Betrieb,
  WebKit-Fenster, native Sichern-/Öffnen-Dialoge, Programmmenü.
- Rückfragen in der Oberfläche statt Browser-Dialogen; Exporte über einen
  gemeinsamen Speicherweg.

### Format
- Projektdateien tragen `version: 2`. Dateien der Version 1 werden beim Öffnen
  ergänzt (Höhenlagen übereinander, kein Dach, leere Treppen/Maße/Stempel).

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
