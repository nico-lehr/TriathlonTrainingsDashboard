// Athletenprofil: Laden/Speichern, Trainingstage-Konstanten.

const ATHLETE_PROFILE_KEY = "triathlon_dashboard_athlete_profile_v1";

let athleteProfile = {
  ftpWatts: null, runThresholdPace: null, swimCss: null, weeklyHours: null,
  experienceLevel: null, strongDiscipline: null, weakDiscipline: null, trainingDaysPerWeek: null,
  age: null, trainingDays: [], swimDays: [], longDays: [], typicalSessionMin: null,
  maxHr: null, restingHr: null, // für TRIMP/Herzfrequenzreserve in der Trainings-Detailansicht (js/analytics/workout-profile.js)
  weightKg: null, // nur für die Rad-VO2max-Schätzung aus Watt (js/analytics/performance.js) - ohne Wert gibt's keine Rad-Schätzung statt einer geratenen
  includeStrength: false, includeMobility: false, // für den automatisch erstellten Trainingsplan (js/analytics/training-plan.js)
  customPlanWishes: "", // freie Zusatzwünsche für die KI-Trainingsplan-Erstellung (z.B. "1x Zugseiltraining pro Woche") - "Erweiterte Einstellungen" in der Trainingsplan-Kachel, siehe CHANGE_REQUESTS.md
  onboardingDone: false, // EIN Onboarding-Wizard (7 Schritte: Persönliches, Über dich, Verfügbarkeit,
  // Leistungswerte, Trainingsplan, Ziel, Fertig) - siehe coach.js. Deckt seit
  // CHANGE_REQUESTS.md #22 auch die Personendaten unten mit ab (davor ein
  // separates, kleineres "Willkommen"-Overlay).
  // Persönliche Daten (Name/Geschlecht/Geburtsdatum) - danach jederzeit in
  // den Einstellungen editierbar ("Persönliche Daten"-Karte). Geburtsdatum
  // nur für eine Geburtstags-Nachricht im Dashboard genutzt (isTodayBirthday()
  // unten), sonst nirgends ausgewertet.
  name: null, gender: null, birthDate: null,
  raceExperience: null, // Wettkampferfahrung (Chips: none/few/some/many) - Kontext für die KI-Trainingsplan-Erstellung
  limitations: null, // Verletzungen/Einschränkungen (Freitext) - wird im KI-Trainingsplan-Kontext berücksichtigt
  swimCssTest: null, // { t400: "7:10", t200: "3:25", date: "YYYY-MM-DD" } - CSS-Test aus dem Analyse-Tab; das Ergebnis steht in swimCss (dasselbe Feld wie in den Einstellungen)
  homeLocation: null, // Heimatort für das Wetter im Kalender { name, lat, lon } - gesucht in den Einstellungen (js/data/weather.js)
  sportBalanceTarget: null, // Ziel-Anteile der Trainingszeit { Schwimmen, Rad, Laufen } in % (zusammen 100) - Analyse-Tab "Sport-Balance", null = Standard 15/50/35 (js/analytics/triathlon.js)
};

const WEEKDAYS = [["mo", "Mo"], ["di", "Di"], ["mi", "Mi"], ["do", "Do"], ["fr", "Fr"], ["sa", "Sa"], ["so", "So"]];

const WEEKDAY_LABELS = Object.fromEntries(WEEKDAYS);
// Schnell-Check: gilt für den aktuellen Tag und fließt direkt in den
// Coach-Kontext ein, damit die Empfehlung Muskelkater/Verletzung/wenig
// Energie berücksichtigt statt sie zu ignorieren. Wird täglich zurückgesetzt
// (neuer "date"-Wert) - der Stand des Vortags landet dabei automatisch im
// Erholungs-Logbuch (recoveryLog), damit die KI bei späteren Auswertungen
// auch auf den Verlauf zurückgreifen kann.

const ONB_EXP_LABELS = { "<1": "< 1 Jahr", "1-3": "1–3 Jahre", ">3": "> 3 Jahre" };

// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
function loadAthleteProfile() {
  const saved = storeGet(ATHLETE_PROFILE_KEY);
  if (saved) athleteProfile = { ...athleteProfile, ...saved };
}

function saveAthleteProfile() {
  storeSet(ATHLETE_PROFILE_KEY, athleteProfile);
}

// Prüft nur Monat+Tag (nicht das Jahr) gegen das hinterlegte Geburtsdatum -
// für die Geburtstags-Nachricht im Dashboard (checkAndShowBirthdayMessage(),
// js/components/dashboard.js). null, falls kein Geburtsdatum hinterlegt ist.
// Alter aus dem Geburtsdatum berechnet (kein eigenes manuelles Feld mehr im
// Onboarding - das war redundant/inkonsistent zum Geburtsdatum). Fällt auf
// ein evtl. noch vorhandenes altes athleteProfile.age zurück (Profile von
// vor diesem Wechsel, die nur ein manuelles Alter ohne Geburtsdatum haben).
function getAthleteAgeFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const bd = new Date(birthDate + "T00:00:00");
  if (isNaN(bd)) return null;
  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const beforeBirthday = (today.getMonth() < bd.getMonth()) ||
    (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate());
  if (beforeBirthday) age--;
  return age;
}

function getAthleteAge() {
  return getAthleteAgeFromBirthDate(athleteProfile.birthDate) ?? (athleteProfile.age || null);
}

function isTodayBirthday() {
  if (!athleteProfile.birthDate) return false;
  const bd = new Date(athleteProfile.birthDate + "T00:00:00");
  const today = new Date();
  return bd.getMonth() === today.getMonth() && bd.getDate() === today.getDate();
}
