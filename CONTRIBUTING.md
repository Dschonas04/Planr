# Mitmachen

Danke, dass du Planr besser machen willst.

## Fehler melden

Bitte ein [Issue](https://github.com/Dschonas04/Planr/issues/new/choose) mit
Version, Browser und Betriebssystem, den Schritten zum Nachstellen und dem,
was du erwartet hast. Sicherheitslücken bitte **nicht** öffentlich melden,
sondern wie in [SECURITY.md](SECURITY.md) beschrieben.

## Entwickeln

Voraussetzungen und Start ohne Container stehen in der
[README](README.md#schnellstart). Vor einem Pull Request muss das hier grün
sein:

```bash
npm ci && npm test && npm run build
(cd server && go vet ./... && gofmt -l . && go test ./...)
```

## Pull Requests

1. Forken, einen Zweig anlegen, ändern.
2. Tests ergänzen, wo sich Verhalten ändert.
3. Einen Eintrag unter „Unveröffentlicht“ in [CHANGELOG.md](CHANGELOG.md)
   ergänzen.
4. Pull Request öffnen und kurz beschreiben, was sich ändert und warum.

Für größere Änderungen lohnt sich vorher ein Issue, damit wir uns über den
Weg einig sind, bevor Arbeit hineinfließt.

## Verhalten

Für alle Beteiligten gilt der [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Lizenz

Planr steht unter der [Business Source License 1.1](LICENSE). Mit einem
Beitrag stimmst du zu, dass er unter derselben Lizenz veröffentlicht wird.
