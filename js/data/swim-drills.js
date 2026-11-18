// Technikübungen fürs Kraulschwimmen - die Sammlung, aus der der Coach für
// jede Schwimmeinheit konkrete Übungen wählt (js/analytics/swim-technique.js
// sucht passend zu deinen Uhrdaten aus, js/data/planned-workouts.js baut
// daraus die Schritte für die Uhr).
//
// Je Übung:
//   id        fester Schlüssel (steht am geplanten Training in `drills`)
//   name      Anzeigename
//   short     kurzer Name für die Uhr (erster Teil des Schritt-Hinweises)
//   focus     Schwerpunkte (SWIM_FOCUS) - der erste ist der Hauptzweck
//   level     1 = für alle, 2 = Kraul sitzt schon sicher, 3 = Fortgeschrittene
//   gear      nötige Hilfsmittel (SWIM_GEAR) - leer = ohne
//   kind      "drill" = 25 m Übung + 25 m Kraul zum Umsetzen
//             "kick"  = 50 m Beinschlag
//             "swim"  = 50 m Kraul mit einer Aufgabe
//   cue       Hinweis auf der Uhr zur Übung (kurz!)
//   swimCue   Hinweis auf der Uhr für die 25 m Kraul danach (nur "drill")
//   how       So geht's - 2-3 einfache Sätze für die App

const SWIM_FOCUS = {
  atmung: "Atmung",
  lage: "Wasserlage",
  gleiten: "Gleiten & Zuglänge",
  zug: "Wasser fassen",
  rotation: "Körperdrehung",
  rhythmus: "Rhythmus",
  beine: "Beinschlag",
  freiwasser: "Freiwasser",
};

// Ein Satz je Schwerpunkt für den Hauptsatz ("worauf achten, wenn's zügig wird").
const SWIM_FOCUS_CUE = {
  atmung: "ins Wasser ausatmen",
  lage: "Kopf ruhig, Hüfte hoch",
  gleiten: "lang machen, ruhig ziehen",
  zug: "Ellbogen hoch, Wasser festhalten",
  rotation: "aus der Hüfte drehen",
  rhythmus: "gleichmäßiger Takt",
  beine: "kleine, lockere Beinschläge",
  freiwasser: "alle 6 Züge nach vorn schauen",
};

const SWIM_GEAR = {
  board: "Schwimmbrett",
  pullbuoy: "Pullbuoy",
  fins: "Flossen",
  paddles: "Paddles",
  snorkel: "Frontschnorchel",
};

