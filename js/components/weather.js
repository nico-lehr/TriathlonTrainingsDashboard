// "Wetter im Kalender"-Karte in den Einstellungen: Heimatort suchen (der
// Server fragt Open-Meteo, js/data/weather.js) und im Profil speichern. Die
// Vorhersage selbst zeigt der Kalender (calWeatherHtml, js/components/calendar.js).

function initWeatherSettings() {
  const input = document.getElementById("weather-location-input");
  const searchBtn = document.getElementById("weather-location-search-btn");
  const status = document.getElementById("weather-location-status");
  const list = document.getElementById("weather-place-list");
  const clearBtn = document.getElementById("weather-location-clear-btn");
  if (!input || !searchBtn || !status || !list || !clearBtn) return;

  function showStatus(text, kind) {
    status.textContent = text;
    status.classList.remove("ok", "warn", "err");
    if (kind) status.classList.add(kind);
  }

  function showCurrent() {
    const loc = athleteProfile.homeLocation;
    showStatus(loc ? `Heimatort: ${loc.name}` : "Noch kein Heimatort eingetragen – ohne Ort zeigt der Kalender kein Wetter.", loc ? "ok" : "");
    clearBtn.hidden = !loc;
  }

  function choose(place) {
    setHomeLocation(place);
    list.innerHTML = "";
    input.value = "";
    showCurrent();
    renderCalendar(); // holt die Vorhersage für den neuen Ort
  }

  async function search() {
    const name = input.value.trim();
    list.innerHTML = "";
    if (name.length < 2) { showStatus("Bitte mindestens 2 Buchstaben eingeben.", "warn"); return; }
    searchBtn.disabled = true;
    showStatus("Suche …");
    try {
      const places = await searchWeatherPlaces(name);
      if (!places.length) {
        showStatus(`Kein Ort „${name}“ gefunden – Schreibweise prüfen.`, "warn");
        return;
      }
      showStatus(places.length === 1 ? "Gefunden – zum Übernehmen antippen:" : "Bitte den passenden Ort wählen:");
      list.innerHTML = places.map((p, i) =>
        `<button type="button" class="chip" data-idx="${i}">${escapeHtml(p.name)}${p.region ? ` <span class="weather-place-region">${escapeHtml(p.region)}</span>` : ""}</button>`).join("");
      list.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => choose(places[Number(btn.dataset.idx)])));
    } catch (e) {
      showStatus(e.message, "err");
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchBtn.addEventListener("click", search);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  clearBtn.addEventListener("click", () => choose(null));
  showCurrent();
}
