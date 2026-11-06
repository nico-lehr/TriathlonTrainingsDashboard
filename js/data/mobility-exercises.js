// Übungs-Sammlung für Mobility (Beweglichkeit) - abgestimmt auf Triathlon:
// Hüfte und Beine fürs Rad und Laufen, Schultern und oberer Rücken fürs
// Schwimmen. Jede Übung hat eine bewegte Zeichnung (fig, siehe
// js/components/mobility-figure.js), einfache Schritte und Varianten.
//
// Felder:
//   areas      Körperbereiche (MOBILITY_AREAS)
//   equipment  nötige Hilfsmittel (MOBILITY_EQUIPMENT) - leer = nur Boden/Matte
//   avoid      Belastungen, die jemand im Trainingsprofil ausschließen kann (MOBILITY_AVOID)
//   kind       "hold" = halten, "reps" = Wiederholungen
//   seconds    Dauer je Seite (bei "reps" grob für die Wiederholungen)
//   reps       Anzahl je Seite (nur "reps"), sides: je Seite einzeln?
//   level      1 sanft · 2 mittel · 3 fordernd
//   sports     wofür sie besonders hilft (Schwimmen/Rad/Laufen)

const MOBILITY_AREAS = {
  hip: "Hüfte & Leiste",
  glute: "Gesäß",
  hamstring: "Oberschenkel hinten",
  quad: "Oberschenkel vorn",
  calf: "Waden & Sprunggelenk",
  lowback: "Unterer Rücken",
  upperback: "Oberer Rücken",
  shoulder: "Schultern & Brust",
};

const MOBILITY_EQUIPMENT = {
  wall: "Wand / Türrahmen",
  roller: "Faszienrolle",
  band: "Widerstandsband",
  strap: "Gurt oder Handtuch",
  block: "Yoga-Block oder dickes Buch",
};

const MOBILITY_AVOID = {
  kneel: "Knien",
  wrists: "Stützen auf den Händen",
  deepknee: "Tiefe Kniebeuge",
  overhead: "Arme über den Kopf",
  prone: "Bauchlage",
  floor: "Hinlegen auf den Boden",
};

const MOBILITY_LEVELS = { 1: "Sanft", 2: "Mittel", 3: "Fordernd" };

// Grundhaltungen für die Zeichnungen (siehe mobility-figure.js).
const QUAD = { p: [0, -21], t: 108, lN: [-18, -2], lF: [-17, -2], ftN: -90, ftF: -90, aN: [24.5, -2], aF: [25.5, -2] };
const SUPINE = { p: [0, -2.5], t: 90, h: 90, lN: [-14, -2], lF: [-15, -2], lNb: -1, lFb: -1, ftN: -90, ftF: -90, aNa: [-92, -90], aFa: [-88, -90] };

