# Betrieb: Dashboard auf dem eigenen Server, Freunde über Tailscale

> **Empfohlen: Raspberry Pi als Server.** Einsteiger-Anleitung Schritt für
> Schritt: **[RASPBERRY_PI_ANLEITUNG.md](RASPBERRY_PI_ANLEITUNG.md)** – vom
> ersten Verbinden bis zur festen https-Adresse für dich und deine Freunde.
> Die Abschnitte unten beschreiben auch den Betrieb auf einem Mac/PC.

Das Dashboard läuft auf **einem** PC (deinem). Dieser PC ist gleichzeitig
Webseite und Datenbank. Bis zu ein paar Freunde erreichen ihn über
**Tailscale** – ein privates Netz nur für eure Geräte, verschlüsselt, ohne
dass etwas im Internet offen steht. Jede Person meldet sich mit eigenem
Benutzernamen an und sieht nur ihre eigenen Daten.

**Dauerbetrieb ohne laufenden Computer:** Mit einem Raspberry Pi läuft das
Dashboard Tag und Nacht und startet von selbst – siehe Abschnitt 9.

Befehle stehen hier mit `python`. Unter Windows geht auch `py`, auf dem Mac
heißt es meist `python3`. Alle Befehle im Projektordner ausführen.

---

## 1. Einmalig auf deinem PC einrichten

1. **Python 3** von python.org installieren. Unter Windows im Installer
   „Add python.exe to PATH“ ankreuzen.
2. **Projekt** auf den PC holen (z. B. `git clone …`, siehe README).
3. **Starten:** Windows: Doppelklick auf `start.bat`; Mac: `./start.sh`.
   Beim ersten Start passiert automatisch:
   - die nötigen Bibliotheken werden installiert,
   - die Datei `.env` mit einem geheimen Schlüssel wird angelegt.

   Das Fenster muss offen bleiben, solange das Dashboard erreichbar sein soll.
4. **Benutzer anlegen** (in einem zweiten Fenster), für dich und jeden Freund:
   ```
   python backend/create_user.py
   ```
   **Lege zuerst dich selbst an, danach die Freunde.** Wer zuerst angelegt
   wird, bekommt alle schon vorhandenen Daten ohne Benutzer (z. B. aus der
   früheren Einzelplatz-Version). Gibt es solche Daten, fragt das Programm vorher nach, ob das
   dein eigenes Konto ist.
   Passwort mindestens 10 Zeichen. Die angezeigte Nummer (`athlete_id`) ist
   die Benutzer-Nummer, die z. B. der Garmin-Sync braucht.
   Passwort vergessen: `python backend/create_user.py --reset`.
5. **Im Browser öffnen:** http://localhost:5000 → Anmelden.

### Deine bisherigen Daten übernehmen (einmalig)

- **Trainings aus `workouts.json`** (von `parse_fit.py`):
  ```
  python backend/import_workouts_json.py --user <dein-name>
  ```
- **Profil, Ziele, Trainingsplan, Erholung, Gewicht, Material, Notizen**
  aus dem alten Doppelklick-Dashboard:
  1. `tools/export-browser-data.html` per Doppelklick **im selben Browser**
     öffnen, in dem du das alte Dashboard benutzt hast (Chrome/Edge empfohlen)
     → „dashboard-export.json speichern“.
  2. Die Datei in den Projektordner legen, dann:
     ```
     python backend/import_workouts_json.py --user <dein-name> --browser-export dashboard-export.json
     ```
     Was auf dem Server schon existiert, wird nicht überschrieben (sonst
     `--overwrite` anhängen). Doppelte Trainings werden übersprungen – der
     Import darf mehrfach laufen. Vorher wird automatisch ein Backup gemacht.
  3. `dashboard-export.json` danach löschen (enthält persönliche Daten).

### Garmin, KI und Wetter (optional)

- **Garmin-Sync** für alle Benutzer: siehe `docs/GARMIN_SYNC_GUIDE.md`.
  Empfohlen ist der **offizielle Weg**: Jede Person erstellt in Garmin
  Connect ihren eigenen „Personal API“-Schlüssel und trägt ihn im Dashboard
  ein (Einstellungen → Garmin-Verbindung). Kein Garmin-Passwort nötig, und
  jede Person kann ihre Daten selbst mit „Jetzt von Garmin holen“ abrufen.
  Einmalig auf dem PC: `python -m pip install -r requirements.txt`.
