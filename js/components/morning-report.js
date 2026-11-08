// Morgenbericht auf "Heute": sobald die Daten der Nacht da sind, die
// wichtigsten Werte im Vergleich zu deinem Normalwert und 2-3 Sätze vom
// KI-Coach, was das für das heutige Training heißt.
//
// - Die KI wird höchstens zweimal am Tag gefragt (ein zweites Mal nur, wenn
//   Garmin Werte nachgetragen hat oder sich der Plan für heute geändert hat).
//   Ohne KI steht ein fester Satz nach Regeln da.
// - Fehlt die Nacht noch, holt das Dashboard sie beim Öffnen einmal von
//   Garmin (höchstens alle 30 Minuten).
// - Gesehen = der Server schickt heute keine Mitteilung mehr (backend/morning.py).

const MORNING_KEY = "triathlon_dashboard_morning_v1"; // { day, text, sig, aiCount, dismissed, seenDay, fetchAt }
const MORNING_AI_MAX_PER_DAY = 2;
const MORNING_FETCH_EVERY_MS = 30 * 60 * 1000;
const MORNING_HIDE_HOUR = 18;

let morningAiRunning = false;
let morningFetching = false;

function morningLoad() {
  return { day: null, text: null, sig: null, aiCount: 0, dismissed: null, seenDay: null, fetchAt: null, ...(storeGet(MORNING_KEY) || {}) };
}

function morningSave(st) { storeSet(MORNING_KEY, st); }

// Die Nacht zum heutigen Tag (Garmin speichert sie unter dem Aufwach-Tag)
function morningNight(dayKey = todayStr()) {
  const w = typeof wellnessForDate === "function" ? wellnessForDate(new Date(dayKey + "T12:00:00")) : null;
  return w && w.sleep_min > 0 ? w : null;
}

function morningPlanToday(dayKey = todayStr()) {
  return (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : [])
    .filter(p => p.date === dayKey && (p.status || "geplant") === "geplant")
    .sort((a, b) => (a.sport === "Mobility") - (b.sport === "Mobility"));
}

