# Planr — maßstabsgetreuer Grundriss-Planer

Planr ist eine browserbasierte Anwendung, mit der sich eine Wohnung oder ein
Haus maßstabsgetreu zeichnen und möblieren lässt. Gerechnet wird durchgängig in
Zentimetern; die 3D-Vorschau baut denselben Plan als begehbares Modell auf.

Die Anwendung läuft vollständig im Browser. Es gibt kein Backend, keine
Anmeldung und keine Datenübertragung — Projekte liegen im `localStorage` und
lassen sich als Datei exportieren.

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

## Schnellstart

### Entwicklung

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # Geometrie- und Modelltests
```

### Mit Docker

```bash
docker compose up -d --build
```

Erreichbar unter [http://localhost:8090](http://localhost:8090).

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
- **3D** — three.js mit OrbitControls, per Code-Splitting nachgeladen
- **State** — eigener Store über `useSyncExternalStore`
- **Auslieferung** — statisches Bundle hinter nginx, kein Server-Code

### Aufbau

```
Planr/
├── src/
│   ├── model/            # Fachlogik, ohne Browser-Abhängigkeiten
│   │   ├── units.js      # cm <-> px, Formatierung, Raster
│   │   ├── geometry.js   # Vektoren, Noding, Raumerkennung
│   │   ├── catalog.js    # Möbelkatalog mit realen Maßen
│   │   └── project.js    # Datenmodell, Wandzerlegung, Serialisierung
│   ├── canvas2d/
│   │   ├── render.js     # sämtliche Draw-Calls
│   │   ├── hitTest.js    # Trefferprüfung und Fangpunkte
│   │   └── events.js     # Zeigerinteraktion
│   ├── three/scene.js    # Aufbau der 3D-Szene aus dem Plan
│   ├── components/       # React-Oberfläche
│   ├── export.js         # PNG-, SVG- und JSON-Export
│   ├── store.js          # State + Undo/Redo
│   └── App.jsx
├── tests/                # node:test, ohne Browser lauffähig
├── Dockerfile
└── docker-compose.yml
```

### Zwei Entwurfsentscheidungen

**Einheiten.** Das Modell rechnet ausschließlich in Zentimetern. Die Umrechnung
in Pixel passiert an einer einzigen Stelle, nämlich im `setTransform()` des
Renderers. Dadurch kann kein Maßstabsfehler in die Fachlogik einsickern.

**Öffnungen ohne CSG.** Türen und Fenster werden nicht aus der Wand
herausgeschnitten. Stattdessen zerlegt `wallSolids()` jede Wand in die massiven
Stücke dazwischen — Brüstung unter dem Fenster, Sturz darüber. Das ist robust,
schnell und kommt ohne Boolesche Operationen auf Geometrie aus.

## Grenzen

- **Eine Ebene.** Das Datenmodell kennt mehrere Geschosse, die Oberfläche
  bedient bisher nur eines.
- **Flächen nach Wandmitte.** Räume werden entlang der Wandmittellinien
  gemessen, nicht nach lichtem Innenmaß. Für die Wohnfläche nach WoFlV ist das
  zu großzügig.
- **Möbel sind Quader.** In 3D erscheinen sie als Körper in korrekten Maßen,
  nicht als Modelle.
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
