// Globale Dashboard-Suche: durchsucht Titel + Untertext ALLER Kacheln in
// ALLEN Tabs (inkl. Einstellungen, siehe CHANGE_REQUESTS.md #1) - nicht nur
// im gerade aktiven Tab. Liegt der erste Treffer in einem anderen Tab, wird
// automatisch dorthin gesprungen (activateView(), app-shell.js), damit auch
// Einstellungen ohne manuelles Suchen im richtigen Tab auffindbar sind.

function initCardSearch() {
  const input = document.getElementById("card-search");
  const noMatchEl = document.getElementById("search-no-match");
  const wrap = document.getElementById("search-wrap");
  const iconBtn = document.getElementById("search-icon-btn");
  if (!input) return;

  // Minimiert auf die Lupe, solange nicht aktiv genutzt - klappt erst bei
  // Klick auf die Lupe zum Texteingabefeld auf (spart Platz in der Topnav).
  // Bleibt aufgeklappt, solange etwas eingetragen ist oder das Feld fokussiert
  // ist; klappt sonst beim Verlassen wieder ein.
  function expand() {
    if (!wrap) return;
    wrap.classList.add("expanded");
    input.focus();
  }
  function collapseIfEmpty() {
    if (!wrap || input.value.trim()) return;
    wrap.classList.remove("expanded");
  }
  if (iconBtn && wrap) {
    iconBtn.addEventListener("click", expand);
    input.addEventListener("blur", collapseIfEmpty);
  }

  function apply() {
    const query = input.value.trim().toLowerCase();
    const allCards = document.querySelectorAll(".card");
    allCards.forEach(card => card.classList.remove("card-search-match", "card-search-dim"));

    if (!query) { noMatchEl.style.display = "none"; return; }

    // Treffer über ALLE Views hinweg sammeln, gruppiert nach View - nicht
    // nur im gerade aktiven Tab (siehe CHANGE_REQUESTS.md #1).
    const matchesByView = new Map();
    allCards.forEach(card => {
      const title = card.querySelector("h2")?.textContent || "";
      const sub = card.querySelector(".card-sub")?.textContent || "";
      if (!(title + " " + sub).toLowerCase().includes(query)) return;
      const view = card.closest(".view");
      if (!view) return;
      if (!matchesByView.has(view.id)) matchesByView.set(view.id, []);
      matchesByView.get(view.id).push(card);
    });

    if (!matchesByView.size) {
      noMatchEl.textContent = "keine Treffer";
      noMatchEl.style.display = "inline";
      return;
    }

    // Treffer im gerade aktiven Tab bevorzugen; sonst zum ersten Tab mit
    // Treffern springen (inkl. Einstellungen - activateView() kennt "settings").
    const activeView = document.querySelector(".view.active");
    const targetViewId = (activeView && matchesByView.has(activeView.id)) ? activeView.id : [...matchesByView.keys()][0];
    if (!activeView || activeView.id !== targetViewId && typeof activateView === "function") {
      activateView(targetViewId.replace(/^view-/, ""));
    }

    const targetCards = matchesByView.get(targetViewId);
    document.querySelectorAll(`#${targetViewId} .card`).forEach(card => {
      card.classList.add(targetCards.includes(card) ? "card-search-match" : "card-search-dim");
    });

    const otherViews = matchesByView.size - 1;
    noMatchEl.textContent = otherViews > 0 ? `+ Treffer in ${otherViews} weiteren Bereich${otherViews > 1 ? "en" : ""}` : "";
    noMatchEl.style.display = noMatchEl.textContent ? "inline" : "none";

    targetCards[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  input.addEventListener("input", apply);
  // Beim Tab-/Settings-Wechsel die Filterung neu auf die jetzt sichtbaren Karten anwenden.
  document.querySelectorAll(".tab-btn, #global-settings-btn, #settings-back-btn").forEach(btn => btn.addEventListener("click", () => { if (input.value.trim()) apply(); }));
  // Escape leert das Suchfeld statt es nur zu verlassen.
  input.addEventListener("keydown", e => { if (e.key === "Escape") { input.value = ""; apply(); input.blur(); } });
}
