# Planr — maßstabsgetreuer Grundriss-Planer

Planr ist eine browserbasierte Anwendung, mit der sich eine Wohnung oder ein
Haus maßstabsgetreu zeichnen und möblieren lässt. Gerechnet wird durchgängig in
Zentimetern; die 3D-Vorschau baut denselben Plan als begehbares Modell auf.

Der Editor läuft vollständig im Browser. Dazu kommt ein schlanker Go-Server,
der Projekte speichert, sie über Links teilbar macht und Grundrisse als SVG
ausliefert — ohne Anmeldung und ohne Datenbank.

## Funktionen

### Zeichnen
- **Wandzüge** — Klick für Klick, mit laufender Längenanzeige in cm bzw. m
- **Winkelraster** — Wände rasten auf 15° ein, `Alt` hebt das auf
- **Fangpunkte** — Wandenden ziehen sich gegenseitig an, sonst greift das Raster
- **Wanddicken** — 11,5 / 17,5 / 24 / 30 / 36,5 cm, frei pro Wand änderbar
- **Türen und Fenster** — auf eine Wand klicken; Breite, Höhe, Brüstung und
  Anschlagsrichtung sind einstellbar
- **Maßketten** — jede Wand zeigt ihre Länge, abschaltbar

### Räume
- **Automatische Raumerkennung** — geschlossene Wandzüge werden als Flächen
  erkannt und mit ihrer Größe in m² beschriftet
- **T-Stöße** — Innenwände, die mitten auf einer Außenwand enden, teilen die
  Fläche korrekt
- **Gesamtfläche** — Anzahl Räume, Fläche, Wände und Möbel auf einen Blick

### Möblieren
- **Katalog mit realen Maßen** — rund 40 Objekte in acht Kategorien, von
  Einzelbett 90×200 bis Badewanne 170×75
- **Frei anpassbar** — Breite, Tiefe, Höhe, Drehung, Farbe und Name pro Objekt
- **Bedienung** — ziehen zum Verschieben, Eckgriffe zum Skalieren, Drehgriff
  oder `R` für 15°-Schritte

### 3D-Vorschau
- Wände werden auf Raumhöhe extrudiert, Fenster- und Türöffnungen bleiben frei
  (mit Brüstung und Sturz), Fenster bekommen eine Glasfläche
- Böden entstehen aus den erkannten Räumen, Möbel als Körper in ihren echten
  Maßen
- Umkreisen, zoomen und verschieben mit der Maus

### Speichern und Export
- **Autosave** im `localStorage`
- **JSON** — Projekt speichern und wieder öffnen
- **PNG** — Pixelplan in hoher Auflösung
- **SVG** — Vektorplan, in Millimetern bemaßt und damit direkt druck- und
  CAD-tauglich

### Server (Go)
- **Benannte Projekte** — anlegen, laden, speichern, löschen über eine REST-API
- **Kennzahlen serverseitig** — Raumzahl und Fläche werden aus dem Grundriss
  gerechnet, nicht vom Client geglaubt
- **Freigabe-Links** — ein 32-stelliger Token gibt einen Grundriss nur lesend
  frei und lässt sich jederzeit zurückziehen
- **SVG ohne Browser** — `/api/projects/<id>/svg` liefert den bemaßten Plan
  direkt aus, verlinkbar und aus Skripten abrufbar
- **Ablage** — eine JSON-Datei je Projekt, atomar geschrieben, keine Datenbank

### Import und Export
- **`.planr`** — das eigene Format: JSON mit Kennung, Versionsnummer und
  Zeitstempel. Ältere Dateien ohne Hülle werden weiterhin gelesen
- **PNG** — serverseitig gerastert, ohne Browser, Größe über `?size=` steuerbar
- **SVG** — Vektorplan in Millimetern bemaßt
- **DXF** — AutoCAD R12, damit der Grundriss in jedes CAD-Programm kommt;
  getrennte Ebenen für Wände, Öffnungen, Möbel, Räume und Beschriftung
- **Prüfung vor dem Import** — `/api/validate` meldet alle Mängel auf einmal,
  statt nach jedem Versuch den nächsten Einzelfehler

## Schnellstart

### Entwicklung

