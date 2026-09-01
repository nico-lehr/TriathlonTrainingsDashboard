// GPX-Streckenprofil-Parser: rein clientseitig (DOMParser, keine Bibliothek
// nötig), liest Höhen-/Koordinatenpunkte aus einer .gpx-Datei und berechnet
// Anstieg/Abstieg + eine grobe Hügeligkeits-Einordnung. Wiederverwendet an
// zwei Stellen: Streckenprofil eines Ziels/Rennens (js/components/coach.js)
// und nachträgliche Höhenmeter-Korrektur einzelner Workouts
// (js/components/workout-card.js) - eine Berechnung, zwei Anzeigeorte
// (PROJECT_MAP: "Analytics: mathematical calculations", hier bewusst als
// eigenständiger Parser statt dupliziert in beiden UI-Dateien).

// Distanz zwischen zwei Koordinaten (Haversine, Erdradius 6371km) - nur für
// die Hm/km-Einordnung, keine hochpräzise Navigationsberechnung nötig.
function gpxHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Liefert null bei ungültigem/leerem GPX statt geraten zu werden (AI_RULES:
// keine erfundenen Daten) - der Aufrufer zeigt dann eine Fehlermeldung.
function parseGpxElevation(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    const pts = Array.from(doc.querySelectorAll("trkpt, rtept"));
    if (pts.length < 2) return null;

    const elevations = pts.map(p => {
      const el = p.querySelector("ele");
      const v = el ? Number(el.textContent) : NaN;
      return isNaN(v) ? null : v;
    });
    let ascentM = 0, descentM = 0, hasElevation = false;
    for (let i = 1; i < elevations.length; i++) {
      if (elevations[i] == null || elevations[i - 1] == null) continue;
      hasElevation = true;
      const d = elevations[i] - elevations[i - 1];
      if (d > 0) ascentM += d; else descentM += -d;
    }
    if (!hasElevation) return null;

    let distanceKm = 0;
    for (let i = 1; i < pts.length; i++) {
      const lat1 = Number(pts[i - 1].getAttribute("lat")), lon1 = Number(pts[i - 1].getAttribute("lon"));
      const lat2 = Number(pts[i].getAttribute("lat")), lon2 = Number(pts[i].getAttribute("lon"));
      if ([lat1, lon1, lat2, lon2].some(isNaN)) continue;
      distanceKm += gpxHaversineKm(lat1, lon1, lat2, lon2);
    }

    // Hügeligkeits-Einordnung nach Höhenmeter/km - dokumentierte, grobe
    // Faustregel-Schwelle (analog zum Seiler-80/10/10-Richtwert an anderer
    // Stelle im Dashboard), keine wissenschaftlich normierte Klassifikation.
    const hmPerKm = distanceKm > 0.1 ? ascentM / distanceKm : null;
    const hilliness = hmPerKm == null ? null : hmPerKm < 10 ? "flach" : hmPerKm < 25 ? "hügelig" : "bergig";

    return {
      ascentM: Math.round(ascentM),
      descentM: Math.round(descentM),
      distanceKm: Math.round(distanceKm * 10) / 10,
      hmPerKm: hmPerKm != null ? Math.round(hmPerKm) : null,
      hilliness,
    };
  } catch (e) {
    return null;
  }
}

// Kurzer Anzeigetext aus einem parseGpxElevation()-Ergebnis, z.B.
// "1240 Hm über 92 km (13 Hm/km, hügelig)" - gemeinsam genutzt von Ziel- und
// Workout-UI statt zweimal formatiert.
function gpxProfileLabel(profile) {
  if (!profile) return "";
  const bits = [`${profile.ascentM} Hm`];
  if (profile.distanceKm) bits.push(`über ${fmtNum(profile.distanceKm, 1)} km`);
  const detail = [];
  if (profile.hmPerKm != null) detail.push(`${profile.hmPerKm} Hm/km`);
  if (profile.hilliness) detail.push(profile.hilliness);
  return bits.join(" ") + (detail.length ? ` (${detail.join(", ")})` : "");
}
