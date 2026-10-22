# DATA_MODEL

Beschreibt die zentralen Datenstrukturen. Bei Änderungen an diesen Formen
mit aktualisieren (siehe AI_RULES.md, Abschnitt 26).

Grundsatz aus AI_RULES.md: nicht jede Sportart hat jede Kennzahl (z. B. Pace
nur beim Laufen/Schwimmen, Leistung nur mit passendem Sensor). Fehlende
Werte sind `null` und gültig — nie geraten/erfunden.

## Wo die Daten liegen (Server-Betrieb)

Das Dashboard läuft über den eigenen Server (`backend/`, siehe
`docs/DEPLOYMENT.md`). Alles Persönliche liegt in `training.db` und ist an
die `athlete_id` der angemeldeten Person gebunden — jede Abfrage filtert
danach. Im Browser bleiben nur der Login-Token und das Farbschema.

| Daten | Wo | Zugriff im Browser |
|---|---|---|
| Trainings (Workout unten) | Tabelle `workouts`, komplettes Parser-Ergebnis in `fit_data` | `GET /api/v1/workouts/full`, neue per `POST /api/v1/workouts` |
| Gesundheitsdaten (Garmin) | Tabelle `wellness`, Rohwerte in `garmin_wellness_data` | `GET /api/v1/wellness/daily` |
| Profil, Ziele, Trainingsplan, Wünsche, Erholung, Gewicht, Notizen, KI-Auswertungen, Erfolge, Einstellungen | Tabelle `athlete_store` (`athlete_id`, `key`, `value` als JSON) | `storeGet(key)` / `storeSet(key, value)` (`js/data/api-client.js`) |
| Material | Tabellen `equipment`, `equipment_workouts` | `/api/v1/equipment…` |
| Login | Tabelle `athlete_logins` (Benutzername, Passwort-Hash) | `POST /api/v1/auth/login` |

**Ablage pro Person (`athlete_store`).** Ersetzt das frühere `localStorage`.
Die Schlüssel sind dieselben wie vorher (z. B.
`triathlon_dashboard_goals_v1`), erlaubt sind `a-z`, `0-9`, `_`, höchstens
64 Zeichen. `loadUserStore()` lädt beim Start alles mit einer Anfrage,
`storeGet()` liest danach aus dem Speicher, `storeSet()` schreibt sofort in
den Speicher und schickt den Wert gebündelt an `PUT /api/v1/store/<key>`
(ersetzt den alten Wert). Scheitert das Speichern, erscheint ein roter
Hinweis; beim Schließen mit ungespeicherten Änderungen warnt der Browser.
Abschnitte unten mit „Ablage“ liegen hier.

**Trainings und Dubletten auf dem Server** (`backend/workout_store.py`):
Dieselbe Einheit wird nicht zweimal gespeichert — gleich gilt: gleicher Tag,
gleiche Startzeit (als Zeitpunkt verglichen) und gleiches `sport_raw`. Aus
dem Garmin-Sync kommt zusätzlich `garmin_activity_id`, eindeutig pro Person.

## Workout

Ein Trainingseintrag, wie er aus einer `.fit`-Datei extrahiert wird
(`js/data/fit-parser.js`) und in `ALL`/`DATA` (`js/data/workouts.js`)
gehalten wird. Felder, wie sie aktuell tatsächlich befüllt werden:

```javascript
{
  file: "2026-08-27-12-30-00.fit",   // eindeutiger Schlüssel, Dateiname
  date: "2026-08-27T12:30:00",       // ISO-Zeitstempel, Trainingsbeginn
  sport: "Laufen",                    // "Laufen" | "Rad" | "Schwimmen" | "Sonstiges"
  sport_raw: "running",               // FIT-Enum-Rohwert (Debug/Referenz)
  sub_sport: "indoor_running",        // z.B. "Indoor", "Virtuell", "Straße", "open_water", …
                                       // bei Schwimmen: "Becken" | "Freiwasser" | "" (unbekannt) -
                                       // siehe "Becken/Freiwasser-Erkennung" unten, NICHT das
                                       // native FIT-sub_sport-Feld (bei HealthFit unzuverlässig).
                                       // bei Rad: "Indoor"/"Virtuell" kennzeichnen Rolle bzw.
                                       // virtuelle Plattform - siehe "Indoor/Outdoor-Erkennung".
  is_indoor: null,                    // true/false/null - aus einem Developer-Feld (s.u.), nicht
                                       // von jeder Quelle befüllt
  has_gps: true,                      // true/false/null - enthält die Aufzeichnung echte GPS-Punkte?
                                       // null bei Einheiten, die vor Einführung des Feldes
                                       // eingelesen wurden. Enum-unabhängiges Indoor-Signal beim Rad.

  duration_s: 3120,
  duration_min: 52.0,
  distance_km: 10.2,

  avg_hr: 152, max_hr: 171, min_hr: 98,
  avg_cadence: 172, max_cadence: 184,
  avg_power_w: 210, max_power_w: 340, normalized_power_w: 225,
  avg_grade_pct: 1.2,
  avg_stance_time_ms: 245, avg_stance_time_pct: 32.1,
  avg_vertical_oscillation_mm: 78, avg_vertical_ratio_pct: 6.9,
  avg_step_length_mm: 1150,
  total_steps: 9200,

  speed_kmh: 11.8, max_speed_kmh: 15.2,
  pace_min_per_km: "5:05",            // nur Laufen
  pace_min_per_100m: "2:04",          // nur Schwimmen

  elevation_gain_m: 120, elevation_loss_m: 118,
  calories: 640,
  training_load: 78,                  // TrainingsPeaks-artiger TSS-Näherungswert
  vo2max: null,                       // reserviert für eine künftige Strava-/Garmin-Connect-
                                       // Synchronisierung - aktuell IMMER null, da .fit-Aktivitäts-
                                       // dateien keinen VO2max-Wert enthalten (Garmin führt ihn
                                       // geräteseitig separat). Bis dahin schätzt
                                       // computeVo2MaxEstimate() ihn deterministisch, siehe unten.

  // Schwimmen - nur befüllt, wenn die .fit-Datei "length"-Nachrichten enthält
  // (bei Beckenschwimmen; bei Freiwasser architekturbedingt nie vorhanden,
  // da dort per GPS statt Bahnenzählung getrackt wird). Siehe
  // "Fundament für Garmin-Connect-/Strava-Daten" unten - Feldnummern der
  // length-Nachricht sind NICHT gegen eine echte Datei verifiziert.
  avg_swolf: null,                    // Ø SWOLF (Bahnzeit[s] + Züge) über aktive Bahnen
  best_swolf: null,                   // beste Einzelbahn
  num_active_lengths: null,           // Anzahl aktiv geschwommener Bahnen (ohne Pausen)
  avg_stroke_rate: null,              // Ø Zugfrequenz, Züge/min
  dominant_stroke: null,              // häufigster Schwimmstil über alle Bahnen, z.B. "Freistil"
  lengths: null,                      // Roh-Bahnen-Array (intern, fürs SWOLF/Stroke-Rate-Aggregat) -
                                       // nicht direkt in der UI, nur die Ø-Werte oben

  // Generisches Fundament für Developer-Felder (herstellerspezifische
  // Zusatzmetriken, die manche Exporte - z.B. HealthFit - in die .fit-Datei
  // einbetten). Bekannte, sinnvolle Felder werden als eigene Property
  // "hochgestuft"; alles andere landet unverändert in dev_raw, damit
  // künftige/unbekannte Felder automatisch sichtbar werden, ohne Code-Änderung.
  is_indoor: null,                    // true/false/null - Developer-Feld, nicht von jeder Quelle befüllt
  has_gps: true,                      // true/false/null - echte GPS-Punkte in der Aufzeichnung (kein Developer-Feld)
  rpe_estimated: null,                // geschätzte gefühlte Anstrengung (RPE) einer Quelle, falls vorhanden
  avg_mets: null,                     // Ø MET-Wert einer Quelle, falls vorhanden
  dev_raw: null,                      // { "Feldname aus der Datei": Wert, ... } - alle übrigen
                                       // Developer-Felder unverändert, als Fallback/Debug

  stream: {                           // Zeitreihen fürs Detail-Chart, s. u. (gleich lange Arrays)
    t: [0, 5, 10, ...],               // Sekunden seit Start
    hr: [98, 101, ...],
    speed: [...],                     // m/s
    dist: [...],                      // Meter seit Start
    alt: [...],                       // Höhe in m
    power: [...], cad: [...], grade: [...],
    vo: [...], gct: [...], vr: [...], sl: [...], // Laufdynamik: vertikale Bewegung,
                                       // Bodenkontaktzeit, vertikales Verhältnis, Schrittlänge
  },

  is_summary: false,                  // true = keine Streckendaten, nur Zusammenfassung
}
```

`stream` wird auf ca. 200 Punkte je Einheit verdichtet (Detailansicht +
"schnellste X km"-Schätzung in den Rekorden).

