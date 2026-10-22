# Betrieb: Dashboard auf dem eigenen PC, Freunde über Tailscale

Das Dashboard läuft auf **einem** PC (deinem). Dieser PC ist gleichzeitig
Webseite und Datenbank. Bis zu ein paar Freunde erreichen ihn über
**Tailscale** – ein privates Netz nur für eure Geräte, verschlüsselt, ohne
dass etwas im Internet offen steht. Jede Person meldet sich mit eigenem
Benutzernamen an und sieht nur ihre eigenen Daten.

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
- **„An Garmin senden“** (geplante Einheit direkt in den Garmin-Kalender):
  braucht einmalig die Garmin-Bibliotheken (`python -m pip install -r requirements.txt`)
  und für die jeweilige Person **einmal** die Garmin-Anmeldung des Syncs
  (`python tools/garmin_sync.py --login --athlete <nummer>`). Das Dashboard
  fragt nie nach einem Garmin-Passwort. Ohne Anmeldung zeigt der Knopf eine
  Meldung; der `.fit`-Download geht immer. Bitte einmal mit dem echten Konto
  ausprobieren – Garmin kann seine Schnittstelle jederzeit ändern.
- **KI-Coach:** [Ollama](https://ollama.com/download) auf diesem PC installieren
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

### Updates

Server beenden → `git pull` → `start.bat`/`start.sh` (installiert fehlende
Bibliotheken von selbst) → wieder starten. Beim Start wird vorher
automatisch gesichert; neue Tabellen legt der Server selbst an, vorhandene
Daten bleiben erhalten.

---

## 4. Sicherheit – was geschützt ist

- Ohne Anmeldung ist nur die Login-Seite erreichbar. Jede Anfrage prüft den
  Login und liefert nur die Daten der angemeldeten Person.
- Passwörter werden nur als Hash gespeichert. Nach 5 Fehlversuchen pro
  Minute sperrt der Server die Adresse kurz.
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
  und „An Garmin senden“, mit dem Token der jeweiligen Person) und Open-Meteo
  (Wetter, nur Ortsname bzw. Koordinaten des Heimatorts).

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
