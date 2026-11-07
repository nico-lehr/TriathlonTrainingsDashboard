// Bewegte Strichfigur für Mobility-Übungen (Seitenansicht, Blick nach rechts).
//
// Eine Übung beschreibt 2-3 Schlüssel-Haltungen (js/data/mobility-exercises.js,
// Feld "fig"); hier wird daraus ein Skelett mit festen Knochenlängen gerechnet
// und weich zwischen den Haltungen hin- und herbewegt. Keine Bilder, keine
// Bibliothek - reines SVG, funktioniert offline.
//
// Koordinaten: x nach rechts, y nach unten, Boden bei y = 0 (oben ist also
// negativ). Winkel in Grad, absolut: 0 = nach unten, 90 = nach vorn (rechts),
// 180 = nach oben, -90 = nach hinten.
//
// Haltung (alle Felder optional, fehlende kommen aus FIG_DEFAULT):
//   p: [x, y]       Becken
//   t: Winkel       Rumpf (Becken -> Schultern), tb: Rundung (+ = runder Rücken)
//   h: Winkel       Kopf (Standard: wie der Rumpf)
//   Gliedmaßen je Seite (N = vorn/nah, F = hinten/fern):
//   lN / lF: [x, y]   Knöchel-Ziel (Welt) - Knie per IK, lNr: relativ zum Becken, lNa: [Ober-, Unterschenkel]-Winkel
//   aN / aF: [x, y]   Hand-Ziel (Welt) - Ellbogen per IK, aNr: relativ zur Schulter, aNa: Winkel
//   lNb / aNb: Beugerichtung (+1 / -1), ftN / ftF: Fußwinkel

const FIG_BONES = { trunk: 26, neck: 4, head: 4.6, upper: 14, fore: 13, thigh: 19, shin: 18, foot: 6 };
const FIG_DEFAULT = {
  p: [0, -38.6], t: 180, tb: 0,
  lF: [2, -2], lN: [-1, -2], lFb: 1, lNb: 1, ftN: 90, ftF: 90,
  aNa: [-6, 2], aFa: [8, 12], aNb: -1, aFb: -1,
};
const FIG_VIEW = { w: 120, h: 100, floor: 93 };
const FIG_LIMBS = [
  ["l", "N"], ["l", "F"], ["a", "N"], ["a", "F"],
];

const rad = d => d * Math.PI / 180;
const dirVec = (deg, len) => [Math.sin(rad(deg)) * len, Math.cos(rad(deg)) * len];
const angleTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
const addV = (a, b) => [a[0] + b[0], a[1] + b[1]];

// Zwei-Knochen-IK: Gelenk (Knie/Ellbogen) so, dass das Ende das Ziel trifft.
function figSolveLimb(root, target, a, b, bend) {
  const dx = target[0] - root[0], dy = target[1] - root[1];
  const d = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, Math.hypot(dx, dy)));
  const phi = angleTo(root, target);
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const t1 = phi + (bend >= 0 ? 1 : -1) * Math.acos(cosA) * 180 / Math.PI;
  const mid = addV(root, dirVec(t1, a));
  const t2 = angleTo(mid, target);
  return [t1, t2];
}

// Welche Form hat eine Gliedmaße in dieser Haltung? "w" Welt-Ziel, "r" relativ, "a" Winkel.
function figLimbForm(pose, kind, side) {
  const k = kind + side;
  if (pose[k + "a"]) return "a";
  if (pose[k + "r"]) return "r";
  if (pose[k]) return "w";
  return null;
}

function figMerge(pose) {
  const out = { ...FIG_DEFAULT };
  FIG_LIMBS.forEach(([kind, side]) => {
    const k = kind + side;
    if (pose[k] || pose[k + "r"] || pose[k + "a"]) { delete out[k]; delete out[k + "r"]; delete out[k + "a"]; }
  });
  return { ...out, ...pose };
}