- **„An Garmin senden“** (geplante Einheit direkt in den Garmin-Kalender):
  braucht einmalig die Garmin-Bibliotheken (`python -m pip install -r requirements.txt`)
  und für die jeweilige Person **einmal** die alte Garmin-Anmeldung des Syncs
  (`python tools/garmin_sync.py --login --athlete <nummer>`) – der offizielle
  Schlüssel kann nur lesen, keine Workouts senden. Das Dashboard
  fragt nie nach einem Garmin-Passwort. Ohne Anmeldung zeigt der Knopf eine
  Meldung; der `.fit`-Download geht immer. Bitte einmal mit dem echten Konto
  ausprobieren – Garmin kann seine Schnittstelle jederzeit ändern.
- **KI-Coach mit Claude (empfohlen):** Einstellungen → **KI-Coach** →
  Claude-Schlüssel einfügen → „Schlüssel prüfen & speichern“. Das kann nur
  der Betreiber. Der Schlüssel liegt danach nur auf diesem PC in
  `~/.triathlon/claude_api.json` und geht nie an den Browser zurück. Mit
  „Für alle Personen freigeben“ nutzen auch Freunde Claude – über dein
  Guthaben. Ohne Claude antwortet Ollama (nächster Punkt).
- **KI-Coach lokal:** [Ollama](https://ollama.com/download) auf diesem PC installieren
  und ein Modell laden (`ollama pull llama3.1`). Die Freunde brauchen kein
  eigenes Ollama – ihr Browser fragt den Dashboard-Server, der fragt Ollama.
  Läuft Ollama auf einem anderen Rechner: in `.env` die Zeile
  `OLLAMA_URL=http://…:11434` eintragen und neu starten.
- **Wetter im Kalender:** in den Einstellungen den Heimatort suchen. Der
  Server fragt den kostenlosen Dienst Open-Meteo (ohne Anmeldung, ohne
  Schlüssel). Dorthin gehen nur der gesuchte Ortsname (bei der Suche) und
  danach die Koordinaten des Orts – nie Trainingsdaten oder Benutzernamen.
  Ohne Heimatort wird nichts abgefragt.

---

## 2. Tailscale: Freunde dazuholen

1. **Tailscale** auf deinem PC installieren (tailscale.com/download) und anmelden.
2. Jeder Freund installiert Tailscale auf Handy/Laptop und meldet sich an.
3. Freunde ins Netz holen – eine der beiden Varianten:
   - **Gerät teilen** (empfohlen, Freunde sehen nur diesen einen PC): in der
     Tailscale-Verwaltung (login.tailscale.com) beim PC „Share…“ wählen und
     die Einladung an den Freund schicken.
   - oder den Freund als Mitglied in dein Tailscale-Netz einladen.
4. Adresse für die Freunde: **http://\<PC-Name\>:5000** (der Name steht beim
   Start im Fenster, z. B. `http://nico-pc:5000`). Klappt der Name nicht,
   geht die Tailscale-IP: `tailscale ip -4` → `http://100.x.y.z:5000`.
5. **Windows-Firewall:** Beim ersten Start fragt Windows, ob Python im Netz
   erreichbar sein darf → für **private Netzwerke** erlauben. Später ändern:
   Windows-Sicherheit → Firewall → „App durch die Firewall zulassen“ → Python.

Über Tailscale ist die Verbindung bereits verschlüsselt, auch wenn die
Adresse mit `http://` beginnt.

---

## 3. Täglicher Betrieb

| Was | Wie |
|---|---|
| Starten | `start.bat` (Windows) / `./start.sh` (Mac) |
| Beenden | Fenster schließen oder Strg+C |
| Benutzer anlegen / Passwort neu | `python backend/create_user.py` / `… --reset` |
| Garmin-Daten holen | `python tools/garmin_sync.py` (alle Benutzer) |
| Backup jetzt | `backup.bat` (Windows) / `python backup.py` |

### Backups

- `backup.py` kopiert `training.db` nach `backups/training-JJJJ-MM-TT.db`
  (eine Datei pro Tag, die **letzten 14** bleiben). Das geht auch, während
  der Server läuft.
- Automatisch: vor **jedem Serverstart** und vor jedem Import.
- **Täglich automatisch (Windows):** Aufgabenplanung öffnen → „Einfache
  Aufgabe erstellen“ → Name „Dashboard-Backup“ → Täglich, z. B. 3:00 Uhr →
  „Programm starten“ → `backup.bat` im Projektordner auswählen → Fertig.
- **Täglich automatisch (Mac):** `crontab -e` und diese Zeile eintragen
  (Pfad anpassen): `0 3 * * * cd /Pfad/zum/Projekt && /usr/bin/python3 backup.py`
- **Wiederherstellen:** Server beenden, `training.db` umbenennen (z. B.
  `training-kaputt.db`), gewünschte Sicherung aus `backups/` in den
  Projektordner kopieren und in `training.db` umbenennen, Server starten.
