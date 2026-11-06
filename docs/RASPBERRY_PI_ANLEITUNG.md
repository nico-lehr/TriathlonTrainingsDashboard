# Raspberry Pi einrichten – Schritt für Schritt (für Einsteiger)

Diese Anleitung bringt das Dashboard auf deinen Raspberry Pi. Danach gilt:

- Der **Pi ist dein Dashboard-Server**. Er läuft Tag und Nacht, braucht so
  wenig Strom wie eine LED-Lampe und startet nach Stromausfall von selbst.
- **Alle Daten liegen auf dem Pi** – bei dir zu Hause, nicht in einer Cloud.
- **Zu Hause** öffnest du das Dashboard unter `http://raspberrypi.local:5000`.
- **Überall** (unterwegs, Handy im Mobilfunk, Freunde) unter einer festen,
  verschlüsselten Adresse wie `https://raspberrypi.tail1234.ts.net` –
  ohne App, einfach im Browser.
- **Jede Person hat ein eigenes Konto** und sieht nur ihre eigenen Daten:
  eigene Trainings, Ziele, Pläne, Garmin-Schlüssel, Mobility-Verlauf.

So sieht das Ganze aus:

```
 iPhone / Mac / Freunde  ──(https, verschlüsselt)──►  Tailscale  ──►  Raspberry Pi zu Hause
 Geräte im eigenen WLAN  ──(http://raspberrypi.local:5000)──────────►  Raspberry Pi
                                                                        ├─ Dashboard
                                                                        ├─ Datenbank (alle Konten, getrennt)
                                                                        ├─ täglich 03:15 Sicherung
                                                                        └─ täglich 05:45 Garmin-Abruf
```

Du brauchst etwa **45 Minuten**. Alle Befehle tippst (oder kopierst) du in
das **Terminal** auf deinem Mac: `Programme → Dienstprogramme → Terminal`
(oder `⌘ + Leertaste`, „Terminal“ tippen, Enter).

> **So liest du die Befehle:** Alles in einem grauen Kasten ist ein Befehl.
> Kopieren, ins Terminal einfügen, Enter drücken. Wörter in `<spitzen
> Klammern>` ersetzt du durch deine eigenen Angaben – ohne die Klammern.

---

## Schritt 1: Den Pi im Netz finden

Der Pi muss eingeschaltet und per Kabel oder WLAN mit deinem Router
verbunden sein. Im Terminal auf dem Mac:

```
ping -c 2 raspberrypi.local
```

- Kommen Zeilen wie `64 bytes from 192.168.178.45` – super. Die Zahl
  `192.168.178.45` ist die **IP-Adresse** deines Pi. Merk sie dir.
