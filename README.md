# Fotobox fürs iPad

Eine Fotobox als Web-App: Das iPad zeigt die Kamera im Vollbild, Gäste tippen auf
den Auslöser, bekommen einen Countdown, eine Serie von Fotos und daraus einen
fertigen Fotostreifen — samt QR-Code, mit dem sie ihr Bild sofort aufs eigene
Handy laden können.

Läuft in Safari, ohne App Store, ohne Xcode. Über „Zum Home-Bildschirm“ startet
sie wie eine native App im Vollbild.

## Was drin ist

- **Countdown & Fotostreifen** – konfigurierbare Anzahl Aufnahmen, Countdown mit
  Ton und Blitz-Effekt, automatisch montiert zum klassischen Streifen mit
  Event-Titel und Datum
- **Filter & Branding** – Original, S/W, Sepia, Vintage, Kühl, Warm; live in der
  Vorschau, identisch im fertigen Bild. Titel, Untertitel und Farben kommen aus
  `config.json`
- **Drei Streifen-Vorlagen** – `classic` (weißer Automatenstreifen), `elegant`
  (Büttenpapier mit doppelter Keyline) und `midnight` (dunkles Papier für
  Abendveranstaltungen), umschaltbar über `strip.style`
- **QR-Code zum Mitnehmen** – nach jedem Shooting erscheint ein QR-Code; wer ihn
  scannt, landet auf einer Downloadseite für genau dieses Foto
- **Galerie & Export** – alle Aufnahmen des Abends unter `/gallery`, einzeln
  löschbar, gesammelt als ZIP herunterladbar
- **Kiosk-Betrieb** – Gäste sehen nur den Auslöser; Galerie, Kameraseite und Ton
  liegen hinter einer PIN

## Schnellstart

```bash
npm install
npm run cert     # selbstsigniertes HTTPS-Zertifikat (siehe unten, warum)
npm run booth    # startet die Fotobox für den Abend
```

`npm run booth` ist die Variante für den Einsatz: Sie hält den Rechner wach
(`caffeinate`) und startet den Server neu, falls er abstürzt. Zum Entwickeln
tut es `npm start` beziehungsweise `npm run dev`.

Der Server nennt beim Start alle Adressen, unter denen die Fotobox erreichbar
ist, zum Beispiel:

```
  Booth    https://192.168.178.42:8443/
  Galerie  https://192.168.178.42:8443/gallery
```

Diese Adresse auf dem iPad in Safari öffnen — fertig.

## Warum HTTPS Pflicht ist

Safari gibt die Kamera nur in einem *secure context* frei. `localhost` gilt als
sicher, eine WLAN-Adresse wie `http://192.168.178.42` nicht. Ohne HTTPS bleibt
die Vorschau schwarz und die App meldet, dass sie keinen Kamerazugriff bekommt.

`npm run cert` erzeugt ein Zertifikat, das auf alle lokalen IP-Adressen des
Rechners ausgestellt ist. Damit Safari es akzeptiert, muss es einmalig auf dem
iPad hinterlegt werden:

1. `certs/cert.pem` aufs iPad schicken (AirDrop oder Mail)
2. Datei öffnen → **Einstellungen → Allgemein → VPN & Geräteverwaltung →
   Profil installieren**
3. **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** →
   Schalter für „Fotobox“ aktivieren

Ohne Schritt 3 zeigt Safari zwar die Seite, verweigert aber die Kamera.

*Alternative:* Wer die Fotobox ohnehin auf einem Server mit echter Domain und
Let's-Encrypt-Zertifikat betreibt, kann `npm run cert` überspringen und
stattdessen hinter einen Reverse Proxy stellen (siehe „Betrieb“).

## Aufbau am Event-Abend

Die Fotobox besteht aus zwei Teilen: dem **iPad** (Kamera und Bedienung) und
einem **Rechner im selben WLAN**, auf dem der Server läuft — ein Laptop, ein
Mini-PC oder ein Raspberry Pi genügt. Der Server hält die Fotos und beantwortet
die QR-Code-Aufrufe der Gäste-Handys.

```
        iPad (Safari)                Handys der Gäste
             │                              │
             │  https://192.168.x.x:8443    │  QR-Code → gleiche Adresse
             └──────────────┬───────────────┘
                            │
                   Laptop / Raspberry Pi
                   npm start · Fotos in data/
```