- Tipp: `backups/` ab und zu zusätzlich auf einen USB-Stick kopieren.

### Updates (automatisch, nach deiner Bestätigung)

Der Server fragt **einmal am Tag** bei GitHub nach, ob es eine neuere
Version gibt. Wenn ja, sieht **nur der Betreiber** (die zuerst angelegte
Person, änderbar mit `ADMIN_USERS=` in `.env`) oben im Dashboard einen
Hinweis mit „Was ist neu?“, „Installieren“ und „Später“. Dieselben Knöpfe
und „Jetzt prüfen“ stehen in den Einstellungen unter **Programm-Updates**.

Beim Installieren passiert automatisch:

1. `training.db` wird gesichert (`backups/vor-update-<Version>-<Zeitpunkt>.db`).
2. Die neue Version wird geladen und geprüft (passt die Versionsnummer?
   nichts außerhalb des Projektordners?), ihre Bibliotheken werden
   installiert. Klappt das nicht, bleiben die Programmdateien unverändert
   (schon installierte neue Bibliotheken stören die alte Version nicht).
3. Die zu ersetzenden Programmdateien landen in
   `backups/programm-<alte Version>-<Zeitpunkt>.zip` (darin steht in
   `WIEDERHERSTELLEN.txt`, wie man zurückkehrt).
4. Die Programmdateien werden ersetzt. **Nie** angefasst werden `.env`,
   `training.db`, `backups/`, `fit-files/`, `data/` und Garmin-Token.
   Lässt sich eine Datei nicht ersetzen (z. B. von einem anderen Programm
   geöffnet), wird der alte Stand zurückgeschrieben – kein halb altes,
   halb neues Programm.
5. Der Server startet neu (meist unter einer Minute; Freunde sind kurz
   getrennt), die Seite lädt sich selbst neu.

Voraussetzungen: Das Dashboard wurde mit `start.bat`/`start.sh` gestartet
(sonst steht nach dem Installieren „bitte neu starten“), und der PC ist mit
dem Internet verbunden. Wurde das Projekt per `git clone` geholt, nutzt das
Update `git` (eigene Änderungen an Programmdateien → das Update bricht ab
und sagt, was zu tun ist). Die tägliche Prüfung lässt sich mit
`UPDATE_CHECK=0` in `.env` abschalten.

**Von Hand** (z. B. bei einer Version ohne Update-Funktion): Dashboard
beenden → neue ZIP von GitHub entpacken und über den Projektordner kopieren
(oder `git pull`) → `start.bat`/`start.sh`. Beim Start wird vorher
automatisch gesichert; neue Tabellen legt der Server selbst an, vorhandene
Daten bleiben erhalten.

---

## 4. Sicherheit – was geschützt ist

- Ohne Anmeldung ist nur die Login-Seite erreichbar. Jede Anfrage prüft den
  Login und liefert nur die Daten der angemeldeten Person.
- Passwörter werden nur als Hash gespeichert. Nach 5 Fehlversuchen pro
  Minute sperrt der Server die Adresse kurz, nach 10 Fehlversuchen für ein
  Konto dieses Konto für 15 Minuten (gegen Raten von vielen Adressen aus).
- **Öffentliche Adresse (Tailscale Funnel, `deploy/raspberry-pi/oeffentlich.sh`):**
  Dann ist die Login-Seite aus dem Internet erreichbar, immer über https.
  Der Server glaubt die echte Besucher-Adresse nur dem Tailscale-Proxy auf
  demselben Rechner (127.0.0.1); gefälschte Weiterleitungs-Kopfzeilen von
  anderswo werden verworfen. Dazu Schutz-Kopfzeilen (kein Einbetten in fremde
  Seiten, nur noch https nach dem ersten https-Besuch). Lange Passwörter
  verwenden. Abschalten: `bash deploy/raspberry-pi/oeffentlich.sh aus`.
- Der Server liefert nur die Webseite aus (`index.html`, `login.html`,
  `css/`, `js/` …) – `.env`, `training.db`, `backups/`, `data/`, `backend/`
  und Garmin-Token sind von außen nicht abrufbar.
- Der Login gilt 30 Tage pro Gerät. **An fremden/geteilten Geräten immer
  abmelden** (Einstellungen → Konto → Abmelden) – das löscht auch alles
  Persönliche aus dem Browser. Ein einzelner Login lässt sich nicht
  zurückziehen: auch nach „Passwort neu“ gilt ein alter Login noch bis zu 30
  Tage. Sofort alle abmelden (z. B. bei verlorenem Handy): in `.env` den
  `SECRET_KEY` ändern und neu starten – dann müssen sich alle neu anmelden.