const MOBILITY_EXERCISES = [
  // ---------------------------------------------------------------- Hüfte
  {
    id: "hueftbeuger-kniend", name: "Hüftbeuger kniend",
    areas: ["hip", "quad"], equipment: [], avoid: ["kneel"], sports: ["Rad", "Laufen"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Ein Knie auf die Matte, den anderen Fuß vorn aufstellen.", "Becken leicht einrollen, als würdest du den Bauchnabel zum Kinn ziehen.", "Hüfte langsam nach vorn schieben, Arme nach oben strecken."],
    feel: "Vorn an der Hüfte und im Oberschenkel des hinteren Beins.",
    mistakes: ["Hohlkreuz statt eingerolltem Becken", "Vorderes Knie schiebt weit über die Zehen"],
    easier: "Hände auf dem vorderen Knie lassen, Kissen unter das hintere Knie.",
    harder: "Hinteren Fuß an eine Wand oder aufs Sofa legen (Couch-Stretch).",
    video: "Hüftbeuger Dehnung kniend Anleitung",
    fig: {
      frames: [
        { p: [0, -20], t: 180, lN: [-24, -2], ftN: -90, lF: [19, -2], aNr: [4, 24], aFr: [6, 23] },
        { p: [5, -17.6], t: 184, lN: [-24, -2], ftN: -90, lF: [19, -2], aNa: [178, 180], aFa: [174, 178] },
      ],
      focus: ["pelvis"],
    },
  },
  {
    id: "hueftbeuger-stehend", name: "Hüftbeuger im Stehen",
    areas: ["hip", "quad"], equipment: [], avoid: [], sports: ["Rad", "Laufen"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Großer Schritt nach vorn, hintere Ferse darf sich heben.", "Becken einrollen und den Po anspannen.", "Hüfte sanft nach vorn schieben, Arme nach oben."],
    feel: "Vorn an der Hüfte des hinteren Beins.",
    mistakes: ["Oberkörper kippt nach vorn", "Hohlkreuz"],
    easier: "Schritt kürzer machen, Hände an die Hüfte.",
    harder: "Oberkörper leicht zur Seite des vorderen Beins neigen.",
    video: "Hüftbeuger dehnen im Stehen Ausfallschritt",
    fig: {
      frames: [
        { p: [0, -36.6], lN: [-15, -2], ftN: 70, lF: [15, -2], aNr: [3, 24], aFr: [5, 23] },
        { p: [3, -33.6], t: 184, lN: [-15, -2], ftN: 70, lF: [15, -2], aNa: [178, 180], aFa: [174, 178] },
      ],
      focus: ["pelvis"],
    },
  },
  {
    id: "couch-stretch", name: "Couch-Stretch",
    areas: ["quad", "hip"], equipment: ["wall"], avoid: ["kneel", "deepknee"], sports: ["Rad", "Laufen"],
    kind: "hold", seconds: 45, sides: true, level: 3,
    steps: ["Mit dem Rücken zur Wand knien, ein Schienbein an der Wand hochstellen.", "Den anderen Fuß vorn aufstellen, Hände aufs vordere Knie.", "Langsam aufrichten und den Po anspannen."],
    feel: "Kräftig vorn im Oberschenkel und an der Hüfte des hinteren Beins.",
    mistakes: ["Zu schnell aufrichten", "Hohlkreuz statt Po-Spannung"],
    easier: "Knie weiter von der Wand weg, Oberkörper nach vorn gelehnt lassen.",
    harder: "Ganz aufrichten und die Arme nach oben strecken.",
    video: "Couch Stretch Anleitung Deutsch",
    fig: {
      frames: [
        { p: [4, -17.5], t: 158, lN: [-7, -20], ftN: 180, lF: [21, -2], aN: [19, -19], aF: [20, -19] },
        { p: [4, -17.5], t: 178, lN: [-7, -20], ftN: 180, lF: [21, -2], aNr: [3, 22], aFr: [5, 22] },
      ],
      props: [{ type: "wall", x: -9.5 }],
      focus: ["pelvis-kneeN@0.5"],
    },
  },
  {
    id: "taube", name: "Taube",
    areas: ["glute", "hip"], equipment: [], avoid: ["deepknee"], sports: ["Laufen", "Rad"],
    kind: "hold", seconds: 45, sides: true, level: 2,
    steps: ["Aus dem Vierfüßlerstand ein Knie nach vorn zwischen die Hände holen.", "Das andere Bein lang nach hinten ausstrecken.", "Becken gerade halten und den Oberkörper langsam nach vorn ablegen."],
    feel: "Tief im Gesäß des vorderen Beins.",
    mistakes: ["Becken kippt zur Seite", "Schmerz im vorderen Knie – dann sofort lösen"],
    easier: "Ein Kissen unter das Gesäß legen oder die liegende Vier machen.",
    harder: "Vorderes Schienbein weiter quer zur Matte stellen.",
    video: "Taube Yoga Dehnung Gesäß Anleitung",
    fig: {
      frames: [
        { p: [0, -9], t: 178, lN: [-36, -3], ftN: -95, lF: [0, -2.5], ftF: -90, aN: [7, -4], aF: [8, -4] },
        { p: [0, -9], t: 118, h: 110, lN: [-36, -3], ftN: -95, lF: [0, -2.5], ftF: -90, aN: [34, -3], aF: [35, -3] },
      ],
      focus: ["pelvis"],
    },
  },
  {
    id: "liegende-vier", name: "Liegende Vier",
    areas: ["glute", "hip"], equipment: [], avoid: ["floor"], sports: ["Laufen", "Rad"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Auf den Rücken legen, beide Füße aufstellen.", "Einen Knöchel aufs andere Knie legen – wie eine 4.", "Das untere Bein mit beiden Händen sanft zur Brust ziehen."],
    feel: "Im Gesäß des überkreuzten Beins.",
    mistakes: ["Kopf und Schultern heben sich", "Zu stark ziehen"],
    easier: "Unteren Fuß am Boden lassen und nur das Knie leicht wegdrücken.",
    harder: "Mit dem Ellbogen das obere Knie sanft wegschieben.",
    video: "Liegende Vier Dehnung Gesäß Piriformis",
    fig: {
      frames: [
        { ...SUPINE, lF: [-12, -2], lN: [-6, -21], lNb: -1, ftN: 150, aNa: [-92, -90] },
        { ...SUPINE, lF: [-4, -26], lN: [4, -26], lNb: -1, ftN: 150, ftF: 180, aN: [3, -16], aF: [4, -16] },
      ],
      focus: ["pelvis"],
    },
  },
  {
    id: "beinpendel", name: "Beinpendel",
    areas: ["hip", "hamstring"], equipment: ["wall"], avoid: [], sports: ["Laufen"],
    kind: "reps", reps: 12, seconds: 25, sides: true, level: 1,
    steps: ["Seitlich oder vor eine Wand stellen und mit einer Hand abstützen.", "Ein Bein locker vor und zurück schwingen.", "Den Schwung langsam größer werden lassen, Oberkörper bleibt ruhig."],
    feel: "Hüfte und Beinrückseite werden warm und locker.",
    mistakes: ["Oberkörper schwingt mit", "Zu viel Schwung am Anfang"],
    easier: "Kleiner schwingen.",
    harder: "Danach seitlich vor dem Körper schwingen.",
    video: "Beinpendel Leg Swings Aufwärmen Laufen",
    fig: {
      frames: [
        { p: [0, -38.6], lNa: [-32, -26], ftN: 60, lF: [1, -2], aN: [17, -47], aFr: [4, 24] },
        { p: [0, -38.6], lNa: [62, 54], ftN: 140, lF: [1, -2], aN: [17, -47], aFr: [4, 24] },
      ],
      props: [{ type: "wall", x: 19 }],
      move: 0.75, hold: 0.05,
      focus: ["pelvis"],
    },
  },
  {
    id: "tiefe-hocke", name: "Tiefe Hocke",
    areas: ["hip", "calf", "lowback"], equipment: [], avoid: ["deepknee"], sports: ["Laufen", "Rad"],
    kind: "hold", seconds: 45, sides: false, level: 2,
    steps: ["Füße etwas breiter als die Hüfte, Zehen leicht nach außen.", "Langsam ganz tief in die Hocke sinken, Fersen bleiben am Boden.", "Ellbogen drücken die Knie sanft nach außen, Brust bleibt offen."],
    feel: "In Hüfte, Leiste und Waden.",
    mistakes: ["Fersen heben ab", "Rücken rundet stark ein"],
    easier: "An einem Türrahmen festhalten oder Fersen auf ein Buch stellen.",
    harder: "In der Hocke abwechselnd einen Arm zur Decke drehen.",
    video: "tiefe Hocke Deep Squat halten Mobility",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [82, 84], aFa: [86, 88] },
        { p: [-6, -12.5], t: 160, lN: [-1, -2], lF: [2, -2], aNr: [9, 10], aFr: [10, 9] },
      ],
      focus: ["pelvis"],
    },
  },
  {
    id: "frosch", name: "Frosch",
    areas: ["hip"], equipment: [], avoid: ["kneel", "wrists"], sports: ["Rad", "Laufen"],
    kind: "reps", reps: 10, seconds: 40, sides: false, level: 2,
    steps: ["Vierfüßlerstand, Knie weit auseinander, Unterarme auf der Matte.", "Innenseiten der Füße liegen am Boden, Rücken lang.", "Becken langsam nach hinten schieben und wieder nach vorn."],
    feel: "Innen an den Oberschenkeln und in der Leiste.",
    mistakes: ["Knie zu weit auseinander – es darf nicht weh tun", "Hohlkreuz"],
    easier: "Knie näher zusammen, Decke unter die Knie.",
    harder: "Ganz nach hinten schieben und 5 Sekunden halten.",
    video: "Frosch Dehnung Adduktoren Mobility",
    fig: {
      frames: [
        { p: [0, -21], t: 98, lN: [-18, -2], lF: [-17, -2], ftN: -90, ftF: -90, aN: [34, -2], aF: [35, -2] },
        { p: [-7, -19.7], t: 94, lN: [-18, -2], lF: [-17, -2], ftN: -90, ftF: -90, aN: [34, -2], aF: [35, -2] },
      ],
      move: 1.4, hold: 0.5,
      focus: ["pelvis"],
    },
  },
  {
    id: "beckenheben", name: "Beckenheben",
    areas: ["glute", "hip", "lowback"], equipment: [], avoid: ["floor"], sports: ["Laufen", "Rad"],
    kind: "reps", reps: 12, seconds: 40, sides: false, level: 1,
    steps: ["Auf den Rücken legen, Füße hüftbreit aufstellen.", "Po anspannen und das Becken heben, bis Knie, Hüfte und Schultern eine Linie bilden.", "Oben kurz halten, langsam wieder absenken."],
    feel: "Im Po – vorn an der Hüfte öffnet es sich.",
    mistakes: ["Hohlkreuz statt Po-Spannung", "Knie fallen nach innen"],
    easier: "Nicht ganz so hoch heben.",
    harder: "Ein Bein in der Luft halten (einbeinig).",
    video: "Beckenheben Glute Bridge richtig",
    fig: {
      frames: [
        { ...SUPINE, lN: [-11.5, -2], lF: [-12.5, -2] },
        { ...SUPINE, p: [2, -13], t: 66.4, h: 80, lN: [-11.5, -2], lF: [-12.5, -2], aNa: [-96, -90], aFa: [-92, -90] },
      ],
      move: 1.1, hold: 0.8,
      focus: ["pelvis"],
    },
  },
  {
    id: "weltbeste-dehnung", name: "Weltbeste Dehnung",
    areas: ["hip", "upperback", "hamstring"], equipment: [], avoid: ["wrists"], sports: ["Laufen", "Rad", "Schwimmen"],
    kind: "reps", reps: 5, seconds: 45, sides: true, level: 2,
    steps: ["Großer Ausfallschritt, beide Hände innen neben dem vorderen Fuß.", "Hinteres Bein lang, Hüfte tief.", "Den inneren Arm weit zur Decke drehen, dem Blick folgen – dann zurück."],
    feel: "Hüfte, Beinrückseite und mittlerer Rücken auf einmal.",
    mistakes: ["Hüfte sinkt nicht ab", "Drehung kommt nur aus dem Arm statt aus dem Brustkorb"],
    easier: "Hinteres Knie auf der Matte ablegen.",
    harder: "Nach der Drehung das vordere Bein strecken.",
    video: "World's Greatest Stretch Anleitung Deutsch",
    fig: {
      frames: [
        { p: [0, -21], t: 92, lN: [-31, -3], ftN: 60, lF: [18, -2], aN: [23, -2], aF: [24, -2] },
        { p: [0, -21], t: 98, h: 135, lN: [-31, -3], ftN: 60, lF: [18, -2], aNa: [182, 182], aF: [24, -2] },
      ],
      focus: ["pelvis", "shoulder"],
    },
  },
  // ------------------------------------------------------ Beinrückseite
  {
    id: "beinrueckseite-liegend", name: "Beinrückseite liegend",
    areas: ["hamstring"], equipment: [], avoid: ["floor"], sports: ["Laufen", "Rad"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Auf den Rücken legen, ein Bein lang am Boden.", "Gurt, Handtuch oder Band um den anderen Fuß legen.", "Das Bein gestreckt langsam nach oben ziehen, bis es spannt."],
    feel: "Hinten im Oberschenkel, manchmal bis in die Wade.",
    mistakes: ["Unteres Bein hebt sich", "Mit Schwung ziehen"],
    easier: "Knie leicht gebeugt lassen oder mit den Händen hinter dem Oberschenkel halten.",
    harder: "Fußspitze zu dir ziehen.",
    video: "Oberschenkelrückseite dehnen liegend Handtuch",
    fig: {
      frames: [
        { ...SUPINE, lFa: [-90, -90], ftF: 180, lNa: [-145, -145], ftN: 125, aN: [16, -13], aF: [17, -13] },
        { ...SUPINE, lFa: [-90, -90], ftF: 180, lNa: [-172, -172], ftN: 98, aN: [14, -17], aF: [15, -17] },
      ],
      props: [{ type: "band", from: "wristN", to: "ankleN-toeN@0.6" }],
      focus: ["pelvis-kneeN@0.5"],
    },
  },
  {
    id: "vorbeuge-stehend", name: "Abrollen im Stehen",
    areas: ["hamstring", "lowback"], equipment: [], avoid: [], sports: ["Laufen", "Rad"],
    kind: "reps", reps: 6, seconds: 45, sides: false, level: 1,
    steps: ["Hüftbreit stehen, Knie ganz leicht gebeugt.", "Kinn zur Brust und Wirbel für Wirbel nach unten abrollen.", "Unten kurz hängen lassen, dann langsam wieder aufrollen."],
    feel: "Rückseite der Beine und entlang des Rückens.",
    mistakes: ["Knie durchgestreckt", "Mit Schwung nach unten"],
    easier: "Knie deutlich beugen, Hände auf die Oberschenkel.",
    harder: "Unten die Hände flach auf den Boden legen.",
    video: "Abrollen im Stehen Wirbelsäule Mobility",
    fig: {
      frames: [
        { p: [0, -38.6] },
        { p: [-5, -36.2], t: 55, tb: 0.7, h: 30, aN: [10, -8], aF: [11, -8] },
      ],
      move: 1.8, hold: 0.9,
      focus: ["pelvis-kneeN@0.5"],
    },
  },
  {
    id: "beinrueckseite-kniend", name: "Beinrückseite kniend",
    areas: ["hamstring", "calf"], equipment: [], avoid: ["kneel"], sports: ["Laufen"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Ein Knie auf die Matte, das andere Bein vorn ausstrecken.", "Ferse vorn am Boden, Zehen zeigen nach oben.", "Po nach hinten schieben, Rücken lang, Oberkörper nach vorn neigen."],
    feel: "Hinten im vorderen Oberschenkel und in der Wade.",
    mistakes: ["Rücken rundet stark", "Vorderes Knie durchgedrückt"],
    easier: "Vorderes Knie leicht beugen, Hände auf Bücher stellen.",
    harder: "Fußspitze aktiv zu dir ziehen.",
    video: "Hamstring Dehnung halb kniend Anleitung",
    fig: {
      frames: [
        { p: [0, -20], t: 180, lF: [-24, -2], ftF: -90, lN: [19, -2], aNr: [4, 24], aFr: [6, 23] },
        { p: [-6, -21], t: 138, lF: [-24, -2], ftF: -90, lN: [30, -3], ftN: 165, aN: [16, -2], aF: [17, -2] },
      ],
      focus: ["pelvis-kneeN@0.5"],
    },
  },
  // ------------------------------------------------- Waden & Sprunggelenk
  {
    id: "wade-wand", name: "Wade an der Wand",
    areas: ["calf"], equipment: ["wall"], avoid: [], sports: ["Laufen"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Hände an die Wand, ein Bein weit nach hinten.", "Hintere Ferse fest am Boden, Bein gestreckt.", "Hüfte langsam Richtung Wand schieben."],
    feel: "Oben in der Wade des hinteren Beins.",
    mistakes: ["Ferse hebt ab", "Fuß zeigt nach außen"],
    easier: "Hinteren Fuß näher an die Wand.",
    harder: "Fußballen vorn auf ein Buch stellen.",
    video: "Wade dehnen an der Wand Läufer",
    fig: {
      frames: [
        { p: [0, -37], t: 175, lN: [-16, -2], ftN: 88, lF: [8, -2], aN: [24, -50], aF: [25, -50] },
        { p: [4, -34.4], t: 160, lN: [-16, -2], ftN: 88, lF: [8, -2], aN: [24, -47], aF: [25, -47] },
      ],
      props: [{ type: "wall", x: 26 }],
      focus: ["kneeN-ankleN@0.35"],
    },
  },
  {
    id: "wade-tief", name: "Tiefe Wade",
    areas: ["calf"], equipment: ["wall"], avoid: [], sports: ["Laufen"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Wie bei der Wade an der Wand, aber kleiner Schritt.", "Hinteres Knie beugen, Ferse bleibt am Boden.", "Knie Richtung Wand schieben."],
    feel: "Tief unten in der Wade, nahe der Achillessehne.",
    mistakes: ["Ferse hebt ab", "Zu weit gebeugt"],
    easier: "Weniger tief beugen.",
    harder: "Mehr Gewicht aufs hintere Bein.",
    video: "Soleus Dehnung Wand Achillessehne",
    fig: {
      frames: [
        { p: [0, -36.4], t: 176, lN: [-10, -2], lF: [8, -2], aN: [24, -50], aF: [25, -50] },
        { p: [2, -30], t: 168, lN: [-10, -2], lF: [8, -2], aN: [24, -45], aF: [25, -45] },
      ],
      props: [{ type: "wall", x: 26 }],
      focus: ["kneeN-ankleN@0.65"],
    },
  },
  {
    id: "knie-zur-wand", name: "Knie zur Wand",
    areas: ["calf"], equipment: ["wall"], avoid: [], sports: ["Laufen"],
    kind: "reps", reps: 10, seconds: 35, sides: true, level: 1,
    steps: ["Vor eine Wand stellen, vorderer Fuß eine Handbreit entfernt.", "Knie nach vorn zur Wand schieben, Ferse bleibt unten.", "Kurz antippen, zurück – mit der Zeit Fuß weiter weg."],
    feel: "Vorn im Sprunggelenk und in der Wade.",
    mistakes: ["Ferse hebt ab", "Knie kippt nach innen"],
    easier: "Fuß näher an die Wand.",
    harder: "Fuß weiter weg stellen.",
    video: "Knee to Wall Test Sprunggelenk Mobility",
    fig: {
      frames: [
        { p: [0, -35], t: 178, lN: [14, -2], lF: [-14, -2], aN: [25, -48], aF: [26, -48] },
        { p: [6, -31], t: 174, lN: [14, -2], lF: [-14, -2], aN: [25, -46], aF: [26, -46] },
      ],
      props: [{ type: "wall", x: 27 }],
      move: 1.1, hold: 0.5,
      focus: ["ankleN"],
    },
  },
  {
    id: "wade-rollen", name: "Wade ausrollen",
    areas: ["calf"], equipment: ["roller"], avoid: ["wrists", "floor"], sports: ["Laufen"],
    kind: "hold", seconds: 45, sides: true, level: 1,
    steps: ["Setzen, Rolle unter eine Wade, Hände hinter dem Körper.", "Po etwas anheben.", "Langsam vom Knie bis zur Ferse rollen, auf festen Stellen kurz bleiben."],
    feel: "Druck in der Wade – unangenehm ist okay, stechend nicht.",
    mistakes: ["Zu schnell rollen", "Über die Kniekehle rollen"],
    easier: "Po am Boden lassen.",
    harder: "Anderes Bein obendrauf legen.",
    video: "Wade ausrollen Faszienrolle richtig",
    fig: {
      frames: [
        { p: [0, -9], t: 200, lN: [36, -10.5], ftN: 160, lF: [14, -2], ftF: 90, aN: [-16, -2], aF: [-15, -2] },
        { p: [-10, -9], t: 200, lN: [26, -10.5], ftN: 160, lF: [4, -2], ftF: 90, aN: [-26, -2], aF: [-25, -2] },
      ],
      props: [{ type: "roller", x: 22 }],
      move: 1.8, hold: 0.3,
      focus: ["kneeN-ankleN@0.5"],
    },
  },
  {
    id: "herabschauender-hund", name: "Herabschauender Hund",
    areas: ["calf", "hamstring", "shoulder"], equipment: [], avoid: ["wrists", "overhead"], sports: ["Laufen", "Schwimmen"],
    kind: "hold", seconds: 45, sides: false, level: 2,
    steps: ["Aus dem Vierfüßlerstand die Knie heben und den Po nach oben schieben.", "Arme lang, Kopf zwischen den Armen.", "Abwechselnd ein Knie beugen und die andere Ferse sinken lassen."],
    feel: "Waden, Beinrückseite und Schultern.",
    mistakes: ["Runder Rücken – dann Knie beugen", "Schultern zu den Ohren"],
    easier: "Knie deutlich gebeugt lassen.",
    harder: "Beide Fersen zum Boden, 5 ruhige Atemzüge halten.",
    video: "Herabschauender Hund richtig Anfänger",
    fig: {
      frames: [
        { p: [0, -33], t: 50, h: 34, lN: [-17, -2], lF: [-16, -2], ftN: 80, ftF: 80, aN: [42.5, -2], aF: [43.5, -2] },
        { p: [0, -33], t: 50, h: 34, lN: [-14, -7], ftN: 40, lF: [-16, -2], ftF: 80, aN: [42.5, -2], aF: [43.5, -2] },
      ],
      move: 1, hold: 0.8,
      focus: ["kneeF-ankleF@0.5"],
    },
  },
  // ----------------------------------------------------- Oberschenkel vorn
  {
    id: "oberschenkel-stehend", name: "Oberschenkel vorn im Stehen",
    areas: ["quad"], equipment: ["wall"], avoid: [], sports: ["Laufen", "Rad"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Mit einer Hand an der Wand abstützen.", "Den Fuß des anderen Beins greifen und die Ferse zum Po ziehen.", "Knie zeigt nach unten, Po leicht anspannen und Hüfte nach vorn."],
    feel: "Vorn im Oberschenkel.",
    mistakes: ["Knie wandert nach vorn oder zur Seite", "Hohlkreuz"],
    easier: "Hose oder ein Handtuch am Fuß greifen.",
    harder: "Ohne Wand balancieren.",
    video: "Oberschenkel vorne dehnen im Stehen richtig",
    fig: {
      frames: [
        { p: [0, -38.6], lNa: [2, -170], ftN: -80, lF: [1, -2], aN: [-3, -38], aF: [18, -50] },
        { p: [1, -38.6], lNa: [-12, -172], ftN: -80, lF: [1, -2], aN: [-6, -37], aF: [18, -50] },
      ],
      props: [{ type: "wall", x: 20 }],
      focus: ["pelvis-kneeN@0.5"],
    },
  },
  {
    id: "oberschenkel-rollen", name: "Oberschenkel vorn ausrollen",
    areas: ["quad", "hip"], equipment: ["roller"], avoid: ["prone", "floor"], sports: ["Rad", "Laufen"],
    kind: "hold", seconds: 45, sides: true, level: 2,
    steps: ["Auf die Unterarme stützen, Rolle unter die Oberschenkel.", "Körper bleibt gerade wie ein Brett.", "Langsam von der Hüfte bis kurz vor das Knie rollen."],
    feel: "Druck vorn im Oberschenkel.",
    mistakes: ["Hohlkreuz", "Über das Knie rollen"],
    easier: "Beide Beine gleichzeitig.",
    harder: "Nur ein Bein auf der Rolle.",
    video: "Oberschenkel vorne ausrollen Blackroll",
    fig: {
      frames: [
        { p: [0, -12], t: 97, h: 100, lN: [-36, -8], lF: [-35, -8], ftN: -20, ftF: -20, aNa: [2, 90], aFa: [4, 92] },
        { p: [11, -12], t: 97, h: 100, lN: [-25, -8], lF: [-24, -8], ftN: -20, ftF: -20, aNa: [2, 90], aFa: [4, 92] },
      ],
      props: [{ type: "roller", x: -6 }],
      move: 1.8, hold: 0.3,
      focus: ["pelvis-kneeN@0.5"],
    },
  },
  // --------------------------------------------------------- Unterer Rücken
  {
    id: "katze-kuh", name: "Katze-Kuh",
    areas: ["lowback", "upperback"], equipment: [], avoid: ["kneel", "wrists"], sports: ["Rad", "Schwimmen", "Laufen"],
    kind: "reps", reps: 8, seconds: 45, sides: false, level: 1,
    steps: ["Vierfüßlerstand: Hände unter den Schultern, Knie unter der Hüfte.", "Ausatmen: Rücken rund machen, Kinn zur Brust.", "Einatmen: Rücken sinken lassen, Blick nach vorn."],
    feel: "Die ganze Wirbelsäule bewegt sich weich.",
    mistakes: ["Nur den Kopf bewegen", "Zu schnell"],
    easier: "Kleinere Bewegung.",
    harder: "Jede Position 3 Atemzüge halten.",
    video: "Katze Kuh Übung richtig",
    fig: {
      frames: [
        { ...QUAD, tb: 1, h: 40 },
        { ...QUAD, tb: -0.9, h: 125 },
      ],
      move: 1.6, hold: 0.6,
      focus: ["pelvis-shoulder@0.5"],
    },
  },
  {
    id: "kindhaltung", name: "Kindhaltung",
    areas: ["lowback", "upperback", "shoulder"], equipment: [], avoid: ["kneel", "deepknee"], sports: ["Schwimmen", "Rad"],
    kind: "hold", seconds: 45, sides: false, level: 1,
    steps: ["Aus dem Vierfüßlerstand den Po zu den Fersen sinken lassen.", "Arme weit nach vorn auf die Matte legen.", "Stirn ablegen und ruhig in den Rücken atmen."],
    feel: "Unterer Rücken, Schultern und Seiten werden lang.",
    mistakes: ["Schultern zu den Ohren", "Luft anhalten"],
    easier: "Kissen zwischen Po und Fersen.",
    harder: "Mit beiden Händen etwas zur Seite wandern (Flanke dehnen).",
    video: "Kindhaltung Yoga richtig",
    fig: {
      frames: [
        { ...QUAD, lNa: [0, -90], lFa: [1, -90], lN: undefined, lF: undefined },
        { p: [-15.4, -13.2], t: 80, tb: 0.6, h: 68, lNa: [54, -90], lFa: [55, -90], ftN: -90, ftF: -90, aN: [36, -2], aF: [37, -2] },
      ],
      move: 1.8, hold: 1.4,
      focus: ["pelvis-shoulder@0.4"],
    },
  },
  {
    id: "knie-zur-brust", name: "Knie zur Brust",
    areas: ["lowback", "glute"], equipment: [], avoid: ["floor"], sports: ["Rad", "Laufen"],
    kind: "hold", seconds: 40, sides: false, level: 1,
    steps: ["Auf den Rücken legen.", "Beide Knie zur Brust ziehen und mit den Händen umfassen.", "Sanft hin und her schaukeln."],
    feel: "Unterer Rücken entspannt sich.",
    mistakes: ["Kopf hochziehen", "Zu stark ziehen"],
    easier: "Nur ein Knie, das andere Bein bleibt aufgestellt.",
    harder: "Kleine Kreise mit den Knien.",
    video: "Knie zur Brust Übung unterer Rücken",
    fig: {
      frames: [
        { ...SUPINE },
        { ...SUPINE, lNa: [-212, -60], lFa: [-210, -58], ftN: -150, ftF: -150, aN: [9, -17], aF: [10, -17] },
      ],
      focus: ["pelvis"],
    },
  },
  {
    id: "sphinx", name: "Sphinx",
    areas: ["lowback"], equipment: [], avoid: ["prone", "floor"], sports: ["Rad", "Schwimmen"],
    kind: "hold", seconds: 40, sides: false, level: 1,
    steps: ["Auf den Bauch legen.", "Ellbogen unter die Schultern, Unterarme nach vorn.", "Brust sanft heben, Schultern weg von den Ohren, Bauch locker."],
    feel: "Sanfte Streckung im unteren Rücken.",
    mistakes: ["Schultern hochziehen", "Schmerz im Rücken – dann flacher bleiben"],
    easier: "Ellbogen weiter vorn.",
    harder: "Langsam auf die Hände hochdrücken (Kobra).",
    video: "Sphinx Yoga Übung unterer Rücken",
    fig: {
      frames: [
        { p: [0, -2.5], t: 92, h: 96, lNa: [-90, -90], lFa: [-91, -90], ftN: -90, ftF: -90, aNa: [80, 92], aFa: [82, 92] },
        { p: [0, -2.5], t: 120, tb: -0.6, h: 108, lNa: [-90, -90], lFa: [-91, -90], ftN: -90, ftF: -90, aNa: [0, 90], aFa: [2, 90] },
      ],
      move: 1.6, hold: 1.4,
      focus: ["pelvis-shoulder@0.3"],
    },
  },
  // --------------------------------------------------------- Oberer Rücken
  {
    id: "vierfuessler-drehung", name: "Drehung im Vierfüßlerstand",
    areas: ["upperback", "shoulder"], equipment: [], avoid: ["kneel", "wrists"], sports: ["Schwimmen", "Rad"],
    kind: "reps", reps: 8, seconds: 40, sides: true, level: 1,
    steps: ["Vierfüßlerstand, eine Hand an den Hinterkopf.", "Ellbogen nach unten zur Stützhand drehen.", "Dann weit nach oben zur Decke aufdrehen, dem Ellbogen nachschauen."],
    feel: "Zwischen den Schulterblättern.",
    mistakes: ["Hüfte dreht mit", "Zu schnell"],
    easier: "Kleinere Drehung.",
    harder: "Po zu den Fersen schieben – dann dreht nur noch der Brustkorb.",
    video: "Thoracic Rotation Vierfüßlerstand Brustwirbelsäule",
    fig: {
      frames: [
        { ...QUAD, h: 30, aNa: [-20, 150] },
        { ...QUAD, t: 104, h: 150, aNa: [168, 110] },
      ],
      move: 1.4, hold: 0.6,
      focus: ["shoulder"],
    },
  },
  {
    id: "nadel-einfaedeln", name: "Nadel einfädeln",
    areas: ["upperback", "shoulder"], equipment: [], avoid: ["kneel", "wrists"], sports: ["Schwimmen"],
    kind: "reps", reps: 6, seconds: 45, sides: true, level: 1,
    steps: ["Vierfüßlerstand.", "Einen Arm weit zur Decke strecken und nachschauen.", "Dann den Arm unter dem Körper durchschieben, Schulter sinkt zur Matte."],
    feel: "Hinten in der Schulter und im oberen Rücken.",
    mistakes: ["Hüfte kippt zur Seite", "Gewicht auf den Nacken"],
    easier: "Arm nur bis zur Senkrechten heben.",
    harder: "Unten 3 Atemzüge halten.",
    video: "Thread the Needle Übung Schulter",
    fig: {
      frames: [
        { ...QUAD, t: 104, h: 150, aNa: [182, 182] },
        { ...QUAD, p: [0, -21], t: 100, h: 25, aNa: [-64, -84] },
      ],
      move: 1.5, hold: 0.7,
      focus: ["shoulder"],
    },
  },
  {
    id: "bws-rolle", name: "Oberer Rücken über der Rolle",
    areas: ["upperback"], equipment: ["roller"], avoid: ["floor"], sports: ["Schwimmen", "Rad"],
    kind: "reps", reps: 8, seconds: 45, sides: false, level: 1,
    steps: ["Rolle quer unter die Schulterblätter, Füße aufstellen.", "Hände hinter den Kopf, Ellbogen zusammen.", "Oberkörper langsam über die Rolle nach hinten sinken lassen und zurück."],
    feel: "Streckung im oberen Rücken.",
    mistakes: ["Über den unteren Rücken rollen", "Kopf nicht gestützt"],
    easier: "Nur ein kleines Stück sinken lassen.",
    harder: "Rolle eine Handbreit weiter wandern lassen und wiederholen.",
    video: "Brustwirbelsäule Faszienrolle Extension",
    fig: {
      frames: [
        { ...SUPINE, t: 108, h: 120, aN: [31, -16], aF: [32, -16], aNb: 1, aFb: 1 },
        { ...SUPINE, t: 104, tb: -0.7, h: 70, aN: [32, -11], aF: [33, -11], aNb: 1, aFb: 1 },
      ],
      props: [{ type: "roller", x: 21 }],
      move: 1.5, hold: 0.8,
      focus: ["shoulder"],
    },
  },
  {
    id: "wandrutschen", name: "Arme an der Wand hochschieben",
    areas: ["shoulder", "upperback"], equipment: ["wall"], avoid: ["overhead"], sports: ["Schwimmen"],
    kind: "reps", reps: 10, seconds: 40, sides: false, level: 1,
    steps: ["Vor die Wand stellen, Unterarme an die Wand, Ellbogen auf Schulterhöhe.", "Unterarme langsam nach oben schieben, bis die Arme lang sind.", "Schulterblätter nach unten ziehen und zurück."],
    feel: "Schultern und zwischen den Schulterblättern.",
    mistakes: ["Schultern zu den Ohren", "Hohlkreuz"],
    easier: "Nur bis Kopfhöhe schieben.",
    harder: "Oben die Arme kurz von der Wand lösen.",
    video: "Wall Slides Übung Schulter Mobility",
    fig: {
      frames: [
        { p: [0, -38.6], t: 178, aNa: [90, 180], aFa: [92, 180] },
        { p: [1, -38.6], t: 174, aNa: [156, 168], aFa: [158, 170] },
      ],
      props: [{ type: "wall", x: 16 }],
      move: 1.5, hold: 0.6,
      focus: ["shoulder"],
    },
  },
  // ------------------------------------------------------- Schultern & Brust
  {
    id: "brust-tuerrahmen", name: "Brust im Türrahmen",
    areas: ["shoulder"], equipment: ["wall"], avoid: [], sports: ["Schwimmen", "Rad"],
    kind: "hold", seconds: 40, sides: true, level: 1,
    steps: ["Unterarm an einen Türrahmen, Ellbogen auf Schulterhöhe.", "Einen kleinen Schritt nach vorn.", "Oberkörper sanft vom Arm wegdrehen."],
    feel: "Vorn in Brust und Schulter.",
    mistakes: ["Ellbogen zu hoch", "Kribbeln im Arm – dann tiefer gehen"],
    easier: "Ellbogen etwas tiefer.",
    harder: "Ellbogen etwas höher für den oberen Brustbereich.",
    video: "Brustmuskel dehnen Türrahmen",
    fig: {
      frames: [
        { p: [0, -38.4], t: 180, lN: [7, -2], lF: [-5, -2], aN: [-21, -77], aFr: [4, 24] },
        { p: [3, -38.2], t: 178, lN: [7, -2], lF: [-5, -2], aN: [-21, -77], aFr: [4, 24] },
      ],
      props: [{ type: "wall", x: -22.5 }],
      focus: ["shoulder"],
    },
  },
  {
    id: "schulter-band", name: "Schulterpassen mit Band",
    areas: ["shoulder", "upperback"], equipment: ["band"], avoid: ["overhead"], sports: ["Schwimmen"],
    kind: "reps", reps: 10, seconds: 40, sides: false, level: 2,
    steps: ["Band weit gefasst vor dem Körper halten, Arme gestreckt.", "Arme in einem großen Bogen über den Kopf nach hinten führen.", "Genauso wieder zurück nach vorn – Rumpf bleibt ruhig."],
    feel: "Vorn in den Schultern und in der Brust.",
    mistakes: ["Arme beugen", "Hohlkreuz beim Weg nach hinten"],
    easier: "Hände weiter auseinander greifen.",
    harder: "Hände etwas enger greifen.",
    video: "Schulter Mobilisation Band Pass Through",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [32, 32], aFa: [30, 30] },
        { p: [0, -38.6], aNa: [180, 180], aFa: [178, 178] },
        { p: [0, -38.6], aNa: [252, 252], aFa: [250, 250] },
      ],
      seq: [0, 1, 2, 1],
      move: 1.1, hold: 0.25,
      focus: ["shoulder"],
    },
  },
  {
    id: "lat-dehnung", name: "Breiter Rücken auf dem Block",
    areas: ["shoulder", "upperback"], equipment: [], avoid: ["kneel", "overhead"], sports: ["Schwimmen"],
    kind: "hold", seconds: 45, sides: false, level: 1,
    steps: ["Vor einen Block, ein Buch oder das Sofa knien.", "Ellbogen darauf ablegen, Hände zusammen.", "Po nach hinten schieben und die Brust sinken lassen."],
    feel: "Seitlich am Rücken und unter den Achseln – wichtig fürs Schwimmen.",
    mistakes: ["Hohlkreuz", "Kopf hochziehen"],
    easier: "Höhere Unterlage.",
    harder: "Hände zur Nackenrolle beugen.",
    video: "Latissimus Dehnung kniend Ellbogen Bank",
    fig: {
      frames: [
        { p: [-3, -21], t: 100, h: 98, lNa: [8, -90], lFa: [9, -90], ftN: -90, ftF: -90, aN: [33, -11], aF: [34, -11] },
        { p: [-12, -16], t: 88, tb: -0.4, h: 75, lNa: [40, -90], lFa: [41, -90], ftN: -90, ftF: -90, aN: [35, -11], aF: [36, -11] },
      ],
      props: [{ type: "block", x: 34, h: 8 }],
      move: 1.6, hold: 1.4,
      focus: ["shoulder"],
    },
  },
  {
    id: "armkreisen", name: "Armkreisen",
    areas: ["shoulder"], equipment: [], avoid: ["overhead"], sports: ["Schwimmen"],
    kind: "reps", reps: 10, seconds: 30, sides: false, level: 1,
    steps: ["Aufrecht stehen, Arme locker.", "Große, langsame Kreise rückwärts.", "Nach der Hälfte die Richtung wechseln."],
    feel: "Schultern werden warm – gut vor dem Schwimmen.",
    mistakes: ["Hohlkreuz", "Zu kleine Kreise"],
    easier: "Abwechselnd nur einen Arm.",
    harder: "Kreise noch größer und langsamer.",
    video: "Armkreisen Aufwärmen Schwimmen",
    fig: {
      frames: [
        { p: [0, -38.6], aNa: [0, 0], aFa: [-4, -4] },
        { p: [0, -38.6], aNa: [90, 90], aFa: [86, 86] },
        { p: [0, -38.6], aNa: [180, 180], aFa: [176, 176] },
        { p: [0, -38.6], aNa: [270, 270], aFa: [266, 266] },
        { p: [0, -38.6], aNa: [360, 360], aFa: [356, 356] },
      ],
      cycle: true, move: 0.55, hold: 0,
      focus: ["shoulder"],
    },
  },
  {
    id: "raupe", name: "Raupe",
    areas: ["hamstring", "shoulder", "calf"], equipment: [], avoid: ["wrists"], sports: ["Laufen", "Schwimmen"],
    kind: "reps", reps: 6, seconds: 50, sides: false, level: 2,
    steps: ["Aufrecht stehen, dann nach vorn beugen, Hände auf den Boden.", "Mit den Händen nach vorn laufen bis in den Liegestütz.", "Mit den Händen zurücklaufen und aufrichten."],
    feel: "Beinrückseite, Waden und Schultern.",
    mistakes: ["Hüfte hängt im Liegestütz durch", "Knie durchgedrückt beim Runterbeugen"],
    easier: "Knie beugen und nicht ganz bis in den Liegestütz.",
    harder: "Im Liegestütz einen Liegestütz einbauen.",
    video: "Inchworm Übung Anleitung",
    fig: {
      frames: [
        { p: [0, -38.6] },
        { p: [-5, -36.2], t: 62, tb: 0.6, h: 36, aN: [14, -2], aF: [15, -2] },
        { p: [35, -20], t: 110, h: 112, lN: [1, -5], lF: [2, -5], ftN: 60, ftF: 60, aN: [59, -2], aF: [60, -2] },
      ],
      seq: [0, 1, 2, 1],
      move: 1.3, hold: 0.5,
      focus: ["pelvis-kneeN@0.5"],
    },
  },
];

const MOBILITY_BY_ID = Object.fromEntries(MOBILITY_EXERCISES.map(e => [e.id, e]));

// Gesamtdauer einer Übung in Sekunden (beide Seiten + kurzer Wechsel).
function mobilityExerciseSeconds(ex, seconds) {
  const per = seconds || ex.seconds;
  return ex.sides ? per * 2 + 5 : per;
}

function mobilityVideoUrl(ex) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(ex.video || ex.name + " Übung Anleitung");
}
