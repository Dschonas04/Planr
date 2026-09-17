# Sicherheit

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils neueste Version 1.x.

## Lücke melden

Bitte **kein öffentliches Issue**. Meldungen per E-Mail an
jonasgroll302@gmail.com mit Beschreibung, betroffener Version und – wenn möglich –
einem Weg, die Lücke nachzuvollziehen. Eine Eingangsbestätigung kommt innerhalb
von 72 Stunden, eine Einschätzung innerhalb von sieben Tagen.

## Sicherheitsmodell

| Bereich | Umsetzung |
|---|---|
| Passwörter | bcrypt (Kosten 10), mindestens 10 Zeichen; Anmeldung prüft gegen einen Attrappen-Hash, wenn es die Adresse nicht gibt (keine Kontoerkennung über die Antwortzeit) |
| Sitzungen | 32 Byte Zufall im Cookie `planr_sitzung` (`HttpOnly`, `SameSite=Lax`, `Secure` hinter HTTPS); auf dem Server nur der SHA-256; Passwortänderung beendet alle anderen Sitzungen, Sperren alle |
| Ablage | `konten.json` und `sitzungen.json` mit Rechten `0600`, atomar geschrieben |
| Zugriff | Projekte gehören einem Konto; jeder Projekt-, Export- und Import-Handler prüft Anmeldung und Eigentum selbst; fremde Projekte antworten mit 404; Kennungen mit 128 Bit |
| Freigaben | 128 Bit Zufall je Link, nur lesend; die öffentliche Antwort enthält weder Kennung noch Eigentümer; Zurückziehen macht den Link sofort ungültig |
| CSRF | ändernde API-Anfragen nur mit `X-Requested-With: planr`; kein CORS |
| Missbrauch | Anfragebremse je IP (API) sowie je IP und je E-Mail-Adresse (Anmeldung, Registrierung) |
| Browser | CSP `default-src 'self'` ohne fremde Quellen, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Protokoll | ohne IP-Adressen und ohne Adressparameter  |
| Container | läuft als unprivilegierter Nutzer, Healthcheck auf `/healthz` |
