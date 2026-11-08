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
  // Rad getrennt nach Umgebung, weil diese Werte in den KI-Kontext fließen:
  // Indoor-Distanzen und -Geschwindigkeiten sind von der Plattform simuliert,
  // als "Bestzeit über 40 km" wären sie für das Modell irreführend. Indoor
  // zählt daher über die Leistung. Unbekannte Umgebung (Altdaten) = Outdoor.
  const radOutdoor = DATA.filter(w => w.sport === "Rad" && w._rideEnv !== "indoor");
  if (radOutdoor.length) {
    const r = {};
    [[10000, "10km"], [20000, "20km"], [40000, "40km"]].forEach(([m, key]) => {
      const best = bestEffortForDistance(radOutdoor, m);
      if (best) r[key] = fmtDurationClock(best.seconds);
    });
    const bestSpeed = bestBy(radOutdoor, w => w.speed_kmh);
    if (bestSpeed) r.geschw = fmtNum(bestSpeed.speed_kmh, 1) + "km/h";
    if (Object.keys(r).length) out.rad_outdoor = r;
  }
  const radIndoor = DATA.filter(w => w.sport === "Rad" && w._rideEnv === "indoor");
  if (radIndoor.length) {
    const r = {};
    const bestPower = bestBy(radIndoor, w => w.avg_power_w);
    if (bestPower) r.watt_avg = Math.round(bestPower.avg_power_w) + "W";
    const bestNp = bestBy(radIndoor, w => w.normalized_power_w);
    if (bestNp) r.np = Math.round(bestNp.normalized_power_w) + "W";
    const kg = (typeof athleteProfile !== "undefined" && athleteProfile) ? athleteProfile.weightKg : null;
    if (kg && bestPower) r.w_pro_kg = fmtNum(bestPower.avg_power_w / kg, 2);
    const bestDur = bestBy(radIndoor, w => w.duration_min);
    if (bestDur) r.laengste_dauer = fmtH(bestDur.duration_min) + "h";
    if (Object.keys(r).length) out.rad_indoor = r;
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
     2) Je Radeinheit aus gleichmäßigen Abschnitten: Leistung (Watt) und
        Anteil der Herzfrequenzreserve (bikeVo2RideEstimate, unten) - braucht
        Leistungsmesser, Körpergewicht, HFmax und Ruhepuls (Profil oder Garmin).
     3) Ohne Ruhepuls: Regression über ganze Einheiten wie beim Laufen (gröber).
        Ohne Leistungsmesser oder Gewicht: null (keine geschwindigkeits-
        basierte Ersatzschätzung, da Radgeschwindigkeit zu stark von
        Wind/Steigung/Windschatten abhängt, um verlässlich zu sein).
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
//
// Indoor-/virtuelle Einheiten fließen hier ABSICHTLICH mit ein (anders als bei
// den Bestzeiten oben): die Formel nutzt ausschließlich Watt, und Watt sind
// umgebungsunabhängig - 200 W auf der Rolle sind 200 W auf der Straße. Eine
// Trennung würde die Punktdichte der Regression halbieren und die Schätzung
// verschlechtern; Rolleneinheiten sind hier sogar die zuverlässigeren Punkte,
// weil ein Smart-Trainer immer Leistung liefert.
function bikeVo2SubmaxPoint(w) {
  const kg = typeof getLatestWeightKg === "function" ? getLatestWeightKg() : athleteProfile.weightKg;
  if (!w.avg_hr || !w.avg_power_w || !kg || w.duration_min < 15) return null;
  const vo2 = 7 + (10.8 * w.avg_power_w) / kg;
  return { hr: w.avg_hr, vo2 };
}

/* ---------- Rad: VO2max je Einheit aus gleichmäßigen Abschnitten ----------
   Die Regression über ganze Einheiten (oben) ist beim Rad unzuverlässig:
   - Fast alle Radeinheiten liegen im ähnlichen Pulsbereich (Grundlage); die
     Gerade muss dann weit bis zur HFmax verlängert werden - schon ein paar
     Schläge Tagesform (Hitze, Müdigkeit, Kaffee) kippen die Steigung und
     die Schätzung landet viele Punkte daneben.
   - Aufwärmen, Pulsanstieg über lange Fahrten und Intervalle (Puls hinkt der
     Leistung hinterher) stecken mit im Ø-Puls der ganzen Einheit.
   Deshalb jetzt ähnlich wie Garmin/Firstbeat: nur gleichmäßige 5-Minuten-
   Abschnitte (nach dem Aufwärmen, kaum Rollphasen, Leistung auch kurz davor
   schon gleich, damit der Puls nachgezogen hat). Je Abschnitt gilt: der
   Anteil der Herzfrequenzreserve entspricht dem Anteil der VO2-Reserve
   (Swain 1997), also
       VO2max = 3,5 + (VO2 bei dieser Leistung − 3,5) ÷ %HFR
   mit VO2 aus der ACSM-Rad-Formel (7 + 10,8 × W/kg). Je Einheit der Median
   der Abschnitte, über alle Einheiten das obere Viertel (Puls-Drift und Hitze
   heben den Puls nur an, drücken die Schätzung also nur nach unten).
   Die Zeitreihe (parse_fit.py) ist schon auf 20-40-s-Mittelwerte verdichtet,
   Rollphasen stecken also anteilig in den Watt - wie im Sauerstoffbedarf. */