## Fundament für Garmin-Connect-/Strava-Daten

Die aktuelle Datenquelle (HealthFit-App / Apple Health) liefert nur einen
Bruchteil dessen, was eine .fit-Datei direkt von der Garmin-Uhr enthält -
Laufdynamik, Rad-Leistung und Schwimm-Bahnendaten gehen auf dem Weg über
Apple Health praktisch immer verloren (siehe Analyse vom 2026-08).
`js/data/fit-parser.js` und `parse_fit.py` können die entsprechenden
.fit-Nachrichten aber bereits lesen, damit eine spätere direkte
Garmin-Connect- oder Strava-Anbindung (oder ein "Original"-Export direkt
aus Garmin Connect) sofort ohne weitere Parser-Änderungen die volle Tiefe
liefert. Drei Bausteine:

**Bahnen-Nachrichten (Schwimmen, FIT-Nachricht 101 "length").** Liefern
SWOLF/Zugfrequenz/Schwimmstil (s.o.). Die verwendeten Feldnummern
(`total_elapsed_time`, `total_strokes`, `swim_stroke`, `avg_swimming_cadence`,
`length_type`, ...) stammen aus der offiziellen FIT-Profildokumentation,
konnten aber noch an KEINER echten Beckenschwimm-Datei getestet werden (in
den aktuellen 105 Dateien gibt es keine length-Nachrichten). Sobald eine
solche Datei vorliegt: `verify_parser.py` erneut laufen lassen (die Felder
`avg_swolf`/`best_swolf`/`num_active_lengths`/`avg_stroke_rate`/
`dominant_stroke` sind dafür bereits als Vergleichsfelder eingetragen) -
weicht der JS-Parser dann vom Python/fitdecode-Referenzwert ab, war eine
Feldnummer falsch geraten und muss korrigiert werden.

**Developer-Felder (FIT-Nachrichten 206/207).** Ein generischer
FIT-Mechanismus, über den Exporteure (z.B. HealthFit, aber auch Garmin
Connect selbst) benannte Zusatzfelder in eine .fit-Datei einbetten können,
die im Standard-Profil nicht vorgesehen sind. Der Parser liest jetzt JEDES
Developer-Feld generisch aus und legt es unter seinem Originalnamen in
`dev_raw` ab; die drei aktuell bekannten, nützlichen Felder (`is_indoor`,
`rpe_estimated`, `avg_mets`) werden zusätzlich als eigene, typisierte
Properties "hochgestuft". Taucht künftig (z.B. mit echten Garmin-Connect-
Exporten) ein neues, bisher unbekanntes Developer-Feld auf, erscheint es
automatisch in `dev_raw` - ohne Code-Änderung. Erst wenn sich ein Feld als
dauerhaft nützlich erweist, lohnt es sich, es analog hochzustufen.

**Becken/Freiwasser-Erkennung (`sub_sport` bei Schwimmen).** Das native
FIT-`sub_sport`-Feld ist bei den aktuellen Exporten unzuverlässig (wird
nicht verlässlich auf "open_water"/"lap_swimming" gesetzt) - eine
Fehlzuordnung würde Becken- und Freiwasserzeiten fälschlich vermischen
(siehe `findComparableWorkouts()`), deshalb wurde bewusst KEIN Rate-Enum
für die nativen Werte erfunden. Stattdessen, in dieser Reihenfolge:

1. Enthält die Datei Bahnen-Nachrichten (s.o.) → definitiv "Becken"
   (Freiwasser wird architekturbedingt nie über Bahnen getrackt, sondern
   durchgehend per GPS).
2. Sonst: Dateiname passt auf `/freiwasser|open.?water/i` → "Freiwasser"
   (funktioniert nur, wenn das im Dateinamen steht - reine Übergangslösung,
   bis Garmin Connect/Strava das Feld zuverlässig selbst liefert).
3. Sonst: Fallback auf das native (unzuverlässige) FIT-`sub_sport`-Feld.
4. Ist nichts davon eindeutig: leerer String `""` (unbekannt) - dann wird
   beim Vergleichen NICHT nach Becken/Freiwasser gefiltert (siehe
   `js/analytics/workout-comparison.js`), um ältere Einheiten ohne
   `sub_sport` nicht fälschlich auszuschließen.

**Dubletten (`dedupeWorkouts()` in `js/data/workouts.js`).** Der übliche
Dublettenschutz hängt am Dateinamen (`w.file`). Das reicht nicht, sobald
dasselbe Training aus zwei Quellen kommt — ein MyWhoosh-Export heißt
`MyNewActivity-6.1.0_2026-09-09_205100.fit`, dieselbe Einheit aus dem
Garmin-Sync `2026-09-09-06-07-16.fit`. An echten Daten beobachtet: dieselbe
Einheit mehrfach exportiert, und dieselbe Fahrt von zwei Geräten aufgezeichnet
(Startzeiten bis zu ~3 Minuten auseinander, **Ende identisch**). Deshalb gilt
als dieselbe Einheit: gleiche `sport_raw` **und** Start **und** Ende jeweils
innerhalb von 180 s. Bewusst nicht allein über den Start — zwei echte, kurz
aufeinanderfolgende Einheiten würden sonst fälschlich verschmelzen. Es gewinnt
der reichhaltigere Datensatz (`workoutRichness()`: Sekundenkurven zählen am
stärksten); fehlende Einzelwerte werden aus den schwächeren Dubletten ergänzt,
damit z. B. eine Notiz nicht verloren geht. Läuft in `recomputeDerived()` und
schreibt nach `RAW` zurück, damit sich Doppelungen nicht über die Zeit
aufsummieren.

**Indoor/Outdoor beim Rad: nur noch in den Vergleichsgruppen.** Die
Umgebungs-Filterleiste und die getrennten Indoor-Anzeigen (eigene Kachel,
zweite Rekorde-Karte, eigenes Watt-Chart, eigene HF-Zeile) wurden wieder
entfernt — Rad wird im Dashboard durchgehend **zusammen** dargestellt. Erhalten
bleibt die Trennung dort, wo sie fachlich nötig ist: in `sameComparisonGroup()`,
damit simulierte Indoor-Kilometer nie gegen echte Straßenwerte verglichen
werden, und bei den km-/km-h-Bestwerten der Rad-Rekorde-Karte.

**Durchschnittsgeschwindigkeit: Rückfall auf Distanz/Zeit.** Garmin schreibt
`avg_speed`/`enhanced_avg_speed` nicht in jede Session — an 64 echten
Radeinheiten geprüft fehlte es bei 61, obwohl Distanz und Zeit vorhanden waren.
Ohne Rückfall blieben Geschwindigkeit und die km/h-Bestwerte leer. Distanz
geteilt durch Zeit **ist** die Durchschnittsgeschwindigkeit — kein Schätzwert,
sondern dieselbe Größe anders berechnet. Umgesetzt in beiden Parsern.

**Indoor/Outdoor-Erkennung beim Rad (`rideEnvironment()`).** Indoor- bzw.
virtuelles Radtraining (Rollentrainer mit Plattform wie MyWhoosh, Zwift,
Rouvy) bleibt bewusst eine **Unterkategorie** von `sport: "Rad"` und wird
NICHT zu einer eigenen Sportart: `w.sport === "Rad"` trifft solche Einheiten
weiter, alle Rad-Summen, -Farben und -Filter bleiben unverändert. Grund für
die Trennung ist ein anderer: Distanz, Geschwindigkeit und Höhenmeter werden
indoor von der Plattform **simuliert** (Kurs, Windschatten, Avatargewicht) und
sind mit echten Straßenwerten nicht vergleichbar.

`rideEnvironment(w)` in `js/data/workouts.js` liefert `"indoor" | "outdoor" |
null` und wird in `recomputeDerived()` einmal pro Laden als `w._rideEnv`
materialisiert (gleiche Konvention wie `_date`) - damit braucht es weder eine
Schema-Migration noch einen Re-Import. Signale in dieser Reihenfolge:

1. `sub_sport` ist ein bekanntes Indoor-Label ("Indoor", "Virtuell", bzw. die
   englischen Rohwerte `indoor_cycling`/`virtual_activity`/`spin`) → "indoor".
2. `is_indoor === true` (Developer-Feld "SESSION INDOOR", z.B. HealthFit) → "indoor".
3. `sub_sport` ist ein bekanntes Outdoor-Label ("Straße", `road`, `gravel_cycling`, …)
   bzw. `is_indoor === false` → "outdoor".
4. `has_gps === true` → "outdoor", `has_gps === false` → "indoor". Das ist das
   **verlässlichste enum-unabhängige** Signal: ein Rollentrainer hat nie GPS,
   eine Straßenausfahrt immer. Es steht trotzdem hinten, weil `has_gps` nur bei
   neu eingelesenen Dateien existiert.
5. Sonst `null` (ehrlich unbekannt) - es wird nie geraten. Solche Einheiten
   gelten in den Auswertungen als Outdoor, damit bestehende Rad-Bestzeiten und
   -Charts unverändert bleiben.

