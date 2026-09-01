// Kompakte Bestzeiten-Zusammenfassung fuer den KI-Coach-Kontext.

function computeCompactRecords() {
  const out = {};
  const laufen = DATA.filter(w => w.sport === "Laufen");
  if (laufen.length) {
    const r = {};
    [[1000, "1km"], [5000, "5km"], [10000, "10km"]].forEach(([m, key]) => {
      const best = bestEffortForDistance(laufen, m);
      if (best) r[key] = fmtDurationClock(best.seconds);
    });
    const bestPace = bestBy(laufen, w => w.pace_min_per_km ? -paceToSeconds(w.pace_min_per_km) : null);
    if (bestPace) r.pace = bestPace.pace_min_per_km + "/km";
    if (Object.keys(r).length) out.laufen = r;
  }
  const rad = DATA.filter(w => w.sport === "Rad");
  if (rad.length) {
    const r = {};
    [[10000, "10km"], [20000, "20km"], [40000, "40km"]].forEach(([m, key]) => {
      const best = bestEffortForDistance(rad, m);
      if (best) r[key] = fmtDurationClock(best.seconds);
    });
    const bestSpeed = bestBy(rad, w => w.speed_kmh);
    if (bestSpeed) r.geschw = fmtNum(bestSpeed.speed_kmh, 1) + "km/h";
    if (Object.keys(r).length) out.rad = r;
  }
  const schwimmen = DATA.filter(w => w.sport === "Schwimmen");
  if (schwimmen.length) {
    const bestPace = bestBy(schwimmen, w => w.pace_min_per_100m ? -paceToSeconds(w.pace_min_per_100m) : null);
    if (bestPace) out.schwimmen = { pace: bestPace.pace_min_per_100m + "/100m" };
  }
  return out;
}

/* ---------- VO2max-Schätzung + Trend, getrennt je Sportart ----------------
   Laufen und Rad werden bewusst NICHT zu einer gemeinsamen Zahl vermischt:
   der gemessene/geschätzte VO2max-Wert fällt je nach Sportart unterschiedlich
   aus (Rad limitiert oft eher lokal-muskulär statt zentral-kardiovaskulär),
   und Garmin selbst führt "Laufen-VO2max" und "Rad-VO2max" ebenfalls getrennt.

   Reihenfolge, nach der die Quelle je Sportart gewählt wird (nie erfunden -
   ohne ausreichende Datenbasis kommt null zurück):

   Laufen:
     1) Direktwert aus einer künftigen Strava-/Garmin-Connect-Synchronisierung
        (Feld `w.vo2max`, siehe DATA_MODEL.md).
     2) Submax-Schätzung aus Pace + Herzfrequenz mehrerer normaler
        Trainingsläufe (lineare Regression Puls→Sauerstoffbedarf, extra-
        poliert auf HFmax) - funktioniert mit normalen Trainingsläufen statt
        einen maximalen Renneffort vorauszusetzen, siehe unten.
     3) Fällt darauf zu wenig geeignete Läufe: VDOT-Formel (Daniels/Gilbert)
        auf die schnellste gemessene 10-km-/5-km-/1-km-Zeit - setzt einen
        nahezu maximalen Effort voraus, ist also nur eine grobe Näherung.
     4) Grobe Schätzung nur aus Max-/Ruhepuls (Uth et al. 2004).

   Rad:
     1) Direktwert aus Sync (wie oben).
     2) Submax-Schätzung aus Leistung (Watt) + Herzfrequenz mehrerer
        Radeinheiten (gleiche Regression wie beim Laufen, andere
        Ausgangsformel) - braucht einen Leistungsmesser UND das
        Körpergewicht im Athletenprofil. Ohne beides: null (keine
        geschwindigkeitsbasierte Ersatzschätzung, da Radgeschwindigkeit zu
        stark von Wind/Steigung/Windschatten abhängt, um verlässlich zu sein).
*/

// Kleinste-Quadrate-Regression: mehrere (Puls, Sauerstoffbedarf-bei-diesem-
// Puls)-Punkte -> Gerade, extrapoliert auf HFmax. Braucht Streuung in der
// Herzfrequenz (sonst nicht lösbar) und einen positiven Anstieg (mehr Puls
// = mehr Sauerstoffbedarf, alles andere ist unplausibel/Messrauschen).
function vo2LinearRegressionToMaxHr(points, maxHr) {
  const n = points.length;
  if (n < 4 || !maxHr) return null;
  const meanX = points.reduce((s, p) => s + p.hr, 0) / n;
  const meanY = points.reduce((s, p) => s + p.vo2, 0) / n;
  let num = 0, den = 0;
  points.forEach(p => { num += (p.hr - meanX) * (p.vo2 - meanY); den += (p.hr - meanX) ** 2; });
  if (den < 4) return null; // zu wenig Puls-Streuung zwischen den Einheiten für eine verlässliche Gerade
  const slope = num / den;
  if (slope <= 0) return null; // unplausibel (mehr Puls müsste mehr Sauerstoffbedarf bedeuten)
  const intercept = meanY - slope * meanX;
  const vo2max = intercept + slope * maxHr;
  return (vo2max > 20 && vo2max < 85) ? vo2max : null; // physiologisch plausibler Bereich, sonst verwerfen statt anzeigen
}

