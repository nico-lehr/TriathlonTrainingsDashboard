// Kraft-Sammlung für Triathleten - gleiche Zeichen-Technik wie Mobility
// (fig -> js/components/mobility-figure.js). Fokus: Beine und Po (Rad, Laufen),
// Rumpf (Stabilität auf allen drei Strecken), Rücken und Schultern (Schwimmen).
//
// Felder wie in js/data/mobility-exercises.js, dazu:
//   group    Bewegungsmuster für eine ausgewogene Einheit: knee | hinge | push | pull | core | extra
//   sets     Sätze, reps: Wiederholungen je Satz (Text, z. B. "8 je Seite"), hold: Sekunden (statt reps)
//   rest     Pause zwischen den Sätzen (Sekunden)
//   weight   true: mit Gewicht (das Dashboard merkt sich das zuletzt genutzte)
//   startKg  Vorschlag beim ersten Mal (Kurzhantel je Hand bzw. gesamt)

const STRENGTH_AREAS = {
  legs: "Beine",
  glute: "Po & Hüfte",
  calf: "Waden",
  core: "Rumpf",
  back: "Rücken",
  shoulder: "Schultern",
  chest: "Brust & Arme",
};

const STRENGTH_GROUPS = ["knee", "hinge", "push", "pull", "core", "extra"];

