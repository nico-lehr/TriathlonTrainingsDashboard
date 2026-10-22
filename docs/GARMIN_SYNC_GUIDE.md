# Garmin-Sync für mehrere Benutzer

`tools/garmin_sync.py` holt Trainings und Gesundheitsdaten (Schlaf, HRV,
Ruhepuls, Gewicht …) aus Garmin Connect – **für jeden Dashboard-Benutzer
getrennt** – und schreibt sie direkt in die Datenbank `training.db`. Jeder
sieht im Dashboard nur seine eigenen Daten.

Im Folgenden steht `python`. Auf dem Mac heißt der Befehl meist `python3`.
Alle Befehle werden im Projektordner ausgeführt.

Es gibt **zwei Wege** zu Garmin, je Person wählbar:

| | Offizieller Schlüssel (empfohlen) | Alte Anmeldung (`--login`) |
|---|---|---|
| Was nötig ist | eigener „Personal API“-Schlüssel aus Garmin Connect | Garmin-E-Mail + Passwort einmalig am PC |
| Wer richtet es ein | jede Person selbst, im Dashboard (Einstellungen → Garmin-Verbindung) | du am Dashboard-PC |
| Lesen (Trainings, Gesundheitsdaten) | ja | ja |
| VO2max, Trainingszustand von Garmin | nein (das Dashboard schätzt VO2max selbst) | ja |
| „An Garmin senden“ (Workouts auf die Uhr) | **nein** | ja |
| Stabilität | offizielle Schnittstelle | inoffiziell, kann bei Garmin-Änderungen brechen |

Hat eine Person einen Schlüssel hinterlegt, benutzt der Sync ihn – auch wenn
sie zusätzlich die alte Anmeldung hat. Die alte Anmeldung bleibt dann nur
noch für „An Garmin senden“ in Gebrauch.

## Offizieller Weg: Personal-API-Schlüssel

