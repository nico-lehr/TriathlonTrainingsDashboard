// UI für die "Erfolge"-Karte (Übersicht) + Feier-Toast beim Freischalten
// neuer Abzeichen. Erkennung/Speicherung passiert in js/analytics/achievements.js
// bzw. js/data/achievements.js - hier nur das Rendering.

const ACHIEVEMENT_BADGE_EMOJI = "🏅";

function renderAchievements() {
  const host = document.getElementById("achievements-body");
  if (!host) return;

  if (!achievementsState.unlocked.length) {
    host.innerHTML = `<p class="empty-note">Noch keine Erfolge freigeschaltet - absolviere Trainings und halte deinen Trainingsplan-Treue-Streak, um welche zu sammeln.</p>`;
    return;
  }

  const sorted = [...achievementsState.unlocked].sort((a, b) => new Date(b.achievedAt) - new Date(a.achievedAt));
  host.innerHTML = sorted.map((a, i) => `
    <div class="achievement-row" style="animation:fadeSlideUp 0.4s cubic-bezier(.16,1,.3,1) both; animation-delay:${i * 50}ms">
      <span class="achievement-badge">${ACHIEVEMENT_BADGE_EMOJI}</span>
      <span class="achievement-label">${escapeHtml(a.label)}</span>
      <span class="achievement-date">${fmtDate(new Date(a.achievedAt))}</span>
    </div>`).join("");

  markAchievementsSeen();
}

// Springt zum Rekorde-Tab und zur Erfolge-Karte, lässt sie kurz aufleuchten -
// damit man vom Toast (oder künftig einer echten Push-Benachrichtigung) aus
// direkt zu den Details findet, statt selbst suchen zu müssen.
function scrollToAchievementsCard() {
  const recordsTabBtn = document.querySelector('.tab-btn[data-view="records"]');
  if (recordsTabBtn) recordsTabBtn.click();
  const card = document.getElementById("achievements-card");
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.remove("card-pulse-highlight");
  // Reflow erzwingen, damit die Animation bei wiederholtem Klick erneut abspielt.
  void card.offsetWidth;
  card.classList.add("card-pulse-highlight");
}

let achievementToastTimer = null;

// Geburtstags-Nachricht (isTodayBirthday(), js/data/athlete.js) - höchstens
// einmal pro Tag gezeigt (localStorage-Flag mit dem heutigen Datum). Eigenes
// Toast-Element (#birthday-toast) statt #achievement-toast mitzubenutzen,
// damit sich beide Benachrichtigungen nicht gegenseitig überschreiben
// können, aber dieselbe Optik (.achievement-toast-Klasse) wie oben.
const BIRTHDAY_TOAST_SHOWN_KEY = "triathlon_dashboard_birthday_shown_v1";

function checkAndShowBirthdayMessage() {
  if (typeof isTodayBirthday !== "function" || !isTodayBirthday()) return;
  const todayKey = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(BIRTHDAY_TOAST_SHOWN_KEY) === todayKey) return;
  } catch (e) { /* localStorage evtl. deaktiviert - dann einfach jedes Mal zeigen */ }

  const toast = document.getElementById("birthday-toast");
  if (!toast) return;
  const namePart = athleteProfile.name ? `, ${escapeHtml(athleteProfile.name)}` : "";
  toast.innerHTML = `<span>🎂</span><span>Alles Gute zum Geburtstag${namePart}! Vielleicht heute mal ein lockerer statt ein harter Trainingstag.</span>`;
  toast.classList.add("show");

  try { localStorage.setItem(BIRTHDAY_TOAST_SHOWN_KEY, todayKey); } catch (e) { /* ignorieren */ }
}

// Zeigt einen kurzen Toast für die zuletzt neu freigeschalteten Erfolge
// (bei mehreren gleichzeitig: nacheinander, damit man jeden lesen kann).
// Klickbar: springt direkt zur Erfolge-Karte im Rekorde-Tab (siehe
// scrollToAchievementsCard oben) - macht den Toast zur echten Kurz-
// Benachrichtigung statt nur einer Info, die gleich wieder verschwindet.
function showAchievementToast(entries) {
  if (!entries || !entries.length) return;
  const toast = document.getElementById("achievement-toast");
  if (!toast) return;

  let i = 0;
  const showNext = () => {
    if (i >= entries.length) { toast.classList.remove("show"); return; }
    toast.innerHTML = `<span>${ACHIEVEMENT_BADGE_EMOJI}</span><span>${escapeHtml(entries[i].label)}</span><span class="achievement-toast-hint">ansehen →</span>`;
    toast.classList.add("show");
    i++;
    clearTimeout(achievementToastTimer);
    achievementToastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(showNext, 400);
    }, 3200);
  };
  showNext();

  toast.onclick = () => {
    clearTimeout(achievementToastTimer);
    toast.classList.remove("show");
    scrollToAchievementsCard();
  };
}