- **Erreichbar ist der Server im ganzen Heimnetz** (WLAN) und über Tailscale.
  Daten sind durch den Login geschützt. Wer ihn nur über Tailscale
  erreichbar machen will: in `.env` `DASHBOARD_HOST=100.x.y.z` (deine
  Tailscale-IP) eintragen und neu starten.
- Der **Kalender-Abo-Link** enthält einen geheimen Schlüssel – nicht
  weitergeben. Alte Abos ohne Schlüssel (`…/ical/1.ics`) funktionieren nicht
  mehr: den Link neu aus den Einstellungen kopieren und neu abonnieren. Ungültig machen lässt er sich nur zusammen mit allen Logins,
  indem man `SECRET_KEY` in `.env` ändert.
- `.env`, `training.db`, `backups/`, Token-Dateien und Trainingsdaten sind
  per `.gitignore` vom Repository ausgeschlossen.
- Nach außen spricht nur der Server, und nur mit: Ollama (KI), Garmin (Sync
  und „An Garmin senden“, mit dem Schlüssel bzw. Token der jeweiligen
  Person), Open-Meteo (Wetter, nur Ortsname bzw. Koordinaten des
  Heimatorts) und GitHub/PyPI (Update-Prüfung einmal am Tag, beim
  Installieren der Download und die Bibliotheken – ohne persönliche Daten).

---

## 5. Probleme und Lösungen

| Problem | Lösung |
|---|---|
| „SECRET_KEY fehlt“ | `start.bat`/`start.sh` benutzen (legt `.env` an) oder `.env.example` nach `.env` kopieren und einen Schlüssel eintragen. |
| Freunde kommen nicht drauf | Läuft das Fenster? Tailscale bei beiden an? Windows-Firewall (siehe oben)? Mit der Tailscale-IP statt des Namens probieren. |
| Mac: Port 5000 belegt | Systemeinstellungen → Allgemein → AirDrop & Handoff → „AirPlay-Empfänger“ aus, oder in `.env` `DASHBOARD_PORT=5050` setzen. |
| Rote Meldung „Speichern fehlgeschlagen“ im Dashboard | Der Server war kurz nicht erreichbar. Server prüfen, Seite neu laden und die letzte Änderung wiederholen. |
| KI: „Ollama ist … nicht erreichbar“ | Ollama auf dem Dashboard-PC starten; Modell geladen (`ollama list`)? |
| Passwort vergessen | `python backend/create_user.py --reset` |

---

## 6. iPhone über Tailscale (als App auf dem Home-Bildschirm)

Das Dashboard läuft weiter auf deinem PC. Das iPhone verbindet sich über
Tailscale damit und bekommt ein eigenes Symbol auf dem Home-Bildschirm, das
sich wie eine App öffnet (ohne Safari-Leisten).

**Wichtig vorab:** Es gibt keinen Offline-Modus. Die App zeigt nur etwas, wenn
dein PC an ist, das Dashboard-Fenster offen ist und Tailscale auf dem iPhone
verbunden ist. Auf dem iPhone wird nichts zwischengespeichert.

Ohne Tailscale geht es auch über die Port-Weiterleitung von VS Code – siehe
Abschnitt 8.

### Schritt 1: Tailscale auf dem iPhone

1. **Tailscale** aus dem App Store laden und mit **demselben Konto** wie am PC
   anmelden (Freunde: mit ihrem eigenen Konto, siehe Abschnitt 2 „Gerät teilen“).
2. Den Schalter in der App auf **an** stellen (oben im Bildschirm erscheint das
   VPN-Symbol).

### Schritt 2: Sichere Adresse (HTTPS) am PC einrichten – einmalig

1. **HTTPS im Tailscale-Netz erlauben:** auf login.tailscale.com die Seite
   **DNS** öffnen. Dort **MagicDNS** einschalten (bei neueren Netzen schon an),
   dann unter **HTTPS Certificates** auf **Enable HTTPS** klicken und den
   Hinweis bestätigen.
   *Hinweis:* Dabei werden der Rechnername und der Netzwerkname in einem
   öffentlichen Zertifikatsverzeichnis sichtbar. Nimm also keinen Rechnernamen,
   der etwas Privates verrät. (Wenn du den Schritt vergisst, fragt der Befehl
   unten selbst nach und zeigt einen Link zum Bestätigen.)