```bash
npm install
npm run dev              # Editor auf http://localhost:5173
npm test                 # Geometrie- und Modelltests
npm run typecheck        # TypeScript prüfen

cd server && go run .    # Server auf http://localhost:8090
cd server && go test ./... && go vet ./...
```

Die Raumerkennung existiert zweimal — in JavaScript für den Editor und in Go
für Kennzahlen und SVG-Export. Beide Testläufe prüfen dieselben Fälle,
darunter die Beispielwohnung mit ihren drei Räumen und exakt 54 m². Weicht eine
Seite ab, fällt ein Test um.

### Mit Docker

```bash
docker compose up -d --build
```

Erreichbar unter [http://localhost:8090](http://localhost:8090). Projekte
liegen im Volume `planr-data`.

### API

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/projects` | Übersicht mit Kennzahlen |
| `POST` | `/api/projects` | Projekt anlegen |
| `GET` | `/api/projects/<id>` | Grundriss laden |
| `PUT` | `/api/projects/<id>` | Grundriss speichern |
| `DELETE` | `/api/projects/<id>` | Projekt löschen |
| `POST` | `/api/projects/<id>/share` | Freigabe-Link erzeugen |
| `DELETE` | `/api/projects/<id>/share` | Freigabe zurückziehen |
| `GET` | `/api/projects/<id>/svg` | bemaßtes SVG |
| `GET` | `/api/projects/<id>/png` | PNG, `?size=` 200–6000 px |
| `GET` | `/api/projects/<id>/dxf` | DXF für CAD |
| `GET` | `/api/projects/<id>/planr` | `.planr`-Datei |
| `POST` | `/api/import` | `.planr` oder JSON hochladen, `?name=` |
| `POST` | `/api/validate` | Grundriss prüfen, ohne zu speichern |
| `GET` | `/api/shared/<token>` | geteilter Grundriss, nur lesend |

## Tastenkürzel

| Kürzel | Aktion |
|--------|--------|
| `V` | Auswählen |
| `W` | Wand zeichnen |
| `D` | Tür einsetzen |
| `F` | Fenster einsetzen |
| `H` | Ansicht verschieben |
| `3` | Zwischen 2D und 3D wechseln |
| `R` / `Umschalt+R` | Auswahl um 15° drehen |
| `Entf` / `Rücktaste` | Auswahl löschen |
| `Strg+Z` / `Strg+Umschalt+Z` | Rückgängig / Wiederholen |
| `Esc` | Auswahl aufheben, Wandzug abbrechen |
| `Alt` (beim Zeichnen) | Winkelraster aussetzen |
| Leertaste halten | Ansicht verschieben |
| Doppelklick / Rechtsklick | Wandzug beenden |

## Architektur

### Tech-Stack
- **Frontend** — React 19, Vite 6, HTML5 Canvas 2D
- **Modellschicht** — TypeScript mit eigenen Einheitentypen für cm, px, Grad
  und Bogenmaß
- **3D** — three.js mit OrbitControls, per Code-Splitting nachgeladen
- **State** — eigener Store über `useSyncExternalStore`
- **Server** — Go 1.25, Standardbibliothek plus `golang.org/x/image`
  (Rasterung und Bitmap-Schrift für den PNG-Export)
- **Auslieferung** — eine statisch gelinkte Binärdatei, die auch das Frontend
  ausliefert

### Aufbau

```
Planr/
├── src/
│   ├── model/            # Fachlogik in TypeScript, ohne Browser-Abhängigkeiten
│   │   ├── types.ts      # Typen samt Einheiten (Cm, Px, Rad, Deg)
│   │   ├── units.ts      # cm <-> px, Formatierung, Raster
│   │   ├── geometry.ts   # Vektoren, Noding, Raumerkennung
│   │   ├── catalog.ts    # Möbelkatalog mit realen Maßen
│   │   └── project.ts    # Datenmodell, Wandzerlegung, Serialisierung
│   ├── canvas2d/
│   │   ├── render.js     # sämtliche Draw-Calls
│   │   ├── hitTest.js    # Trefferprüfung und Fangpunkte
│   │   └── events.js     # Zeigerinteraktion
│   ├── three/scene.js    # Aufbau der 3D-Szene aus dem Plan
│   ├── components/       # React-Oberfläche
│   ├── export.js         # PNG-, SVG- und JSON-Export
│   ├── store.js          # State + Undo/Redo
│   └── App.jsx
├── server/               # Go
│   ├── main.go           # HTTP, REST-API, Freigabe-Links
│   ├── store.go          # Projektablage auf der Platte
│   ├── geometry.go       # Raumerkennung (Go-Seite)
│   ├── format.go         # .planr-Format und Prüfung
│   ├── svg.go            # SVG-Export
│   ├── raster.go         # PNG-Export ohne Browser
│   ├── dxf.go            # DXF-Export für CAD
│   └── *_test.go
├── tests/                # node:test, ohne Browser lauffähig
├── Dockerfile
└── docker-compose.yml
```

### Zwei Entwurfsentscheidungen

**Einheiten.** Das Modell rechnet ausschließlich in Zentimetern. Die Umrechnung
in Pixel passiert an einer einzigen Stelle, nämlich im `setTransform()` des
Renderers. Dadurch kann kein Maßstabsfehler in die Fachlogik einsickern.

**Einheiten im Typsystem.** Planr rechnet gleichzeitig mit Zentimetern,
Pixeln, Grad und Bogenmaß — in JavaScript sind das alles `number` und damit
verwechselbar. Die Modellschicht ist deshalb TypeScript, mit unterscheidbaren
Typen `Cm`, `Px`, `Rad` und `Deg`. Zur Laufzeit bleiben es gewöhnliche Zahlen
ohne jeden Aufwand.

**Kein eigenes Dateiformat.** `.planr` ist JSON — eine eigene Syntax hätte
nichts gebracht, was JSON nicht kann, aber jedes vorhandene Werkzeug
ausgesperrt. Was gefehlt hat, war Verbindlichkeit: eine Kennung, damit eine
fremde JSON-Datei nicht versehentlich als Grundriss gilt, eine Versionsnummer
für spätere Änderungen und eine Prüfung, die alle Mängel auf einmal meldet.

**Öffnungen ohne CSG.** Türen und Fenster werden nicht aus der Wand
herausgeschnitten. Stattdessen zerlegt `wallSolids()` jede Wand in die massiven
Stücke dazwischen — Brüstung unter dem Fenster, Sturz darüber. Das ist robust,
schnell und kommt ohne Boolesche Operationen auf Geometrie aus.

## Grenzen

- **Eine Ebene.** Das Datenmodell kennt mehrere Geschosse, die Oberfläche
  bedient bisher nur eines.
- **Der Editor spricht noch nicht mit dem Server.** Die REST-API steht und ist
  getestet, die Bedienoberfläche dafür fehlt — Projekte lassen sich derzeit nur
  per API oder Freigabe-Link nutzen.
- **Kein Zugriffsschutz.** Wer die Adresse kennt, sieht alle Projekte. Für den
  Betrieb im Internet gehört eine Authentifizierung davor.
- **Flächen nach Wandmitte.** Räume werden entlang der Wandmittellinien
  gemessen, nicht nach lichtem Innenmaß. Für die Wohnfläche nach WoFlV ist das
  zu großzügig.
- **Möbel sind Quader.** In 3D erscheinen sie als Körper in korrekten Maßen,
  nicht als Modelle.
- **PNG-Beschriftung ohne Sonderzeichen.** Die eingebaute Bitmap-Schrift deckt
  nur ASCII ab, deshalb steht dort „m2" statt „m²". SVG und DXF sind davon
  nicht betroffen.
- **Kein Dach, keine Treppe in 3D.** Die Treppe ist im Grundriss ein Symbol.

## Lizenz

Business Source License 1.1 — siehe [LICENSE](LICENSE).

Kurz gefasst: lesen, ändern, selbst betreiben und beitragen ist erlaubt,
einschließlich Nutzung in der eigenen Organisation. Nicht erlaubt ist es, Planr
als kommerzielles Angebot für Dritte zu betreiben oder zu verkaufen. Am
**10. August 2030** geht diese Version automatisch in die **Apache-2.0**-Lizenz
über.

BSL ist quelloffen, aber keine von der OSI anerkannte Open-Source-Lizenz —
GitHub weist sie deshalb als „Other" aus.
