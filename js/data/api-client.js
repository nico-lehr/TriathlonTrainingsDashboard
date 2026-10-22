/**
 * API Client for Triathlon Dashboard
 *
 * Das Dashboard laeuft unter derselben Adresse wie die API (backend/frontend.py),
 * deshalb sind alle Adressen relativ ("api/v1/...") - egal ob ueber localhost,
 * die PC-IP oder Tailscale aufgerufen.
 *
 * - apiCall(): zentrale Anfrage mit Login-Token; bei 401 geht es zur Login-Seite.
 * - Ablage pro Person (storeGet/storeSet): ersetzt localStorage fuer alle
 *   persoenlichen Dashboard-Daten, damit jede Person nur ihre eigenen sieht.
 * - TriathlonApiClient: aeltere Komfort-Methoden auf denselben Endpunkten.
 */

// Login-Token (siehe login.html / js/login.js). Bleibt im localStorage dieses
// Browsers, bis abgemeldet wird oder er nach 30 Tagen ablaeuft.
const AUTH_TOKEN_KEY = "triathlon_dashboard_token_v1";
const LOGIN_PAGE = "login.html";

function getAuthToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch (e) { return null; }
}

function setAuthToken(token) {
  try { localStorage.setItem(AUTH_TOKEN_KEY, token); } catch (e) { /* ignorieren */ }
}

function goToLogin() {
  window.location.href = LOGIN_PAGE;
}