2. Das Dashboard muss laufen (`start.bat` bzw. `./start.sh`).
3. In einem **zweiten Fenster** (Windows: PowerShell, Mac: Terminal; falls
   nötig mit `sudo` davor) eingeben:
   ```
   tailscale serve --bg 5000
   ```
   Die `5000` ist der Port des Dashboards (steht in `.env` bei
   `DASHBOARD_PORT`, falls du ihn geändert hast). Der Befehl zeigt die fertige
   Adresse an, sie sieht so aus:
   **https://\<pc-name\>.\<netzwerkname\>.ts.net** (ohne `:5000`).
   `--bg` heißt: läuft im Hintergrund weiter, auch nach einem Neustart des PCs.
   (Das Dashboard selbst musst du nach einem Neustart trotzdem wieder starten.)
4. Prüfen, was gerade läuft: `tailscale serve status`

   *Falls du in `.env` `DASHBOARD_HOST` auf die Tailscale-IP gesetzt hast:*
   Tailscale reicht die Anfragen intern an `127.0.0.1` weiter. Dann entweder die
   Zeile entfernen oder `DASHBOARD_HOST=127.0.0.1` setzen und neu starten.

### Schritt 3: Als App auf den Home-Bildschirm

1. Auf dem iPhone in **Safari** die Adresse aus Schritt 2 öffnen (Tailscale
   muss dabei an sein) und anmelden.
2. Unten auf das **Teilen-Symbol** (Quadrat mit Pfeil) tippen →
   **„Zum Home-Bildschirm“** → Name „TriDashboard“ → **Hinzufügen**.
3. Das neue Symbol antippen. **In der App musst du dich einmal neu anmelden** –
   die Home-Bildschirm-App hat auf dem iPhone einen eigenen Speicher, getrennt
   von Safari.

### Geht es auch ohne HTTPS?

Ja. Über `http://<pc-name>:5000` (Abschnitt 2) lässt sich das Dashboard
ebenfalls auf den Home-Bildschirm legen, und die Verbindung ist durch Tailscale
trotzdem verschlüsselt. Aber manche Funktionen verlangen von iPhone/Safari eine
„echte“ HTTPS-Adresse – zum Beispiel die **Kopieren-Knöpfe** (etwa beim
Kalender-Abo-Link). Ohne HTTPS tun sie nichts. Deshalb empfehlen wir Schritt 2.

### Was auf dem iPhone nicht geht

- **Kein Offline-Modus** (siehe oben).
- **Ordner-Import** („Aktualisieren → Ordner“): Safari auf dem iPhone kann keine
  Ordner auswählen. Neue Trainings kommen über den Garmin-Sync am PC ins
  Dashboard.
- Ältere iPhones: Das Layout braucht iOS 16 oder neuer.

### Wieder abschalten

Am PC: `tailscale serve reset` – das beendet die https-Adresse. Das Dashboard
bleibt wie gewohnt über `http://<pc-name>:5000` erreichbar.
Die Home-Bildschirm-App einfach wie jede andere App löschen (lange drücken →
App entfernen).

### Wenn es nicht klappt

| Problem | Lösung |
|---|---|
| Seite lädt nicht / leere App | PC an? Dashboard-Fenster offen? Tailscale auf dem iPhone an (VPN-Symbol)? Am PC `tailscale serve status` prüfen. |
| Kein „https“ / Zertifikatsfehler | Schritt 2.1 noch nicht gemacht (HTTPS nicht eingeschaltet). |
| Wieder abgemeldet | Normal alle 30 Tage oder nach „Abmelden“ – einfach neu anmelden. |

---

## 7. Neue Version veröffentlichen (für dich als Projekt-Besitzer)

Ein Update erreicht die Dashboards erst, wenn es auf GitHub eine **Release**
gibt – ein normales Hochladen auf `main` löst bewusst nichts aus. Die Release
legt GitHub **automatisch** an (`.github/workflows/release.yml`), sobald auf
`main` eine neue Nummer in `VERSION` steht:

1. In der Datei `VERSION` die Nummer erhöhen, z. B. `2.0.0` → `2.1.0`
   (kleine Korrektur: letzte Stelle, neue Funktionen: mittlere Stelle).
2. In `CHANGELOG.md` oben einen Abschnitt `## 2.1.0` ergänzen und darunter in
   einfachen Worten schreiben, was neu ist – genau dieser Text erscheint als
   Release-Text und im Dashboard unter „Was ist neu?“.
3. Beides auf `main` bringen. GitHub legt dann den Tag `v2.1.0` und die
   Release an (im Projekt unter **Actions** zu sehen, dauert etwa eine Minute).
   Innerhalb eines Tages (oder sofort mit „Jetzt prüfen“) sehen alle
   Dashboards den Hinweis.

Fehlt der Abschnitt in `CHANGELOG.md` oder steht in `VERSION` keine
Versionsnummer, legt die Automatik nichts an und meldet den Fehler unter
**Actions** (rotes Kreuz). Gibt es die Release schon, passiert nichts.

