// Automatischer Wochenplan als Sammelauftrag (Claude Batches API, halber Preis).
//
// Schema (gilt nur für den AUTOMATISCHEN Plan - "Plan erstellen", "Plan neu
// erstellen" und die Nachricht an den Coach antworten weiter sofort):
//
//   noch ≤ 5 Tage geplant   -> nächste Woche als Sammelauftrag abschicken
//                              (fertig meist in unter einer Stunde, spätestens 24 h)
//   Ergebnis da             -> wie ein normaler KI-Plan prüfen, reparieren,
//                              auffüllen und speichern (generateTrainingPlan)
//   noch ≤ 1 Tag geplant    -> nicht länger warten: sofort planen (voller Preis).
//                              Sicherheitsnetz, falls der Auftrag hängt oder die
//                              App tagelang nicht offen war.
//
// Die Tage kurz vorher passt danach der tägliche Plan-Check (plan-check.js)
// an die Verfassung an - der vorab erstellte Plan muss das nicht leisten.
// Ohne Claude (lokale KI über Ollama, kostenlos) bleibt alles wie bisher.
//
// Der laufende Auftrag steht in der Ablage pro Person (PLAN_BATCH_KEY), damit
// jedes Gerät ihn abholen kann.

const PLAN_BATCH_KEY = "triathlon_plan_batch_v1";
const PLAN_BATCH_LEAD_DAYS = 5;       // ab hier vorab als Sammelauftrag planen
const PLAN_BATCH_URGENT_DAYS = 1;     // ab hier sofort planen (voller Preis)
const PLAN_BATCH_MAX_FAILS = 2;       // so oft am Tag darf ein Auftrag scheitern
const PLAN_BATCH_POLL_MS = 10 * 60 * 1000;
const PLAN_BATCH_MIN_POLL_MS = 2 * 60 * 1000;

let planBatchBusy = false;
let planBatchTimer = null;
let planBatchLastRun = 0;

// Wie viele Kalendertage ist (ab heute, heute mitgezählt) noch etwas geplant?
// 0 = ab heute nichts mehr.
function planBatchDaysLeft(plannedDates, todayKey) {
  const future = (plannedDates || []).filter(d => d >= todayKey).sort();
  if (!future.length) return 0;
  const last = future[future.length - 1];
  return Math.round((new Date(last + "T00:00:00") - new Date(todayKey + "T00:00:00")) / 86400000) + 1;
}

// Reine Entscheidung (getestet): "now" | "batch" | "wait" | null.
// job: gespeicherter Stand ({ state: "pending" } oder { state: "failed", fails, failDate }) oder null.
function planAutoDecision({ daysLeft, job, todayKey }) {
  const urgent = daysLeft <= PLAN_BATCH_URGENT_DAYS;
  if (job && job.state === "pending") return urgent ? "now" : "wait";
  if (urgent) return "now";
  if (daysLeft > PLAN_BATCH_LEAD_DAYS) return null;
  const failedToday = job && job.state === "failed" && job.failDate === todayKey && (job.fails || 0) >= PLAN_BATCH_MAX_FAILS;
  return failedToday ? null : "batch";
}

function planBatchLoad() {
  const raw = typeof storeGet === "function" ? storeGet(PLAN_BATCH_KEY) : null;
  return raw && typeof raw === "object" ? raw : null;
}

function planBatchSave(job) {
  if (typeof storeSet === "function") storeSet(PLAN_BATCH_KEY, job || null);
}

// Für die Plan-Karten: Hinweis, solange ein Auftrag läuft (sonst null).
function planBatchStatusText(goalId) {
  const job = planBatchLoad();
  if (!job || job.state !== "pending" || (goalId && job.goalId !== goalId) || !Array.isArray(job.windowDates)) return null;
  const first = new Date(job.windowDates[0] + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
  return `Dein Plan ab ${first} wird gerade vorbereitet – als günstiger Sammelauftrag, meist in unter einer Stunde fertig.`;
}

function planBatchRerender() {
  if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof mScheduleRender === "function") mScheduleRender();
}

