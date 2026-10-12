# Garmin-Sync für mehrere Benutzer

`tools/garmin_sync.py` holt Trainings und Gesundheitsdaten (Schlaf, HRV,
Ruhepuls, Gewicht …) aus Garmin Connect – **für jeden Dashboard-Benutzer
getrennt** – und schreibt sie direkt in die Datenbank `training.db`. Jeder
sieht im Dashboard nur seine eigenen Daten.

Im Folgenden steht `python`. Auf dem Mac heißt der Befehl meist `python3`.
Alle Befehle werden im Projektordner ausgeführt.

## Einmalig: vorbereiten

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

## Einmalig pro Person: bei Garmin anmelden

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
kann die Garmin-Daten dieser Person lesen – deshalb liegt es außerhalb des
Projektordners und darf nicht weitergegeben werden. Ein erneutes `--login`
ersetzt das alte Token.

**Anmeldung zurückziehen:** den Ordner `~/.triathlon/garmin_<Nummer>.token`
löschen. Der Sync lässt diese Person ab dann aus.

## Regelmäßig: synchronisieren

| Befehl | Was passiert |
|---|---|
| `python tools/garmin_sync.py` | alle Personen, die ein Token haben, nacheinander |
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
| Garmin blockt gerade (zu viele Anfragen) | Ein paar Stunden warten, dann erneut starten. Bis dahin Geladenes bleibt gespeichert. |
| Benutzer X gibt es nicht | Benutzer mit `backend/create_user.py` anlegen oder Token-Ordner `garmin_X.token` löschen |
| Anmeldefehler trotz richtigem Passwort | Garmin ändert gelegentlich seine Anmeldung: `python -m pip install -U garminconnect curl_cffi` |

## Wo liegt was?

| Ort | Inhalt |
|---|---|
| `training.db`, Tabelle `workouts` | Trainings je Person. Das komplette Ergebnis von `parse_fit.py` (inkl. Kurven) steht in der Spalte `fit_data`. |
| `training.db`, Tabelle `wellness` | Gesundheitsdaten je Person und Tag. Alle Werte in `garmin_wellness_data`. |
| `fit-files/athlete_<Nummer>/` | Original-.fit-Dateien (Archiv) und `garmin-raw-cache.json` (Garmin-Rohantworten, macht den Sync schnell). Nicht im Repository. |
| `~/.triathlon/garmin_<Nummer>.token` | Garmin-Token je Person. |
| `~/.triathlon/garmin-sync.log` | eine Zeile je Person und Lauf. |

## Umstieg vom bisherigen Einzel-Sync

- Das alte Token unter `~/.garminconnect` wird nicht mehr benutzt. Melde
  dich einmal neu an: `python tools/garmin_sync.py --login --athlete 1`
  (deine Nummer aus `create_user.py`).
- Der Sync schreibt **nicht mehr** nach `fit-files/*.fit` und
  `data/wellness-data.js`. Beides kann nur eine Person enthalten. Das
  Dashboard liest die Daten künftig aus der Datenbank (Etappe 3). Bis dahin
  bekommt das Doppelklick-Dashboard keine neuen Garmin-Daten; alte Dateien
  bleiben unangetastet.
- `sync-garmin.command` (Mac) ruft den Sync weiterhin auf; die
  anschließenden Schritte `parse_fit.py`/`build_dashboard.py` bringen aber
  keine neuen Daten mehr ins Doppelklick-Dashboard.
- Beim ersten Lauf pro Person werden die Gesundheitsdaten einmal komplett
  neu geholt (bei 300 Tagen ein paar Minuten).
