// Wettkampf-Formate: Distanz-Vorlagen je Sportart, Staffel (welche
// Teilstrecke(n) man selbst macht), Streckenart - und kleine Hilfen, die
// überall dieselbe Antwort geben: Welche Sportarten trainiert man für dieses
// Rennen, welche Teilstrecken gehören einem selbst? (Trainingsplan-Regeln,
// Rennplan-Tempo, Rennverpflegung und KI-Coach nutzen alle dieselben.)
//
// Gespeichert wird am Ziel (js/data/goals.js), alles optional:
//   format      Schlüssel der Vorlage, z.B. "olympic" oder "half" (null = eigene Distanz)
//   relay       true = Staffel (nur Triathlon)
//   relayLegs   eigene Teilstrecken bei der Staffel, z.B. ["run"]
//   terrain     Streckenart, z.B. "trail"
//   subDisciplines  wie bisher: je Teilstrecke Distanz + Zielzeit (bei der
//                   Staffel alle drei Teilstrecken, auch die der anderen)

const RACE_LEGS = {
  swim: { label: "Schwimmen", sport: "Schwimmen" },
  bike: { label: "Rad", sport: "Rad" },
  run: { label: "Laufen", sport: "Laufen" },
};
const RACE_LEG_ORDER = ["swim", "bike", "run"];
const RACE_LEG_BY_SPORT = { Schwimmen: "swim", Rad: "bike", Laufen: "run" };

// Triathlon: Distanzen je Teilstrecke; sonst eine Gesamtdistanz (null = frei).
const RACE_FORMATS = {
  Triathlon: [
    { key: "supersprint", label: "Supersprint", legs: { swim: 0.4, bike: 10, run: 2.5 } },
    { key: "sprint", label: "Sprint", legs: { swim: 0.75, bike: 20, run: 5 } },
    { key: "olympic", label: "Olympisch", legs: { swim: 1.5, bike: 40, run: 10 } },
    { key: "middle", label: "Mitteldistanz (70.3)", legs: { swim: 1.9, bike: 90, run: 21.1 } },
    { key: "long", label: "Langdistanz", legs: { swim: 3.8, bike: 180, run: 42.2 } },
  ],
  Laufen: [
    { key: "5k", label: "5 km", km: 5 },
    { key: "10k", label: "10 km", km: 10 },
    { key: "half", label: "Halbmarathon", km: 21.1 },
    { key: "marathon", label: "Marathon", km: 42.2 },
    { key: "ultra", label: "Ultra (länger als Marathon)", km: null },
  ],
  Rad: [
    { key: "tt", label: "Zeitfahren", km: null },
    { key: "granfondo", label: "Radmarathon / Jedermannrennen", km: null },
  ],
  Schwimmen: [
    { key: "1k", label: "1 km", km: 1 },
    { key: "1.5k", label: "1,5 km", km: 1.5 },
    { key: "3.8k", label: "3,8 km", km: 3.8 },
    { key: "5k", label: "5 km", km: 5 },
  ],
};

const RACE_TERRAINS = {
  Triathlon: [["road", "Straße"], ["cross", "Cross-Triathlon (Gelände)"]],
  Laufen: [["road", "Straße"], ["trail", "Trail / Gelände"], ["track", "Bahn"], ["cross", "Crosslauf"]],
  Rad: [["road", "Straße"], ["gravel", "Gravel"], ["mtb", "Mountainbike"]],
  Schwimmen: [["open", "Freiwasser"], ["pool", "Becken"]],
};

function raceFormatsFor(sport) {
  return RACE_FORMATS[sport] || [];
}

function raceFormatOf(goal) {
  if (!goal || !goal.format) return null;
  return raceFormatsFor(goal.sport).find(f => f.key === goal.format) || null;
}

function raceTerrainLabel(goal) {
  if (!goal || !goal.terrain) return null;
  const hit = (RACE_TERRAINS[goal.sport] || []).find(([k]) => k === goal.terrain);
  return hit ? hit[1] : null;
}

// Staffel: nur beim Triathlon und nur, wenn man nicht alle drei Teile selbst macht.
function goalIsRelay(goal) {
  return !!goal && goal.sport === "Triathlon" && !!goal.relay;
}

