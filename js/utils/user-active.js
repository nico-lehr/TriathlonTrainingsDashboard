// Ist gerade wirklich jemand da?
//
// Die App fragt die KI an drei Stellen von selbst (ohne Knopfdruck): den
// automatischen Wochenplan (js/ai/plan-batch.js), den täglichen Plan-Check
// (js/components/plan-check.js) und den Text im Morgenbericht
// (js/components/morning-report.js). Ein Tab, der tagelang offen
// herumliegt, soll dafür keine Tokens verbrauchen. Diese Stellen laufen
// deshalb nur, wenn die App sichtbar ist UND in den letzten
// USER_IDLE_MS jemand getippt, geklickt oder gescrollt hat. Kommt die
// Person zurück, holt onUserBack() alles sofort nach.
//
// Was man selbst anstößt (Knopf, Nachricht an den Coach), läuft immer -
// der Klick zählt ja als Benutzung.

const USER_IDLE_MS = 2 * 60 * 60 * 1000; // 2 Stunden ohne Benutzung = nicht aktiv

let userLastSeen = Date.now(); // Öffnen der App zählt als Benutzung
const userBackHandlers = [];

function userPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function userIsActive(now = Date.now()) {
  return userPageVisible() && now - userLastSeen < USER_IDLE_MS;
}

// fn läuft, sobald die Person nach einer Pause (Tab verdeckt oder länger
// nicht benutzt) wieder da ist.
function onUserBack(fn) {
  userBackHandlers.push(fn);
}

function noteUserActivity(now = Date.now()) {
  const wasAway = now - userLastSeen >= USER_IDLE_MS;
  userLastSeen = now;
  if (!wasAway || !userPageVisible()) return;
  userBackHandlers.forEach(fn => {
    try { fn(); } catch (e) { console.warn("onUserBack:", e); }
  });
}

if (typeof document !== "undefined" && document.addEventListener) {
  ["pointerdown", "keydown", "touchstart", "wheel", "scroll"].forEach(type =>
    document.addEventListener(type, () => noteUserActivity(), { capture: true, passive: true }));
  // Wieder sichtbar (App geöffnet, Tab gewechselt) = jemand schaut hin.
  // Die einzelnen Stellen hängen sich selbst an "visibilitychange"; hier
  // nur die, die sonst bis zum nächsten Stundentakt warten würden.
  let wasHidden = document.visibilityState === "hidden";
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { wasHidden = true; return; }
    const back = wasHidden || Date.now() - userLastSeen >= USER_IDLE_MS;
    wasHidden = false;
    userLastSeen = Date.now();
    if (back) userBackHandlers.forEach(fn => {
      try { fn(); } catch (e) { console.warn("onUserBack:", e); }
    });
  }, { capture: true });
}