**Von Hand** geht es auch: im Projekt rechts **Releases** → **Draft a new
release** → **Choose a tag** `v2.1.0` → „Create new tag“ (Ziel: `main`) →
Titel und Text → **Publish release**. Der Tag muss genau zur Nummer in
`VERSION` passen (mit `v` davor) – sonst lehnt das Dashboard das Update ab.

Das Repository muss öffentlich sein (die Prüfung fragt GitHub ohne Konto).
Dateien, die eine neue Version löscht, bleiben bei bestehenden
Installationen liegen – sie stören nicht.

---

## 8. Handy über VS Code (Port-Weiterleitung, ohne Tailscale)

Wenn auf deinem PC ohnehin VS Code läuft, kann VS Code das Dashboard unter
einer eigenen **https-Adresse** ins Internet weiterreichen. Auf dem Handy
brauchst du dann **kein Tailscale** – nur einen Browser. Am Dashboard muss
dafür nichts umgestellt werden.

### Einrichten

1. Das Dashboard wie gewohnt starten (`start.bat` bzw. `start.sh`) und am PC
   prüfen, dass http://localhost:5000 geht.
2. In VS Code unten das Panel **Ports** öffnen (neben „Terminal“; oder
   Befehlspalette ⌘/Strg+Umschalt+P → „Ports: Focus on Ports View“).
3. **Port weiterleiten** („Forward a Port“) → `5000` eingeben → Enter.
   Beim ersten Mal fragt VS Code nach deiner Anmeldung mit GitHub – zustimmen.
4. In der Zeile erscheint die **weitergeleitete Adresse**, z. B.
   `https://abc123-5000.euw.devtunnels.ms`. Mit Rechtsklick → **Adresse
   kopieren** (oder das Globus-Symbol zum Testen).
5. Die Adresse auf dem Handy öffnen. Beim ersten Mal zeigt Microsoft eine
   Warnseite („Developer Tunnel“) → **Weiter**. Dann erscheint die
   Dashboard-Anmeldung.
6. Als App auf den Home-Bildschirm: in Safari **Teilen** → **„Zum
   Home-Bildschirm“**. In der App meldest du dich noch einmal an (sie hat
   einen eigenen Speicher, getrennt von Safari).

### Sichtbarkeit: „Privat“ lassen

Mit Rechtsklick auf den Port → **Port-Sichtbarkeit** („Port Visibility“):

| Einstellung | Wer kommt bis zur Dashboard-Anmeldung? | Empfehlung |
|---|---|---|
| **Privat** (Standard) | nur wer sich vorher mit **deinem** GitHub-Konto anmeldet | **für dich allein** – doppelt geschützt (GitHub + Dashboard-Login) |
| **Öffentlich** | jeder, der die Adresse kennt | nur, wenn Freunde ohne Tailscale zugreifen sollen; dann schützt allein das Dashboard-Passwort |

Mit „Privat“ fragt das Handy vor dem Dashboard zusätzlich nach der
GitHub-Anmeldung – das ist gewollt.

### Gut zu wissen

- **VS Code muss auf dem PC offen bleiben** (und das Dashboard-Fenster
  laufen). Schließt du VS Code oder geht der PC in den Ruhezustand, ist das
  Handy getrennt. Tailscale (Abschnitt 2 und 6) läuft dagegen im Hintergrund.
- Die Adresse bleibt meist dieselbe, solange du denselben Port weiterleitest.
  Ändert sie sich, die neue kopieren und das Lesezeichen bzw. die
  Home-Bildschirm-App neu anlegen.
- **Weil die Adresse https ist**, funktionieren auf dem iPhone auch die
  Kopieren-Knöpfe (z. B. Kalender-Abo-Link) und die Home-Bildschirm-App.
- **Freunde:** „Privat“ gilt nur für dein eigenes GitHub-Konto. Für Freunde
  bleibt Tailscale (Abschnitt 2) die bessere Lösung.
- **Login-Bremse:** Alle Anfragen über die Weiterleitung kommen für den
  Server von `127.0.0.1`. Die Bremse (5 Fehlversuche pro Minute) gilt dann
  für alle gemeinsam – bei „Öffentlich“ kann also ein Fremder mit falschen
  Passwörtern alle für jeweils eine Minute aussperren. Ein weiterer Grund
  für „Privat“.
- Hast du in `.env` `DASHBOARD_HOST` auf die Tailscale-IP gesetzt, erreicht
  VS Code den Server unter `localhost` nicht. Dann die Zeile entfernen oder
  `DASHBOARD_HOST=0.0.0.0` setzen und neu starten.