// Ein Lauf -> ein (Puls, Sauerstoffbedarf-bei-dieser-Pace)-Punkt, nach der
// ACSM-Lauf-Formel (VO2 = 3.5 + 0.2 × Geschwindigkeit in m/min), mit grober
// Steigungskorrektur aus den Höhenmetern der Einheit. Nur "normale" Dauerläufe
// (Mindestdauer, plausible Pace) - kurze/extreme Ausreißer verzerren die Gerade.
function runVo2SubmaxPoint(w) {
  if (!w.avg_hr || !w.distance_km || !w.duration_min || w.duration_min < 15) return null;
  const v = (w.distance_km * 1000) / w.duration_min; // m/min
  if (v < 120 || v > 300) return null; // ca. 8:20/km bis 3:20/km - Plausibilitätsgrenzen fürs Modell
  let vo2 = 3.5 + 0.2 * v;
  if (w.elevation_gain_m && w.distance_km > 0) {
    const grade = Math.min(w.elevation_gain_m / (w.distance_km * 1000), 0.08); // Ø-Anstieg, gedeckelt (Formel gilt nur für moderate Steigungen)
    vo2 += 0.9 * v * grade;
  }
  return { hr: w.avg_hr, vo2 };
}

// Eine Radeinheit -> ein (Puls, Sauerstoffbedarf-bei-dieser-Leistung)-Punkt,
// nach der ACSM-Rad-Ergometrie-Formel (VO2 = 7 + 10.8 × Watt ÷ Körpergewicht).
// Braucht echte Leistungsdaten (Sensor) und das Körpergewicht - sonst kein Punkt.
function bikeVo2SubmaxPoint(w) {
  if (!w.avg_hr || !w.avg_power_w || !athleteProfile.weightKg || w.duration_min < 15) return null;
  const vo2 = 7 + (10.8 * w.avg_power_w) / athleteProfile.weightKg;
  return { hr: w.avg_hr, vo2 };
}

// Daniels/Gilbert VDOT-Formel: aus Geschwindigkeit (m/min) der Sauerstoffbedarf,
// aus der Renndauer (Min.) der Anteil davon, der bei dieser Dauer maximal
// nutzbar ist - daraus VO2max = VO2-Bedarf ÷ genutzter Anteil. Gültig für
// Effort-Dauern von ca. 3.5 bis 300 Minuten.
function vo2maxFromRunEffort(seconds, meters) {
  if (!seconds || seconds < 180 || !meters) return null;
  const v = meters / (seconds / 60);
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  const t = seconds / 60;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  if (!(pctMax > 0) || !isFinite(vo2)) return null;
  const vo2max = vo2 / pctMax;
  return isFinite(vo2max) && vo2max > 0 ? vo2max : null;
}

// Bester Lauf-Effort innerhalb der übergebenen Einheiten - bevorzugt 10km
// (stabiler für eine Ausdauerschätzung als ein sehr kurzer Effort), sonst 5km,
// sonst 1km.
function bestRunVo2(runs) {
  const distances = [[10000, "10-km"], [5000, "5-km"], [1000, "1-km"]];
  for (const [m, label] of distances) {
    const best = bestEffortForDistance(runs, m);
    if (best) {
      const vo2 = vo2maxFromRunEffort(best.seconds, m);
      if (vo2 != null) return { vo2, label };
    }
  }
  return null;
}

