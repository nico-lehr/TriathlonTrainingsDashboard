// Gruppe: Highlights, Emoji-Reaktionen und Challenges mit den anderen
// Nutzern dieses Dashboards (Server: backend/group.py, Seite: m-group.js).
//
// Geteilt werden nur Ergebnisse: neue Abzeichen (Trainingsanzahl, Serie,
// Bestzeit) und die Summe in Challenges, bei denen man mitmacht. Nie einzelne
// Trainings, Puls, Tempo-Verlauf, GPS oder Gesundheitswerte. Mitmachen ist
// freiwillig; erst ab dem Beitritt werden Abzeichen geteilt.

const GROUP_SHARED_KEY = "triathlon_dashboard_group_shared_v1"; // schon geteilte Abzeichen-IDs
const GROUP_REACTIONS = { fire: "🔥", muscle: "💪", clap: "👏", party: "🎉", wow: "🤩" };
const GROUP_REFRESH_MS = 30000;

const groupState = { data: null, loading: false, error: "", loadedAt: 0, sharing: false };

function groupJoined() {
  return !!(groupState.data && groupState.data.me && groupState.data.me.joined);
}

async function loadGroup(force) {
  if (groupState.loading) return;
  if (!force && groupState.data && Date.now() - groupState.loadedAt < GROUP_REFRESH_MS) return;
  groupState.loading = true;
  try {
    groupState.data = (await apiCall("group", "GET", null, { redirectOn401: false })).data;
    groupState.error = "";
  } catch (e) {
    groupState.error = e.message || String(e);
  } finally {
    groupState.loading = false;
    groupState.loadedAt = Date.now(); // auch nach einem Fehler erst in 30 s erneut (sonst Dauerschleife beim Zeichnen)
  }
  if (typeof mScheduleRender === "function") mScheduleRender();
  shareNewAchievements();
}

// Abzeichen-ID (js/analytics/achievements.js) -> was der Server annimmt.
function achievementToGroupItem(a) {
  let m = /^count_(\d+)$/.exec(a.id);
  if (m) return { type: "count", value: Number(m[1]) };
  m = /^streak_(\d+)$/.exec(a.id);
  if (m) return { type: "streak", value: Number(m[1]) };
  m = /^pb_(Laufen|Rad)_[a-z]+_(\d+)_(\d+)$/.exec(a.id);
  if (m) return { type: "pb", sport: m[1], meters: Number(m[2]), value: Math.round(Number(m[3])) };
  return null;
}

// Neue Abzeichen seit dem Beitritt (höchstens 7 Tage alt) einmal teilen.
// Doppelte verwirft auch der Server; die Liste hier spart nur Anfragen.
async function shareNewAchievements() {
  if (!groupJoined() || groupState.sharing || typeof achievementsState === "undefined") return;
  const since = new Date(groupState.data.me.joined_at).getTime();
  const weekAgo = Date.now() - 7 * 86400000;
  const shared = new Set(storeGet(GROUP_SHARED_KEY) || []);
  const fresh = achievementsState.unlocked.filter(a => {
    const at = new Date(a.achievedAt).getTime();
    return !shared.has(a.id) && at >= since - 60000 && at >= weekAgo;
  });
  const all = fresh.map(a => ({ a, item: achievementToGroupItem(a) })).filter(x => x.item);
  if (!all.length) return;
  // Kommen mehrere Stufen auf einmal (z. B. nach dem ersten Garmin-Abruf 10., 25.
  // und 50. Training), wird nur die höchste geteilt - die anderen gelten als erledigt.
  const best = {};
  all.forEach(x => {
    const k = x.item.type === "pb" ? `pb_${x.item.sport}_${x.item.meters}` : x.item.type;
    const better = x.item.type === "pb" ? !best[k] || x.item.value < best[k].item.value : !best[k] || x.item.value > best[k].item.value;
    if (better) best[k] = x;
  });
  const items = Object.values(best).slice(0, 20);
  groupState.sharing = true;
  try {
    const r = (await apiCall("group/highlights", "POST", { items: items.map(x => ({ ...x.item, achieved_at: x.a.achievedAt })) }, { redirectOn401: false })).data;
    all.forEach(x => shared.add(x.a.id));
    storeSet(GROUP_SHARED_KEY, [...shared].slice(-200));
    if (r && r.added) loadGroup(true);
  } catch (e) {
    /* nächstes Mal erneut versuchen */
  } finally {
    groupState.sharing = false;
  }
}

async function groupJoin(displayName) {
  await apiCall("group/me", "PUT", { display_name: displayName });
  // Bestehende Abzeichen gelten als schon geteilt - geteilt wird nur, was ab jetzt dazukommt.
  if (typeof achievementsState !== "undefined") {
    const shared = new Set(storeGet(GROUP_SHARED_KEY) || []);
    achievementsState.unlocked.forEach(a => shared.add(a.id));
    storeSet(GROUP_SHARED_KEY, [...shared].slice(-200));
  }
  await loadGroup(true);
}

async function groupLeave() {
  await apiCall("group/me", "DELETE");
  await loadGroup(true);
}

// Reaktion an/aus - sofort anzeigen, dann mit dem Stand vom Server abgleichen.
async function groupToggleReaction(highlightId, emoji) {
  const h = groupState.data && (groupState.data.highlights || []).find(x => x.id === highlightId);
  if (!h) return;
  const myName = groupState.data.me.display_name;
  const list = h.reactions.map(r => ({ ...r, names: [...r.names] }));
  const r = list.find(x => x.emoji === emoji);
  if (r && r.mine) { r.count--; r.mine = false; r.names = r.names.filter(n => n !== myName); }
  else if (r) { r.count++; r.mine = true; r.names.push(myName); }
  else list.push({ emoji, count: 1, mine: true, names: [myName] });
  const order = Object.keys(GROUP_REACTIONS);
  h.reactions = list.filter(x => x.count > 0).sort((a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji));
  if (typeof mScheduleRender === "function") mScheduleRender();
  try {
    h.reactions = (await apiCall(`group/highlights/${highlightId}/reactions`, "POST", { emoji })).data.reactions;
  } catch (e) {
    groupState.error = e.message || String(e);
    loadGroup(true);
  }
  if (typeof mScheduleRender === "function") mScheduleRender();
}

async function groupDeleteHighlight(id) {
  await apiCall(`group/highlights/${id}`, "DELETE");
  await loadGroup(true);
}

async function groupCreateChallenge(fields) {
  const r = await apiCall("group/challenges", "POST", fields);
  await loadGroup(true);
  return r.data;
}

async function groupJoinChallenge(id, join) {
  await apiCall(`group/challenges/${id}/join`, join ? "POST" : "DELETE");
  await loadGroup(true);
}

async function groupDeleteChallenge(id) {
  await apiCall(`group/challenges/${id}`, "DELETE");
  await loadGroup(true);
}

function initGroup() {
  loadGroup(true);
  // Zurück in die App: Stand auffrischen (z. B. neue Reaktionen).
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadGroup(); });
}
