// Wetter für den Kalender: 7-Tage-Vorhersage für den Heimatort
// (athleteProfile.homeLocation = { name, lat, lon }, gesucht in den
// Einstellungen). Der Browser fragt nur den eigenen Server
// (backend/weather_routes.py), der Open-Meteo anfragt und die Antwort eine
// Stunde zwischenspeichert. Die Vorhersage selbst wird nicht gespeichert.

const WEATHER_REFRESH_MS = 60 * 60 * 1000; // spätestens nach 1 Stunde neu holen

let weatherState = { byDate: {}, error: null, fetchedAt: 0 };
let weatherRequestSeq = 0; // nur die zuletzt gestartete Anfrage darf das Ergebnis setzen

// WMO-Wettercode (Open-Meteo "weather_code") -> Symbol + kurzer deutscher Text.
const WMO_WEATHER = [
  [[0], "☀️", "Klar"],
  [[1], "🌤️", "Überwiegend klar"],
  [[2], "⛅", "Teils bewölkt"],
  [[3], "☁️", "Bedeckt"],
  [[45, 48], "🌫️", "Nebel"],
  [[51, 53, 55], "🌦️", "Nieselregen"],
  [[56, 57, 66, 67], "🌧️", "Gefrierender Regen"],
  [[61, 63], "🌧️", "Regen"],
  [[65], "🌧️", "Starker Regen"],
  [[71, 73, 75, 77], "🌨️", "Schnee"],
  [[80, 81, 82], "🌦️", "Regenschauer"],
  [[85, 86], "🌨️", "Schneeschauer"],
  [[95], "⛈️", "Gewitter"],
  [[96, 99], "⛈️", "Gewitter mit Hagel"],
];

// { icon, label } oder null bei unbekanntem/fehlendem Code (dann nichts raten).
function weatherCodeInfo(code) {
  const row = WMO_WEATHER.find(([codes]) => codes.includes(code));
  return row ? { icon: row[1], label: row[2] } : null;
}

function weatherForDate(dateKey) {
  return weatherState.byDate[dateKey] || null;
}

function weatherNeedsRefresh() {
  return !!athleteProfile.homeLocation && Date.now() - weatherState.fetchedAt > WEATHER_REFRESH_MS;
}

// Holt die Vorhersage für den Heimatort. Wirft nie: ein Fehler landet als
// deutscher Text in weatherState.error, der Kalender läuft ohne Wetter weiter.
async function loadWeatherForecast() {
  const seq = ++weatherRequestSeq;
  const loc = athleteProfile.homeLocation;
  weatherState = { byDate: {}, error: null, fetchedAt: Date.now() }; // sofort, damit parallele Aufrufe nicht nochmal anfragen
  if (!loc) return;
  let byDate = {}, error = null;
  try {
    const res = await apiCall(`weather?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}`);
    (res.data.days || []).forEach(d => { byDate[d.date] = d; });
  } catch (e) {
    error = e.message;
  }
  if (seq === weatherRequestSeq) weatherState = { byDate, error, fetchedAt: weatherState.fetchedAt };
}

// Ortssuche über den Server -> [{ name, region, lat, lon }] (wirft bei Fehlern).
async function searchWeatherPlaces(name) {
  return (await apiCall(`weather/geocode?name=${encodeURIComponent(name)}`)).data.places || [];
}

// Speichert den Heimatort im Profil (null = entfernen); die nächste
// Kalender-Darstellung holt dann die neue Vorhersage.
function setHomeLocation(place) {
  athleteProfile.homeLocation = place
    ? { name: place.region ? `${place.name} (${place.region})` : place.name, lat: place.lat, lon: place.lon }
    : null;
  saveAthleteProfile();
  weatherRequestSeq++; // eine evtl. noch laufende Anfrage für den alten Ort verwerfen
  weatherState = { byDate: {}, error: null, fetchedAt: 0 };
}