- **Abschalten:** im Ports-Panel Rechtsklick auf den Port → **Port-Weiterleitung
  beenden** („Stop Forwarding Port“).

### Wenn es nicht klappt

| Problem | Lösung |
|---|---|
| Seite lädt nicht | Läuft das Dashboard (http://localhost:5000 am PC)? Ist VS Code offen und der Port im Ports-Panel aufgeführt? PC im Ruhezustand? |
| Handy fragt nach GitHub-Anmeldung | Normal bei „Privat“ – mit **deinem** GitHub-Konto anmelden. |
| „Developer Tunnel“-Warnseite kommt immer wieder | Einmal „Weiter“ – in einer neu angelegten Home-Bildschirm-App kommt sie noch einmal. |
| Nach einem Update kurz „nicht erreichbar“ | Der Server startet neu; nach etwa einer Minute die Seite neu laden. |

---

## 9. Raspberry Pi als Dashboard-Server (empfohlen für den Dauerbetrieb)

Ein Raspberry Pi läuft Tag und Nacht, braucht kaum Strom und macht deinen
Computer frei: Das Dashboard läuft dann **auf dem Pi**, und alle deine
Geräte – Mac, PC, iPhone, Tablet – greifen im Heimnetz per Browser darauf
zu, unterwegs über Tailscale. Ein Installationsprogramm erledigt alles; es
richtet das Dashboard als Dienst ein, der beim Einschalten, nach einem
Absturz und nach einem Update von selbst startet, und plant eine tägliche
Sicherung (03:15 Uhr) und einen täglichen Garmin-Abruf (05:45 Uhr) ein.

**Was du brauchst:** Raspberry Pi 4 oder 5 (2 GB Arbeitsspeicher reichen),
Raspberry Pi OS (64-Bit), Netzwerk (LAN-Kabel oder WLAN) und SSH. Am
einfachsten stellst du beim Bespielen der Speicherkarte im **Raspberry Pi
Imager** unter „Einstellungen bearbeiten“ Rechnername (z. B. `tripi`),
Benutzer, Passwort, WLAN und „SSH aktivieren“ ein.

### Schritt 1: Mit dem Pi verbinden

Auf dem Mac im Terminal (Windows: PowerShell):
```
ssh <benutzer>@<pi-name>.local
```
z. B. `ssh nico@tripi.local`. Die Frage nach dem „fingerprint“ mit `yes`
beantworten, dann das Pi-Passwort eingeben. Alle folgenden Befehle laufen
in diesem Fenster **auf dem Pi**.

### Schritt 2: Projekt holen und installieren

```
git clone https://github.com/nico-lehr/TriathlonTrainingsDashboard.git
cd TriathlonTrainingsDashboard
bash deploy/raspberry-pi/install.sh
```
Das dauert ein paar Minuten (fragt einmal nach dem Pi-Passwort für die
Systemteile). Am Ende steht die Adresse, z. B. `http://tripi.local:5000`.
Da das Projekt per `git` geholt wurde, kommen Updates später über den
Hinweis im Dashboard (Abschnitt 3, „Updates“) – der Dienst startet danach
von selbst neu.

### Schritt 3: Daten – umziehen oder neu anfangen

**Neu anfangen** (oder zusätzlich Freunde anlegen), auf dem Pi:
```
bash deploy/raspberry-pi/benutzer.sh
```

**Bisherige Daten vom Mac/PC übernehmen** (Trainings, Benutzer, Garmin-
Schlüssel): Auf dem **alten** Rechner das Dashboard-Fenster schließen,
dann dort im Projektordner (der braucht dafür den aktuellen Stand, also
vorher einmal aktualisieren):
```
bash deploy/raspberry-pi/daten-zum-pi.sh <benutzer>@<pi-name>.local
```
Das Skript sichert die Daten, hält das Dashboard auf dem Pi kurz an und
kopiert `training.db`, `.env`, `fit-files/` und die Garmin-Schlüssel aus
`~/.triathlon`. Alle bisherigen Benutzer und Passwörter gelten danach auf
dem Pi weiter. Stand in der alten `.env` die Zeile `DASHBOARD_HOST=…`, auf
dem Pi löschen (`nano .env`) und `sudo systemctl restart triathlon-dashboard`.

**Wichtig:** Danach das Dashboard auf dem alten Rechner **nicht mehr
starten** – sonst gibt es zwei getrennte Datenstände.

### Schritt 4: Von allen Geräten zugreifen

- **Zu Hause** (gleiches WLAN): `http://<pi-name>.local:5000`, z. B.
  `http://tripi.local:5000` – auf Mac, PC, iPhone, Android. Klappt der Name
  auf einem Gerät nicht, die IP-Adresse nehmen (zeigt das
  Installationsprogramm an; im Router dem Pi eine feste IP geben, damit sie
  sich nicht ändert).
- **Unterwegs und für Freunde ohne App (empfohlen):** feste https-Adresse
  über Tailscale Funnel:
  ```
  bash deploy/raspberry-pi/oeffentlich.sh
  ```
  Das Skript installiert Tailscale, führt durch die Anmeldung und zeigt am
  Ende die Adresse (`https://<pi-name>.<netz>.ts.net`). Status:
  `… oeffentlich.sh status`, abschalten: `… oeffentlich.sh aus`.
- **Nur privat über die Tailscale-App:** Tailscale auf dem Pi installieren:
  ```
  curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up
  ```
  Den angezeigten Link öffnen und mit deinem Tailscale-Konto anmelden. Danach
  gilt alles aus Abschnitt 2 und 6 mit dem **Pi** statt dem PC: Adresse
  `http://<pi-name>:5000`, fürs iPhone mit https: `sudo tailscale serve --bg 5000`.
- iPhone/Android als App: Adresse in Safari/Chrome öffnen → „Zum
  Home-Bildschirm“ (Abschnitt 6, Schritt 3).

### Garmin und KI auf dem Pi

- Der **Garmin-Abruf** läuft jeden Morgen von selbst für alle mit Schlüssel
  bzw. Anmeldung; „Jetzt von Garmin holen“ in den Einstellungen geht
  weiterhin. Die alte Anmeldung (für „An Garmin senden“) auf dem Pi:
  `.venv/bin/python tools/garmin_sync.py --login --athlete <Nummer>`.
- **KI:** Am einfachsten mit **Claude** – Schlüssel in den Einstellungen →
  KI-Coach eintragen, fertig; der Pi schickt die Anfragen direkt an Claude.
- **Ollama statt Claude:** Für die Sprachmodelle ist der Pi zu schwach. Lass Ollama
  auf dem Mac/PC laufen und trage auf dem Pi in `.env` dessen Adresse ein,
  z. B. `OLLAMA_URL=http://192.168.1.20:11434`, dann
  `sudo systemctl restart triathlon-dashboard`. Ollama muss dafür im Netz
  lauschen (Mac: im Terminal `launchctl setenv OLLAMA_HOST 0.0.0.0`, Ollama
  neu starten). Die KI geht dann nur, wenn der Mac/PC an ist – alles andere
  läuft weiter. Alternativ die Claude API (Einstellungen).

### Verwalten (auf dem Pi)

| Was | Befehl |
|---|---|
| Läuft es? | `sudo systemctl status triathlon-dashboard` |
| Meldungen ansehen | `sudo journalctl -u triathlon-dashboard -n 100` (live: `-f`) |
| Neu starten | `sudo systemctl restart triathlon-dashboard` |
| Anhalten / wieder starten | `sudo systemctl stop …` / `sudo systemctl start triathlon-dashboard` |
| Garmin jetzt holen (alle) | `sudo systemctl start triathlon-dashboard-garmin` |
| Benutzer anlegen / Passwort neu | `bash deploy/raspberry-pi/benutzer.sh` / `… benutzer.sh passwort` |
| Öffentliche Adresse an / Status / aus | `bash deploy/raspberry-pi/oeffentlich.sh` / `… status` / `… aus` |
| Installation auffrischen | `bash deploy/raspberry-pi/install.sh` (harmlos, beliebig oft) |

**Sicherungen nicht nur auf der Speicherkarte lassen** – SD-Karten gehen
irgendwann kaputt. Ab und zu auf den Mac holen (dort im Terminal):
```
scp -r <benutzer>@<pi-name>.local:TriathlonTrainingsDashboard/backups ~/Desktop/dashboard-sicherung
```

### Wenn es nicht klappt

| Problem | Lösung |
|---|---|
| `ssh: Could not resolve hostname` | Pi an und im selben Netz? Statt des Namens die IP aus dem Router nehmen. |
| Adresse `….local:5000` lädt nicht | Auf dem Pi `sudo systemctl status triathlon-dashboard`; Meldungen mit `journalctl` (siehe oben). |
| Installationsprogramm bricht bei den Bibliotheken ab | Internet am Pi prüfen, dann erneut `bash deploy/raspberry-pi/install.sh`. |
| „Address already in use“ in den Meldungen | Läuft das Dashboard zusätzlich per `start.sh` im Terminal? Dieses beenden – der Dienst reicht. |
| Nach dem Umzug fehlen Daten | Lief beim Kopieren das alte Dashboard noch? Erneut `daten-zum-pi.sh` (die vorige Pi-Datenbank liegt als `training.db.vor-umzug` daneben). |