// Zentrale Anfrage an die API. Liefert die JSON-Antwort ({data, meta}) oder
// wirft einen Fehler mit der (deutschen) Meldung des Servers.
async function apiCall(endpoint, method = "GET", body = null, { timeoutMs = 20000, redirectOn401 = true } = {}) {
  const headers = { "Accept": "application/json" };
  if (body !== null) headers["Content-Type"] = "application/json";
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`api/v1/${endpoint}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = new Error("Server nicht erreichbar - läuft das Dashboard auf dem PC?");
    err.timeout = !!e && e.name === "TimeoutError"; // Anfrage evtl. trotzdem ausgeführt (z. B. An Garmin senden)
    throw err;
  }

  if (response.status === 401 && redirectOn401) {
    try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch (e) { /* ignorieren */ }
    goToLogin();
    throw new Error("Nicht angemeldet");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

// Ohne Token gar nicht erst starten, sondern direkt zur Login-Seite.
function requireLogin() {
  if (getAuthToken()) return true;
  goToLogin();
  return false;
}

// Abmelden: alles Persoenliche aus diesem Browser entfernen (Token, KI-Schluessel,
// Einstellungen) - nur das gewaehlte Hell/Dunkel-Design bleibt.
function logout() {
  let theme = null;
  try {
    theme = localStorage.getItem("triathlon_dashboard_theme_v1");
    localStorage.clear();
    if (theme) localStorage.setItem("triathlon_dashboard_theme_v1", theme);
  } catch (e) { /* ignorieren */ }
  goToLogin();
}

// Sichtbarer Hinweis oben im Dashboard (index.html: #api-error-banner), wenn
// Laden/Speichern scheitert - ein still verschluckter Fehler wuerde sonst
// unbemerkt Aenderungen verlieren. null blendet ihn aus - ausser es gilt noch
// etwas Wichtigeres aus der Ablage (siehe unten): ein ungesicherter Wert oder
// die Warnung "auf einem anderen Geraet geaendert". Ein anderer Erfolg (z. B.
// Equipment gespeichert) erledigt beides nicht.
function showApiError(message) {
  if (!message && storeStale) return showStoreStaleNotice();
  if (!message && storeFailed.size) message = storeFailedText;
  const el = document.getElementById("api-error-banner");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

/* ----------------------------------------------------------------------
   Ablage pro Person (GET/PUT /api/v1/store). loadUserStore() holt beim Start
   EINMAL alles; danach lesen die js/data-Module synchron per storeGet() und
   speichern per storeSet(). Die Schluessel sind dieselben wie frueher im
   localStorage (z.B. "triathlon_dashboard_goals_v1").
   ---------------------------------------------------------------------- */

let userStore = {};
const storeSending = new Set(); // Schluessel, die gerade zum Server unterwegs sind
const storeDirty = new Set();   // Schluessel mit noch nicht gesendeter Aenderung
const storeFailed = new Set();  // Schluessel, deren letztes Speichern scheiterte (der Browser hat den neueren Stand)
let storeFailedText = "";
let storeLoaded = false;
let storeStale = false;         // auf einem anderen Geraet wurde inzwischen etwas geaendert
let storeCheckedAt = 0;
let storeChangeCount = 0;       // zaehlt eigene Aenderungen (siehe checkStoreStale)

async function loadUserStore() {
  userStore = (await apiCall("store")).data || {};
  storeLoaded = true;
}

// Kopie statt Referenz - verhaelt sich wie frueher JSON.parse(localStorage...).
function storeGet(key) {
  return key in userStore ? JSON.parse(JSON.stringify(userStore[key])) : null;
}

// Abgelegt wird eine Kopie: sonst waere z. B. plannedWorkouts dasselbe Objekt
// wie der Ablage-Eintrag, und eine noch nicht gespeicherte Aenderung (etwa ein
// Lade-Merker der KI) saehe beim Vergleich wie eine Aenderung von aussen aus.
function storeSet(key, value) {
  userStore[key] = value === undefined ? null : JSON.parse(JSON.stringify(value));
  storeChangeCount++;
  storeDirty.add(key);
  if (!storeSending.has(key)) sendStoreKey(key);
}

// Sendet nacheinander; mehrere schnelle Aenderungen desselben Schluessels
// werden zu einer Anfrage mit dem neuesten Stand zusammengefasst.
async function sendStoreKey(key) {
  storeSending.add(key);
  while (storeDirty.has(key)) {
    storeDirty.delete(key);
    try {
      await apiCall(`store/${key}`, "PUT", { value: userStore[key] });
      storeFailed.delete(key);
      showApiError(null);
    } catch (e) {
      storeFailed.add(key);
      storeFailedText = `Speichern fehlgeschlagen (${e.message}). Die letzte Änderung ist evtl. nicht gesichert.`;
      showApiError(storeFailedText);
    }
  }
  storeSending.delete(key);
}

// Wartet, bis die letzte Aenderung dieses Schluessels beim Server angekommen
// ist - fuer Server-Funktionen, die selbst aus der Ablage lesen (An Garmin senden).
async function storeSaved(key) {
  while (storeSending.has(key)) await new Promise(resolve => setTimeout(resolve, 100));
}

// Ein lange offener Tab kennt nur den Stand vom Start, und jedes Speichern
// ersetzt den ganzen Wert auf dem Server. Wurde auf einem anderen Geraet
// (Handy/PC) inzwischen etwas geaendert, wuerde der naechste Haken hier das
// stillschweigend ueberschreiben. Deshalb: kommt der Tab wieder nach vorn,
// wird der Serverstand verglichen und bei Abweichung gewarnt (nicht einfach neu
// geladen - sonst ginge eine halb ausgefuellte Eingabe verloren).
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function storeChangedElsewhere(server) {
  const keys = new Set([...Object.keys(server), ...Object.keys(userStore)]);
  return [...keys].some(k => stableJson(server[k]) !== stableJson(userStore[k]));
}

function showStoreStaleNotice() {
  const el = document.getElementById("api-error-banner");
  if (!el) return;
  el.textContent = "Auf einem anderen Gerät wurde inzwischen etwas geändert. Bitte neu laden, sonst überschreibst du es beim nächsten Speichern. ";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cal-today-btn";
  btn.textContent = "Neu laden";
  btn.addEventListener("click", () => window.location.reload());
  el.appendChild(btn);
  el.hidden = false;
}

// Ein ungesicherter eigener Wert ist keine Aenderung "von aussen" - solange es
// einen gibt, wird nicht verglichen (sonst riete der Hinweis zum Neuladen,
// und die eigene Aenderung waere weg).
async function checkStoreStale() {
  const idle = () => !storeSending.size && !storeDirty.size && !storeFailed.size;
  if (!storeLoaded || document.visibilityState !== "visible" || storeStale || !idle() || Date.now() - storeCheckedAt < 30000) return;
  storeCheckedAt = Date.now();
  const changesBefore = storeChangeCount;
  let server;
  try { server = (await apiCall("store")).data || {}; } catch (e) { return; }
  // Waehrenddessen selbst etwas geaendert (auch wenn es schon gespeichert ist):
  // die Server-Antwort ist dann aelter als der eigene Stand - nicht vergleichen.
  if (!idle() || storeChangeCount !== changesBefore) return;
  if (storeChangedElsewhere(server)) { storeStale = true; showStoreStaleNotice(); }
}
document.addEventListener("visibilitychange", checkStoreStale);
window.addEventListener("focus", checkStoreStale); // zwei Fenster nebeneinander: Wechsel per Klick

// Warnen, wenn die Seite geschlossen wird, waehrend noch gespeichert wird
// oder eine Aenderung nicht gesichert werden konnte.
window.addEventListener("beforeunload", (e) => {
  if (storeSending.size || storeFailed.size) { e.preventDefault(); e.returnValue = ""; }
});

class TriathlonApiClient {
  constructor() {
    this.timeout = 5000;
    this.isAvailable = null; // null = unknown, true/false = cached status
  }

  /**
   * Check if API is available (with caching for 30 seconds)
   */
  async checkAvailability() {
    if (this.isAvailable !== null) return this.isAvailable;

    try {
      const response = await this.request("health", "GET", null, { noFallback: true });
      this.isAvailable = response?.data?.status === "ok";

      // Re-check after 30 seconds
      setTimeout(() => { this.isAvailable = null; }, 30000);

      return this.isAvailable;
    } catch (e) {
      console.warn(`✗ API unavailable: ${e.message}`);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Make HTTP request to API (ueber apiCall, also mit Login-Token)
   */
  async request(endpoint, method = "GET", body = null, options = {}) {
    try {
      return await apiCall(endpoint, method, body, { timeoutMs: this.timeout });
    } catch (error) {
      if (!options.noFallback) console.warn(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * Get current athlete profile
   */
  async getAthlete() {
    try {
      const response = await this.request("athlete", "GET");
      return response.data;
    } catch (e) {
      console.error("Failed to fetch athlete", e);
      return null;
    }
  }

  /**
   * Update athlete profile
   */
  async updateAthlete(athleteData) {
    try {
      const response = await this.request("athlete", "PUT", athleteData);
      return response.data;
    } catch (e) {
      console.error("Failed to update athlete", e);
      return null;
    }
  }

  /**
   * Get workouts with optional filtering
   */
  async getWorkouts(filters = {}) {
    try {
      let endpoint = "workouts";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);
      if (filters.sport) params.append("sport", filters.sport);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch workouts", e);
      return [];
    }
  }

  /**
   * Create or update a workout
   */
  async createWorkout(workoutData) {
    try {
      const response = await this.request("workouts", "POST", workoutData);
      return response.data;
    } catch (e) {
      console.error("Failed to create workout", e);
      return null;
    }
  }

  /**
   * Get wellness data with optional filtering
   */
  async getWellness(filters = {}) {
    try {
      let endpoint = "wellness";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch wellness", e);
      return [];
    }
  }

  /**
   * Create or update wellness data
   */
  async createWellness(wellnessData) {
    try {
      const response = await this.request("wellness", "POST", wellnessData);
      return response.data;
    } catch (e) {
      console.error("Failed to create wellness", e);
      return null;
    }
  }

  /**
   * Get recovery checks with optional filtering
   */
  async getRecoveryChecks(filters = {}) {
    try {
      let endpoint = "recovery-checks";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch recovery checks", e);
      return [];
    }
  }

  /**
   * Create recovery check
   */
  async createRecoveryCheck(checkData) {
    try {
      const response = await this.request("recovery-checks", "POST", checkData);
      return response.data;
    } catch (e) {
      console.error("Failed to create recovery check", e);
      return null;
    }
  }

  /**
   * Get goals
   */
  async getGoals() {
    try {
      const response = await this.request("goals", "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch goals", e);
      return [];
    }
  }

  /**
   * Create goal
   */
  async createGoal(goalData) {
    try {
      const response = await this.request("goals", "POST", goalData);
      return response.data;
    } catch (e) {
      console.error("Failed to create goal", e);
      return null;
    }
  }

  /**
   * Get planned workouts with optional filtering
   */
  async getPlannedWorkouts(filters = {}) {
    try {
      let endpoint = "planned-workouts";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch planned workouts", e);
      return [];
    }
  }

  /**
   * Create planned workout
   */
  async createPlannedWorkout(workoutData) {
    try {
      const response = await this.request("planned-workouts", "POST", workoutData);
      return response.data;
    } catch (e) {
      console.error("Failed to create planned workout", e);
      return null;
    }
  }
}

// Global API client instance
const apiClient = new TriathlonApiClient();