const STRENGTH_EXERCISES = [
  {
    id: "goblet-kniebeuge", name: "Goblet-Kniebeuge", group: "knee",
    areas: ["legs", "glute"], equipment: ["dumbbells"], avoid: ["deepknee"], sports: ["Rad", "Laufen"],
    sets: 3, reps: "10", rest: 75, weight: true, startKg: 12, level: 2,
    steps: ["Eine Kurzhantel senkrecht vor der Brust halten, Füße schulterbreit.", "Po nach hinten-unten sinken lassen, bis die Oberschenkel waagrecht sind.", "Über die ganze Fußsohle kraftvoll hochdrücken."],
    feel: "Vorn im Oberschenkel und im Po.",
    mistakes: ["Knie fallen nach innen", "Fersen heben ab"],
    easier: "Ohne Gewicht oder nur bis zu einem Stuhl.",
    harder: "Unten 2 Sekunden halten.",
    video: "Goblet Squat Anleitung",
    fig: {
      frames: [
        { p: [0, -38.6], aNr: [9, 9], aFr: [10, 9] },
        { p: [-9, -21.5], t: 158, lN: [-1, -2], lF: [2, -2], aNr: [10, 7], aFr: [11, 7] },
      ],
      props: [{ type: "weight", at: "wristN", w: 4 }],
      move: 1.1, hold: 0.4, focus: ["pelvis-kneeN@0.5"],
    },
  },
  {
    id: "ausfallschritt", name: "Ausfallschritt rückwärts", group: "knee",
    areas: ["legs", "glute"], equipment: [], avoid: ["kneel"], sports: ["Laufen", "Rad"],
    sets: 3, reps: "8 je Seite", rest: 60, weight: true, startKg: 6, level: 2,
    steps: ["Aufrecht stehen, Hanteln locker an der Seite (oder ohne).", "Einen großen Schritt nach hinten, hinteres Knie sinkt Richtung Boden.", "Über das vordere Bein zurück nach oben drücken."],
    feel: "Im vorderen Oberschenkel und Po.",
    mistakes: ["Vorderes Knie kippt nach innen", "Oberkörper fällt nach vorn"],
    easier: "Kleinerer Schritt, mit einer Hand an der Wand.",
    harder: "Schwerere Hanteln oder Knie langsam absenken (3 Sekunden).",
    video: "Ausfallschritt rückwärts Anleitung",
    fig: {
      frames: [
        { p: [0, -38.6], lN: [-1, -2], lF: [2, -2], aNa: [-4, 0], aFa: [4, 0] },
        { p: [2, -21], t: 182, lN: [-17, -4], ftN: 40, lF: [20, -2], aNa: [-2, 0], aFa: [3, 0] },
      ],
      props: [{ type: "weight", at: "wristN", w: 4 }],
      move: 1.1, hold: 0.4, focus: ["pelvis-kneeF@0.5"],
    },
  },
  {
    id: "step-up", name: "Aufsteiger auf die Bank", group: "knee",
    areas: ["legs", "glute"], equipment: ["bench"], avoid: [], sports: ["Laufen", "Rad"],
    sets: 3, reps: "8 je Seite", rest: 60, weight: true, startKg: 6, level: 2,
    steps: ["Einen Fuß komplett auf eine stabile Bank oder Stufe stellen.", "Über dieses Bein hochdrücken, bis du gerade stehst.", "Langsam und kontrolliert wieder absteigen."],
    feel: "Im Oberschenkel und Po des oberen Beins.",
    mistakes: ["Mit dem unteren Bein abstoßen", "Knie kippt nach innen"],
    easier: "Niedrigere Stufe, ohne Gewicht.",
    harder: "Höhere Stufe oder schwerere Hanteln.",
    video: "Step Up Übung Anleitung",
    fig: {
      frames: [
        { p: [-2, -36], t: 172, lF: [12, -12], ftF: 90, lN: [-6, -2], aNa: [-4, 0], aFa: [4, 0] },
        { p: [10, -48.5], t: 180, lF: [12, -12], ftF: 90, lN: [8, -15], ftN: 70, aNa: [-4, 0], aFa: [4, 0] },
      ],
      props: [{ type: "block", x: 13, h: 10 }, { type: "weight", at: "wristN", w: 4 }],
      move: 1.2, hold: 0.4, focus: ["pelvis-kneeF@0.5"],
    },
  },
  {
    id: "rumaenisches-kreuzheben", name: "Rumänisches Kreuzheben", group: "hinge",
    areas: ["glute", "back"], equipment: ["dumbbells"], avoid: [], sports: ["Rad", "Laufen"],
    sets: 3, reps: "10", rest: 75, weight: true, startKg: 10, level: 2,
    steps: ["Hanteln vor den Oberschenkeln, Knie ganz leicht gebeugt.", "Po weit nach hinten schieben, Hanteln gleiten an den Beinen nach unten.", "Wenn es hinten spannt: Po anspannen und aufrichten."],
    feel: "Hinten im Oberschenkel und im Po.",
    mistakes: ["Runder Rücken", "Knie zu stark gebeugt (wird zur Kniebeuge)"],
    easier: "Leichteres Gewicht, nur bis Kniehöhe.",
    harder: "Einbeinig ausführen.",
    video: "Rumänisches Kreuzheben Kurzhantel",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [0, 0], aFa: [2, 2] },
        { p: [-7, -37.4], t: 122, h: 112, lN: [-1, -2], lF: [2, -2], aNa: [2, 0], aFa: [4, 2] },
      ],
      props: [{ type: "weight", at: "wristN", w: 4 }],
      move: 1.3, hold: 0.4, focus: ["pelvis-kneeN@0.4"],
    },
  },
  {
    id: "beckenheben-einbeinig", name: "Beckenheben einbeinig", group: "hinge",
    areas: ["glute", "core"], equipment: [], avoid: ["floor"], sports: ["Laufen", "Rad"],
    sets: 3, reps: "10 je Seite", rest: 45, weight: false, level: 2,
    steps: ["Auf den Rücken legen, ein Fuß aufgestellt, das andere Bein gestreckt in der Luft.", "Über die Ferse das Becken hochdrücken, bis Schulter, Hüfte und Knie eine Linie bilden.", "Oben kurz halten, langsam absenken."],
    feel: "Im Po des Standbeins.",
    mistakes: ["Becken kippt zur Seite", "Hohlkreuz statt Po-Spannung"],
    easier: "Beidbeinig.",
    harder: "Fuß auf eine Bank stellen.",
    video: "Single Leg Glute Bridge Anleitung",
    fig: {
      frames: [
        { p: [0, -2.5], t: 90, h: 90, lF: [-11.5, -2], lFb: -1, ftF: -90, lNa: [-118, -118], ftN: 150, aNa: [-92, -90], aFa: [-88, -90] },
        { p: [2, -13], t: 66.4, h: 80, lF: [-11.5, -2], lFb: -1, ftF: -90, lNa: [-108, -108], ftN: 160, aNa: [-96, -90], aFa: [-92, -90] },
      ],
      move: 1.0, hold: 0.7, focus: ["pelvis"],
    },
  },
  {
    id: "liegestuetz", name: "Liegestütz", group: "push",
    areas: ["chest", "shoulder", "core"], equipment: [], avoid: ["wrists"], sports: ["Schwimmen"],
    sets: 3, reps: "10", rest: 60, weight: false, level: 2,
    steps: ["Hände etwas breiter als die Schultern, Körper gerade wie ein Brett.", "Brust kontrolliert Richtung Boden senken, Ellbogen leicht nach hinten.", "Kraftvoll hochdrücken, ohne dass die Hüfte durchhängt."],
    feel: "Brust, Schultern und Rückseite der Arme.",
    mistakes: ["Hüfte hängt durch", "Kopf nach vorn gestreckt"],
    easier: "Auf den Knien oder mit den Händen auf einer Bank.",
    harder: "Füße auf eine Bank stellen.",
    video: "Liegestütz richtig",
    fig: {
      frames: [
        { p: [-0.2, -18.7], t: 112, h: 112, lN: [-36, -4], lF: [-35, -4], ftN: 30, ftF: 30, aN: [25, -2], aF: [26, -2] },
        { p: [0.8, -7.7], t: 96, h: 96, lN: [-36, -4], lF: [-35, -4], ftN: 30, ftF: 30, aN: [25, -2], aF: [26, -2], aNb: 1, aFb: 1 },
      ],
      move: 0.9, hold: 0.3, focus: ["shoulder"],
    },
  },
  {
    id: "schulterdruecken", name: "Schulterdrücken", group: "push",
    areas: ["shoulder"], equipment: ["dumbbells"], avoid: ["overhead"], sports: ["Schwimmen"],
    sets: 3, reps: "10", rest: 60, weight: true, startKg: 6, level: 2,
    steps: ["Aufrecht stehen, Hanteln auf Schulterhöhe.", "Über den Kopf drücken, bis die Arme gestreckt sind.", "Langsam zurück auf Schulterhöhe."],
    feel: "In den Schultern.",
    mistakes: ["Hohlkreuz", "Mit Schwung aus den Beinen"],
    easier: "Im Sitzen oder abwechselnd einarmig.",
    harder: "Unten kurz pausieren.",
    video: "Schulterdrücken Kurzhantel stehend",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [28, 172], aFa: [32, 174] },
        { p: [0, -38.6], aNa: [178, 180], aFa: [176, 178] },
      ],
      props: [{ type: "weight", at: "wristN", w: 4 }],
      move: 1.0, hold: 0.3, focus: ["shoulder"],
    },
  },
  {
    id: "rudern-vorgebeugt", name: "Rudern vorgebeugt", group: "pull",
    areas: ["back", "shoulder"], equipment: ["dumbbells"], avoid: [], sports: ["Schwimmen"],
    sets: 3, reps: "10", rest: 60, weight: true, startKg: 10, level: 2,
    steps: ["Oberkörper mit geradem Rücken nach vorn neigen, Hanteln hängen lassen.", "Ellbogen nah am Körper nach hinten-oben ziehen.", "Schulterblätter zusammen, dann langsam ablassen."],
    feel: "Zwischen den Schulterblättern und im breiten Rücken.",
    mistakes: ["Runder Rücken", "Mit Schwung ziehen"],
    easier: "Einarmig, mit einer Hand auf einer Bank abgestützt.",
    harder: "Oben 2 Sekunden halten.",
    video: "Kurzhantel Rudern vorgebeugt",
    fig: {
      frames: [
        { p: [-7, -37.4], t: 122, h: 112, lN: [-1, -2], lF: [2, -2], aNa: [2, 0], aFa: [4, 2] },
        { p: [-7, -37.4], t: 122, h: 112, lN: [-1, -2], lF: [2, -2], aNa: [-112, 2], aFa: [-108, 4] },
      ],
      props: [{ type: "weight", at: "wristN", w: 4 }],
      move: 0.9, hold: 0.35, focus: ["shoulder"],
    },
  },
  {
    id: "zugseil", name: "Schwimm-Zug mit Band", group: "pull",
    areas: ["back", "shoulder"], equipment: ["band", "wall"], avoid: [], sports: ["Schwimmen"],
    sets: 3, reps: "15", rest: 45, weight: false, level: 1,
    steps: ["Band auf Kopfhöhe am Türrahmen befestigen, Oberkörper leicht vorneigen.", "Mit hohem Ellbogen ziehen – wie unter Wasser – bis zur Hüfte.", "Langsam zurück nach vorn."],
    feel: "Im breiten Rücken und hinten in den Schultern.",
    mistakes: ["Ellbogen fällt nach unten", "Nur aus den Händen ziehen"],
    easier: "Leichteres Band, weiter zur Tür.",
    harder: "Stärkeres Band oder einarmig.",
    video: "Zugseil Training Schwimmen Band",
    fig: {
      frames: [
        { p: [0, -37.5], t: 128, h: 118, lN: [-1, -2], lF: [2, -2], aNa: [128, 128], aFa: [126, 126] },
        { p: [0, -37.5], t: 128, h: 118, lN: [-1, -2], lF: [2, -2], aNa: [-8, -20], aFa: [-6, -18] },
      ],
      props: [{ type: "band", from: "wristN", to: [52, -46] }, { type: "wall", x: 53 }],
      move: 0.9, hold: 0.25, focus: ["shoulder"],
    },
  },
  {
    id: "face-pull", name: "Face Pull mit Band", group: "pull",
    areas: ["shoulder", "back"], equipment: ["band", "wall"], avoid: [], sports: ["Schwimmen", "Rad"],
    sets: 3, reps: "15", rest: 45, weight: false, level: 1,
    steps: ["Band auf Gesichtshöhe befestigen, Arme gestreckt nach vorn.", "Zum Gesicht ziehen, Ellbogen hoch und weit nach außen.", "Kurz halten, langsam zurück."],
    feel: "Hinten in den Schultern – schützt die Schulter beim Schwimmen.",
    mistakes: ["Ellbogen zu tief", "Hohlkreuz"],
    easier: "Leichteres Band.",
    harder: "Am Ende Hände nach oben drehen (wie Ergeben).",
    video: "Face Pull Band Anleitung",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [94, 94], aFa: [92, 92] },
        { p: [0, -38.6], aNa: [-80, 120], aFa: [-78, 122] },
      ],
      props: [{ type: "band", from: "wristN", to: [46, -63] }, { type: "wall", x: 47 }],
      move: 0.9, hold: 0.4, focus: ["shoulder"],
    },
  },
  {
    id: "latzug-band", name: "Latzug mit Band", group: "pull",
    areas: ["back", "shoulder"], equipment: ["band"], avoid: ["overhead"], sports: ["Schwimmen"],
    sets: 3, reps: "12", rest: 45, weight: false, level: 1,
    steps: ["Band oben befestigen (Tür, Stange) und mit gestreckten Armen greifen.", "Ellbogen nach unten zur Seite ziehen, Brust raus.", "Langsam zurück nach oben."],
    feel: "Im breiten Rücken unter den Achseln.",
    mistakes: ["Schultern zu den Ohren", "Mit Schwung"],
    easier: "Im Knien, leichteres Band.",
    harder: "Echte Klimmzüge an der Stange.",
    video: "Latzug mit Widerstandsband",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [172, 176], aFa: [170, 174] },
        { p: [0, -38.6], aNa: [-12, 170], aFa: [-10, 168] },
      ],
      props: [{ type: "band", from: "wristN", to: [4, -92] }],
      move: 1.0, hold: 0.3, focus: ["shoulder"],
    },
  },
  {
    id: "unterarmstuetz", name: "Unterarmstütz", group: "core",
    areas: ["core"], equipment: [], avoid: ["prone"], sports: ["Schwimmen", "Rad", "Laufen"],
    sets: 3, hold: 40, rest: 45, weight: false, level: 1,
    steps: ["Unterarme unter den Schultern, Beine gestreckt auf den Zehen.", "Bauch und Po fest, Körper gerade wie ein Brett.", "Ruhig weiteratmen und halten."],
    feel: "Im ganzen Rumpf.",
    mistakes: ["Hüfte hängt durch", "Po zu hoch"],
    easier: "Auf den Knien.",
    harder: "Abwechselnd ein Bein anheben.",
    video: "Unterarmstütz Plank richtig",
    fig: {
      frames: [
        { p: [0, -10.5], t: 100, h: 100, lN: [-36, -4], lF: [-35, -4], ftN: 30, ftF: 30, aNa: [0, 90], aFa: [2, 90] },
        { p: [0, -11.5], t: 98, h: 100, lN: [-36, -4], lF: [-35, -4], ftN: 30, ftF: 30, aNa: [0, 90], aFa: [2, 90] },
      ],
      move: 1.6, hold: 1.2, focus: ["pelvis-shoulder@0.4"],
    },
  },
  {
    id: "dead-bug", name: "Dead Bug", group: "core",
    areas: ["core"], equipment: [], avoid: ["floor"], sports: ["Laufen", "Schwimmen"],
    sets: 3, reps: "8 je Seite", rest: 40, weight: false, level: 1,
    steps: ["Auf den Rücken, Arme zur Decke, Knie über der Hüfte gebeugt.", "Gegengleich einen Arm nach hinten und ein Bein nach vorn strecken.", "Unterer Rücken bleibt am Boden – dann Seite wechseln."],
    feel: "Tief im Bauch.",
    mistakes: ["Hohlkreuz", "Zu schnell"],
    easier: "Nur die Beine bewegen.",
    harder: "Kleine Hantel in den Händen.",
    video: "Dead Bug Übung Anleitung",
    fig: {
      frames: [
        { p: [0, -2.5], t: 90, h: 90, lNa: [-180, -90], lFa: [-178, -88], ftN: -90, ftF: -90, aNa: [180, 180], aFa: [178, 178] },
        { p: [0, -2.5], t: 90, h: 90, lNa: [-100, -96], lFa: [-178, -88], ftN: 180, ftF: -90, aNa: [180, 180], aFa: [94, 94] },
      ],
      move: 1.1, hold: 0.5, focus: ["pelvis-shoulder@0.4"],
    },
  },
  {
    id: "vogel-hund", name: "Vogel-Hund", group: "core",
    areas: ["core", "back"], equipment: [], avoid: ["kneel", "wrists"], sports: ["Laufen", "Rad"],
    sets: 3, reps: "8 je Seite", rest: 40, weight: false, level: 1,
    steps: ["Vierfüßlerstand, Rücken gerade.", "Gegengleich einen Arm nach vorn und ein Bein nach hinten strecken.", "Kurz halten, ohne dass das Becken kippt – Seite wechseln."],
    feel: "Rumpf, Po und unterer Rücken.",
    mistakes: ["Becken dreht auf", "Bein zu hoch (Hohlkreuz)"],
    easier: "Nur Arm oder nur Bein.",
    harder: "Ellbogen und Knie unter dem Bauch zusammenführen.",
    video: "Bird Dog Übung richtig",
    fig: {
      frames: [
        { p: [0, -21], t: 108, lN: [-18, -2], lF: [-17, -2], ftN: -90, ftF: -90, aN: [24.5, -2], aF: [25.5, -2] },
        { p: [0, -21], t: 104, lNa: [-92, -92], ftN: -100, lF: [-17, -2], ftF: -90, aF: [25.5, -2], aNa: [96, 96] },
      ],
      move: 1.1, hold: 0.7, focus: ["pelvis-shoulder@0.5"],
    },
  },
  {
    id: "wadenheben", name: "Wadenheben", group: "extra",
    areas: ["calf"], equipment: [], avoid: [], sports: ["Laufen"],
    sets: 3, reps: "15", rest: 45, weight: true, startKg: 10, level: 1,
    steps: ["Aufrecht stehen, eventuell mit einer Hand an der Wand.", "Langsam auf die Zehenspitzen hochdrücken.", "Oben kurz halten, langsam absenken."],
    feel: "In den Waden – schützt die Achillessehne beim Laufen.",
    mistakes: ["Zu schnell", "Nach außen kippen"],
    easier: "Ohne Gewicht.",
    harder: "Einbeinig auf einer Stufe.",
    video: "Wadenheben Anleitung",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [-4, 0], aFa: [4, 0] },
        { p: [1, -42.4], lN: [0, -6.5], lF: [3, -6.5], ftN: 40, ftF: 40, aNa: [-4, 0], aFa: [4, 0] },
      ],
      props: [{ type: "weight", at: "wristN", w: 4 }],
      move: 0.8, hold: 0.5, focus: ["kneeN-ankleN@0.5"],
    },
  },
];

const STRENGTH_BY_ID = Object.fromEntries(STRENGTH_EXERCISES.map(e => [e.id, e]));

function strengthAmount(ex, x) {
  const reps = x && x.reps ? x.reps : ex.reps;
  const hold = x && x.hold ? x.hold : ex.hold;
  return hold ? `${hold} s` : `${reps}`;
}