1. **Schlüssel erstellen** (jede Person in ihrem eigenen Garmin-Konto):
   Garmin Connect im Browser → Einstellungen → **Personal API**
   (https://connect.garmin.com/app/settings/personalApiToken) → Laufzeit
   wählen (30 Tage bis 1 Jahr) → Schlüssel kopieren. Er wird nur **einmal**
   angezeigt.
2. **Im Dashboard eintragen:** Einstellungen → **Garmin-Verbindung** →
   Schlüssel einfügen, optional „Gültig bis“ setzen → „Schlüssel prüfen &
   speichern“. Der Server fragt Garmin, ob der Schlüssel gilt, und legt ihn
   erst dann ab. Bitte nur am Dashboard-PC selbst oder über Tailscale
   eintragen (nicht über ein fremdes WLAN).
3. **„Jetzt von Garmin holen“** drücken. Beim ersten Mal dauert es einige
   Minuten (300 Tage Gesundheitsdaten), danach nur Sekunden. Danach die Seite
   neu laden. Der Sync am PC (`python tools/garmin_sync.py`, siehe unten)
   holt die Daten dieser Person ab jetzt ebenfalls mit.

Einmalig auf dem Dashboard-PC: `python -m pip install -r requirements.txt`
(darin steckt der Leser für die `.fit`-Dateien).

**Sicherheit:** Der Schlüssel kann nur lesen. Er liegt auf dem PC unter
`~/.triathlon/garmin_api_<Nummer>.json` (nur für deinen Computer-Benutzer
lesbar), daneben ein 24 Stunden gültiger Zugangs-Token. Das Dashboard zeigt
ihn nie wieder an. Zurückziehen: im Dashboard „Schlüssel entfernen“ **und**
in Garmin Connect löschen. Läuft er bald ab, warnt die Karte in den
Einstellungen (wenn „Gültig bis“ eingetragen ist); ein abgelaufener
Schlüssel erscheint im Log als „Garmin hat den Schlüssel abgelehnt“.

**Was fehlt:** VO2max und Garmins „Trainingszustand“ liefert die Personal
API nicht; das Dashboard schätzt VO2max dann selbst. Ob Garmin in den
`.fit`-Dateien der Schnittstelle einzelne Werte weglässt, ist noch nicht
bestätigt – bitte beim ersten Abruf mit dem Training in Garmin Connect
vergleichen.

## Alter Weg: Anmeldung mit Passwort (für „An Garmin senden“)

### Einmalig: vorbereiten

1. Bibliotheken installieren (Garmin-Teil und Datenbank-Teil):
   ```
   python -m pip install -r requirements.txt -r backend/requirements.txt
   ```
2. Die Datei `.env` muss existieren (siehe `.env.example`), sonst startet
   weder der Server noch der Sync.
3. Jeder Mitmachende braucht einen Dashboard-Benutzer:
   ```
   python backend/create_user.py
   ```
   Am Ende steht z. B. `Benutzer 'anna' angelegt (athlete_id=2)`. Die Zahl
   ist die **Benutzer-Nummer** – die braucht der Sync.

### Einmalig pro Person: bei Garmin anmelden

```
python tools/garmin_sync.py --login --athlete 2
```

Die Person mit der Nummer 2 tippt dann selbst ein:

- ihre Garmin-E-Mail (sichtbar),
- ihr Garmin-Passwort (unsichtbar beim Tippen),
- falls bei Garmin die Zwei-Faktor-Anmeldung an ist: den Code aus der
  App/SMS.

Danach läuft direkt der erste Sync für diese Person.

**Was gespeichert wird:** nur ein Anmelde-Token unter
`~/.triathlon/garmin_2.token` (ein kleiner Ordner, nur für deinen
Computer-Benutzer lesbar). Das Passwort wird **nie** gespeichert und nie ins
Log geschrieben. Das Token erneuert sich selbst. Aber: Wer das Token hat,
kann die Garmin-Daten dieser Person lesen und Workouts anlegen – deshalb liegt es außerhalb des
Projektordners und darf nicht weitergegeben werden. Ein erneutes `--login`
ersetzt das alte Token.

**Dasselbe Token für „An Garmin senden“:** Im Dashboard kann jede Person
eine geplante Lauf-, Rad- oder Schwimmeinheit direkt in ihren
Garmin-Kalender schicken (Trainingsplan → „An Garmin senden“). Der Server
benutzt dafür genau dieses Token – deshalb kann er auch Workouts in Garmin
Connect **anlegen**, nicht nur lesen. Im Dashboard wird nie ein
Garmin-Passwort abgefragt; ohne `--login` für diese Person zeigt der Knopf
nur eine Meldung.

**Anmeldung zurückziehen:** den Ordner `~/.triathlon/garmin_<Nummer>.token`
löschen. Der Sync lässt diese Person ab dann aus, und „An Garmin senden“
geht für sie nicht mehr.

## Regelmäßig: synchronisieren

| Befehl | Was passiert |
|---|---|
| `python tools/garmin_sync.py` | alle Personen mit Schlüssel oder Token, nacheinander |
| `python tools/garmin_sync.py --athlete 2` | nur Person 2 |
| `python tools/garmin_sync.py --days 1095` | einmalig mehr Vergangenheit holen (Standard: 300 Tage) |
| `python tools/garmin_sync.py --since 2024-01-01` | ab einem bestimmten Datum |
| `--activities-only` / `--wellness-only` | nur Trainings bzw. nur Gesundheitsdaten |

Was schon in der Datenbank steht, wird nicht noch einmal heruntergeladen.
Doppelte Trainings verhindert die Regel „pro Person jede Garmin-Aktivität
nur einmal“ (`UNIQUE(athlete_id, garmin_activity_id)`). Wurde ein Training
früher schon ohne Garmin-Nummer gespeichert (z. B. aus einem Import), erkennt
der Sync es an gleicher Startzeit und Sportart und ergänzt nur die Nummer.

## Das Log lesen

Pro Person und Lauf steht genau **eine Zeile** in `~/.triathlon/garmin-sync.log`
(und auf dem Bildschirm):

```
2026-10-12 06:00:03 Nutzer 1: OK - Aktivitaeten 2 neu, 41 vorhanden, 0 Fehler, Gesundheitsdaten 301 Tage
2026-10-12 06:00:05 Nutzer 2: FEHLER - Garmin-Anmeldung fehlt oder ist abgelaufen. Neu anmelden: python3 tools/garmin_sync.py --login --athlete 2
2026-10-12 06:00:09 Nutzer 3: FEHLER - Garmin blockt gerade (zu viele Anfragen). Spaeter erneut starten.
```

Ein Fehler bei einer Person stoppt die anderen **nicht**. Gab es irgendwo
einen Fehler, endet der Sync mit Rückgabewert 1 (wichtig nur für
automatisch gestartete Läufe).

| Meldung | Was tun |
|---|---|
| Garmin-Anmeldung fehlt oder ist abgelaufen | Person erneut anmelden: `--login --athlete <Nummer>` |
| Garmin hat den Schlüssel abgelehnt | Schlüssel abgelaufen oder in Garmin Connect gelöscht: neuen erstellen und in den Einstellungen eintragen |
| Garmin blockt gerade (zu viele Anfragen) | Ein paar Stunden warten, dann erneut starten. Bis dahin Geladenes bleibt gespeichert. |
| Benutzer X gibt es nicht | Benutzer mit `backend/create_user.py` anlegen oder Token-Ordner `garmin_X.token` löschen |
| Anmeldefehler trotz richtigem Passwort | Garmin ändert gelegentlich seine Anmeldung: `python -m pip install -U garminconnect curl_cffi` |

## Wo liegt was?

| Ort | Inhalt |
|---|---|
| `training.db`, Tabelle `workouts` | Trainings je Person. Das komplette Ergebnis von `parse_fit.py` (inkl. Kurven) steht in der Spalte `fit_data`. |
| `training.db`, Tabelle `wellness` | Gesundheitsdaten je Person und Tag. Alle Werte in `garmin_wellness_data`. |
| `fit-files/athlete_<Nummer>/` | Original-.fit-Dateien (Archiv) und `garmin-raw-cache.json` (Garmin-Rohantworten, macht den Sync schnell). Nicht im Repository. |
| `~/.triathlon/garmin_<Nummer>.token` | Garmin-Token je Person (alter Weg). |
| `~/.triathlon/garmin_api_<Nummer>.json` | Personal-API-Schlüssel je Person (offizieller Weg), dazu `….bearer.json` mit dem 24-h-Token. |
| `~/.triathlon/garmin-sync.log` | eine Zeile je Person und Lauf. |

## Umstieg vom bisherigen Einzel-Sync

- Das alte Token unter `~/.garminconnect` wird nicht mehr benutzt. Melde
  dich einmal neu an: `python tools/garmin_sync.py --login --athlete 1`
  (deine Nummer aus `create_user.py`).
- Der Sync schreibt **nicht mehr** nach `fit-files/*.fit` und
  `data/wellness-data.js`. Beides kann nur eine Person enthalten. Das
  Dashboard liest die Daten aus der Datenbank (`GET /api/v1/workouts/full`
  und `/wellness/daily`); alte Dateien bleiben unangetastet.
- `sync-garmin.command` (Mac, alter Einzelplatz-Ablauf) ruft den Sync weiterhin
  auf; die anschließenden Schritte `parse_fit.py`/`build_dashboard.py` und das
  Öffnen von `index.html` bringen aber nichts mehr ins Dashboard. Nimm
  stattdessen `python tools/garmin_sync.py`.
- Beim ersten Lauf pro Person werden die Gesundheitsdaten einmal komplett
  neu geholt (bei 300 Tagen ein paar Minuten).