async function planBatchSubmit(goal, prev) {
  const windowDates = computePlanningWindow(goal.id);
  const todayKey = todayStr();
  try {
    const id = await submitClaudeBatch(buildTrainingPlanPrompt(goal, windowDates), { task: "planbatch", json: true });
    planBatchSave({ state: "pending", id, goalId: goal.id, windowDates, submittedAt: new Date().toISOString() });
  } catch (e) {
    const fails = prev && prev.state === "failed" && prev.failDate === todayKey ? (prev.fails || 0) + 1 : 1;
    planBatchSave({ state: "failed", goalId: goal.id, fails, failDate: todayKey, error: String((e && e.message) || e) });
  }
  planBatchRerender();
}

// Fertigen Auftrag abholen und einbauen. Gibt den neuen Stand zurück.
async function planBatchCollect(goal, job) {
  let r;
  try { r = await fetchClaudeBatch(job.id); } catch (e) { return job; } // Server/Internet gerade weg: später nochmal
  if (!r || r.status === "pending") return job;
  const todayKey = todayStr();
  if (r.status !== "done" || !r.text) {
    const failed = { state: "failed", goalId: goal.id, fails: 1, failDate: todayKey, error: r.error || "fehlgeschlagen" };
    planBatchSave(failed);
    return failed;
  }
  // Zuerst als erledigt markieren - so baut kein zweites Gerät denselben Plan ein.
  planBatchSave(null);
  // Noch passend? Hat inzwischen jemand diese Tage geplant (Knopf, anderes
  // Gerät), ist das Ergebnis überholt.
  const fresh = computePlanningWindow(goal.id);
  const dates = (job.windowDates || []).filter(d => d >= todayKey);
  if (!dates.length || (fresh[0] && fresh[0] > job.windowDates[0])) return null;
  await generateTrainingPlan(goal.id, { windowDates: dates, firstRaw: r.text });
  return null;
}

// Hauptlauf: beim Start, alle 10 Minuten solange ein Auftrag läuft und wenn
// die App wieder in den Vordergrund kommt.
async function runAutoPlan({ force = false } = {}) {
  if (planBatchBusy) return;
  if (!force && Date.now() - planBatchLastRun < PLAN_BATCH_MIN_POLL_MS) return;
  planBatchBusy = true;
  planBatchLastRun = Date.now();
  try {
    const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
    if (!goal || !goal.date || goal._planLoading) return;
    const todayKey = todayStr();
    if (goal.date < todayKey) return;
    // Ohne Trainingstage im Profil kann die KI nichts sinnvoll planen - dann
    // nicht automatisch fragen (der Knopf im Coach-Bereich bleibt nutzbar).
    if (!athleteProfile || !Array.isArray(athleteProfile.trainingDays) || !athleteProfile.trainingDays.length) return;
    if (typeof ensureClaudeStatus === "function") await ensureClaudeStatus();
    let job = planBatchLoad();
    if (job && job.goalId !== goal.id) { job = null; planBatchSave(null); } // Hauptziel gewechselt
    const claude = typeof claudeAvailable === "function" && claudeAvailable();
    if (!claude) {
      // Lokale KI kostet nichts - wie bisher sofort planen, wenn wenig übrig ist.
      if (shouldAutoReplan(goal)) await generateTrainingPlan(goal.id);
      return;
    }
    if (job && job.state === "pending") job = await planBatchCollect(goal, job);
    const daysLeft = planBatchDaysLeft(futurePlannedDatesForGoal(goal.id), todayKey);
    const decision = planAutoDecision({ daysLeft, job, todayKey });
    if (decision === "now") {
      planBatchSave(null); // ein evtl. noch laufender Auftrag ist damit überholt
      await generateTrainingPlan(goal.id);
    } else if (decision === "batch") {
      await planBatchSubmit(goal, job);
    }
  } catch (e) {
    console.warn("Automatischer Plan fehlgeschlagen:", e);
  } finally {
    planBatchBusy = false;
    const job = planBatchLoad();
    clearTimeout(planBatchTimer);
    if (job && job.state === "pending") planBatchTimer = setTimeout(() => runAutoPlan(), PLAN_BATCH_POLL_MS);
    planBatchRerender();
  }
}

function initAutoPlan() {
  runAutoPlan({ force: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") runAutoPlan();
  });
}