**Warum die Referenzgruppen beim Rad strikt und beim Schwimmen tolerant sind.**
`sameComparisonGroup(ref, cand)` (ebenfalls `js/data/workouts.js`) ist die
einzige Stelle, an der entschieden wird, wer in eine Vergleichsgruppe darf -
genutzt von `findComparableWorkouts()`, dem HF-Profil, dem Belastungs-Radar
und dem Vergleichs-Picker. Beim Rad muss die Umgebung übereinstimmen (sofern
bekannt), beim Schwimmen bleibt die bisherige tolerante Regel. Der Unterschied
ist beabsichtigt: bei Becken/Freiwasser ist die Pace nur *verzerrt*, bei
Indoor-Kilometern ist sie *erfunden* - dort gilt "lieber keine Vergleichsgruppe
als eine falsche".

**Was sich indoor in der Auswertung ändert.** Statt Kilometern und km/h zählt
die Leistung: die Vergleichsgruppe wird über die **Dauer** (±20 %) statt über
die Distanz gebildet, das Radar nutzt Ø Watt/NP statt Ø-Schnitt/Strecke
(`RADAR_AXES_INDOOR_RIDE`), die Rekorde-Karte "Rad (Indoor)" kennt keine
km-Zeilen, die Erfolge-Bestzeiten (10/20/40 km) sind auf Outdoor beschränkt,
und der KI-Kontext bekommt einen expliziten Hinweis plus ein Watt-Delta statt
eines km/h-Deltas. In der HF-Verteilung ist Indoor eine **eigene Zeile**, weil
der Puls auf der Rolle bei gleicher Leistung wärmebedingt höher liegt.

**Bewusste Ausnahme: VO2max.** `bikeVo2SubmaxPoint()`
(`js/analytics/performance.js`) rechnet `VO2 = 7 + 10.8 × Watt ÷ kg` - rein
leistungsbasiert. Watt sind umgebungsunabhängig, deshalb fließen Indoor-
Einheiten hier absichtlich mit ein; eine Trennung würde die Punktdichte der
Regression halbieren und die Schätzung verschlechtern.

## Gesundheitsdaten (`GET /api/v1/wellness/daily` → `WELLNESS`)

Geschrieben von `tools/garmin_sync.py` in die Tabelle `wellness` (je Person
und Tag), gelesen über `loadWellness()` in `js/data/garmin-wellness.js`.
Quelle ist je Person die offizielle Personal API (Schlüssel,
`tools/garmin_personal_api.py`) oder der alte Login; die Aufbereitung
(`normalize()`) ist dieselbe. Über die Personal API bleiben `vo2max`,
`vo2max_cycling`, `training_status` und `training_load_week` `null` (liefert
sie nicht). Der
Server liefert dieselbe Form wie früher die Datei `data/wellness-data.js`,
deshalb blieben die Auswertungen unverändert. `sync.at` ist der Zeitpunkt
der letzten Änderung.

```javascript
const WELLNESS = {
  generated_at: "2026-09-12T13:00:00+02:00",
  sync: { at, von, bis, aktivitaeten: { neu, vorhanden, fehler, gesamt } },
  daily: {
    "2026-09-10": {
      sleep_min: 450, sleep_deep_min: 90, sleep_rem_min: 105, sleep_score: 82,
      hrv_ms: 68, hrv_status: "BALANCED",          // Garmins eigene Einordnung
      hrv_baseline_low: 55, hrv_baseline_high: 78, // Garmins Normbereich
      resting_hr: 48,
      body_battery_high: 88, body_battery_low: 25,
      weight_kg: 72.4, body_fat_pct: 18.2, muscle_mass_kg: 31.5,
      steps: 11230,
      vo2max: 52.3, vo2max_cycling: 49.1,
      training_status: "PRODUCTIVE",
    },
    // ...
  },
};
```

**`null`-Semantik, wie überall im Projekt:** Fehlende Werte sind `null` bzw.
fehlen ganz - ein Tag ohne getragene Uhr ist eine **Lücke, kein Nullwert**.
`wellnessSeries()` lässt solche Tage aus, statt sie als 0 einzurechnen; ein
Tag ohne einen einzigen Messwert taucht in `daily` gar nicht erst auf.
Ausnahme: `steps: 0` ist ein echter Messwert (Tag ohne Bewegung) und bleibt.

**Warum Abweichung statt Absolutwert.** HRV und Ruhepuls werden in der UI
(`js/components/recovery.js`) und im KI-Kontext (`js/ai/context-builder.js`)
als Abweichung vom eigenen 30-Tage-Mittel dargestellt. Ein HRV-Wert von 62 ms
ist ohne Vergleichsgröße bedeutungslos - individuelle Normalwerte
unterscheiden sich um ein Vielfaches. Erst "8% unter dem eigenen Mittel" ist
eine Aussage. `wellnessBaseline()` verlangt dafür mindestens 3 Messwerte;
darunter wird keine Basislinie gebildet, weil sie irreführend wäre.

**Verhältnis zum subjektiven Erholungs-Check** (`js/data/health.js`): Die
gemessenen Werte ERSETZEN die manuelle Abfrage nicht, sie stehen daneben -
im Dashboard wie im KI-Kontext. Gefühl und Messwert fallen regelmäßig
auseinander, und genau diese Diskrepanz ist die interessanteste Information
für eine Trainingsempfehlung.