Wichtig: **Alle Geräte müssen im selben WLAN sein**, sonst führt der QR-Code ins
Leere. Ein Gäste-WLAN mit Client-Isolation („AP Isolation“) verhindert das —
in dem Fall ein eigenes WLAN aufspannen oder die Isolation abschalten.

### iPad als Kiosk

Damit niemand versehentlich aus der App fliegt:

1. Fotobox in Safari öffnen → Teilen-Menü → **Zum Home-Bildschirm**
2. Von dort starten (läuft dann ohne Safari-Leisten im Vollbild)
3. **Einstellungen → Bedienungshilfen → Geführter Zugriff** aktivieren, in der
   App dreimal die Seitentaste drücken und den geführten Zugriff starten
4. **Einstellungen → Anzeige & Helligkeit → Automatische Sperre → Nie**
   (die App fordert zusätzlich einen Wake Lock an, aber doppelt hält besser)

## Konfiguration

### `config.json` — was die Gäste sehen

Wird bei jedem Aufruf frisch gelesen, ein Neustart des Servers ist nicht nötig.

| Feld | Bedeutung | Standard |
| --- | --- | --- |
| `eventTitle` | Überschrift im Bild und auf dem Streifen | `"Unsere Fotobox"` |
| `eventSubtitle` | Zweite Zeile auf dem Streifen, z. B. der Ort | `""` |
| `shots` | Aufnahmen pro Durchgang (1 = Einzelfoto) | `4` |
| `countdownSeconds` | Countdown vor jeder Aufnahme | `3` |
| `pauseBetweenShotsMs` | Pause zwischen zwei Aufnahmen | `1200` |
| `reviewSeconds` | Wie lange das Ergebnis stehen bleibt (0 = bis „Nochmal“) | `60` |
| `defaultFilter` | Vorausgewählter Look | `"original"` |
| `mirrorPreview` | Vorschau spiegeln (das Foto selbst nie) | `true` |
| `showQrCode` | QR-Code nach dem Shooting anzeigen | `true` |
| `kioskMode` | Bedienelemente vor Gästen verbergen (siehe unten) | `true` |
| `adminPin` | PIN für den Admin-Zugang; leer = kein Schutz | `"1608"` |
| `strip.style` | Vorlage des Streifens: `classic`, `elegant` oder `midnight` | `"classic"` |
| `strip.accent` | Akzentfarbe für Streifen **und** Bedienoberfläche | `"#c8a25a"` |
| `strip.background` / `strip.foreground` | Papier- und Schriftfarbe; ohne Angabe aus der Vorlage | — |

### `.env` — wie der Server läuft

`cp .env.example .env` und anpassen:

| Variable | Bedeutung |
| --- | --- |
| `PORT` | Port des Servers (Standard 8443 mit TLS, sonst 8080) |
| `DATA_DIR` | Wohin die Fotos geschrieben werden (Standard `./data`) |
| `TLS_CERT` / `TLS_KEY` | Zertifikat und Key; fehlen sie, startet der Server ohne HTTPS |
| `PUBLIC_URL` | Feste Adresse für die QR-Codes; leer = aus der Anfrage abgeleitet |
| `ADMIN_PIN` | Überschreibt `adminPin` aus der `config.json`; leer gesetzt hebt sie auf |
| `GALLERY_PASSWORD` | Zusätzlicher Passwortschutz (Basic Auth) für Galerie und Export |

## Kiosk-Betrieb und Admin-Zugang

Mit `kioskMode: true` sieht die Feiergesellschaft nur Filterleiste und
Auslöser. Galerie, Kamerawechsel und Ton verschwinden hinter einem unauffälligen
**Admin**-Knopf oben rechts; ein Tippen darauf öffnet ein PIN-Feld. Nach
richtiger Eingabe sind die Bedienelemente da, ein **Sperren**-Knopf schließt
wieder ab, und nach fünf Minuten ohne Bedienung sperrt die Booth von selbst.

Wer die Adresse der Galerie direkt eintippt, landet ebenfalls beim PIN-Feld –
die Fotoliste, das Löschen und der ZIP-Export sind auf dem Server abgesichert,
nicht nur in der Oberfläche.

Die PIN verlässt den Server nie: Der Browser schickt die Eingabe hin und bekommt
im Erfolgsfall ein Sitzungscookie (acht Stunden, `HttpOnly`). Nach zehn
Fehlversuchen ist für eine Viertelstunde Schluss, und ein Serverneustart sperrt
alle offenen Sitzungen.