function morningHm(min) {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

// Kacheln: [{ label, value, sub, cls }] - nur Werte von heute Nacht
function morningValues(w) {
  const out = [];
  const base = f => (typeof wellnessBaseline === "function" ? wellnessBaseline(f) : null);
  const sb = base("sleep_min");
  out.push({ label: "Schlaf", value: morningHm(w.sleep_min), sub: sb ? `Ø ${morningHm(sb)}` : "",
    cls: sb && w.sleep_min < sb - 45 ? "bad" : sb && w.sleep_min >= sb - 15 ? "good" : "" });
  if (w.hrv_ms) {
    const hb = base("hrv_ms");
    const pct = hb ? Math.round((w.hrv_ms - hb) / hb * 100) : null;
    out.push({ label: "HRV", value: `${Math.round(w.hrv_ms)} ms`, sub: pct != null ? `${pct >= 0 ? "+" : "−"}${Math.abs(pct)} % zu Ø` : "",
      cls: pct != null && pct <= -PLAN_HRV_DROP_PCT ? "bad" : pct != null && pct >= 0 ? "good" : "" });
  }
  if (w.resting_hr) {
    const rb = base("resting_hr");
    const d = rb ? Math.round(w.resting_hr - rb) : null;
    out.push({ label: "Ruhepuls", value: `${Math.round(w.resting_hr)}`, sub: d != null ? `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)} zu Ø` : "",
      cls: d != null && d >= PLAN_RHR_RISE_BPM ? "bad" : d != null && d <= 0 ? "good" : "" });
  }
  if (w.body_battery_charged != null) out.push({ label: "Body Battery", value: `+${Math.round(w.body_battery_charged)}`, sub: "aufgeladen", cls: w.body_battery_charged >= 50 ? "good" : w.body_battery_charged < 25 ? "bad" : "" });
  else if (w.readiness_score != null) out.push({ label: "Bereitschaft", value: `${Math.round(w.readiness_score)}`, sub: "von 100", cls: w.readiness_score < PLAN_READINESS_LOW ? "bad" : w.readiness_score >= 60 ? "good" : "" });
  return out;
}

// Was die KI sehen soll - knapp gehalten (ein paar hundert Tokens)
function morningSignature(w, plan) {
  return [w.sleep_min, w.hrv_ms, w.resting_hr, w.body_battery_charged, w.readiness_score,
    ...plan.map(p => `${p.id}:${p.duration_min}:${p.intensity}`)].join("|");
}

function buildMorningContext(w, plan) {
  const now = new Date();
  const todayKey = todayStr();
  const lines = [`Heute: ${now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} Uhr`];
  const garmin = typeof garminRecoveryBits === "function" ? garminRecoveryBits().filter(b => !/^Schritte|Gewicht/.test(b)) : [];
  if (garmin.length) lines.push(`Garmin, letzte Nacht: ${garmin.join(" | ")}`);
  if (w.body_battery_charged != null) lines.push(`Body Battery über Nacht aufgeladen: +${Math.round(w.body_battery_charged)}`);
  const rec = typeof mRecovery === "function" ? mRecovery() : null;
  if (rec) lines.push(`Erholung laut Dashboard: ${rec.score} von 100${rec.signs && rec.signs.length ? ` – Warnzeichen: ${rec.signs.join("; ")}` : ""}`);
  const rc = typeof recoveryCheck !== "undefined" && recoveryCheck && recoveryCheck.date === todayKey ? recoveryCheck : null;
  if (rc && (rc.soreness || rc.energy || rc.injury === "yes")) {
    const bits = [];
    if (rc.soreness) bits.push(`Muskelkater ${RECOVERY_SORENESS_LABELS[rc.soreness]}`);
    if (rc.energy) bits.push(`Energie ${RECOVERY_ENERGY_LABELS[rc.energy]}`);
    if (rc.injury === "yes") bits.push(`Verletzung${rc.injuryNote ? `: ${rc.injuryNote}` : ""}`);
    lines.push(`Eigenes Gefühl heute: ${bits.join(", ")}`);
  }
  const series = typeof computeLoadSeries === "function" ? computeLoadSeries() : null;
  if (series && series.length) {
    const last = series[series.length - 1];
    lines.push(`Belastung: Fitness ${Math.round(last.ctl)}, Ermüdung ${Math.round(last.atl)}, Form ${Math.round(last.tsb)}`);
  }
  const yKey = planShiftDay(todayKey, -1);
  const yesterday = (typeof DATA !== "undefined" ? DATA : []).filter(x => x._date && localDateStr(x._date) === yKey);
  lines.push(`Gestern trainiert: ${yesterday.length ? yesterday.map(x => `${x.sport} ${Math.round(x.duration_min || 0)} min${x.training_load != null ? `, Load ${Math.round(x.training_load)}` : ""}`).join("; ") : "nichts"}`);
  lines.push(`Heute geplant: ${plan.length ? plan.map(p => `${p.sport} „${p.title || p.sport}“, ${p.duration_min} min, ${p.intensity || "Intensität offen"}${p.description ? ` – ${String(p.description).slice(0, 120)}` : ""}`).join("; ") : "nichts (Ruhetag)"}`);
  const pc = typeof currentPlanCheckEntry === "function" ? currentPlanCheckEntry() : null;
  if (pc && pc.items && pc.items.length) lines.push(`Der Plan-Check hat heute schon geändert: ${pc.items.map(i => `${i.day}: ${i.text}`).join("; ")}`);
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  if (goal && goal.date) lines.push(`Ziel: ${goal.name} in ${Math.round((new Date(goal.date + "T00:00:00") - new Date(todayKey + "T00:00:00")) / 86400000)} Tagen`);
  return lines.join("\n");
}

function buildMorningPrompt(w, plan) {
  return `Du bist ein erfahrener, freundlicher Triathlon-Coach und schreibst den Morgenbericht für die Person, die du trainierst.

${buildMorningContext(w, plan)}

Schreib 2 bis 3 kurze Sätze auf Deutsch, per du, in ganz einfachen Worten (kein Fachjargon):
1. Wie gut die Erholung über Nacht war – im Vergleich zum eigenen Normalwert.
2. Was das für das heutige Training heißt (wie geplant, lieber lockerer, oder Ruhetag). Nenne die Einheit beim Namen.
Nur Zahlen verwenden, die oben stehen. Keine Aufzählung, keine Überschrift, keine Anrede wie „Hallo“, höchstens 350 Zeichen.`;
}

// Fester Satz ohne KI
function morningRuleText(plan) {
  const rec = typeof mRecovery === "function" ? mRecovery() : null;
  const main = plan.find(p => p.sport !== "Mobility");
  if (typeof mVerdict === "function") return mVerdict(rec, main && main.intensity === "hart").text;
  return main ? `Heute steht „${main.title || main.sport}“ an.` : "Heute ist nichts geplant.";
}

function morningVisible(now = new Date()) {
  const st = morningLoad();
  const key = todayStr();
  return !!morningNight(key) && st.dismissed !== key && now.getHours() < MORNING_HIDE_HOUR;
}

async function ensureMorningText() {
  if (morningAiRunning || typeof callAiText !== "function" || !morningVisible()) return;
  // Läuft gerade der Plan-Check, kommt der Aufruf danach noch einmal (plan-check.js)
  if (typeof planCheckRunning !== "undefined" && planCheckRunning) return;
  const key = todayStr();
  const w = morningNight(key);
  const plan = morningPlanToday(key);
  const sig = morningSignature(w, plan);
  let st = morningLoad();
  if (st.day === key && (st.sig === sig || (st.aiCount || 0) >= MORNING_AI_MAX_PER_DAY)) return;
  st = { ...st, day: key, sig, aiCount: (st.day === key ? st.aiCount || 0 : 0) + 1, text: st.day === key ? st.text : null };
  morningSave(st);
  morningAiRunning = true;
  if (typeof mScheduleRender === "function") mScheduleRender();
  try {
    const prompt = buildMorningPrompt(w, plan);
    const raw = String(await callAiText(prompt, { task: "morning" }) || "").replace(/\s+/g, " ").trim();
    const text = (typeof keepPromptNumbers === "function" ? keepPromptNumbers(raw, prompt) : raw).slice(0, 420);
    morningSave({ ...morningLoad(), text: text || null, at: new Date().toISOString() });
  } catch (e) {
    // KI nicht erreichbar: der feste Satz bleibt stehen
  } finally {
    morningAiRunning = false;
    if (typeof mScheduleRender === "function") mScheduleRender();
  }
}

// Bericht angesehen: der Server schickt heute keine Mitteilung mehr
function markMorningSeen() {
  const st = morningLoad();
  const key = todayStr();
  if (st.seenDay === key || document.visibilityState === "hidden") return;
  morningSave({ ...st, seenDay: key });
  apiCall("morning/seen", "POST").catch(() => {});
}

function dismissMorningReport() {
  morningSave({ ...morningLoad(), dismissed: todayStr() });
}

// Morgens beim Öffnen: Nacht fehlt noch -> einmal bei Garmin nachsehen
async function morningAutoFetch(now = new Date()) {
  if (morningFetching || morningNight() || now.getHours() < 5 || now.getHours() >= 12 || typeof startGarminSync !== "function") return;
  const st = morningLoad();
  if (st.fetchAt && now - new Date(st.fetchAt) < MORNING_FETCH_EVERY_MS) return;
  morningSave({ ...st, fetchAt: now.toISOString() });
  morningFetching = true;
  if (typeof mScheduleRender === "function") mScheduleRender();
  try {
    await startGarminSync(); // lädt danach selbst neu (reloadGarminData)
    if (typeof schedulePlanCheck === "function") schedulePlanCheck();
  } catch (e) {
    // nicht verbunden o. ä.: dann eben ohne
  } finally {
    morningFetching = false;
    if (typeof mScheduleRender === "function") mScheduleRender();
    ensureMorningText();
  }
}

// Karte für m-app.js (Heute)
function morningCardHtml(esc) {
  const key = todayStr();
  if (!morningVisible()) {
    if (morningFetching) return `<section class="m-card m-morning"><div class="m-head"><h2>Guten Morgen</h2></div><p class="m-say">Ich hole gerade die Daten deiner Nacht von Garmin …</p></section>`;
    return "";
  }
  const w = morningNight(key);
  const plan = morningPlanToday(key);
  const st = morningLoad();
  const tiles = morningValues(w).map(v => {
    const [num, unit] = String(v.value).split(" ");
    return `<div class="m-mr-tile ${v.cls}"><small>${esc(v.label)}</small><b>${esc(num)}${unit ? `<i>${esc(unit)}</i>` : ""}</b>${v.sub ? `<span>${esc(v.sub)}</span>` : ""}</div>`;
  }).join("");
  const text = st.day === key && st.text ? st.text : null;
  const say = text ? esc(text) : morningAiRunning ? `<span class="m-mr-wait">Dein Coach schreibt …</span>` : esc(morningRuleText(plan));
  setTimeout(markMorningSeen, 0);
  return `<section class="m-card m-morning" id="m-morning"><div class="m-head"><h2>Guten Morgen</h2><small class="m-mr-date">${esc(new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }))}</small></div>
      <div class="m-mr-tiles">${tiles}</div>
      <p class="m-say">${say}</p>
      <div class="m-actions"><button type="button" class="m-btn primary" data-m-act="mr-ok">Danke</button></div></section>`;
}

function initMorningReport() {
  morningAutoFetch();
  // Normalerweise schreibt der Plan-Check-Lauf beim Start den Text an (danach);
  // ohne Ziel läuft der nicht - dann hier.
  setTimeout(ensureMorningText, 8000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    morningAutoFetch();
    ensureMorningText();
  });
  // Tipp auf die Mitteilung (sw.js) oder Link mit ?morgen=1: zu "Heute"
  const goToMorning = () => {
    if (typeof mShow === "function") mShow("heute");
    setTimeout(() => { const el = document.getElementById("m-morning"); if (el) el.scrollIntoView({ block: "start" }); }, 60);
  };
  if (/[?&]morgen=1/.test(location.search)) {
    goToMorning();
    history.replaceState(null, "", location.pathname + location.hash);
  }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "morning-open") goToMorning(); });
}