function vo2TrendLabel(current, prior) {
  if (prior == null) return null;
  const deltaPct = ((current - prior) / prior) * 100;
  if (Math.abs(deltaPct) < 0.5) return "stabil ggü. vor 3 Monaten";
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${fmtNum(deltaPct, 1)} % ggü. vor 3 Monaten`;
}

// Gemeinsame Regressions-Stufe für Laufen/Rad: sammelt (Puls,
// Sauerstoffbedarf)-Punkte der letzten 120 Tage (genug Dichte für eine
// stabile Gerade) und der 120 Tage davor (nur fürs Trend), rechnet je einmal
// die Regression. `pointFn` ist runVo2SubmaxPoint oder bikeVo2SubmaxPoint.
function sportVo2Regression(sportName, pointFn, maxHr) {
  if (!maxHr) return null;
  const workouts = ALL.filter(w => w.sport === sportName && w._date && !w.is_summary);
  if (!workouts.length) return null;
  const now = Date.now(), dayMs = 86400000;
  const currentPoints = workouts.filter(w => now - w._date.getTime() <= 120 * dayMs).map(pointFn).filter(Boolean);
  const value = vo2LinearRegressionToMaxHr(currentPoints, maxHr);
  if (value == null) return null;
  const priorPoints = workouts.filter(w => { const age = now - w._date.getTime(); return age > 120 * dayMs && age <= 240 * dayMs; }).map(pointFn).filter(Boolean);
  const priorValue = vo2LinearRegressionToMaxHr(priorPoints, maxHr);
  return { value, priorValue };
}

function syncedVo2ForSport(sportName) {
  const synced = ALL.filter(w => w.sport === sportName && w._date && w.vo2max != null).sort((a, b) => b._date - a._date);
  if (!synced.length) return null;
  const latest = synced[0];
  const cutoff = new Date(latest._date.getTime() - 90 * 86400000);
  const older = synced.find(w => w._date <= cutoff);
  return {
    value: latest.vo2max,
    methodLabel: "synchronisiert (Strava/Garmin Connect)",
    trendLabel: older ? vo2TrendLabel(latest.vo2max, older.vo2max) : null,
  };
}

function computeRunVo2MaxEstimate() {
  // 1) Künftiger Direktwert aus Strava/Garmin Connect
  const synced = syncedVo2ForSport("Laufen");
  if (synced) return synced;

  // 2) Submax-Schätzung aus Pace + Puls mehrerer Trainingsläufe (Regression)
  const reg = sportVo2Regression("Laufen", runVo2SubmaxPoint, athleteProfile.maxHr);
  if (reg) {
    return {
      value: reg.value,
      methodLabel: "geschätzt aus Pace & Puls mehrerer Trainingsläufe (Regression, keine Bestzeit nötig)",
      trendLabel: reg.priorValue != null ? vo2TrendLabel(reg.value, reg.priorValue) : null,
    };
  }

  // 3) Fallback: VDOT-Formel auf die schnellste gemessene Zeit
  const runs = ALL.filter(w => w.sport === "Laufen" && w._date && !w.is_summary);
  if (runs.length) {
    const now = Date.now();
    const dayMs = 86400000;
    const recentRuns = runs.filter(w => now - w._date.getTime() <= 90 * dayMs);
    const olderRuns = runs.filter(w => { const age = now - w._date.getTime(); return age > 90 * dayMs && age <= 180 * dayMs; });
    const current = bestRunVo2(recentRuns.length ? recentRuns : runs);
    if (current) {
      const prior = bestRunVo2(olderRuns);
      return {
        value: current.vo2,
        methodLabel: `geschätzt aus schnellster ${current.label}-Zeit (VDOT-Formel, setzt einen nahezu maximalen Effort voraus)`,
        trendLabel: prior ? vo2TrendLabel(current.vo2, prior.vo2) : null,
      };
    }
  }

  // 4) Grobe Schätzung nur aus Max-/Ruhepuls
  const maxHr = athleteProfile.maxHr, restingHr = athleteProfile.restingHr;
  if (maxHr && restingHr && restingHr > 0 && maxHr > restingHr) {
    return {
      value: 15.3 * (maxHr / restingHr),
      methodLabel: "grob geschätzt aus Max-/Ruhepuls (15,3 × HFmax/HFruhe)",
      trendLabel: null,
    };
  }

  return null; // keine ausreichende Datenbasis - lieber leer als erfunden
}

function computeBikeVo2MaxEstimate() {
  // 1) Künftiger Direktwert aus Strava/Garmin Connect
  const synced = syncedVo2ForSport("Rad");
  if (synced) return synced;

  // 2) Submax-Schätzung aus Leistung (Watt) + Puls mehrerer Radeinheiten
  //    (Regression) - braucht Leistungsmesser-Daten UND Körpergewicht im
  //    Profil. Kein Geschwindigkeits-Fallback (siehe Kommentar oben) - lieber
  //    leer als eine unzuverlässige Schätzung.
  const reg = sportVo2Regression("Rad", bikeVo2SubmaxPoint, athleteProfile.maxHr);
  if (reg) {
    return {
      value: reg.value,
      methodLabel: "geschätzt aus Leistung (Watt) & Puls mehrerer Radeinheiten (Regression)",
      trendLabel: reg.priorValue != null ? vo2TrendLabel(reg.value, reg.priorValue) : null,
    };
  }

  return null;
}

// Kachel ganz oben im Überblick - nutzt immer die volle Historie (wie
// PMC/ACWR), unabhängig vom Zeitraum-Filter, da VO2max ein Fitness-Zustand
// ist, kein Zeitraum-Wert. Laufen und Rad bewusst getrennt (s.o.).
function computeVo2MaxEstimate() {
  return { laufen: computeRunVo2MaxEstimate(), rad: computeBikeVo2MaxEstimate() };
}

/* ======================================================================
   COACH — Ziele/Events eintragen, Trainingsempfehlung über ein lokales
   KI-Modell (Ollama, http://localhost:11434) generieren. Läuft komplett
   lokal: Ziele liegen im localStorage, die Anfrage geht nur an Ollama auf
   dem eigenen Rechner - es verlässt nichts das Gerät.
   ====================================================================== */