- Kommt `cannot resolve` oder `Unknown host`: Der Pi hat einen anderen
  Namen. Öffne die Übersicht deines Routers (bei einer FRITZ!Box:
  http://fritz.box → „Heimnetz“ → „Netzwerk“) und such ein Gerät, das nach
  Raspberry klingt. Dort steht seine IP-Adresse. Nimm in den nächsten
  Schritten statt `raspberrypi.local` diese IP.

**Tipp:** Stell im Router ein, dass der Pi **immer dieselbe IP** bekommt
(FRITZ!Box: beim Gerät „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse
zuweisen“).

## Schritt 2: Mit dem Pi verbinden

Du steuerst den Pi vom Mac aus – mit „SSH“ (eine Fernbedienung per Text).

```
ssh <benutzer>@raspberrypi.local
```

Für `<benutzer>` nimmst du den Benutzernamen, den du (oder wer den Pi
eingerichtet hat) bei der Installation gewählt hast. Bei sehr alten
Installationen ist es `pi` mit dem Passwort `raspberry`.

- Beim ersten Mal kommt eine Frage mit „fingerprint“: `yes` tippen, Enter.
- Dann das **Passwort des Pi** eingeben. Beim Tippen erscheinen keine
  Sternchen – das ist normal. Enter.
- Steht vorne jetzt etwas wie `nico@raspberrypi:~ $`, bist du **auf dem Pi**.
  Alle weiteren Befehle laufen in diesem Fenster auf dem Pi.

**Klappt es nicht?**

| Meldung | Was tun |
|---|---|
| `Connection refused` | SSH ist am Pi aus. Bildschirm und Tastatur an den Pi, dort `sudo raspi-config` → „Interface Options“ → „SSH“ → „Yes“. Oder Plan B unten. |
| `Permission denied` | Benutzername oder Passwort falsch. Unbekannt? Plan B unten. |
| `Could not resolve hostname` | Statt `raspberrypi.local` die IP aus Schritt 1 nehmen, z. B. `ssh nico@192.168.178.45`. |

**Plan B – Speicherkarte frisch einrichten (15 Minuten, löscht alles auf
der Karte):** Pi ausschalten, Speicherkarte in den Mac (ggf. mit
Kartenleser). [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
installieren und öffnen → Gerät „Raspberry Pi 4“ → Betriebssystem
„Raspberry Pi OS (64-bit)“ (unter „Raspberry Pi OS (other)“ geht auch die
„Lite“-Version ohne Bildschirm-Oberfläche) → deine Karte → „Weiter“ →
„Einstellungen bearbeiten“: Hostname `raspberrypi`, Benutzername und
Passwort festlegen, WLAN eintragen (falls kein Kabel), Reiter „Dienste“:
**SSH aktivieren** (mit Passwort). Speichern, schreiben lassen, Karte in den
Pi, einschalten, 2 Minuten warten – dann Schritt 1 und 2 wiederholen.

## Schritt 3: Kurz prüfen und den Pi auf den neuesten Stand bringen

Auf dem Pi:

```
getconf LONG_BIT
```

Steht dort `64`, passt alles. Steht `32`: Das Dashboard läuft auch, aber
Claude (KI-Coach) wahrscheinlich nicht – dann lieber Plan B aus Schritt 2
mit „64-bit“.

System aktualisieren (dauert ein paar Minuten, fragt evtl. nach dem
Pi-Passwort):

```
sudo apt update && sudo apt full-upgrade -y && sudo reboot
```

Der Pi startet neu, die Verbindung bricht ab. Eine Minute warten und wieder
verbinden: `ssh <benutzer>@raspberrypi.local`.

## Schritt 4: Dashboard installieren

Auf dem Pi, die drei Zeilen nacheinander:

```
git clone https://github.com/nico-lehr/TriathlonTrainingsDashboard.git
cd TriathlonTrainingsDashboard
bash deploy/raspberry-pi/install.sh
```

Das dauert 5–10 Minuten. Am Ende steht die Adresse, z. B.
`http://raspberrypi.local:5000`. Das Dashboard läuft jetzt als Dienst: Es
startet beim Einschalten, nach einem Absturz und nach Updates von selbst.

## Schritt 5: Konten – deine Daten vom Mac umziehen oder neu anfangen

Wähle **eins** von beiden.

### A) Du hast das Dashboard schon auf dem Mac benutzt (empfohlen)

Dann ziehst du alles um: alle Konten mit Passwörtern, Trainings, Ziele,
Garmin- und Claude-Schlüssel.

1. Auf dem **Mac** das Dashboard beenden (Terminal-Fenster mit dem
   laufenden Dashboard schließen).
2. Ein **neues** Terminal-Fenster auf dem Mac öffnen (`⌘ + N`) und in deinen
   Projektordner wechseln, z. B.:
   ```
   cd ~/Documents/TriathlonTrainingsDashboard
   ```
3. Den Projektordner auf den neuesten Stand bringen und umziehen:
   ```
   git pull
   bash deploy/raspberry-pi/daten-zum-pi.sh <benutzer>@raspberrypi.local
   ```
   Das Skript fragt ein paar Mal nach dem **Pi-Passwort**. Es sichert
   vorher alles und kopiert dann die Daten auf den Pi.
4. **Wichtig:** Das Dashboard auf dem Mac ab jetzt **nicht mehr starten** –
   sonst gibt es zwei getrennte Datenstände. Ab jetzt ist der Pi zuständig.

### B) Neu anfangen

Auf dem Pi (im Ordner `TriathlonTrainingsDashboard`):

```
bash deploy/raspberry-pi/benutzer.sh
```

Benutzernamen und Passwort (mindestens 10 Zeichen) für **dich** eingeben.
Das zuerst angelegte Konto ist der **Betreiber**: Nur er darf Updates
installieren und den Claude-Schlüssel ändern.

## Schritt 6: Zu Hause ausprobieren

Am Mac oder Handy (im selben WLAN) im Browser öffnen:

```
http://raspberrypi.local:5000
```

Anmelden – fertig. Klappt der Name auf einem Gerät nicht (manche
Android-Handys), nimm die IP: `http://192.168.178.45:5000`.

## Schritt 7: Von überall erreichbar machen

Jetzt bekommt dein Dashboard eine feste, verschlüsselte Internet-Adresse.
Dafür nutzen wir den kostenlosen Dienst **Tailscale** (Funktion „Funnel“).
Du musst am Router **nichts** einstellen.

Auf dem Pi:

```
bash deploy/raspberry-pi/oeffentlich.sh
```

1. Das Skript installiert Tailscale und zeigt dann einen **Link**. Öffne ihn
   am Mac und melde dich an (z. B. mit deinem Apple- oder Google-Konto) –
   so entsteht dein kostenloses Tailscale-Konto. „Connect“ bestätigen.
2. Beim ersten Mal kommt ein **zweiter Link**, um „HTTPS“ und „Funnel“ zu
   erlauben. Öffnen, bestätigen. Das Skript läuft dann von selbst weiter.
3. Am Ende steht deine Adresse, z. B.:
   ```
   https://raspberrypi.tail1234.ts.net
   ```
   **Diese Adresse funktioniert überall** – im Mobilfunk, im Büro, bei
   Freunden. Sie bleibt auch nach einem Neustart des Pi gleich.

**Aufs iPhone als App:** Die Adresse in Safari öffnen → Teilen-Knopf →
„Zum Home-Bildschirm“. Android: Chrome → ⋮ → „Zum Startbildschirm“.

Die Adresse wieder abschalten: `bash deploy/raspberry-pi/oeffentlich.sh aus`
(zu Hause geht das Dashboard weiter). Anzeigen: `… oeffentlich.sh status`.

## Schritt 8: Claude und Garmin einrichten

Im Dashboard (egal von welchem Gerät):

- **Claude:** ⚙️ Einstellungen → **KI-Coach** → Schlüssel einfügen →
  „Schlüssel prüfen & speichern“. Hast du Daten vom Mac umgezogen, ist er
  schon da. Mit „Für alle Personen freigeben“ dürfen auch deine Freunde
  Claude nutzen – über dein Guthaben.
- **Garmin:** Jede Person trägt in ihrem eigenen Konto unter ⚙️ →
  **Garmin-Verbindung** ihren eigenen Garmin-Schlüssel ein. Der Pi holt dann
  jeden Morgen um 05:45 Uhr die neuen Daten.

## Schritt 9: Freunde dazuholen

Jede Person erstellt sich ihr Konto selbst – mit eigenem, getrenntem
Bereich. Dafür braucht sie deinen **Einladungscode**; ohne Code kann
niemand aus dem Internet ein Konto anlegen.

1. Im Dashboard: ⚙️ Einstellungen → **Freunde einladen** → Schalter
   „Einladungen erlauben“ an. Es erscheint ein Code wie `SXEG-26GH`.
2. **„Einladung senden“** tippen und z. B. per WhatsApp schicken. Der Link
   öffnet direkt „Konto erstellen“, der Code ist schon eingetragen.
3. Die Person wählt Benutzernamen und Passwort (mindestens 10 Zeichen) –
   fertig, sie ist sofort angemeldet. Danach richtet sie unter ⚙️ ihr
   Trainingsprofil und ihren Garmin-Schlüssel ein.

- **„Neuer Code“** macht den alten sofort ungültig (bestehende Konten
  bleiben). Gut, wenn ein Code in falsche Hände geraten ist.
- Sind alle da: Schalter wieder **aus** – dann kann sich niemand mehr
  registrieren. In der Karte siehst du auch alle Konten.
- Passwort vergessen? Auf dem Pi: `bash deploy/raspberry-pi/benutzer.sh passwort`.
  (Konten von Hand anlegen geht weiterhin mit `bash deploy/raspberry-pi/benutzer.sh`.)

## Angemeldet bleiben

Beim Anmelden ist **„Angemeldet bleiben“** schon eingeschaltet. Dann musst
du dich auf diesem Gerät nicht wieder anmelden, solange du das Dashboard
mindestens alle **90 Tage** einmal öffnest – die Anmeldung verlängert sich
bei jedem Besuch von selbst. Schaltest du es aus (z. B. an einem fremden
Computer), gilt die Anmeldung nur, bis der Browser geschlossen wird
(höchstens einen Tag).

## Sicherheit – was jetzt öffentlich ist

Aus dem Internet ist **nur die Anmeldeseite** zu sehen. Alles andere geht
erst nach dem Login, und jede Person bekommt nur ihre eigenen Daten.

- Die Verbindung ist immer **verschlüsselt** (https, Zertifikat von Tailscale).
- **Raten wird gebremst:** Nach 5 falschen Passwörtern in einer Minute wird
  die Adresse des Ratenden kurz gesperrt; nach 10 Fehlversuchen für ein
  Konto ist dieses Konto 15 Minuten gesperrt (auch für dich – einfach warten).
- Programmdateien, Datenbank, Schlüssel und Sicherungen sind nie abrufbar.
- Neue Konten gibt es nur mit deinem Einladungscode (5 falsche Codes →
  kurze Sperre, höchstens 5 neue Konten pro Stunde und Adresse, insgesamt
  höchstens 30 Konten – änderbar mit `MAX_ACCOUNTS=` in `.env`).
- An fremden Geräten „Angemeldet bleiben“ ausschalten oder danach
  **abmelden** (⚙️ → Konto → Abmelden).
- Verlorenes Handy? Auf dem Pi in der Datei `.env` den `SECRET_KEY` ändern
  (`nano .env`) und `sudo systemctl restart triathlon-dashboard` – dann sind
  alle Geräte abgemeldet.
- Lange Passwörter sind der wichtigste Schutz – für alle Konten.

## Alltag

- **Updates:** Erscheint oben im Dashboard „Neue Version verfügbar“, klickst
  du (als Betreiber) auf „Installieren“. Der Pi sichert vorher alles und
  startet danach selbst neu.
- **Sicherungen** macht der Pi jede Nacht um 03:15 Uhr. Speicherkarten
  gehen irgendwann kaputt – hol dir die Sicherungen ab und zu auf den Mac
  (Terminal am **Mac**):
  ```
  scp -r <benutzer>@raspberrypi.local:TriathlonTrainingsDashboard/backups ~/Desktop/dashboard-sicherung
  ```
- **Pi ausschalten** (z. B. vor einem Umzug): `sudo shutdown now`, dann
  Stecker ziehen. Einfach Stecker ziehen geht meistens auch, kann die
  Speicherkarte aber beschädigen.

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Dashboard lädt nicht | Auf dem Pi: `sudo systemctl status triathlon-dashboard` – steht dort „active (running)“? Sonst `sudo systemctl restart triathlon-dashboard`. Meldungen: `sudo journalctl -u triathlon-dashboard -n 50`. |
| Die https-Adresse lädt nicht | Pi an und im Internet? Auf dem Pi `bash deploy/raspberry-pi/oeffentlich.sh status`. Steht dort nichts: `bash deploy/raspberry-pi/oeffentlich.sh` noch einmal. |
| „Zu viele Fehlversuche“ | 15 Minuten warten. Passwort vergessen: `bash deploy/raspberry-pi/benutzer.sh passwort` auf dem Pi. |
| Installationsprogramm bricht ab | Internet am Pi prüfen, dann `bash deploy/raspberry-pi/install.sh` einfach noch einmal. |
| Nach dem Umzug fehlen Daten | Lief beim Kopieren das Dashboard auf dem Mac noch? Mac-Dashboard schließen, Schritt 5 A noch einmal. |
| Claude: „Paket fehlt“ | 32-Bit-System (Schritt 3). Plan B aus Schritt 2 mit „64-bit“. |

Mehr Details für Fortgeschrittene: [DEPLOYMENT.md](DEPLOYMENT.md), Abschnitt 9.