// Haltung -> Gelenkwinkel (für Gliedmaßen, deren Form in zwei Frames nicht passt).
function figLimbAngles(pose, kind, side, pelvis, shoulder) {
  const k = kind + side;
  const root = kind === "l" ? pelvis : shoulder;
  const [a, b] = kind === "l" ? [FIG_BONES.thigh, FIG_BONES.shin] : [FIG_BONES.upper, FIG_BONES.fore];
  const bend = pose[k + "b"] != null ? pose[k + "b"] : (kind === "l" ? 1 : -1);
  if (pose[k + "a"]) return pose[k + "a"];
  if (pose[k + "r"]) return figSolveLimb(root, addV(root, pose[k + "r"]), a, b, bend);
  return figSolveLimb(root, pose[k], a, b, bend);
}

function figLerp(x, y, t) {
  if (typeof x === "number" && typeof y === "number") return x + (y - x) * t;
  if (Array.isArray(x) && Array.isArray(y)) return x.map((v, i) => figLerp(v, y[i], t));
  return t < 0.5 ? x : y;
}

function figShoulder(pose) {
  return addV(pose.p, dirVec(pose.t, FIG_BONES.trunk));
}

// Zwei Haltungen mischen: gleiche Form -> Ziele mischen (Füße bleiben stehen),
// sonst die Gelenkwinkel.
function figBlend(A, B, t) {
  if (t <= 0) return A;
  if (t >= 1) return B;
  const out = {};
  ["p", "t", "tb", "h", "ftN", "ftF"].forEach(k => {
    const a = A[k] != null ? A[k] : (k === "h" ? A.t : undefined);
    const b = B[k] != null ? B[k] : (k === "h" ? B.t : undefined);
    if (a !== undefined && b !== undefined) out[k] = figLerp(a, b, t);
  });
  FIG_LIMBS.forEach(([kind, side]) => {
    const k = kind + side;
    out[k + "b"] = t < 0.5 ? A[k + "b"] : B[k + "b"];
    const fa = figLimbForm(A, kind, side), fb = figLimbForm(B, kind, side);
    if (fa && fa === fb) {
      const key = fa === "w" ? k : k + fa;
      out[key] = figLerp(A[key], B[key], t);
    } else {
      const angA = figLimbAngles(A, kind, side, A.p, figShoulder(A));
      const angB = figLimbAngles(B, kind, side, B.p, figShoulder(B));
      out[k + "a"] = figLerp(angA, angB, t);
    }
  });
  return out;
}

// Haltung -> alle Punkte des Skeletts.
function figPoints(pose) {
  const P = pose.p;
  const S = figShoulder(pose);
  const head = pose.h != null ? pose.h : pose.t;
  const neck = addV(S, dirVec(head, FIG_BONES.neck));
  const H = addV(neck, dirVec(head, FIG_BONES.head));
  const pts = { pelvis: P, shoulder: S, neck, head: H, tb: pose.tb || 0, trunkAngle: pose.t };
  FIG_LIMBS.forEach(([kind, side]) => {
    const [t1, t2] = figLimbAngles(pose, kind, side, P, S);
    const root = kind === "l" ? P : S;
    const [a, b] = kind === "l" ? [FIG_BONES.thigh, FIG_BONES.shin] : [FIG_BONES.upper, FIG_BONES.fore];
    const mid = addV(root, dirVec(t1, a));
    const end = addV(mid, dirVec(t2, b));
    if (kind === "l") {
      pts["knee" + side] = mid;
      pts["ankle" + side] = end;
      const ft = pose["ft" + side] != null ? pose["ft" + side] : 90;
      pts["toe" + side] = addV(end, dirVec(ft, FIG_BONES.foot));
    } else {
      pts["elbow" + side] = mid;
      pts["wrist" + side] = end;
    }
  });
  return pts;
}

// Benannter Punkt, auch Zwischenpunkte: "kneeN", "pelvis-kneeN@0.5".
function figPoint(pts, name) {
  const m = /^(\w+)-(\w+)@([\d.]+)$/.exec(name);
  if (m) {
    const a = pts[m[1]], b = pts[m[2]], t = Number(m[3]);
    return a && b ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : null;
  }
  return pts[name] || null;
}

