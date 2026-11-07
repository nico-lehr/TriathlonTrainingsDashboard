# Offizielle Garmin Training API – so wird sie eingeschaltet

Das Dashboard bringt geplante Trainings auf zwei Wegen auf die Uhr
(`backend/garmin_push.py`):

1. **Jetzt:** über die Garmin-Anmeldung im Dashboard (Bibliothek
   `garminconnect`, inoffiziell). Funktioniert sofort, aber Garmin kann
   diesen Weg jederzeit ändern.
2. **Offiziell:** über Garmins **Training API** aus dem *Garmin Connect
   Developer Program*. Zuverlässig und ohne Garmin-Passwort im Dashboard –
   jede Person stimmt einmal direkt bei Garmin zu. Der Code dafür ist fertig
   (`backend/garmin_official.py`), aber **aus**, bis Garmin freischaltet.

Sobald der offizielle Weg verbunden ist, nimmt der Abgleich automatisch ihn.

## Schritte

1. Bei Garmin bewerben: <https://developer.garmin.com/gc-developer-program/>
   → „Training API“. Garmin prüft die Anfrage (kann Tage bis Wochen dauern).
   Als Zweck z. B.: „Privates Trainings-Dashboard, sendet geplante Workouts
   in den Garmin-Kalender der Nutzer“.
2. Nach der Freischaltung im Developer-Portal eine App anlegen. Als
   Weiterleitungs-Adresse (Redirect URL) die eigene Dashboard-Adresse mit
   `?garmin_oauth=1` eintragen, z. B. `https://dashboard.example/?garmin_oauth=1`.
3. In der `.env` auf dem Dashboard-PC eintragen (nie ins Repository, nie in
   einen Chat):
   ```
   GARMIN_TRAINING_CLIENT_ID=...
   GARMIN_TRAINING_CLIENT_SECRET=...
   GARMIN_TRAINING_REDIRECT_URL=https://dashboard.example/?garmin_oauth=1
   ```
4. Dashboard neu starten. In Einstellungen → Garmin → „Trainings auf die
   Uhr“ erscheint **„Offiziell mit Garmin verbinden“**.
5. **Vor dem ersten echten Einsatz** die Adressen und Feldnamen in
   `backend/garmin_official.py` (`AUTHORIZE_URL`, `TOKEN_URL`,
   `WORKOUT_PATH`, `SCHEDULE_PATH`, `convert_step`) mit der Doku
   abgleichen, die Garmin nach der Freischaltung bereitstellt. Sie folgen
   Garmins öffentlicher Beschreibung, sind aber noch nicht gegen das echte
   Garmin getestet (in Tests wird Garmin nie angesprochen).

Die Tokens liegen je Person unter `~/.triathlon/garmin_training_<id>.json`
(nur für den eigenen Betriebssystem-Benutzer lesbar) und gehen nie an den
Browser.