**VO2max und Trainingszustand** stammen NICHT aus `get_max_metrics` (kam an
echten Daten leer zurück), sondern aus `get_training_status` →
`mostRecentVO2Max.generic` bzw. `.cycling`. Der `trainingStatus` dort ist ein
undokumentierter Zahlencode und damit für eine Auswertung wertlos — genutzt
wird stattdessen `trainingStatusFeedbackPhrase` (z. B. `MAINTAINING_1` →
„Erhaltend"). Unbekannte Phrasen werden unverändert durchgereicht, statt eine
Übersetzung zu erfinden.

**Standard-Zeitraum: 300 Tage** (`DEFAULT_DAYS` in `tools/garmin_sync.py`).
Bewusst gewählt: das längste analytische Fenster im Dashboard ist der
VO2max-Trend mit 240 Tagen (120 aktuell + 120 davor, `sportVo2Regression()`),
danach CTL/ATL/TSB mit 42 und ACWR mit 28 Tagen. Die KI-Vergleichsgruppe nimmt
ohnehin nur die 12 ähnlichsten Einheiten. Nicht abgedeckt sind allein die
**Allzeit-Bestwerte** (Rekorde-Tab, Bestzeit-Erfolge) und der Filter-Chip
„1J" (365 Tage) — dafür einmalig mit größerem `--days` nachladen. Da
`fit-files/` als Archiv dient und der Downloader vorhandene Dateien
überspringt, ist das jederzeit nachholbar und verliert nichts.

**Roh-Zwischenspeicher** `fit-files/athlete_<id>/garmin-raw-cache.json` (je Person) hält die unveränderten
Garmin-Antworten je Tag. Zwei Gründe: der Sync wird dadurch inkrementell
(bereits geholte Tage werden nie erneut abgefragt - schont das Rate-Limit),
und bei einer Formatänderung auf Garmins Seite lässt sich die Aufbereitung
wiederholen, ohne alles neu herunterzuladen.

## Roh-Container (`workouts.json` von `parse_fit.py`)

Nur noch Eingabe für den einmaligen Import
(`python backend/import_workouts_json.py --user <name>`). Das Dashboard liest
Trainings vom Server (siehe oben); `data/workouts-data.js` wird nicht mehr
geladen.

```javascript
{
  generated_at: "2026-08-28T10:01:53Z",
  source_folder: "...",
  count: 104,
  skipped: [...],       // Dateien, die nicht gelesen werden konnten
  workouts: [ /* Workout[] wie oben */ ],
}
```

`js/data/workouts.js` lädt die Trainings vom Server
(`loadPersistedWorkouts()`) nach `ALL` (alles) und leitet `DATA`
(zeitraum-/sportart-gefiltert über `filterState`) ab. Neue `.fit`-Dateien
aus dem Browser-Import speichert `saveImportedWorkouts()` per
`POST /api/v1/workouts`.

## Athlete Profile (`js/data/athlete.js`, Ablage)

```javascript
{
  age: 34,
  experienceLevel: "1-3",             // "<1" | "1-3" | ">3"
  strongDiscipline: "Rad",
  weakDiscipline: "Laufen",

  trainingDays: ["mo", "mi", "fr"],   // generelle Trainingstage
  trainingDaysPerWeek: 3,             // = trainingDays.length (Redundanz für Altbestand)
  swimDay: "mi",                      // muss Teilmenge von trainingDays sein
  longDays: ["fr"],                   // muss Teilmenge von trainingDays sein
  typicalSessionMin: 75,

  weeklyHours: 8,
  ftpWatts: 250,
  runThresholdPace: "4:30",
  swimCss: "1:45",
  maxHr: 188,                         // optional, nur für TRIMP/HFR in der Trainings-Detailansicht + VO2max-Regression
  restingHr: 52,                      // optional, siehe js/analytics/workout-profile.js
  weightKg: 72,                       // optional, nur für die Rad-VO2max-Schätzung aus Watt (js/analytics/performance.js)
  includeStrength: true,              // Kraft-Einheiten in den automatischen Trainingsplan mit aufnehmen
  includeMobility: false,             // Mobility/Beweglichkeit in den automatischen Trainingsplan mit aufnehmen

  onboardingDone: true,               // schaltet das Coach-Onboarding-Gate frei

  swimCssTest: { t400: "7:10", t200: "3:25", date: "2026-09-01" }, // CSS-Test (Analyse-Tab), Ergebnis in swimCss
  homeLocation: { name: "Kraichtal", lat: 49.1, lon: 8.7 },         // Wetter im Kalender, null = aus
  sportBalanceTarget: { Schwimmen: 15, Rad: 50, Laufen: 35 },       // Ziel-Anteile in %, null = Standard 15/50/35
}
```

## Goal (`js/data/goals.js`, Ablage)

```javascript
{
  id: "g1234...",
  name: "Ironman 70.3 Kraichgau",
  sport: "Triathlon",
  date: "2026-06-15",
  targetTime: "05:30:00",             // optional
  distanceKm: 113,                    // optional
  subDisciplines: [                   // optional, nur bei sport === "Triathlon"
    { key: "swim", label: "Schwimmen", distanceKm: 1.9, targetTime: "0:40:00" },
    { key: "bike", label: "Rad", distanceKm: 90, targetTime: "2:30:00" },
    { key: "run", label: "Laufen", distanceKm: 21.1, targetTime: "1:40:00" },
  ],                                   // nur ausgefüllte Disziplinen, sonst null
  notes: "erste Langdistanz",         // optional
  isPrimary: true,                    // "Hauptevent" - nur EIN Ziel gleichzeitig, per ★ markierbar
                                       // (setGoalPrimary, js/data/goals.js) - der Trainingsplan
                                       // (siehe unten) plant immer auf dieses eine Ziel hin.
  recommendation: "...",              // zuletzt generierte KI-Empfehlung
  recommendationAt: "2026-08-20T...", // Zeitstempel dazu
  lastPlannedAt: "2026-08-27T...",    // Zeitstempel der letzten Trainingsplan-Generierung (s.u.)
  racePlan: null,                     // Rennplan, siehe "Rennplan" unten (null = Standard-Listen)
}
```

**Zeitformat:** `targetTime` ist `H:MM:SS` oder `H:MM` — zwei Teile heißen
Stunden:Minuten („5:30“ = 5 h 30 min). Gelesen wird überall mit
`goalTimeToSeconds()` (`js/utils/dates.js`), dem einen Parser für Zielzeiten.

## Geplantes Workout (`js/data/planned-workouts.js`, Ablage)

Eine vorgeschlagene/geplante Trainingseinheit - komplett getrennt von den
echten, aus `.fit`-Dateien importierten Workouts oben: kein `stream`, keine
Ist-Werte, nur eine Absicht. Wird im Kalender (Monats-/Wochen-/Tagesansicht)
UND im Coach-Tab ("Trainingsplan"-Kachel) angezeigt, im Kalender per
Drag & Drop auf ein anderes Datum verschiebbar.

Entsteht entweder durch die KI (`generateTrainingPlan()`, `js/ai/ollama.js`,
`source: "ai"`) ODER durch manuelles Anlegen (`source: "manual"`) - beide
Wege nutzen dasselbe Overlay/dieselbe Funktion `openPlanEdit(id, defaults)`
(`js/components/training-plan.js`): `id === null` schaltet das Overlay in
den Neuanlage-Modus (Titel "Neue Einheit planen", kein Status-/Löschen-/
Export-Bereich, da eine gerade erst angelegte Einheit zwangsläufig
`status: "geplant"` ist und noch nichts zum Exportieren/Löschen einer
bestehenden ID gibt). Zwei Einstiegspunkte:

* Coach-Tab, Trainingsplan-Kachel: Button "+ Einheit" → `openPlanEdit(null, { goalId: <Hauptevent-Ziel>, phase: <aktuelle Phase> })` -
  die Einheit landet damit direkt in derselben Liste wie KI-Vorschläge.
* Kalender, Steuerleiste: Button "+ Workout" → `openPlanEdit(null, { date: <aktuell fokussierter Tag>, goalId: <Hauptevent-Ziel, falls vorhanden> })`.

Eine manuell angelegte Einheit ohne Hauptevent-Ziel (`goalId: null`, z.B.
wenn noch kein ★-Ziel markiert ist) erscheint weiterhin im Kalender
(`plannedWorkoutsOfDay()` filtert nicht nach `goalId`), aber NICHT in der
Trainingsplan-Kachel (die filtert bewusst nach dem Hauptevent-Ziel).

```javascript
{
  id: "pw1234...",
  date: "2026-09-02",                 // YYYY-MM-DD
  sport: "Laufen",                    // "Schwimmen" | "Rad" | "Laufen" | "Kraft" | "Mobility"
  title: "Lockerer Dauerlauf",
  duration_min: 50,
  intensity: "leicht",                // "leicht" | "mittel" | "hart" | null - bewusst KEIN
                                       // exakter Load/TSS-Wert, da ohne Ist-Daten nicht seriös
                                       // berechenbar (AI_RULES: fehlende Werte nie erfinden)
  description: "10min Einrollen, 30min lockeres Grundlagentempo, 10min Auslaufen",
  exercises: null,                    // nur bei sport="Kraft"/"Mobility":
                                       // [{ name: "Kniebeuge", sets: 3, reps: "12", note: "..." }]
  status: "geplant",                  // "geplant" | "erledigt" | "uebersprungen"
  goalId: "g1234...",                 // welchem Ziel/Trainingsplan zugeordnet
  phase: "grundlage",                 // Trainingsphase am Tag der Einheit (getPhase, s. "Periodisierung");
                                       // wird beim Verschieben auf ein neues Datum neu berechnet
  steps: null,                        // optional: Schritte fürs Garmin-Workout/.fit, s.u.
  source: "ai",                       // "ai" | "manual"
  createdAt: "2026-08-27T...",
  garminSentAt: "2026-09-01T...",     // nur nach "An Garmin senden": wann
  garminWorkoutId: 123456789,         //   und unter welcher Nummer in Garmin Connect
}
```

**Schritte (`steps`, optional).** Struktur einer Einheit, geprüft von
`validateWorkoutSteps()`; fehlen sie, gelten `defaultWorkoutSteps()`:

```javascript
[{ type: "warmup", duration_min: 10, target: { kind: "none" } },
 { type: "repeat", count: 6, steps: [
     { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
     { type: "recovery", duration_min: 1.5, target: { kind: "none" } } ] },
 { type: "cooldown", duration_min: 10 }]
// type: warmup | interval | recovery | cooldown | rest | repeat
// target.kind: none | hr_zone | pace_zone | power_zone
// je Schritt duration_min ODER distance_km (keins = bis Lap-Taste), max. 50 Schritte,
// keine Wiederholung in der Wiederholung
```

## Terminwünsche (`js/data/plan-wishes.js`, Ablage)

„Ich möchte Donnerstag 60 min schwimmen“ — die nächste KI-Planung plant
offene Wünsche fest ein. Ob ein Wunsch eingeplant ist, wird nicht
gespeichert, sondern am Plan abgelesen (gleicher Tag + gleiche Sportart).
Vergangene Wünsche fallen beim Laden weg.

```javascript
[{ id: "pw…", date: "2026-09-10", sport: "Schwimmen", duration_min: 60, note: null, createdAt: "…" }]
```

Daneben bleibt der freie Wunschtext `athleteProfile.customPlanWishes`.

## Gewichtsverlauf (`js/data/weight-log.js`, Ablage)

Separates Log fürs Körpergewicht über die Zeit (Basis für künftige
Trend-Auswertungen) — getrennt von `athleteProfile.weightKg`, das weiterhin
der "aktuelle" Wert bleibt und beim Eintragen automatisch mitaktualisiert
wird (`logWeight()`), damit beide Werte nie auseinanderlaufen. Max. ein
Eintrag pro Tag (ein neuer Eintrag am selben Datum überschreibt).

```javascript
[
  { date: "2026-08-20", weightKg: 75 },
  { date: "2026-08-29", weightKg: 74.2 },
]
```

`getLatestWeightKg()` liefert den neuesten Eintrag (Fallback:
`athleteProfile.weightKg`, falls noch nie über den Verlauf eingetragen
wurde) — genutzt von der Ernährungs-Berechnung unten. `weightTrend(days)`
gibt die Veränderung ggü. vor `days` Tagen zurück, oder `null` bei zu wenig
Historie (nie interpoliert/geraten).

## Recovery Check / Health (`js/data/health.js`, Ablage)

```javascript
// aktueller Tag:
{
  date: "2026-08-28",
  soreness: "moderate",               // "none" | "light" | "moderate" | "severe"
  sorenessLocation: "rechtes Knie",   // frei, nur wenn soreness != "none"
  energy: "low",                      // "low" | "reduced" | "high"
  injury: "yes",                      // "no" | "yes"
  injuryNote: "seit 2 Tagen",
}

// Logbuch (letzte 90 Tage mit Eintrag), für den KI-Kontext:
[
  { date: "2026-08-27", soreness: "light", energy: "high", injury: "no", ... },
  ...
]
```

Wird täglich zurückgesetzt: beim Laden verglichen mit dem heutigen Datum,
der Vortag wird (falls nicht leer) ins Logbuch archiviert.

## KI-Auswertung je Trainingseinheit (`js/ai/ollama.js`, Ablage)

Separater Cache (nicht Teil des Workout-Objekts, da `ALL`/`DATA` bei jedem
"Aktualisieren" aus `RAW` neu abgeleitet werden), Schlüssel = Dateiname:

```javascript
// workoutAnalysisCache["2026-08-27-...-Connect.fit"]:
{
  analysis: "...",                    // zuletzt generierter Auswertungstext
  analysisAt: "2026-08-28T...",       // Zeitstempel dazu
  error: "...",                       // z.B. "zu wenig Vergleichsdaten" oder Ollama-Fehler
  loading: false,
}
```

Vergleichsgruppe (gleiche Sportart, Distanz/Dauer ±20%, siehe
`findComparableWorkouts()` in `js/analytics/workout-comparison.js`) wird
deterministisch berechnet, das Modell bekommt die fertigen Ø-Werte/Deltas
und interpretiert nur (siehe `docs/AI_CONTEXT.md`).

## Race Readiness Score (`js/analytics/race-readiness.js`)

Rein rechnerisch (kein LLM-Call), wird bei jedem Render von `renderGoals()`
(`js/components/coach.js`) live für jedes Goal mit Datum in der Zukunft neu
berechnet — nicht persistiert. `computeRaceReadiness(goal)` gibt `null`
zurück, wenn `goal.date` fehlt oder in der Vergangenheit liegt, sonst:

```javascript
{
  score: 68,                          // 0-100, Summe der 4 Faktor-Punkte
  level: { label: "auf gutem Weg", color: "var(--c-warn)" },
  daysUntil: 42,
  factors: [
    { label: "Form", note: "TSB +12.3 (frisch)" },
    { label: "Verletzungsrisiko", note: "ACWR 1.05 (optimal)" },
    { label: "Trainingskonstanz", note: "82% der Zielumfänge der letzten 4 Wochen erreicht" },
    { label: "Phase", note: "42 Tage bis Event — noch keine Taper-Phase" },
  ],
}
```

Vier Faktoren, max. Punkte je Faktor: Form/TSB (30), Verletzungsrisiko/ACWR
(25, dieselben Bänder wie das ACWR-Gauge), Trainingskonstanz vs.
`athleteProfile.weeklyHours` der letzten 4 Wochen (25), Zeit-bis-Event/
Taper-Phase (20, gewichtet TSB stärker je näher das Event). Nutzt
`computeLoadSeries()` (`js/analytics/training-load.js`) für CTL/ATL/TSB.

## Trainingsplan (`js/analytics/training-plan.js`, `js/ai/*.js`, `js/data/planned-workouts.js`)

Automatisch von der KI erstellter Trainingsplan fürs Hauptevent-Ziel
(`goal.isPrimary`). Rein deterministischer Teil (`training-plan.js`):

- `computeTrainingPhase(daysUntil)` — Phase als Text für den KI-Kontext,
  abgeleitet aus `getPhase()` (siehe „Periodisierung“ unten), KEINE
  Trainingsinhalte.
- `computePlanningWindow(goalId, days=7)` — rollierendes Fenster: die
  nächsten `days` Tage, die für dieses Ziel noch KEINEN geplanten Eintrag
  haben. Es wird also nie die ganze Vorbereitungsphase auf einmal verplant,
  sondern immer nur ein kurzes Stück weiter (Form/Werte ändern sich laufend).
- `shouldAutoReplan(goal)` — true, wenn weniger als 3 zukünftige geplante
  Tage übrig sind. Wird einmal pro App-Start geprüft (`checkAutoReplan`,
  `js/app.js`) und löst bei Bedarf automatisch `generateTrainingPlan()` aus.

Die eigentlichen Workout-Vorschläge kommen vom LLM: `buildPlanContext()`/
`buildPlanPrompt()` (`js/ai/context-builder.js`/`prompts.js`) bauen Kontext
und Prompt, `generateTrainingPlan()` (`js/ai/ollama.js`) ruft Ollama mit
`format:"json"` auf und lässt `parsePlanResponse()` das Ergebnis validieren,
bevor daraus `plannedWorkouts`-Einträge werden (siehe oben) - ungültige
Einträge (falsches Datum/Sportart/unplausible Dauer) werden verworfen statt
ungeprüft übernommen.

Danach prüft das Regelwerk (`validatePlan()`, nächster Abschnitt) jeden
KI-Plan: Verstöße mit fertigem Vorschlag werden automatisch korrigiert,
sonst wird die KI höchstens 2-mal mit der Liste der Verstöße neu gefragt.
Bleibt ein „block“-Verstoß, wird der Plan nicht übernommen. Beim Verschieben
per Drag & Drop oder Datum gilt dasselbe Regelwerk: „warn“ → „Trotzdem
verschieben“, „block“ → Vorschlag per Klick.

## Planregeln (`js/analytics/plan-rules.js`)

`validatePlan(plannedWorkouts, history, wellness, recovery, options)` — rein
rechnerisch, ohne Speicherzugriff (`tests/js/plan-rules.test.js`). Die KI
darf Einheiten vorschlagen; ob ein Plan zu hart ist, entscheidet nur dieses
Regelwerk. `wellness` = `{ hrv_ms, resting_hr }` (Abweichung vom eigenen
Mittel), `recovery` = heutiger Erholungs-Check, `options` =
`{ goal, today, acwr, planUntil }`.

| Nr. | Regel (`rule`) | Stufe |
|---|---|---|
| 1 | nie 2 harte Tage hintereinander (`hard_in_row`); hart = „hart“/„VO2max“ oder > 120 min | block |
| 2 | max. 3 harte Einheiten/Woche (`hard_per_week`), ~80 % locker (`easy_share`) | warn |
| 3 | mind. 1 freier Tag pro Woche (`rest_day`) | block |
| 4 | Wochenumfang max. +10 % (`volume_increase`), jede 4. Woche Entlastung −30 % (`deload`), Zielumfang der Phase (`phase_volume`) | warn |
| 5 | nach Belastungsspitze (ACWR > 1,3) oder schlechter Erholung nur locker (`recovery` block, `wellness` warn) | block/warn |
| 6 | je Ziel-Sportart mind. eine lockere Grundlageneinheit (`goal_base`) | warn |
| 7 | nach dem Wettkampf (Erholungswoche) nur locker (`recovery_week`) | warn |

**Wiedereinstieg (Regel 4):** Nach mind. 2 leichteren Wochen in Folge
(Krankheit, Urlaub) ist die letzte normale Woche als Maßstab zu hoch. Dann
zählt die stärkste dieser leichteren Wochen, mindestens die Hälfte der
letzten normalen Woche.

Ein Verstoß:

```javascript
{
  rule: "hard_in_row", severity: "block",  // "block" = so nicht übernehmen, "warn" = Hinweis
  date: "2026-09-10",                       // bei Wochenregeln der Montag der Woche
  workoutId: "pw…",                         // bei Wochenregeln null
  text: "…",                                // deutscher Satz für die Anzeige
  suggestion: { action: "set_intensity", workoutId: "pw…", intensity: "leicht" } // oder null
}
// action: set_intensity | reduce_duration | move | make_rest_day | reduce_week_volume | add_easy_session
```

## Periodisierung (`js/analytics/periodization.js`)

Rein rechnerisch (`tests/js/periodization.test.js`). Einzige Quelle für die
Phasen — Kalender, Coach-Tab, Planregeln und KI-Kontext leiten sich davon ab.

- `getPhase(date, goal)` → `"grundlage" | "aufbau" | "spezifisch" | "taper" |
  "erholung"` oder `null` (kein Ziel/Datum, Rennen länger als 7 Tage vorbei).
  Gezählt in Kalenderwochen (Mo–So) bis zur Rennwoche: Taper = Rennwoche +
  Woche davor, Spezifisch = 6 Wochen davor, Aufbau = 8 Wochen davor, sonst
  Grundlage; Erholung = 7 Tage nach dem Rennen.
- `getPhaseTimeline(date, goal)` → `[{ phase, from, to }]` ab heute.
- `getWeeklyTargets(goal, plannedWorkouts, history, today)` → Zielumfang je
  Woche:

```javascript
{
  baselineMin: 420,           // Anker: letzte normale Woche (Minuten), null ohne Training in 8 Wochen
  baselineWeek: "2026-09-07", // ihr Montag; null beim Wiedereinstieg
  returnAfterWeeks: 0,        // > 0 = Wiedereinstieg nach so vielen leichten Wochen
  weeks: [{
    weekStart: "2026-09-14", phase: "aufbau",
    type: "belastung",        // belastung | entlastung | taper | rennwoche | erholung
    targetPct: 1.05, targetMin: 441,  // targetPct = Faktor zum Anker (1.05 = 105 %), targetMin null ohne Anker
    doneMin: 120, plannedMin: 300,
  }],
}
```

Steigerung je Belastungswoche: Grundlage +3 %, Aufbau +5 %, Spezifisch 0 %;
höchstens +30 % über dem Anker. Taper: Woche vor dem Rennen 70 %, Rennwoche
50 %, Erholungswoche 40 % der letzten Belastungswoche.

## Rennplan (`js/analytics/race-plan.js`, gespeichert in `goal.racePlan`)

Coach-Tab, je Ziel: Tempo je Disziplin aus Distanz + Zielzeit
(`computeRacePacing()`), die Tage der Rennwoche und drei Checklisten. Fehlt
Distanz oder Zielzeit, wird nichts geschätzt. Liegt ein errechnetes Tempo
außerhalb des Plausiblen (`RACE_PACE_LIMITS`: Schwimmen 0:50–5:00/100 m,
Rad 10–60 km/h, Laufen 2:30–15:00/km), erscheint ein Hinweis statt einer
Zahl — die Zielzeit war dann fast sicher anders gemeint.

```javascript
goal.racePlan = null  // = Standard-Listen aus defaultRacePlan(), sonst:
{ transition: [{ text, done }],             // Wechselzone (Triathlon) bzw. Ausrüstung
  nutrition:  [{ text, done }],             // Verpflegung - freie Checkliste
  raceWeek:   [{ text, done, dayOffset }] } // dayOffset -6..0 = Tage vor dem Renntag
```

## Wetter (`js/data/weather.js`, `backend/weather_routes.py`)

7-Tage-Vorhersage für `athleteProfile.homeLocation` im Kalender. Der Browser
fragt nur den eigenen Server (`GET /api/v1/weather?lat=&lon=`, Ortssuche
`GET /api/v1/weather/geocode?name=`), der Open-Meteo anfragt und eine Stunde
zwischenspeichert. Die Vorhersage wird nicht in der Datenbank gespeichert.

```javascript
weatherState.byDate["2026-09-10"] = { date, code, temp_max, temp_min, precip_prob, wind_max }
// °C, Regenwahrscheinlichkeit in %, Wind km/h; fehlende Werte null
// code = WMO-Wettercode -> weatherCodeInfo(code) = { icon, label }
```

## Material (`equipment`, `equipment_workouts`)

Laufschuhe, Räder und Verschleißteile je Person in der Datenbank
(`backend/equipment_routes.py`, Browser: `js/data/equipment.js`).

- `equipment`: `name`, `typ` (Laufschuhe | Rad | Verschleißteil | Sonstiges),
  `sport` (zählt Trainings dieser Sportart), `parent_id` (Verschleißteil →
  Rad), `start_km`, `max_km` (Warnung ab 90 %), `aktiv`, `details` (JSON).
- `equipment_workouts`: ausdrückliche Zuordnung Training (`workout_file`) →
  Material, je Person und Training höchstens eine.
- Die frühere Liste in der Ablage (`triathlon_dashboard_equipment_items_v1`)
  wird einmalig übernommen (`POST /api/v1/equipment/import`); der Server
  setzt dabei `triathlon_dashboard_equipment_migrated_v1`, damit zwei offene
  Tabs sie nicht doppelt anlegen. Die alte Liste bleibt als Sicherheitskopie.

## Triathlon-Auswertungen (`js/analytics/triathlon.js`, Analyse-Tab)

Rein rechnerisch, ohne neue Speicherfelder außer den drei Profilfeldern
`swimCssTest`, `sportBalanceTarget` (siehe Athlete Profile) und dem
vorhandenen `swimCss`/`ftpWatts`:

- `computeSportBalance()` — Anteil Schwimmen/Rad/Laufen je Woche (8) oder
  Monat (6) gegen das Ziel (Standard 15/50/35 %, ±5 %).
- `computeSwimCss(t400, t200)` / `computeSwimAnalysis()` — CSS aus dem
  400/200-m-Test (plausibel 0:50–5:00/100 m), Pace-/SWOLF-Trend 6 gegen
  6 Wochen.
- `computeBikeAnalysis()` — FTP-Schätzung aus der besten 20-min-Leistung der
  letzten 90 Tage, Verlauf 12 Monate, Zeit in den Leistungszonen (4 Wochen).
- Koppeltraining: Lauf startet höchstens 30 min nach dem Radende; die ersten
  10 Minuten werden mit normalen Läufen der 90 Tage davor verglichen.

## Garmin-Export (`js/data/fit-workout-writer.js`)

Exportiert eine geplante Einheit (`plannedWorkouts`-Eintrag) als echte
`.fit`-Workout-Datei, die sich bei Garmin Connect importieren und danach
auf die Uhr synchronisieren lässt. Gegenrichtung zu `fit-parser.js` (der
liest fertige `.fit`-Aktivitäten ein) - hier wird eine `.fit`-Datei vom
Typ "workout" neu geschrieben, mit genau einem Trainingsschritt pro
Datei (`buildFitWorkoutFile(pw)`).

Bewusste Design-Entscheidung: `target_type = "open"` (kein festes Pace-/
Puls-/Leistungsziel), weil die App für den einzelnen geplanten Schritt
keine verlässliche Zielzahl hat, nur eine Intensität als Text - es wird
also nichts erfunden, was nicht in der App steht (siehe AI_RULES). Die
Dauer wird nur gesetzt, wenn `duration_min` vorhanden ist, sonst
"open duration" (Athlet entscheidet selbst, wann der Schritt endet).

Export-Buttons - ausnahmslos alle rufen nur `exportPlannedWorkoutAsFit(id)`
bzw. `exportPlannedWorkoutsAsFit(list)` auf (nie direkt `downloadFitBytes()`/
`buildFitWorkoutFile()`), damit es genau EINE Stelle gibt, an der später der
Versandweg ausgetauscht/ergänzt werden kann (siehe "Vorbereitung auf eine
API-Anbindung" unten):
- einzelne Einheit: Download-Symbol in der Trainingsplan-Kachel-Liste
  (`js/components/training-plan.js`) und im Bearbeiten-Overlay.
- alle anstehenden Einheiten des Hauptevent-Ziels: "Für Garmin exportieren"
  in der Trainingsplan-Kachel.
- alle noch geplanten (Status "geplant", bereits erledigte/übersprungene
  bewusst ausgeschlossen) Einheiten der sichtbaren Woche: "Woche für Garmin
  exportieren" in der Kalender-Wochenansicht (`js/components/calendar.js`,
  `renderCalendarWeek()`) - nur sichtbar, wenn es in der Woche tatsächlich
  etwas zu exportieren gibt.

Beide Mehrfach-Exporte lösen mehrere, leicht zeitversetzte Downloads aus
(kein ZIP - keine externe Abhängigkeit, siehe AI_RULES).

Reine Client-Seite: `Blob` + `URL.createObjectURL` + unsichtbarer
`<a download>`-Klick, keine Server-Komponente. Die FIT-eigene CRC-16
(nicht Standard-CRC-16-CCITT) wird per fester Referenztabelle berechnet
(`fitCrc16()`), sowohl für die Header- als auch die Datei-CRC.

**An Garmin senden (`sendPlannedWorkoutToGarmin(id)`).** Lauf-, Rad- und
Schwimmeinheiten gehen auch direkt an Garmin Connect:
`POST /api/v1/planned-workouts/<id>/send-to-garmin` (`backend/garmin_workouts.py`)
lädt die Einheit als Garmin-Workout hoch (mit `steps`, siehe „Geplantes
Workout“) und legt sie auf den geplanten Tag in den Garmin-Kalender; die Uhr
holt sie beim nächsten Sync. Danach trägt der Browser `garminSentAt` und
`garminWorkoutId` am Eintrag ein.

- Der Server liest die Einheit aus der Ablage der angemeldeten Person, nie
  aus einer fremden.
- Angemeldet wird mit dem Token des Garmin-Syncs dieser Person
  (`~/.triathlon/garmin_<id>.token`, siehe `docs/GARMIN_SYNC_GUIDE.md`) —
  im Dashboard wird nie ein Garmin-Passwort abgefragt. Ohne Token gibt es
  eine verständliche Meldung.
- Kraft/Mobility gehen nicht per Versand (Garmin verlangt Übungen aus dem
  eigenen Katalog) — dort bleibt der `.fit`-Download, ebenso als Plan B,
  wenn der Versand scheitert.
- Nutzt die inoffizielle Schnittstelle der Bibliothek `garminconnect`
  (dieselbe wie der Sync); Garmin kann sie jederzeit ändern.

## Trainingsmonotonie/-Strain (`js/analytics/training-load.js`)

`computeMonotonyStrainSeries()` — nach Foster (1998), rein rechnerisch, aus
der vollen `DATA`-Historie (nicht persistiert, bei jedem Render neu
berechnet). Ein Eintrag pro Tag ab dem 7. Tag mit Load-Daten, rollierendes
7-Tage-Fenster:

```javascript
{ day: 19951, monotony: 1.42, strain: 3120, weekLoad: 2197 }
// day = Tage seit Unix-Epoche (wie computeLoadSeries().day)
// monotony = Ø Tagesbelastung ÷ Standardabweichung (7 Tage)
// strain = monotony × weekLoad (Foster'sche "Training Strain")
```

Wird sowohl vom "Trainingsmonotonie"-Chart als auch (nur der jeweils
aktuellste Wert) von der Monotonie-Kennzahl in der "Fitness & Form"-Karte
genutzt — eine Berechnung, zwei Anzeigeorte (AI_RULES Regel 5).

## Monatsvergleich (`js/analytics/training-load.js`)

`computeMonthComparison()` — vergleicht den aktuellen Kalendermonat (Tag 1
bis heute) mit demselben Tage-Abschnitt des Vormonats (Tag 1 bis zum
selben Tag-im-Monat, gekappt auf dessen tatsächliche Länge), damit nie ein
vollständiger Vormonat gegen einen erst teilweise vergangenen aktuellen
Monat verglichen wird. Nutzt immer die volle Historie, unabhängig vom
Zeitraum-Filter oben in der Filterleiste.

```javascript
{
  current: { count: 16, minutes: 666, load: 1170 },
  previous: { count: 26, minutes: 640, load: 1054 },
  dayOfMonth: 28,           // bis zu diesem Tag wurde in beiden Monaten verglichen
  monthLabel: "August", prevMonthLabel: "Juli",
}
```

## VO2max-Schätzung (`js/analytics/performance.js`)

`computeVo2MaxEstimate()` — zwei Kacheln ganz oben im Überblick ("VO2max
Laufen"/"VO2max Rad"), nutzt immer die volle Historie (wie PMC/ACWR,
unabhängig vom Zeitraum-Filter). Laufen und Rad werden bewusst NICHT zu
einer gemeinsamen Zahl vermischt — der Wert fällt je nach Sportart
unterschiedlich aus (Rad limitiert oft eher lokal-muskulär statt
zentral-kardiovaskulär), und Garmin selbst führt "Laufen-VO2max" und
"Rad-VO2max" ebenfalls getrennt.

Rückgabewert: `{ laufen: {...}|null, rad: {...}|null }`, je Sportart
z. B. `{ value: 52.3, methodLabel: "...", trendLabel: "+2,1 % ggü. vor 3 Monaten" }`.

**Laufen**, in dieser Reihenfolge (nie erfunden — ohne Datenbasis `null`):

1. Direktwert aus `w.vo2max` (s. o.), sobald eine Strava-/Garmin-Connect-
   Synchronisierung das liefert — dann echter Trend über die letzten 3 Monate.
2. **Submax-Regression aus Pace + Puls** (`sportVo2Regression`,
   `runVo2SubmaxPoint`) — Hauptmethode. Sammelt aus den letzten 120 Tagen
   je Lauf einen (Puls, Sauerstoffbedarf-bei-dieser-Pace)-Punkt nach der
   ACSM-Lauf-Formel (`3.5 + 0.2 × Geschwindigkeit`, grobe Steigungskorrektur
   aus den Höhenmetern), legt eine Ausgleichsgerade durch mindestens 4 Punkte
   und extrapoliert sie auf `athleteProfile.maxHr` (`vo2LinearRegressionToMaxHr`).
   Braucht dafür KEINEN maximalen Renneffort, nur mehrere normale
   Trainingsläufe mit Puls — deutlich alltagstauglicher als Stufe 3 und
   näher an der Methode, die Garmin/Firstbeat selbst verwenden. Ergebnisse
   außerhalb 20–85 ml/kg/min oder mit negativer/unklarer Steigung werden
   verworfen statt angezeigt. Trend: gleiche Regression auf die 120 Tage
   davor, falls dort ebenfalls ≥ 4 Punkte vorliegen.
3. Fällt Stufe 2 mangels Daten aus: VDOT-Formel (Daniels/Gilbert) auf die
   schnellste gemessene 10-km-/5-km-/1-km-Zeit — Fallback, setzt einen
   nahezu maximalen Effort voraus, ist also nur eine grobe Näherung.
4. Fällt auch das aus, aber `athleteProfile.maxHr`/`restingHr` sind gesetzt:
   grobe Schätzung `15.3 × HFmax/HFruhe` (Uth et al. 2004) — ohne Trend.

**Rad**, in dieser Reihenfolge:

1. Direktwert aus Sync (wie oben).
2. **Submax-Regression aus Leistung (Watt) + Puls** (`bikeVo2SubmaxPoint`,
   ACSM-Rad-Ergometrie-Formel `7 + 10.8 × Watt ÷ Körpergewicht`) — gleiche
   Regressions-/Extrapolationslogik wie beim Laufen. Braucht echte
   Leistungsdaten (Sensor, `avg_power_w`) UND `athleteProfile.weightKg`.
   Bewusst KEIN Geschwindigkeits-Fallback, da Radgeschwindigkeit zu stark
   von Wind/Steigung/Windschatten abhängt, um verlässlich zu sein — ohne
   Leistungsmesser + Körpergewicht bleibt die Rad-Kachel leer statt geraten.

## Ernährung (`js/analytics/nutrition.js`, "Ernährung"-Tab)

Rein rechnerisch (kein LLM), analog zur VO2max-Schätzung oben — nutzt
Körpergewicht (`getLatestWeightKg()`), den Trainingsplan
(`plannedWorkouts`) und das Hauptevent-Ziel (`getPrimaryGoal()`). Werte
beruhen auf etablierten Sporternährungs-Richtlinien (Quellen in den
Funktionskommentaren), nicht auf einer individuellen Stoffwechselmessung —
fehlt eine nötige Grundlage (Körpergewicht, Zielzeit), liefert die
jeweilige Funktion `null` statt einen Wert zu erfinden. Drei Funktionen:

**`computeDailyMacroTargets()`** — Tagesziel für Kohlenhydrate, Eiweiß und
Fett, bewusst an dieselben Größen gekoppelt wie der Trainingsplan (nicht
unabhängig davon berechnet):

1. Die Kohlenhydrat-KATEGORIE richtet sich nach dem heutigen geplanten
   Trainingsumfang (`plannedWorkouts` von heute — Dauer + Intensität, fünf
   Stufen von "Ruhetag" bis "hohes Volumen").
2. INNERHALB dieser Kategorie zusätzlich ein Bias nach der groben
   Trainings-PHASE (`computeTrainingPhase()`, `training-plan.js` — dieselbe
   Phase, die auch der automatische Trainingsplan und der KI-Kontext
   verwenden, siehe `docs/AI_CONTEXT.md`): in der Grundlagenphase an
   Ruhe-/moderaten Tagen bewusst die UNTERE Bereichsgrenze ("train low" für
   die Fettstoffwechsel-Adaption), in der Taper-Phase die OBERE
   Bereichsgrenze (Glykogenspeicher hochhalten). An Ausdauer-/hochvolumigen
   Trainingstagen wird NIE eingeschränkt, unabhängig von der Phase — die
   Belastung selbst braucht ausreichend Kohlenhydrate (`carbBiasForPhase()`,
   Impey et al., "Fuel for the Work Required", Sports Med 2018).
3. Steht das Hauptevent-Ziel ≤ 2 Tage bevor, überschreibt das
   Carb-Loading-Protokoll beides (unabhängig vom heutigen Plan und von der
   Phasen-Logik).

Eiweiß/Fett sind konstante g/kg-Richtwerte für Ausdauerathleten (keine
BMR-Schätzung — dafür fehlen im Profil Größe/Geschlecht, siehe unten).
Rückgabe:

```javascript
{
  weightKg: 74.2, category: { key: "endurance", label: "...", min: 6, max: 10, mid: 8 },
  isCarbLoading: false, loadingNote: null,
  phaseLabel: "Aufbauphase", carbBias: "mid", biasNote: null, // "low"/"high" mit Begründungstext, siehe oben
  carbG: 594, carbRangeG: [445, 742],
  proteinG: 119, fatG: 74, kcal: 3518,
  todaysMinutes: 100,
  sourceNote: "...",
}
```

Dieselbe Zahl (`carbG`/`proteinG`/`fatG` + Begründung) fließt außerdem als
Zeile "Ernährungsziel heute" in `buildCompactContext()`
(`js/ai/context-builder.js`) ein — die KI-Trainingsempfehlung und der
automatische Trainingsplan bekommen so denselben, bereits fertig
berechneten Wert und dürfen ihn interpretieren/erwähnen, aber nicht neu
erfinden (siehe `docs/AI_CONTEXT.md`, AI_RULES §9).

**`computePreWorkoutTiming()`** — Timing-Empfehlung für die nächste
anstehende geplante Einheit (`plannedWorkouts`, Status "geplant", ohne
Kraft/Mobility). Geplante Einheiten haben KEINE Uhrzeit (nur ein Datum,
siehe oben) — die Empfehlung ist deshalb bewusst relativ formuliert
("2-4h vorher", "30-60min vorher"), nie als feste Uhrzeit. Ohne anstehende
geplante Einheit: `null`.

**`computeRaceFuelingPlan()`** — Verpflegungsplan aus den Zielzeiten des
Hauptevent-Ziels (bei Triathlon je Teildisziplin über `subDisciplines`,
sonst die Gesamt-Zielzeit). Kohlenhydrat-Bedarf pro Stunde nach Dauer
gestaffelt, für Laufen niedriger gedeckelt als Rad (schlechtere
Magen-Darm-Verträglichkeit beim Laufen). Die Flüssigkeits-Faustregel ist
bewusst generisch (400-800 ml/h) — ohne individuelle Schweißrate oder
Wetterdaten (siehe "bewusst nicht umgesetzt" unten) keine personalisierte
Zahl. Ohne Zielzeit(en) im Ziel: `null`.

Bewusst NICHT umgesetzt (siehe Anfrage vom 2026-08-29): ein
Ernährungstagebuch (Ist-Werte eintragen) und ein Schweiß-/Natrium-Rechner
auf Basis der Außentemperatur — Letzterer bräuchte entweder eine manuelle
Temperatur-Eingabe je Einheit oder einen externen Wetterdienst
(Netzwerk-Abhängigkeit, widerspricht dem Local-First-Grundsatz, siehe
AI_RULES §21) und wurde deshalb zurückgestellt.

## Trainingsplan-Treue-Streak (`js/analytics/streak.js`, "Übersicht"-Tab)

Kachel `🔥ᳰ Trainingsplan-Treue-Streak` in der Übersicht (`renderStats`,
`js/components/dashboard.js`), sichtbar sobald `athleteProfile.trainingDays`
gepflegt ist (sonst `null` von `computeAdherenceStreak()` — kein Raten ohne
Grundlage).

Bewusst KEIN "hat jeden Tag trainiert"-Streak, sondern ein
Trainingsplan-**Treue**-Streak: gezählt wird, ob an einem Tag eingehalten
wurde, was laut Profil für diesen Wochentag vorgesehen war.

- Laut `trainingDays` ein Ruhetag → zählt automatisch als eingehalten (kein
  Zwang, an freien Tagen trotzdem etwas zu importieren).
- Laut `trainingDays` ein Trainingstag UND ein echtes (importiertes) Workout
  an diesem Datum in `ALL` vorhanden → eingehalten. Bewusst KEIN manuelles
  "als erledigt markieren" nötig — die ohnehin genutzte
  "Aktualisieren"-Funktion (`.fit`-Import) hält den Streak am Leben.
- Trainingstag ohne Workout, aber ein Erholungs-Check-Eintrag mit Grund
  (Verletzung, wenig Energie, starker Muskelkater) an diesem Datum
  (`recoveryCheck`/`recoveryLog`, `js/data/health.js`) → Tag wird
  "eingefroren" (zählt weiter zum Streak, aber getrennt als `frozenDays`
  ausgewiesen), statt den Streak zu brechen. Bewusste Design-Entscheidung:
  der Streak soll niemanden dazu verleiten, trotz Verletzung zu trainieren,
  nur um ihn zu behalten (Gesundheit geht vor, siehe AI_RULES).
- Trainingstag ohne Workout und ohne Erholungsgrund → Streak bricht (`0`
  Tage ab hier zurückgerechnet).
- Der heutige Tag zählt, solange er noch offen ist (Training evtl. noch
  nicht importiert), NICHT als verpasst — er ist nur "gefährdet"
  (`atRisk: true`), damit ein bereits bestehender Streak nicht schon
  mittags auf 0 fällt. Die Kachel zeigt in diesem Fall einen Hinweistext
  und eine dezente Warn-Umrandung (`.stat-tile.at-risk`).

`computeAdherenceStreak()` gibt `{ days, frozenDays, todayStatus, atRisk }`
zurück (oder `null` ohne konfigurierte Trainingstage).

## Erfolge/Abzeichen (`js/data/achievements.js`, `js/analytics/achievements.js`, "Übersicht"-Tab)

Karte "Erfolge" (erste Karte im Übersicht-Grid) + kurzer Feier-Toast beim
Freischalten. Rein deterministisch aus bereits vorhandenen, echten Werten
abgeleitet — kein erfundenes Punkte-/XP-System (AI_RULES §9: die KI/App darf
keine Werte erfinden, hier wird konsequent auch für die App selbst dabei
geblieben).

Drei Kategorien, alle über `checkAndUnlockAchievements()`
(`js/analytics/achievements.js`) geprüft — idempotent, gefahrlos bei jedem
`renderAll()` aufrufbar, da bereits freigeschaltete IDs übersprungen werden:

- **Trainingsanzahl-Meilensteine**: 10/25/50/100/250/500/1000 absolvierte
  Einheiten (`ALL`, ohne Zusammenfassungs-Einträge).
- **Streak-Meilensteine**: 7/14/30/60/100/200/365 Tage
  Trainingsplan-Treue-Streak (siehe oben).
- **Neue Bestzeit**: für 6 feste Distanzen (1/5/10 km Laufen, 10/20/40 km
  Rad) dieselbe Schätzung wie in `records.js`/`performance.js`
  (`bestEffortForDistance`). Ein Schnappschuss der zuletzt bekannten
  Bestzeit (`js/data/achievements.js`, `achievementsState.snapshot`) macht
  "neu" erkennbar — die allererste Berechnung nach Einführung dieses
  Features feiert dadurch nicht fälschlich jede bestehende Bestzeit als
  "neu", sondern merkt sich nur den Ausgangsstand.

Freigeschaltete Erfolge (`achievementsState.unlocked`,
`triathlon_dashboard_achievements_v1` in der Ablage) sind dauerhaft:
`{ id, label, achievedAt, seen }`, eindeutige `id` (z. B. `count_100`,
`streak_30`, `pb_Laufen_10000_2145`) verhindert doppelte Freischaltung.

## Zeitraum-Filter (`js/data/workouts.js`, `filterState`)

Der Zeitraum lässt sich entweder über feste Chips (7/30/90 Tage, 1 Jahr,
Alle → `filterState.rangeDays`) ODER frei per Von/Bis-Datum wählen
(`filterState.customFrom`/`customTo`) — ist mindestens eines der beiden
Felder gesetzt, überschreibt es die Chips (siehe `getFilteredData()`).
Die meisten Übersicht-Kacheln rendern mit dem gefilterten Zeitraum; PMC,
ACWR, Trainingsmonotonie, Monatsvergleich, Kalender und Rekorde nutzen
bewusst immer die volle Historie, weil ihre Berechnung Kontext vor dem
sichtbaren Fenster braucht (siehe Kommentare in `js/app.js`).

## Trainings-Detailauswertung (`js/analytics/workout-profile.js`)

Drei zusätzliche, rein deterministische Auswertungen für die Detailansicht
einer einzelnen Einheit (Modal + Kalender-Tagesansicht) — alle geben `null`
zurück statt erfundener Werte, wenn die nötigen Daten fehlen:

- `computeTrainingLoadStats(w)` — braucht `athleteProfile.maxHr`/`restingHr`.
  TRIMP nach Banister (Koeffizienten 0.64/1.92), TRIMP/Min., Ø-Herzfrequenz-
  reserve (%) und ein selbst definierter "Stress-Score" (`%HRR × ln(1+Dauer) ÷ 10`,
  kein Nachbau einer Garmin-/TrainingPeaks-Kennzahl).
- `computeWorkoutHrProfile(w, allData)` — Puls-Dichtekurve dieser Einheit
  (`ownDensity`) plus, wenn genug Vergleichsdaten vorhanden sind, eine zweite
  Kurve über alle sonstigen Einheiten derselben Sportart (`compareDensity`),
  beide auf derselben bpm-Achse (`hrDensityFromValues()` aus
  `hr-distribution.js`). Dazu eine Variabilitäts-Einstufung aus der
  Standardabweichung der Pulswerte.
- `computeLoadRadar(w, allData)` — 6 Achsen (Ø-Schnitt, kcal/Min., HF Ø,
  Strecke, Dauer, Negativer Split), je Achse Min-Max-normiert (0..1) über
  diese Einheit + mind. 5 vergleichbare Einheiten derselben Sportart. Fehlt
  auch nur eine Achse (z.B. Negativer Split ohne Streckendaten), wird das
  ganze Profil weggelassen statt eine Achse zu erfinden.