// Eigene Teilstrecken (swim/bike/run) - Staffel ohne Auswahl zählt wie alle drei.
function goalOwnLegKeys(goal) {
  if (!goal) return [];
  if (goal.sport === "Triathlon") {
    const mine = goalIsRelay(goal) && Array.isArray(goal.relayLegs)
      ? RACE_LEG_ORDER.filter(k => goal.relayLegs.includes(k)) : [];
    return mine.length ? mine : RACE_LEG_ORDER.slice();
  }
  return RACE_LEG_BY_SPORT[goal.sport] ? [RACE_LEG_BY_SPORT[goal.sport]] : [];
}

// Sportarten, für die man auf dieses Rennen hin trainiert.
function goalRaceSports(goal) {
  return goalOwnLegKeys(goal).map(k => RACE_LEGS[k].sport);
}

// Alle Teilstrecken mit Distanz/Zielzeit und ob man sie selbst macht.
// Triathlon: immer alle drei in der Reihenfolge Schwimmen/Rad/Laufen;
// sonst eine Teilstrecke aus Distanz + Zielzeit des Ziels.
function goalLegs(goal) {
  if (!goal) return [];
  const own = goalOwnLegKeys(goal);
  if (goal.sport === "Triathlon") {
    const subs = Array.isArray(goal.subDisciplines) ? goal.subDisciplines : [];
    return RACE_LEG_ORDER.map(key => {
      const s = subs.find(x => x && x.key === key) || {};
      return { key, label: RACE_LEGS[key].label, sport: RACE_LEGS[key].sport, distanceKm: s.distanceKm != null ? Number(s.distanceKm) : null, targetTime: s.targetTime || null, mine: own.includes(key) };
    });
  }
  const key = RACE_LEG_BY_SPORT[goal.sport];
  if (!key) return [];
  return [{ key, label: RACE_LEGS[key].label, sport: RACE_LEGS[key].sport, distanceKm: goal.distanceKm != null ? Number(goal.distanceKm) : null, targetTime: goal.targetTime || null, mine: true }];
}

function raceLegNames(keys) {
  const names = keys.map(k => RACE_LEGS[k].label);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}` : (names[0] || "");
}

// Kurze Merkmale des Rennens für Karten und KI, z.B.
// ["Olympisch", "Staffel – du machst: Laufen", "Trail / Gelände"].
function goalRaceBits(goal) {
  if (!goal) return [];
  const bits = [];
  const f = raceFormatOf(goal);
  if (f) bits.push(f.label);
  if (goalIsRelay(goal)) {
    const own = goalOwnLegKeys(goal);
    bits.push(own.length < 3 ? `Staffel – du machst: ${raceLegNames(own)}` : "Staffel");
  }
  const t = raceTerrainLabel(goal);
  if (t) bits.push(t);
  return bits;
}

// Formular-Werte → gespeicherte Felder eines Ziels (rein rechnerisch, kein
// DOM; js/components/goal-form.js liest das Formular). input:
//   { sport, format, relay, relayLegs, terrain, distanceKm, targetTime,
//     legs: { swim: { distanceKm, targetTime }, bike: {…}, run: {…} } }
// Triathlon: Gesamtdistanz = Summe der Teilstrecken (wenn alle drei da sind).
function goalRaceFields(input) {
  const sport = input.sport;
  const tri = sport === "Triathlon";
  const num = v => (v === "" || v == null || !(Number(v) > 0) ? null : Math.round(Number(v) * 1000) / 1000);
  const txt = v => (v == null ? "" : String(v)).trim() || null;
  const format = raceFormatsFor(sport).some(f => f.key === input.format) ? input.format : null;
  const terrain = (RACE_TERRAINS[sport] || []).some(([k]) => k === input.terrain) ? input.terrain : null;
  const relay = tri && !!input.relay;
  const relayLegs = relay ? RACE_LEG_ORDER.filter(k => (input.relayLegs || []).includes(k)) : null;
  let subDisciplines = null, distanceKm = num(input.distanceKm);
  if (tri) {
    const legs = input.legs || {};
    subDisciplines = RACE_LEG_ORDER.map(key => {
      const l = legs[key] || {};
      const d = num(l.distanceKm), t = txt(l.targetTime);
      return d == null && t == null ? null : { key, label: RACE_LEGS[key].label, distanceKm: d, targetTime: t };
    }).filter(Boolean);
    if (!subDisciplines.length) subDisciplines = null;
    const dists = RACE_LEG_ORDER.map(k => num((legs[k] || {}).distanceKm));
    distanceKm = dists.every(d => d != null) ? Math.round(dists.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  }
  return { format, relay, relayLegs: relayLegs && relayLegs.length ? relayLegs : null, terrain, distanceKm, targetTime: txt(input.targetTime), subDisciplines };
}