const SWIM_DRILLS = [
  {
    id: "torpedo", name: "Torpedo-Gleiten", short: "Torpedo", focus: ["lage", "gleiten"], level: 1, gear: [], kind: "drill",
    cue: "Arme lang, Kopf zwischen die Arme, gleiten",
    swimCue: "Kopf so ruhig lassen wie beim Gleiten",
    how: "Kräftig von der Wand abstoßen, Arme lang über dem Kopf, Hände übereinander, Blick zum Boden. Mit kleinen Beinschlägen gleiten, so weit es geht – dann Kraul bis zur Wand.",
  },
  {
    id: "seitlage", name: "Seitlage-Beinschlag", short: "Seitlage", focus: ["lage", "rotation", "atmung"], level: 1, gear: [], kind: "drill",
    cue: "Unterer Arm lang, Schulter zur Decke, Kopf ruhig",
    swimCue: "Bei jedem Zug ganz auf die Seite drehen",
    how: "Auf der Seite liegen: unterer Arm lang nach vorn, oberer Arm an der Seite, die Schulter zeigt zur Decke. Gesicht im Wasser, zum Atmen nur den Kopf drehen. Bei jeder Wiederholung die Seite wechseln.",
  },
  {
    id: "sechs-drei-sechs", name: "6-3-6 Seitenwechsel", short: "6-3-6", focus: ["rotation", "atmung", "lage"], level: 2, gear: [], kind: "drill",
    cue: "6 Beinschläge Seitlage, 3 Züge, Seite wechseln",
    swimCue: "Drehung aus der Hüfte mitnehmen",
    how: "6 Beinschläge in Seitlage, dann 3 Kraulzüge und dabei auf die andere Seite rollen, wieder 6 Beinschläge. Die Drehung kommt aus der Hüfte, nicht aus den Schultern.",
  },
  {
    id: "abschlag", name: "Abschlagschwimmen", short: "Abschlag", focus: ["gleiten", "zug"], level: 1, gear: [], kind: "drill",
    cue: "Hand wartet vorn, bis die andere sie berührt",
    swimCue: "Vorne kurz lang bleiben, dann ziehen",
    how: "Ein Arm bleibt vorne gestreckt liegen, bis die andere Hand nach ihrem Zug ihn berührt. Erst dann zieht er. So lernst du, vorne lang zu bleiben und jeden Zug auszunutzen.",
  },
  {
    id: "faust", name: "Faustschwimmen", short: "Faust", focus: ["zug"], level: 1, gear: [], kind: "drill",
    cue: "Fäuste machen, mit dem Unterarm ziehen",
    swimCue: "Hände auf – das Wasser fühlt sich dicker an",
    how: "Normal Kraul schwimmen, aber mit geballten Fäusten. Dann merkst du: Der Unterarm muss mitziehen. Auf der Bahn danach die Hände öffnen – das Wasser fühlt sich jetzt dicker an.",
  },
  {
    id: "einarmig", name: "Einarmig Kraul", short: "Einarmig", focus: ["zug", "rotation"], level: 2, gear: [], kind: "drill",
    cue: "Ein Arm vorn, der andere zieht bis zum Oberschenkel",
    swimCue: "Beide Arme ziehen so lang wie eben",
    how: "Ein Arm bleibt vorne gestreckt, der andere zieht – lang bis zum Oberschenkel. Zur Seite des ziehenden Arms atmen. Bei jeder Wiederholung den Arm wechseln.",
  },
  {
    id: "reissverschluss", name: "Reißverschluss", short: "Reißverschluss", focus: ["rotation", "zug"], level: 1, gear: [], kind: "drill",
    cue: "Daumen an der Seite hoch zur Achsel, Ellbogen führt",
    swimCue: "Ellbogen hoch, Hand nah am Körper",
    how: "Beim Zurückführen des Arms streift der Daumen an der Körperseite entlang nach oben bis zur Achsel – wie ein Reißverschluss. So bleibt der Ellbogen hoch und der Körper dreht sich mit.",
  },
  {
    id: "lange-zugbahn", name: "Daumen an den Oberschenkel", short: "Lange Zugbahn", focus: ["zug", "gleiten"], level: 1, gear: [], kind: "swim",
    cue: "Daumen streift am Ende jeden Zugs den Oberschenkel",
    how: "Normal Kraul, aber bei jedem Zug streift der Daumen am Ende kurz den Oberschenkel. So drückst du das Wasser ganz nach hinten weg, statt die Hand zu früh herauszunehmen.",
  },
  {
    id: "hundekraul", name: "Hundekraul", short: "Hundekraul", focus: ["zug", "lage"], level: 1, gear: [], kind: "drill",
    cue: "Hände unter Wasser vor, Ellbogen hoch, Wasser fassen",
    swimCue: "Gleiches Fassen vorne, nur mit langem Arm",
    how: "Kraul mit kurzen Armbewegungen nur unter Wasser: Hände vor dem Kopf ins Wasser, mit hohem Ellbogen fassen und unter dem Bauch nach hinten drücken. Kopf flach, Blick zum Boden.",
  },
  {
    id: "wriggen", name: "Wriggen vorne", short: "Wriggen", focus: ["zug"], level: 2, gear: [], kind: "drill",
    cue: "Kleine Achten vorne, Druck auf den Handflächen",
    swimCue: "Den Druck vom Wriggen in den Zug mitnehmen",
    how: "Bauchlage, Arme vorne schulterbreit, Ellbogen etwas höher als die Hände. Die Hände machen kleine Achten nach außen und innen und halten den Druck auf dem Wasser. Dazu leichter Beinschlag.",
  },
  {
    id: "zuege-zaehlen", name: "Züge zählen", short: "Züge zählen", focus: ["gleiten", "rhythmus"], level: 1, gear: [], kind: "swim",
    cue: "Züge pro Bahn zählen, 1 Zug weniger schaffen",
    how: "Normal Kraul und die Züge pro Bahn zählen (nur den Arm mit der Uhr). Dann versuchen, bei gleichem Tempo 1 Zug weniger zu brauchen: vorne lang machen, hinten sauber abdrücken.",
  },
  {
    id: "dreier-atmung", name: "3er-Atmung", short: "3er-Atmung", focus: ["atmung", "rotation"], level: 1, gear: [], kind: "swim",
    cue: "Jeden 3. Zug atmen, ins Wasser ausatmen",
    how: "Nur jeden dritten Zug atmen – also abwechselnd links und rechts. Unter Wasser ruhig durch Mund und Nase ausatmen, dann musst du beim Drehen nur noch einatmen. Den Kopf drehen, nicht heben.",
  },
  {
    id: "brett-atmung", name: "Brett-Beinschlag mit Atmen", short: "Brett-Atmung", focus: ["atmung", "beine"], level: 1, gear: ["board"], kind: "kick",
    cue: "Ins Wasser blubbern, zum Atmen Kopf zur Seite",
    how: "Hände vorne auf dem Brett, Gesicht im Wasser und ruhig ausatmen (blubbern). Zum Einatmen den Kopf zur Seite drehen – ein Ohr bleibt im Wasser. Dazu gleichmäßiger Beinschlag.",
  },
  {
    id: "beine-brett", name: "Beinschlag mit Brett", short: "Beine Brett", focus: ["beine", "lage"], level: 1, gear: ["board"], kind: "kick",
    cue: "Aus der Hüfte schlagen, Knie locker, Füße gestreckt",
    how: "Mit dem Brett vorne Beine schlagen: Die Bewegung kommt aus der Hüfte, die Beine sind fast gestreckt, die Füße locker und gestreckt. Kleine, schnelle Schläge statt großer Tritte.",
  },
  {
    id: "beine-ruecken", name: "Beinschlag in Rückenlage", short: "Rücken-Beine", focus: ["lage", "beine"], level: 1, gear: [], kind: "kick",
    cue: "Bauchnabel hoch, Knie bleiben unter Wasser",
    how: "In Rückenlage, Arme an der Seite, Bauchnabel nach oben, Kinn leicht zur Brust. Aus der Hüfte schlagen – die Zehen sprudeln an der Oberfläche, die Knie bleiben unter Wasser.",
  },
  {
    id: "schnelle-arme", name: "Flüssiger Takt", short: "Takt", focus: ["rhythmus"], level: 2, gear: [], kind: "swim",
    cue: "Keine Pause vorne, Arme gleichmäßig weiter",
    how: "Kraul ohne Pause vorne: Sobald eine Hand eintaucht, beginnt sie zu fassen. Etwas kürzere, flüssige Züge im gleichen Takt. Das ist im Freiwasser und im Neo oft schneller als langes Gleiten.",
  },
  {
    id: "krokodil", name: "Krokodilaugen", short: "Krokodilaugen", focus: ["freiwasser", "atmung"], level: 1, gear: [], kind: "swim",
    cue: "Alle 6 Züge kurz nur die Augen nach vorn heben",
    how: "Alle 6 Züge kurz nur die Augen über das Wasser heben (wie ein Krokodil), nach vorn schauen, dann zur Seite drehen und einatmen. Den Kopf so wenig wie möglich anheben.",
  },
  {
    id: "kopf-hoch", name: "Kopf-hoch-Kraul", short: "Kopf hoch", focus: ["freiwasser", "zug"], level: 3, gear: [], kind: "drill",
    cue: "Kopf über Wasser, Blick nach vorn, kräftig fassen",
    swimCue: "Kopf wieder flach, Zug genauso fest",
    how: "Kraul mit dem Kopf über Wasser und Blick nach vorn, kürzere und kräftige Züge. Das trainiert die Orientierung im Freiwasser und ein festes Fassen des Wassers. Anstrengend – nur kurz.",
  },
];

const SWIM_DRILL_BY_ID = Object.fromEntries(SWIM_DRILLS.map(d => [d.id, d]));

// Hilfsmittel, die die Person beim Schwimmen dabei hat (Trainingsprofil).
function swimGear(profile) {
  const p = profile || (typeof athleteProfile !== "undefined" ? athleteProfile : {});
  return Array.isArray(p.swimEquipment) ? p.swimEquipment.filter(g => SWIM_GEAR[g]) : ["pullbuoy", "board"];
}