function figTrunkPath(pts, tx) {
  const [px, py] = tx(pts.pelvis), [sx, sy] = tx(pts.shoulder);
  const bend = pts.tb * 7;
  const nx = Math.cos(rad(pts.trunkAngle)), ny = -Math.sin(rad(pts.trunkAngle));
  const cx = (px + sx) / 2 + nx * bend, cy = (py + sy) / 2 + ny * bend;
  return `M${px.toFixed(2)} ${py.toFixed(2)} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${sx.toFixed(2)} ${sy.toFixed(2)}`;
}

// Bereich aller Haltungen -> waagrechte Verschiebung, damit die Figur mittig steht.
function figOffsetX(frames) {
  let min = Infinity, max = -Infinity;
  frames.forEach(f => {
    for (let i = 0; i <= 4; i++) {
      const pts = figPoints(i === 0 ? f : figBlend(f, frames[(frames.indexOf(f) + 1) % frames.length], i / 4));
      Object.values(pts).forEach(v => { if (Array.isArray(v)) { min = Math.min(min, v[0]); max = Math.max(max, v[0]); } });
    }
  });
  return FIG_VIEW.w / 2 - (min + max) / 2;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

// Ablauf: Haltung 0 halten, zu 1 bewegen, halten, zurück. "seq" in fig
// erlaubt andere Reihenfolgen, "move"/"hold" die Zeiten (Sekunden).
function figTimeline(fig) {
  const seq = fig.seq || (fig.frames.length > 2 ? fig.frames.map((_, i) => i) : [0, 1]);
  const move = fig.move || 1.3, hold = fig.hold || 1.2;
  // cycle: eine Runde 0 -> 1 -> ... -> letzte, dann sprungfrei von vorn
  // (erste und letzte Haltung sehen gleich aus, z.B. Armkreisen 0° / 360°).
  const steps = fig.cycle
    ? seq.slice(0, -1).map((from, i) => ({ from, to: seq[i + 1] }))
    : seq.map((from, i) => ({ from, to: seq[(i + 1) % seq.length] }));
  const total = steps.length * (move + hold);
  return { steps, move, hold, total };
}

const easeInOut = t => 0.5 - Math.cos(Math.PI * t) / 2;

function figPoseAt(frames, tl, time) {
  const per = tl.move + tl.hold;
  const tt = ((time % tl.total) + tl.total) % tl.total;
  const step = tl.steps[Math.floor(tt / per)];
  const local = tt - Math.floor(tt / per) * per;
  if (local < tl.hold) return frames[step.from];
  return figBlend(frames[step.from], frames[step.to], easeInOut((local - tl.hold) / tl.move));
}

// Baut die Figur. options: { animate: true|false, keyFrame } - gibt das SVG zurück.
function createMobilityFigure(exercise, { animate = true, label = true } = {}) {
  const fig = exercise.fig;
  const frames = fig.frames.map(figMerge);
  const offX = figOffsetX(frames);
  const tx = ([x, y]) => [x + offX, y + FIG_VIEW.floor];

  const svg = svgEl("svg", { viewBox: `0 0 ${FIG_VIEW.w} ${FIG_VIEW.h}`, class: "mob-fig" });
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Zeichnung: ${exercise.name}`);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  svg.appendChild(svgEl("ellipse", { class: "mob-fig-shadow", cx: FIG_VIEW.w / 2, cy: FIG_VIEW.floor + 1.5, rx: 34, ry: 2.4 }));
  svg.appendChild(svgEl("line", { class: "mob-fig-floor", x1: 6, y1: FIG_VIEW.floor, x2: FIG_VIEW.w - 6, y2: FIG_VIEW.floor }));

  // Requisiten (statisch: Wand, Block; mitbewegt: Rolle, Band)
  const props = (fig.props || []).map(pr => {
    if (pr.type === "wall") {
      const x = pr.x + offX;
      svg.appendChild(svgEl("line", { class: "mob-fig-prop", x1: x, y1: 8, x2: x, y2: FIG_VIEW.floor }));
      return null;
    }
    if (pr.type === "block") {
      const [x] = tx([pr.x, 0]);
      const w = pr.w || 10;
      svg.appendChild(svgEl("rect", { class: "mob-fig-prop-fill", x: x - w / 2, y: FIG_VIEW.floor - (pr.h || 6), width: w, height: pr.h || 6, rx: 1.2 }));
      return null;
    }
    if (pr.type === "bench") { // Hantelbank: Polster (w breit, Oberkante h) auf einem Fuß
      const [x] = tx([pr.x, 0]);
      const w = pr.w || 30, h = pr.h || 12;
      svg.appendChild(svgEl("rect", { class: "mob-fig-prop-fill", x: x - w / 2, y: FIG_VIEW.floor - h, width: w, height: 3, rx: 1.2 }));
      svg.appendChild(svgEl("line", { class: "mob-fig-prop", x1: x, y1: FIG_VIEW.floor - h + 2, x2: x, y2: FIG_VIEW.floor }));
      return null;
    }
    if (pr.type === "line") { // feste Linie (Lehne, Schiene eines Geräts)
      const [x1, y1] = tx(pr.from), [x2, y2] = tx(pr.to);
      svg.appendChild(svgEl("line", { class: "mob-fig-prop", x1, y1, x2, y2 }));
      return null;
    }
    if (pr.type === "pulley") { // Kabelzug/Gerät: Rolle an festem Punkt
      const [x, y] = tx(pr.at);
      svg.appendChild(svgEl("line", { class: "mob-fig-prop", x1: x, y1: Math.min(y, 8), x2: x, y2: FIG_VIEW.floor }));
      svg.appendChild(svgEl("circle", { class: "mob-fig-prop-fill", r: 2.4, cx: x, cy: y }));
      return null;
    }
    if (pr.type === "bar") { // Klimmzugstange: kurzer fester Querbalken
      const [x, y] = tx(pr.at);
      svg.appendChild(svgEl("line", { class: "mob-fig-prop", x1: x - 9, y1: y, x2: x + 9, y2: y }));
      return null;
    }
    if (pr.type === "plate") { // Langhantel von der Seite: Hantelscheibe an einem Punkt
      const el = svgEl("circle", { class: "mob-fig-plate", r: pr.r || 6.5 });
      return { pr, el, late: true };
    }
    if (pr.type === "kettlebell") {
      const el = svgEl("circle", { class: "mob-fig-plate", r: 3.6 });
      return { pr, el, late: true };
    }
    if (pr.type === "roller" && pr.x != null) { // liegt fest, der Körper rollt darüber
      svg.appendChild(svgEl("circle", { class: "mob-fig-prop-fill", r: 5, cx: pr.x + offX, cy: FIG_VIEW.floor - 5 }));
      return null;
    }
    if (pr.type === "roller") {
      const el = svgEl("circle", { class: "mob-fig-prop-fill", r: 5 });
      svg.appendChild(el);
      return { pr, el };
    }
    if (pr.type === "band") {
      const el = svgEl("path", { class: "mob-fig-band" });
      return { pr, el, late: true };
    }
    if (pr.type === "weight") { // Kurzhantel/Gewicht an einer Hand (Kraftübungen)
      const el = svgEl("path", { class: "mob-fig-weight" });
      return { pr, el, late: true };
    }
    return null;
  }).filter(Boolean);

  const focus = (fig.focus || []).map(() => {
    const el = svgEl("circle", { class: "mob-fig-focus", r: 6.5 });
    svg.appendChild(el);
    return el;
  });

  const far = svgEl("g", { class: "mob-fig-far" });
  const near = svgEl("g", { class: "mob-fig-near" });
  const mk = (g, cls) => { const el = svgEl("path", { class: cls }); g.appendChild(el); return el; };
  const els = {
    armF: mk(far, "mob-fig-limb"), legF: mk(far, "mob-fig-limb"), footF: mk(far, "mob-fig-limb mob-fig-foot"),
    trunk: mk(near, "mob-fig-trunk"), neck: mk(near, "mob-fig-limb"),
    legN: mk(near, "mob-fig-limb"), footN: mk(near, "mob-fig-limb mob-fig-foot"), armN: mk(near, "mob-fig-limb"),
  };
  const headEl = svgEl("circle", { class: "mob-fig-head", r: FIG_BONES.head });
  near.insertBefore(headEl, els.legN);
  svg.appendChild(far);
  svg.appendChild(near);
  props.filter(p => p.late).forEach(p => svg.appendChild(p.el));

  const line = (...ps) => "M" + ps.map(p => tx(p).map(v => v.toFixed(2)).join(" ")).join(" L");

  function draw(pose) {
    const pts = figPoints(pose);
    els.trunk.setAttribute("d", figTrunkPath(pts, tx));
    els.neck.setAttribute("d", line(pts.shoulder, pts.neck));
    const [hx, hy] = tx(pts.head);
    headEl.setAttribute("cx", hx.toFixed(2));
    headEl.setAttribute("cy", hy.toFixed(2));
    ["N", "F"].forEach(s => {
      els["leg" + s].setAttribute("d", line(pts.pelvis, pts["knee" + s], pts["ankle" + s]));
      els["foot" + s].setAttribute("d", line(pts["ankle" + s], pts["toe" + s]));
      els["arm" + s].setAttribute("d", line(pts.shoulder, pts["elbow" + s], pts["wrist" + s]));
    });
    props.forEach(({ pr, el }) => {
      if (pr.type === "roller") {
        const at = figPoint(pts, pr.at);
        if (!at) return;
        const [x] = tx(at);
        el.setAttribute("cx", x.toFixed(2));
        el.setAttribute("cy", (FIG_VIEW.floor - 5).toFixed(2));
      } else if (pr.type === "band") {
        // "to" darf auch ein fester Punkt sein ([x, y], z. B. Band am Türrahmen)
        const a = figPoint(pts, pr.from), b = Array.isArray(pr.to) ? pr.to : figPoint(pts, pr.to);
        if (!a || !b) return;
        el.setAttribute("d", line(a, b));
      } else if (pr.type === "plate" || pr.type === "kettlebell") {
        const at = figPoint(pts, pr.at);
        if (!at) return;
        const [x, y] = tx(at);
        el.setAttribute("cx", x.toFixed(2));
        el.setAttribute("cy", (y + (pr.type === "kettlebell" ? 3.4 : 0)).toFixed(2));
      } else if (pr.type === "weight") {
        const at = figPoint(pts, pr.at);
        if (!at) return;
        const [x, y] = tx(at);
        const w = pr.w || 5;
        el.setAttribute("d", `M${(x - w).toFixed(2)} ${y.toFixed(2)} L${(x + w).toFixed(2)} ${y.toFixed(2)}`);
      }
    });
    (fig.focus || []).forEach((name, i) => {
      const at = figPoint(pts, name);
      if (!at) return;
      const [x, y] = tx(at);
      focus[i].setAttribute("cx", x.toFixed(2));
      focus[i].setAttribute("cy", y.toFixed(2));
    });
  }

  const keyFrame = fig.key != null ? fig.key : frames.length - 1;
  draw(frames[keyFrame]);
  if (animate && frames.length > 1) {
    const tl = figTimeline(fig);
    figAnimator.add(svg, time => draw(figPoseAt(frames, tl, time)));
  }
  return svg;
}

// Ein gemeinsamer Takt für alle sichtbaren Figuren. Unsichtbare (andere
// Ansicht, außerhalb des Bildschirms) und "Bewegung reduzieren" ruhen.
const figAnimator = (() => {
  const items = new Map(); // svg -> { draw, visible, start }
  let raf = null;
  const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const io = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => {
      entries.forEach(e => { const it = items.get(e.target); if (it) it.visible = e.isIntersecting; });
      kick();
    })
    : null;

  function tick(now) {
    raf = null;
    let any = false;
    items.forEach((it, svg) => {
      if (!svg.isConnected) { items.delete(svg); if (io) io.unobserve(svg); return; }
      if (!it.visible || it.paused) return;
      any = true;
      if (it.start == null) it.start = now;
      it.draw((now - it.start) / 1000);
    });
    if (any) raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (!raf && !reduce() && !document.hidden) raf = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", kick);
  return {
    add(svg, draw) {
      items.set(svg, { draw, visible: !io, start: null, paused: false });
      if (io) io.observe(svg);
      kick();
    },
    setPaused(svg, paused) {
      const it = items.get(svg);
      if (it) { it.paused = paused; kick(); }
    },
  };
})();