Zur Einordnung: Das ist ein Riegel gegen neugierige Gäste, kein Schutz gegen
jemanden, der es ernsthaft darauf anlegt. Eine vierstellige PIN im eigenen WLAN
ist genau so viel Sicherheit, wie eine Fotobox braucht. Wer die Booth öffentlich
erreichbar macht, sollte zusätzlich `GALLERY_PASSWORD` setzen.

## Betrieb

Die Fotos liegen als gewöhnliche Dateien in `DATA_DIR` — pro Aufnahme ein JPEG
plus eine kleine JSON-Datei mit Zeitpunkt und Filter. Sichern heißt: Verzeichnis
kopieren. Aufräumen heißt: Dateien löschen.

Hinter einem Reverse Proxy (nginx, Caddy) `PUBLIC_URL` auf die öffentliche
Adresse setzen, damit die QR-Codes dorthin zeigen, und `X-Forwarded-Proto`
weiterreichen. Wer die Fotobox öffentlich erreichbar macht, sollte
`GALLERY_PASSWORD` setzen — die Aufnahmen selbst sind über ihre (nicht
erratbare) ID abrufbar, die Übersicht bleibt damit privat.

## Entwicklung

```bash
npm run dev      # Server mit Auto-Reload
npm test         # Tests für Speicher, HTTP-Schnittstelle und Admin-Zugang
npm run icons    # App-Icons neu erzeugen
```

```
server/          Express-Server: Upload, Galerie, QR-Codes, ZIP-Export
  admin.js       PIN-Prüfung, Sitzungscookie, Sperre für die Galerie
  config.js      Konfiguration aus config.json und Umgebung
  storage.js     Ablage der Aufnahmen als Datei + Metadaten
public/          Alles, was im Browser läuft (kein Build-Schritt)
  js/booth.js    Ablaufsteuerung: Countdown, Serie, Upload, QR
  js/camera.js   Kamerazugriff und Einzelbildaufnahme
  js/filters.js  Bildlooks für Vorschau und fertiges Foto
  js/strip.js    Montage des Fotostreifens auf dem Canvas
  js/admin.js    PIN-Feld für den Admin-Zugang
scripts/         Start, Zertifikat und Icons
tests/           Tests (node --test, ohne weitere Abhängigkeiten)
```

Das Frontend nutzt native ES-Module und wird direkt ausgeliefert — kein Bundler,
kein Framework. Wer etwas ändert, lädt die Seite neu.

## Wenn etwas nicht klappt

**Die Vorschau bleibt schwarz.** Fast immer fehlt HTTPS oder das Zertifikat ist
auf dem iPad nicht als vertrauenswürdig markiert (Schritt 3 oben). Prüfen: Zeigt
Safari das Schloss-Symbol ohne Warnung?

**Safari fragt nicht nach der Kamera.** Der Zugriff wurde einmal abgelehnt. In
Safari links in der Adresszeile auf „aA“ → **Website-Einstellungen** → Kamera auf
„Fragen“ oder „Erlauben“ stellen, dann neu laden.

**Der QR-Code funktioniert nicht.** Das Handy ist in einem anderen Netz, oder das
WLAN trennt die Clients voneinander. Zum Test die angezeigte Adresse am Handy
von Hand eintippen.

**Das Bild ist spiegelverkehrt.** Die Vorschau ist absichtlich gespiegelt (das
fühlt sich an wie ein Spiegel), das gespeicherte Foto nicht — sonst stünde jede
Schrift im Hintergrund falsch herum. Wer beides gespiegelt will, setzt
`mirrorPreview` auf `false`.

**Der Streifen ist zu lang/zu kurz.** `shots` in `config.json` anpassen; das
Seitenverhältnis der Einzelbilder kommt von der Kamera und wird übernommen.

**Ich komme nicht mehr in die Galerie.** PIN vergessen? Sie steht in
`config.json` unter `adminPin`. Nach zehn Fehlversuchen sperrt der Server für
15 Minuten – ein Neustart des Servers hebt die Sperre sofort auf.

**Die Vorschau sieht anders aus als das fertige Foto.** Die Live-Vorschau nutzt
CSS-Filter, das fertige Bild wird Pixel für Pixel gerechnet. Farbstimmung und
Kontrast stimmen überein, aber Korn und Randabfall von „Vintage“ erscheinen erst
im Ergebnis – in der Vorschau wären sie bei 60 Bildern pro Sekunde zu teuer.