const BIKE_VO2_WINDOW_S = 300;       // Länge eines Abschnitts
const BIKE_VO2_LEAD_S = 120;         // so lange muss die Leistung schon vorher gleich sein (Puls zieht nach)
const BIKE_VO2_WARMUP_S = 600;       // die ersten 10 Minuten zählen nicht
const BIKE_VO2_HRR_RANGE = [0.5, 0.95]; // darunter ist der Puls zu ungenau, darüber nicht mehr gleichmäßig
const BIKE_VO2_MIN_RIDES = 3;

const vo2Median = arr => {
  const s = arr.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const vo2Quantile = (arr, q) => {
  const s = arr.slice().sort((a, b) => a - b), pos = (s.length - 1) * q, lo = Math.floor(pos);
  return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (pos - lo) : s[lo];
};

function vo2maxFromBikeEffort(watts, hr, kg, maxHr, restHr) {
  const hrr = (hr - restHr) / (maxHr - restHr);
  if (!(hrr >= BIKE_VO2_HRR_RANGE[0] && hrr <= BIKE_VO2_HRR_RANGE[1])) return null;
  const vo2 = 7 + (10.8 * watts) / kg;
  const est = 3.5 + (vo2 - 3.5) / hrr;
  return est > 20 && est < 90 ? est : null;
}

// Eine Radeinheit -> VO2max-Schätzung (oder null). Mit Zeitreihe aus den
// gleichmäßigen Abschnitten, ohne nur aus Normalized Power + Ø-Puls (gröber).
function bikeVo2RideEstimate(w, kg, maxHr, restHr) {
  if (!w || !(w.duration_min >= 20)) return null;
  const s = w.stream;
  if (s && Array.isArray(s.t) && Array.isArray(s.hr) && Array.isArray(s.power) && s.t.length >= 20) {
    const ests = [];
    let i = 0;
    while (i < s.t.length) {
      const t0 = s.t[i];
      if (t0 < BIKE_VO2_WARMUP_S) { i++; continue; }
      let j = i;
      while (j < s.t.length && s.t[j] - t0 < BIKE_VO2_WINDOW_S) j++;
      if (j >= s.t.length) break;
      const lead = [];
      for (let k = i - 1; k >= 0 && t0 - s.t[k] <= BIKE_VO2_LEAD_S; k--) lead.push(s.power[k]);
      const pw = s.power.slice(i, j + 1), hr = s.hr.slice(i, j + 1);
      const est = bikeVo2WindowEstimate(pw, hr, lead, kg, maxHr, restHr);
      if (est != null) { ests.push(est); i = j + 1; } else i++;
    }
    if (ests.length) return vo2Median(ests);
    return null; // Zeitreihe da, aber kein gleichmäßiger Abschnitt - nicht auf Ø-Werte ausweichen
  }
  // Ohne Zeitreihe: Ø-Leistung + Ø-Puls, nur für gleichmäßige Fahrten
  // (Normalized Power höchstens 10 % über Ø - sonst hinkt der Puls hinterher).
  const np = w.normalized_power_w, avg = w.avg_power_w;
  if (!w.avg_hr || !(np > 0) || !(avg > 0) || np / avg > 1.1) return null;
  return vo2maxFromBikeEffort(avg, w.avg_hr, kg, maxHr, restHr);
}

// Ein Abschnitt: Leistung gleichmäßig (kaum Rollphasen, Schwankung klein),
// auch kurz davor schon ähnlich, Puls ohne Lücken.
function bikeVo2WindowEstimate(power, hr, leadPower, kg, maxHr, restHr) {
  if (power.length < 3 || power.some(v => v == null) || hr.some(v => v == null || v <= 0)) return null;
  if (power.filter(v => v <= 0).length / power.length > 0.1) return null;
  const mean = power.reduce((a, b) => a + b, 0) / power.length;
  if (!(mean >= 1.2 * kg)) return null; // unter ca. 1,2 W/kg ist der Puls zu ungenau
  const sd = Math.sqrt(power.reduce((a, v) => a + (v - mean) ** 2, 0) / power.length);
  if (sd / mean > 0.2) return null;
  const lead = leadPower.filter(v => v != null);
  if (!lead.length) return null;
  const leadMean = lead.reduce((a, b) => a + b, 0) / lead.length;
  if (Math.abs(leadMean - mean) / mean > 0.15) return null;
  const hrMean = hr.reduce((a, b) => a + b, 0) / hr.length;
  return vo2maxFromBikeEffort(mean, hrMean, kg, maxHr, restHr);
}

// Ruhepuls: Profil, sonst Median der Garmin-Ruhepulswerte der letzten 30 Tage.
function vo2RestingHr() {
  if (athleteProfile.restingHr > 0) return athleteProfile.restingHr;
  if (typeof wellnessSeries !== "function") return null;
  const vals = wellnessSeries("resting_hr", 30).map(p => p.value).filter(v => v > 0);
  return vals.length ? vo2Median(vals) : null;
}

// Rad-VO2max aus den Einheiten eines Zeitfensters (Tage vor heute: from..to).
function bikeVo2FromRides(rides, kg, maxHr, restHr) {
  const ests = rides.map(w => bikeVo2RideEstimate(w, kg, maxHr, restHr)).filter(v => v != null);
  if (ests.length < BIKE_VO2_MIN_RIDES) return null;
  return { value: vo2Quantile(ests, 0.75), rides: ests.length };
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
  if (synced.length) {
    const latest = synced[0];
    const cutoff = new Date(latest._date.getTime() - 90 * 86400000);
    const older = synced.find(w => w._date <= cutoff);
    return {
      value: latest.vo2max,
      methodLabel: "synchronisiert (Garmin Connect)",
      trendLabel: older ? vo2TrendLabel(latest.vo2max, older.vo2max) : null,
    };
  }

  // Garmin liefert VO2max als TAGESwert, nicht je Einheit (siehe
  // js/data/garmin-wellness.js) - Laufen und Rad werden dort getrennt gefuehrt.
  // Der gemessene Wert schlaegt jede eigene Schaetzung, deshalb steht er hier
  // vor den Regressions-/Formel-Fallbacks der Aufrufer.
  if (typeof latestWellness === "function") {
    const field = sportName === "Rad" ? "vo2max_cycling" : "vo2max";
    const cur = latestWellness(field, 60);
    if (cur) {
      const hist = (typeof wellnessSeries === "function") ? wellnessSeries(field, 180) : [];
      const cutoffMs = new Date(cur.date).getTime() - 90 * 86400000;
      const older = hist.filter(p => p.date.getTime() <= cutoffMs).pop();
      return {
        value: cur.value,
        methodLabel: "synchronisiert (Garmin Connect)",
        trendLabel: older ? vo2TrendLabel(cur.value, older.value) : null,
      };
    }
  }
  return null;
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

  // 2) Je Einheit aus gleichmäßigen Abschnitten (Leistung + Herzfrequenz-
  //    reserve, siehe bikeVo2RideEstimate) - braucht Leistungsmesser,
  //    Körpergewicht, HFmax und Ruhepuls.
  const kg = typeof getLatestWeightKg === "function" ? getLatestWeightKg() : athleteProfile.weightKg;
  const maxHr = athleteProfile.maxHr, restHr = vo2RestingHr();
  if (kg > 0 && maxHr > 0 && restHr > 0 && maxHr > restHr) {
    const rides = ALL.filter(w => w.sport === "Rad" && w._date && !w.is_summary);
    const now = Date.now(), dayMs = 86400000;
    const age = w => (now - w._date.getTime()) / dayMs;
    const cur = bikeVo2FromRides(rides.filter(w => age(w) <= 120), kg, maxHr, restHr);
    if (cur) {
      const prior = bikeVo2FromRides(rides.filter(w => age(w) > 120 && age(w) <= 240), kg, maxHr, restHr);
      return {
        value: cur.value,
        methodLabel: `geschätzt aus gleichmäßigen Abschnitten von ${cur.rides} Radeinheiten (Leistung & Puls, wie Garmin)`,
        trendLabel: prior ? vo2TrendLabel(cur.value, prior.value) : null,
      };
    }
  }

  // 3) Ohne Ruhepuls: alte Regression über ganze Einheiten (ungenauer, siehe oben).
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
