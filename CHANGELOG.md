# Was ist neu

Jede Version hat hier einen Abschnitt `## <Versionsnummer>` (genau wie in der
Datei `VERSION`). Der Text darunter erscheint auf GitHub als Release-Text und
im Dashboard unter „Was ist neu?“. Neueste Version oben.

## 2.5.53

**Keine KI-Kosten mehr, wenn keiner hinschaut**
- Die App fragt die KI an drei Stellen von selbst: den automatischen Wochenplan, den täglichen Plan-Check und den Text im Morgenbericht. Das passiert jetzt nur noch, wenn die App wirklich offen und sichtbar ist und in den letzten 2 Stunden jemand getippt, geklickt oder gescrollt hat.
- Ein Browser-Tab, der tagelang offen herumliegt, verbraucht also keine Tokens mehr.
- Kommst du zurück, holt die App alles sofort nach: Plan-Check, Wochenplan und Morgenbericht.
- Was du selbst anstößt (Knopf drücken, Nachricht an den Coach), läuft wie bisher sofort.

## 2.5.52

**Fehler behoben: Gewünschtes Training verschwand wieder**
- Wer dem Coach schrieb „heute 45 min schwimmen“ und heute eigentlich Ruhetag war, bekam die Antwort „eingetragen“, aber im Kalender stand nichts. Grund: Danach gab es in der Woche keinen freien Tag mehr, und die automatische Regelprüfung hat genau das neue Training wieder gestrichen.
- Jetzt gilt: Was du dir selbst wünschst (per Nachricht an den Coach oder selbst im Plan eingetragen), streicht die Regelprüfung nie für einen Ruhetag. Wenn nötig, wird stattdessen ein anderer Tag frei. Bleibt kein anderer Tag übrig, bekommst du nur einen Hinweis, dass ein freier Tag guttun würde.
- Ändert die Regelprüfung nach deiner Nachricht noch etwas, steht das jetzt auch in der Antwort des Coachs.

## 2.5.51

**Notizen zu Einheiten speichern sich selbst**
- In der Workout-Ansicht unter „Deine Bewertung“ gibt es keinen „Notiz speichern“-Knopf mehr. Die Notiz wird automatisch gespeichert: kurz nachdem du aufhörst zu tippen, wenn du das Feld verlässt oder die Ansicht schließt und wenn du die App wechselst.
- Unter dem Feld steht, was gerade passiert: „Wird gespeichert …“ und dann „Gespeichert ✓“.
- Auch ohne Netz geht nichts verloren: Die Notiz wird im Gerät zwischengespeichert und nachgeschickt, sobald der Server wieder erreichbar ist.

## 2.5.5

**Sicherheit: fünf Verbesserungen aus dem Sicherheitscheck**
- **Nur über Tailscale erreichbar:** Neuer Schalter für den Betreiber unter Einstellungen → Sicherheit. Ist er an, beantwortet das Dashboard nur noch Geräte mit Tailscale (auch über die https-Adresse) und den Rechner selbst. Wer im WLAN die normale Adresse `http://…:5000` benutzt, sieht nur einen Hinweis. So geht kein Passwort mehr unverschlüsselt durchs Heimnetz. Aussperren kannst du dich damit nicht: Einschalten geht nur, wenn dein Gerät gerade über Tailscale verbunden ist.
- **Überall abmelden:** Unter Einstellungen → Sicherheit beendet ein Knopf alle Anmeldungen auf allen Geräten, zum Beispiel wenn das Handy verloren ist. Ein neues Passwort meldet ebenfalls überall ab.
- **Abmelden stoppt den Morgenbericht:** Nach dem Abmelden kommen auf diesem Gerät keine Mitteilungen mehr, also auch kein Schlaf, HRV oder Ruhepuls auf dem Sperrbildschirm.
- **Dateien nur für dich lesbar:** Datenbank, Sicherungen und gespeicherte Schlüssel (Claude, Garmin) kann auf dem Server-Rechner nur noch dein eigenes Benutzerkonto lesen.
- **Zusätzliche Schutzschicht im Browser:** Das Dashboard führt nur noch eigene Skripte aus und spricht nur mit dem eigenen Server. Sollte jemals fremder Code eingeschleust werden, blockiert der Browser ihn.

## 2.5.4

**Sicherheit: Bremsen gegen zu viele Anfragen**
- KI-Coach: Jede Person darf pro Tag nur noch eine bestimmte Zahl an Anfragen an Claude stellen (Standard: 30). Der Betreiber stellt die Zahl in den Einstellungen unter „KI-Coach“ ein („Anfragen pro Tag und Person“, 0 = ohne Grenze) und ist selbst davon ausgenommen. So kann niemand über den freigegebenen Schlüssel hohe Kosten verursachen.
- Wer Claude nutzt, sieht in den Einstellungen „heute noch X von 30 Anfragen“. Ist die Grenze erreicht, kommt eine klare Meldung, und Claude wird gar nicht erst gefragt. Anfragen, die fehlschlagen, ohne etwas zu kosten, zählen nicht.
- Für die ganze App gilt jetzt: höchstens 300 Anfragen pro Minute und Person. Bei normaler Nutzung merkt man davon nichts. Wird es doch einmal knapp (z. B. beim Import sehr vieler Einheiten), wartet die App kurz und macht dann selbst weiter. Einstellbar in `.env` mit `API_RATE_PER_MINUTE`.

## 2.5.3

**Schwimmen: Strecke pro Einheit selbst festlegen**
- Neu in den Einstellungen (Training & Planung) und im Onboarding: „Strecke pro Schwimmeinheit“ von–bis in Metern, z. B. 2.000–3.000 m. Du kannst auch nur eine Grenze angeben („mindestens“ oder „höchstens“). Leer lassen heißt: Der Coach entscheidet wie bisher.
- Der Coach plant jede neue Schwimmeinheit in diesem Bereich. Plant er trotzdem zu kurz oder zu lang, setzt die App die Meter selbst in den Bereich und passt die Dauer an. Der Hauptsatz auf der Uhr wird so lang, dass die Meter stimmen.

## 2.5.2

**Schwimmen: konkrete Technik statt „6 × 50 m Technik“**
- Der Coach wertet deine Bahn-Daten von der Uhr aus (Züge pro 25 m, Zugfrequenz, Anteil Brust-Bahnen, ob die Technik gegen Ende nachlässt, ob ein Freiwasser-Wettkampf ansteht) und legt daraus deine Technik-Schwerpunkte fest.
- Jede Schwimmeinheit hat jetzt 1–3 konkrete Technikübungen aus einer neuen Sammlung mit 18 Übungen, z. B. Abschlagschwimmen, Seitlage-Beinschlag, Faustschwimmen, 3er-Atmung oder Krokodilaugen. Auf der Uhr steht bei jedem Schritt, worauf du achten sollst. In der App steht unter „Technik heute“, wie die Übung geht und warum sie für dich dran ist.
- Aufbau wie bei Garmin Coach: Einschwimmen, Pause, Technikblock (25 m Übung + 25 m Kraul, Pause), Pause, Hauptsatz mit Pausen, ab 50 Minuten ein Pull-Satz mit Pullbuoy, Ausschwimmen. Alle Pausen sind eigene Schritte auf der Uhr.
- Behoben: Die Uhr bekam oft einen anderen Ablauf als den, den der Coach beschrieben hat (statt „8 × 100 m“ z. B. „6 × 50 m“, dadurch deutlich weniger Meter). Hauptsatz, Ein- und Ausschwimmen kommen jetzt aus dem Text des Coaches, und die angezeigten Meter sind die Meter auf der Uhr.
- Neu im Profil: „Hilfsmittel beim Schwimmen“ (Pullbuoy, Schwimmbrett, Flossen, Paddles, Schnorchel). Der Coach plant nur Übungen, die du damit machen kannst.

**Mobility: 11 neue Übungen, vor allem für Knie und Hüfte**
- Neuer Bereich „Knie“ mit 4 Übungen: Fersenrutschen, Knie strecken mit Band, Beinstrecken im Sitzen und Fersensitz. Im Trainingsprofil kannst du „Knie“ jetzt auch als Schwerpunkt oder als Bereich mit Beschwerden wählen – dann wird dort nur sanft gearbeitet.
- 6 neue Übungen für die Hüfte: Schmetterling, Hüft-Scheibenwischer, Hüfttor öffnen, Ausfallschritt mit Drehung, Hüftkreisen im Vierfüßlerstand und Liegende Drehung.
- Außerdem neu: Beinrückseite im Sitzen.
- Alle neuen Übungen haben wie gewohnt eine bewegte Strichfigur, einfache Schritte, typische Fehler sowie eine leichtere und eine schwerere Variante. Insgesamt gibt es jetzt 44 Mobility-Übungen – mehr Abwechslung in deinen Einheiten.

## 2.5.0

**Neu: Feed – gemeinsam motivieren**
- Neuer Bereich „Feed“ in der Leiste. Mitmachen ist freiwillig: Du wählst einen Anzeigenamen und bist dabei. Austreten geht jederzeit, dabei verschwinden deine Highlights und Reaktionen.
- Geteilt werden nur Highlights, nie einzelne Trainings, Puls, Strecken oder Gesundheitswerte: neue Meilensteine (z. B. 100. Training), Serien, Bestzeiten über 1/5/10 km Laufen und 10/20/40 km Rad sowie geschaffte Challenges. Was du vor dem Beitritt erreicht hast, bleibt privat.
- Jedes Highlight bekommt eine glänzende Medaille mit einem lockeren Spruch. Beim Öffnen dreht sie sich einmal herein.
- Mit Emojis reagieren: 🔥 💪 👏 🎉 🤩 – du siehst, wer reagiert hat.

**Neu: Challenges**
- Unter „Feed → Challenges“ kann jeder eine Challenge starten, die anderen machen mit einem Tipp mit.
- Drei Arten: Gruppenziel (alle sammeln zusammen, z. B. 1.500 km Rad im November), persönliche Challenge (jeder für sich, z. B. 60 km Laufen) und Rangliste (wer schafft am meisten?).
- Gezählt werden Kilometer, Stunden oder Einheiten im gewählten Zeitraum. Ist das Ziel geschafft oder die Rangliste vorbei, erscheint automatisch ein Highlight im Feed.

**Neu: Kalender mit neuem Aussehen und Verschieben per Ziehen**
- Der Kalender wurde neu gestaltet: feine Linien wie in einem Papierplaner statt vieler Kästchen. Erledigte Einheiten sind farbig gefüllt, geplante gestrichelt umrandet.
- Am Computer gibt es eine Monats- und eine Wochenansicht. Links steht die Kalenderwoche, rechts die Wochensumme mit einem farbigen Balken je Sportart und der noch geplanten Zeit.
- Das Wetter steht direkt am Tag (Symbol und Temperatur, in der Woche auch die Regenwahrscheinlichkeit). Der bisherige „Große Kalender mit Wetter“ ist damit im neuen Kalender aufgegangen.
- Geplante Einheiten lassen sich auf einen anderen Tag ziehen – am Computer mit der Maus, am Handy kurz gedrückt halten und ziehen. Die Trainingsregeln werden dabei wie gewohnt geprüft, und mit „Rückgängig“ geht es sofort zurück. In die Vergangenheit lässt sich nichts schieben.
- Am Handy: kleiner Monat mit Strichen je Einheit, darunter die nächsten 7 Tage mit Wetter.

## 2.4.51

**Kraft & Mobility: Strichmännchen bewegen sich richtig**
- Alle 83 Übungen durchgesehen und rund 40 Zeichnungen korrigiert. Gelenke knicken nicht mehr in die falsche Richtung: beim Liegestütz und bei den Dips am Stuhl zeigen die Ellbogen jetzt nach hinten statt nach vorn.
- Hände und Füße schweben nicht mehr in der Luft, sondern stehen dort, wo sie hingehören (z. B. Wade ausrollen, Beinrückseite kniend, Taube, Beinpresse).
- Bei mehreren Übungen im Liegen wurden die Arme bisher gar nicht richtig gezeichnet. Jetzt halten die Hände das Band (Beinrückseite liegend), umfassen die Knie (Knie zur Brust, Liegende Vier) oder liegen hinter dem Kopf (Oberer Rücken über der Rolle).
- Richtige Bewegung statt falscher: Vogel-Hund hebt Arm und Bein über Kreuz, der Bergsteiger wechselt die Beine ab, beim Frosch und beim breiten Rücken auf dem Block liegen die Unterarme bzw. Ellbogen wirklich auf, beim Klimmzug kommt das Kinn über die Stange.
- Natürlichere Haltungen bei Bankdrücken, Kreuzheben, Kettlebell-Swing, Latziehen, Rudern am Kabelzug, Ausfallschritt, Sphinx, Nadel einfädeln und Drehung im Vierfüßlerstand.
- Arme und Beine, die zur Seite aus dem Bild zeigen, werden jetzt kürzer gezeichnet – so wie man sie von der Seite auch sieht (Brust im Türrahmen, Face Pull, Frosch, Liegende Vier).

## 2.4.50

**Einstellungen: „Nachdenken“ steht beim Trainingsplan**
- „Nachdenken beim Trainingsplan“ steht in den Claude-Einstellungen jetzt direkt unter der Zeile „Trainingsplan“ und nicht mehr ganz unten in der Liste.

## 2.4.49

**Trainingsplan: nächste Woche zum halben Preis**
- Mit Claude plant das Dashboard die nächste Woche jetzt früher vor: Sobald nur noch 5 Tage geplant sind, geht sie als „Sammelauftrag“ an Claude. Das kostet nur die Hälfte, dafür kommt die Antwort nicht sofort, sondern meist in unter einer Stunde.
- Solange der Auftrag läuft, steht beim Trainingsplan ein kurzer Hinweis. Das Ergebnis wird automatisch abgeholt, sobald das Dashboard offen ist, und genauso geprüft wie bisher.
- Sicherheitsnetz: Ist nur noch ein Tag geplant und der Auftrag noch nicht fertig, plant das Dashboard sofort (normaler Preis). Dir fehlt also nie ein Plan.
- Der tägliche Plan-Check bleibt: Er schaut weiter jeden Morgen, ob heute und die nächsten Tage noch zu deiner Verfassung passen, danach kommt der Morgenbericht.
- „Plan erstellen“, „Plan neu erstellen“ und Nachrichten an den Coach antworten weiter sofort. Mit der lokalen KI ändert sich nichts.
- Unter Mehr → Statistik heißt der neue Posten „Trainingsplan (Sammelauftrag)“.

## 2.4.48

**Trainingsplan: Nachdenken einstellbar**
- Neu in den Einstellungen unter Claude: „Nachdenken beim Trainingsplan“ mit den Stufen „Wenig – günstiger“ und „Mittel – gründlicher“. Die Einstellung gilt für das Erstellen des Plans und für Nachrichten an den Coach.
- Neuer Standard ist „Wenig“. Das Nachdenken der KI wird wie geschriebener Text bezahlt und ist beim Plan der größte Kostenanteil. Wirken dir die Pläne zu oberflächlich, stellst du einfach wieder auf „Mittel“.
- Was eine Planerstellung im Schnitt kostet, siehst du unter Mehr → Statistik bei „Kosten je Aufgabe“.

## 2.4.47

**Trainingsplan: weniger KI-Kosten bei gleicher Qualität**
- Täglicher Plan-Check: Die festen Regeln prüfen den Plan weiterhin jeden Tag. Die KI wird aber nur noch gefragt, wenn es wirklich etwas abzuwägen gibt. Das ist der Fall bei Muskelkater oder wenig Energie im Erholungs-Check, einer verpassten Einheit, schnell steigender Belastung oder wenn mehrere Uhr-Werte gleichzeitig leicht auffällig sind. Ist alles im grünen Bereich, hätte die KI ohnehin „behalten“ gesagt, und diese Anfrage fällt jetzt weg. Der Knopf „Jetzt prüfen“ fragt die KI weiterhin immer.
- Nachricht an den Coach: Die KI schreibt nicht mehr die ganze Woche neu, sondern schickt nur die Tage zurück, die sich ändern. Alle anderen Tage bleiben genau wie vorher.
- „Kürzere Variante“ oder „Alternative“ für eine einzelne Einheit: Die KI denkt dafür weniger lange nach, denn es geht nur um eine Einheit statt um eine ganze Woche.
- Statistik (Mehr → Statistik): Je Aufgabe steht jetzt, wie oft sie lief, was eine Anfrage im Schnitt kostet und wie viel die KI im Schnitt geschrieben hat. So sieht man, wo das Geld hingeht.

## 2.4.46

**KI-Anfragen kürzer und günstiger**
- Beim Erstellen eines Trainingsplans schickt das Dashboard der KI nur noch, was sie dafür wirklich braucht. Bestzeiten, VO2max, Körperwerte oder Ernährungsziele fallen dort weg. Die Anfrage ist dadurch etwa ein Drittel kürzer.
- Sonderregeln (z. B. zu Verletzungen, Wünschen oder dem Streckenprofil) stehen nur noch drin, wenn es dazu auch etwas gibt. Regeln für die Wochen vor dem Rennen kommen erst, wenn das Rennen näher als 5 Wochen ist.
- Die Antwort der KI ist kürzer: Kraft- und Mobility-Übungen kommen nur noch als Kennung zurück, Name und Hinweise ergänzt das Dashboard selbst. Titel und Beschreibungen sind knapper. Antworten kosten am meisten, deshalb spart das am stärksten.
- Garmin-Erholungswerte (HRV, Ruhepuls, Schlaf) stehen kompakter in einer Zeile. Die Sauerstoffsättigung erscheint nur, wenn sie auffällig niedrig ist.

**Kleine Animationen am Computer**
- Beim Öffnen eines Bereichs zählen die großen Zahlen kurz hoch. Kacheln und Listen-Zeilen erscheinen leicht versetzt nacheinander.
- Unter der Maus heben sich Kacheln leicht an, Sport-Symbole wachsen mit, Ringe leuchten stärker und Pfeile rutschen ein Stück zur Seite.
- Der heutige Tag im Kalender leuchtet beim Öffnen einmal kurz auf. Das Symbol des gewählten Bereichs in der Seitenleiste nickt kurz.
- Ist am Computer „Bewegung reduzieren“ eingeschaltet, bleibt alles ruhig.

## 2.4.45

**Ernährung: Neuer Bereich „Energie & Bedarf“**
- Ganz oben im Ernährungs-Tab siehst du jetzt, wie viele Kalorien du verbrauchst – aufgeteilt in **Grundumsatz** (Verbrauch in Ruhe), **Alltag** (Gehen, Stehen, Verdauen) und **Training**.
- **Energie heute**: voraussichtlicher Verbrauch für heute, inklusive des Trainings, das im Plan steht. Die Kalorien fürs Training werden aus deinen eigenen bisherigen Einheiten geschätzt. Mit Garmin siehst du zusätzlich, wie viel es bisher war.
- **Dein Energiebedarf**: Durchschnitt der letzten 7, 30 und 90 Tage, Ruhetag im Vergleich zum Trainingstag, und ob dein Verbrauch gerade steigt oder sinkt.
- **Verlauf**: Balkendiagramm über 30 Tage, 90 Tage oder 12 Monate, mit Durchschnittslinie.
- **Gewicht & Energiebilanz**: Aus deinem Gewichtsverlauf wird berechnet, ob du gerade mehr oder weniger isst, als du verbrauchst – ganz ohne Essen zu tracken. Dazu „Du isst ungefähr“ und „Zum Halten“ in kcal pro Tag. Dein Gewicht kannst du direkt hier eintragen.
- **Kennzahlen**: Grundumsatz, Aktivitätslevel (PAL), Verbrauch pro kg, Kalorien pro Trainingsstunde, Anteil des Trainings, BMI und (mit Garmin-Waage) Magermasse – jeweils mit kurzer Erklärung.
- Die älteren Kacheln (Makros, Essen vor dem Training, Wettkampf-Verpflegung) stehen weiter unten und sind noch als „Coming soon“ gesperrt.

**Garmin**
- Aus der Garmin-Tageszusammenfassung kommen jetzt auch die Kalorien (gesamt, aktiv, Grundumsatz). Ohne Garmin-Werte rechnet das Dashboard selbst.
- Korrektur: Der schnelle Abgleich (letzte 3 Tage) hat bisher ältere Tageswerte wie Body Battery bis zum nächsten nächtlichen Abgleich überschrieben. Jetzt werden sie zusammengeführt und bleiben erhalten.

**Profil**
- Neues Feld **Größe** (cm) unter Einstellungen → Profil. Damit wird der Grundumsatz genauer und der BMI angezeigt. Wenn Garmin deine Größe kennt, kann sie übernommen werden.

## 2.4.44

**Neue Projektseite auf GitHub**
- Das README ist neu: auf Englisch (README.md) und auf Deutsch (README.de.md), mit Bildern aus der App (nur erfundene Beispieldaten), einem Preisvergleich mit bezahlten Trainings-Apps, einer Übersicht aller Funktionen und einem Schnellstart.
- Die ausführliche Installationsanleitung aus dem alten README steht jetzt in docs/INSTALLATION.md.

**Kleine Korrektur**
- Einstellungen → Garmin: Steht in der Liste auch eine Einheit, die du selbst an Garmin geschickt hast, heißt die Überschrift jetzt „Heute + von dir gesendet“ statt nur „Heute“.

## 2.4.43

**Garmin: Du bestimmst, was auf die Uhr kommt**
- Neu unter Einstellungen → Garmin: „Was kommt automatisch auf die Uhr?“ mit drei Möglichkeiten:
  - **Nur heute** (neuer Standard): Am Trainingstag kommt die Einheit des Tages automatisch auf die Uhr – sonst nichts.
  - **Nächste 7 Tage**: wie bisher, die ganze Woche liegt schon in Garmin Connect.
  - **Nur per Knopf**: Nichts geht automatisch, du schickst jede Einheit selbst.
- In jeder geplanten Einheit gibt es den Knopf „An Garmin senden“. Damit schickst du eine Einheit sofort auf die Uhr – auch eine von morgen oder nächster Woche. Von Hand gesendete Einheiten bleiben in Garmin, egal welche Einstellung du gewählt hast.
- Aufräumen: Einheiten für die kommenden Tage, die bisher automatisch geschickt wurden, werden beim nächsten Abgleich wieder aus Garmin Connect entfernt. Die Einheit von heute und alles, was du selbst geschickt hast, bleibt.
- In einer Einheit für einen späteren Tag steht jetzt: „Kommt am Trainingstag automatisch auf deine Uhr – oder schick sie jetzt schon.“

## 2.4.42

**Rad-VO2max: genauere Schätzung**

- **Neue Rechnung:** Die VO2max fürs Rad wird jetzt ähnlich wie bei Garmin berechnet. Das Dashboard sucht in deinen Radeinheiten gleichmäßige 5-Minuten-Abschnitte (nach dem Aufwärmen, ohne Intervalle). Dort vergleicht es deine Watt mit deinem Puls: Wie viel Prozent deines Pulsspielraums (zwischen Ruhepuls und Maximalpuls) brauchst du für diese Leistung? Daraus ergibt sich die VO2max.
- **Warum die alte Zahl zu tief war:** Bisher wurde eine Linie durch die Durchschnittswerte ganzer Einheiten gelegt und bis zum Maximalpuls verlängert. Weil die meisten Radfahrten im ähnlichen Pulsbereich liegen, reichten schon ein paar Schläge Tagesform (Hitze, Müdigkeit), um das Ergebnis deutlich nach unten zu ziehen – im Test um bis zu 15 Punkte.
- **Ruhepuls von Garmin:** Ist im Profil kein Ruhepuls eingetragen, wird der Mittelwert deiner Garmin-Ruhepulswerte der letzten 30 Tage genutzt. Als Gewicht zählt dein zuletzt eingetragenes Gewicht.

## 2.4.41

**Wettkämpfe mit mehr Details**

- **Distanz-Vorlagen:** Beim Anlegen eines Wettkampfs kannst du jetzt eine Distanz auswählen – zum Beispiel Sprint, Olympisch, Mitteldistanz oder Langdistanz beim Triathlon, 5 km, 10 km, Halbmarathon oder Marathon beim Laufen. Die Kilometer werden automatisch eingetragen und lassen sich danach noch ändern. Passt nichts, wählst du „Eigene Distanz“.
- **Staffel:** Beim Triathlon gibt es jetzt „Allein“ oder „Staffel“. Bei einer Staffel wählst du aus, welche Teilstrecke du selbst machst (z. B. nur Laufen). Die Distanzen jeder Teilstrecke kannst du frei eintragen.
- **Nur dein Teil zählt:** Bei einer Staffel richten sich Trainingsplan, KI-Coach, Renntempo und Rennverpflegung nur nach deiner eigenen Teilstrecke. Der Rennplan zeigt eine passende Checkliste für die Übergabe ans Team.
- **Streckenart:** Optional kannst du angeben, ob es z. B. ein Straßenlauf, Trail, Bahn- oder Crosslauf ist. Auch das bekommt der Coach mit.
- **Bearbeiten:** Wettkämpfe lassen sich jetzt nachträglich ändern – über den Stift (✎) auf der Wettkampfkarte.

## 2.4.40

- **Ist mein Wert gut? – Einordnung direkt unter den Diagrammen:** In der Detailansicht einer Einheit steht jetzt unter Schrittfrequenz, Bodenkontaktzeit, vertikalem Verhältnis, Leistung, Puls und Tempo eine kurze Einordnung:
  - ein Farbbalken mit dem Bereich, in dem dein Wert liegt (von „sehr gut“ bis „verbesserungswürdig“) und was als gut gilt,
  - **besser oder schlechter als sonst** – verglichen mit deinen früheren Einheiten, beim Laufen möglichst nur mit Läufen in ähnlichem Tempo (Schrittfrequenz & Co. hängen stark vom Tempo ab),
  - aufklappbar „Was heißt das?“ mit einer einfachen Erklärung und einem Tipp.
- **Laufen:** Schrittfrequenz, Bodenkontaktzeit, vertikales Verhältnis, vertikale Oszillation (Bereiche wie die Farben bei Garmin) und „Puls bei ähnlichem Tempo“ – sinkt er, wirst du fitter.
- **Rad:** Trittfrequenz, Intensität in % deiner FTP (mit W/kg), Gleichmäßigkeit (wichtig für den Lauf danach) und Puls bei ähnlicher Leistung.
- **Schwimmen:** Tempo im Verhältnis zu deiner CSS, SWOLF und Zugfrequenz.
- **Für alle Sportarten:** Pulszone der Einheit mit Abgleich zum Plan (z. B. „härter als geplant“, wenn eine lockere Einheit zu schnell war), Garmin-Trainingseffekt und bei gleichmäßigen Einheiten ab 40 Minuten die Puls-Drift (steigt der Puls bei gleichem Tempo?).
- **Der Coach bewertet die Werte mit:** Die KI-Auswertung bekommt dieselbe Einordnung und gibt jetzt Rückmeldung, ob z. B. deine höhere Schrittfrequenz das vertikale Verhältnis wirklich senkt. Ältere Auswertungen zeigen einen Hinweis – mit „Neu auswerten“ bekommst du die neue Rückmeldung.

## 2.4.39

- **Garmin-Daten kommen jetzt von selbst:** Sobald du das Dashboard öffnest oder die App wieder nach vorne holst, werden die neuesten Garmin-Daten leise im Hintergrund geholt. Oben steht so lange „Holt Garmin-Daten …“, danach erscheinen neue Trainings und Schlafwerte ohne Neuladen.
- **Schnell und schonend:** Dieser automatische Abruf holt nur die letzten 3 Tage und dauert deshalb nur Sekunden. Er läuft höchstens alle 30 Minuten, damit Garmin nicht zu oft gefragt wird. Die gründliche Prüfung über die letzten Monate macht weiterhin der nächtliche Abruf um 5:45 Uhr.
- **Wann zuletzt geholt:** Der Garmin-Knopf oben zeigt jetzt z. B. „Garmin · vor 12 Min.“ – auch nach dem nächtlichen Abruf. Antippen holt sofort neue Daten.
- **Am Handy nach unten ziehen** (ganz oben auf einer Seite) holt ebenfalls sofort neue Daten – wie in Mail oder Fotos.
- **Warnung vor dem Ablauf des Garmin-Schlüssels:** Eine Woche bevor dein Schlüssel abläuft, erscheint auf „Heute“ ein Hinweis mit „Jetzt erneuern“. Ist er abgelaufen, steht das auch oben im Garmin-Knopf.
- Tippst du gerade etwas ein, wartet die App mit dem Neuzeichnen, bis du fertig bist.

## 2.4.38

- **Krafttraining-Wunsch jetzt als Text:** In „Training & Planung“ gibt es keine Auswahl mehr für „Ziel beim Krafttraining“ und „Schwerpunkt“. Stattdessen steht unter „Deine Wünsche“ ein neues Feld: „Was möchtest du mit dem Krafttraining erreichen?“ – dort schreibst du in eigenen Worten, z. B. „athletischer Körper, Fokus auf Schultern und Brust“.
- Die App liest aus dem Text heraus, welche Körperteile dir wichtig sind (z. B. Brust, Schultern, Rücken, Beine) und ob du Muskeln aufbauen möchtest. Darunter steht direkt, was erkannt wurde. Diese Körperteile bekommen weiterhin in jeder Kraft-Einheit zwei Übungen. „Keine Beinübungen“ wird richtig als „nicht gewünscht“ verstanden.
- Der ganze Text geht zusätzlich an die KI, damit sie den Plan danach ausrichtet.
- Wer vorher schon etwas ausgewählt hatte, findet das automatisch als Text im neuen Feld wieder.

## 2.4.37

- **KI-Kosten je Modell:** Jede Anfrage an den KI-Coach wird jetzt mit dem Modell gespeichert, das wirklich geantwortet hat – samt Tokens und Kosten. Die Kosten werden mit dem Listenpreis zum Zeitpunkt der Anfrage berechnet (Opus 5.5: 4 $ / 20 $, Sonnet 5.5: 2 $ / 10 $, Haiku 5.5: 0,10 $ / 0,50 $ je Million gelesener / geschriebener Tokens). Auch abgebrochene Antworten zählen mit, denn sie kosten ebenfalls.
- **Neue Karte „KI-Kosten“ in der Statistik (Mehr → Statistik):** Gesamtkosten im gewählten Zeitraum, je Modell Anfragen, Tokens und Kosten, dazu die Kosten je Aufgabe (Trainingsplan, Auswertung, Morgenbericht …). Bei jeder Person stehen die KI-Kosten neben der Anzahl der Anfragen. Tokens von vor diesem Update stehen als „Ohne Modell“ dabei.

## 2.4.36

- **KI-Modell je Aufgabe:** Unter Einstellungen → KI-Coach kann der Betreiber jetzt neben dem Standard-Modell für jede Aufgabe ein eigenes Modell wählen: Trainingsplan (inkl. täglichem Plan-Check), Analysen (Auswertung von Einheiten, Lessons Learned, Belastung, Leistungszustand), Coach & Morgenbericht sowie Mobility. Beispiel: Pläne mit Opus, Analysen mit Sonnet. Die Wahl liegt auf dem Server und gilt für alle, die den Schlüssel des Betreibers nutzen. „Wie Standard“ übernimmt automatisch das Standard-Modell.

## 2.4.35

- **KI-Auswertung einer Einheit kennt jetzt die Reihenfolge:** Verglichen wird nur noch mit Einheiten, die VOR der ausgewerteten Einheit lagen. Was du danach trainiert hast (z. B. ein CSS-Test am Tag darauf), bekommt die KI getrennt als „seitdem gemacht“ – inklusive deiner Notizen. So empfiehlt sie keinen Test mehr, den du schon gemacht hast.
- **Notizen werden nicht mehr verwechselt:** Notizen anderer Einheiten stehen jetzt mit Datum und Namen im Kontext und dürfen nicht mehr als Notiz der ausgewerteten Einheit ausgegeben werden.
- **Mehr Hintergrund für die Auswertung:** Die KI kennt jetzt das heutige Datum, wann die Einheit war, was an dem Tag geplant war, deine Körperwerte an dem Morgen (HRV, Ruhepuls, Schlaf) im Vergleich zu deinem Mittel, die Belastung der 7 Tage davor und deine aktuellen Schwellenwerte (CSS mit Testdatum, FTP, Lauf-Schwelle). Beim Schwimmen wird die Strecke in Metern übergeben.
- **Hinweis bei alten Auswertungen:** Auswertungen von vor diesem Update zeigen einen Hinweis – mit „Neu auswerten“ bekommst du die genauere Einordnung.

## 2.4.34

- **Schwimmen in Metern:** Bei Schwimm-Einheiten steht jetzt, wie viele Meter du schwimmst (z. B. „45 min · 1.600 m“) – statt einer Geschwindigkeits-Vorgabe. Auch auf der Uhr gibt es beim Schwimmen keine Tempo-Vorgabe mehr, nur noch die Meter je Abschnitt.
- **Krafttraining nach deinem Wunsch:** Unter Einstellungen → Training & Planung → Wochenplan gibt es neu „Ziel beim Krafttraining“ (Fit für Triathlon oder Athletischer Körper) und „Schwerpunkt“ (z. B. Brust & Arme, Schultern). Mit „Athletischer Körper“ gibt es mehr Sätze für Muskelaufbau, und jede Kraft-Einheit enthält mindestens zwei Übungen pro Schwerpunkt.
- **Kraft-Einheiten fehlen nicht mehr:** Plant die KI weniger Kraft-Einheiten als eingestellt („Kraft pro Woche“), ergänzt die App die fehlenden – an Tagen mit Platz und nicht direkt hintereinander.
- **Hinweis, wenn Kraft ausgeschaltet ist:** Steht in deinen Wünschen etwas zu Kraft oder Muskeln, aber „Krafttraining einplanen“ ist aus, zeigt der Wochenplan einen Hinweis mit Knopf „Einschalten“.

## 2.4.33

Dein Trainingsplan hält sich jetzt an deine Woche – und morgens weißt du sofort, wie erholt du bist.

Neu in 2.4.33:
- Wochenplan in den Einstellungen: Unter Training & Planung stellst du jetzt jederzeit Trainingstage, Schwimmtage und den Tag für die lange Einheit ein – dazu, wie viele Haupttrainings du pro Tag machst und ob Kraft und Mobility zusätzlich am Trainingstag oder an eigenen Tagen kommen
- Neu: Kraft pro Woche (1×, 2× oder 3×) und deine übliche Trainingsdauer. Auch Erfahrung, Wettkämpfe und stärkste/schwächste Disziplin aus der Einrichtung kannst du dort ändern
- Der Plan hält sich daran: Jeder neue Plan wird danach geprüft. Schwimmen kommt nur an deine Schwimmtage, pro Tag gibt es nur so viele Einheiten wie eingestellt, und Kraft kommt nicht öfter als gewünscht. Was angepasst wurde, steht unter „So ist dein Plan entstanden“
- Garmin-Events: Wenn Garmin den Kalender über den Schlüssel nicht herausgibt, nutzt das Dashboard jetzt die Garmin-Anmeldung. Früher kamen dann still keine Events an
- Deine Wettkämpfe stehen jetzt auf der Coach-Seite, und im Kalender markiert eine Zielflagge den Wettkampftag
- Morgenbericht: Auf „Heute“ siehst du morgens Schlaf, HRV und Ruhepuls im Vergleich zu deinem Normalwert, dazu einen kurzen Satz vom Coach zum heutigen Training
- Mitteilung aufs Handy: Sobald die Daten deiner Nacht da sind, kommt der Morgenbericht als Mitteilung. Einschalten unter Einstellungen → Mitteilungen. Auf dem iPhone geht das nur, wenn du das Dashboard über Safari → Teilen → „Zum Home-Bildschirm“ abgelegt hast und von dort öffnest

## 2.4.32

Dein Plan passt jetzt besser auf dich auf – und deine Garmin-Events sind automatisch da.

Neu in 2.4.32:
- Events aus Garmin Connect: Wettkämpfe, die du im Garmin-Kalender eingetragen hast, erscheinen automatisch als Ziele (mit Datum, Sportart, Distanz, Zielzeit und Ort). Steht dasselbe Event schon bei deinen Zielen, wird es nur verknüpft – keine Doppelten
- Nichts wird gelöscht: Ein Ziel, das du selbst löschst, kommt nicht wieder. Dein Hauptevent wird nur gesetzt, wenn du noch keins hast
- Unter Einstellungen → Garmin kannst du die Events jederzeit mit „Events jetzt holen“ abrufen
- Plan-Check: Der Coach schaut jeden Tag auf heute und morgen, alle 3 Tage auf die restliche Woche und einmal pro Woche weiter in die Zukunft – nach einer ausgelassenen Einheit oder einer Verletzung sofort
- Leere Trainingstage werden automatisch aufgefüllt, und wenn du erschöpft bist, wird eine harte Einheit locker gemacht. Auf „Heute“ siehst du, was geändert wurde, und kannst es mit einem Tipp rückgängig machen
- Beim Plan erstellen gehen keine Einheiten mehr still verloren; du siehst, was ergänzt wurde
- Kraft: Wähle, womit du trainierst – Eigengewicht, Kurzhanteln, Kettlebell, Band oder Studio. Dazu 35 neue Übungen mit Strichfiguren

## 2.4.31

Der Kalender zeigt dir jetzt, was als Nächstes kommt.

Neu in 2.4.31:
- Die Liste im Kalender startet immer bei „Heute“ und zeigt die nächsten 7 Tage – vergangene Workouts stehen dort nicht mehr
- Mit dem Pfeil blätterst du weiter in die Zukunft; die Stunden oben rechts zeigen, wie viel Training ansteht
- Vergangene Tage siehst du weiterhin, wenn du sie im Monat oben antippst

## 2.4.30

Trainings auf der Uhr sind jetzt so detailliert wie beim Garmin Coach.

Neu in 2.4.30:
- Jede Einheit auf der Uhr hat jetzt einen richtigen Ablauf: Aufwärmen, Hauptteil als Wiederholungen mit Pausen, Ausklang – mit kurzem Hinweis bei jedem Abschnitt
- Schwimmen in Metern wie beim Garmin Coach: Einschwimmen, Technik-Bahnen, z. B. 10 × 100 m Kraul mit 20 s Pause, Ausschwimmen – mit Schwimmstil und 25-m-Bahn
- Laufen und Rad je nach Intensität: lockere Grundlage mit Steigerungen, Tempo- oder Sweet-Spot-Blöcke, harte Intervalle. Zielbereiche aus deinem Profil (Pace, Watt oder Puls)
- Steht im Titel ein Satz wie „6 × 800 m“ oder „5 × 4 min“, wird genau der auf der Uhr angelegt
- Auch Einheiten, die schon auf der Uhr sind, werden beim nächsten Abgleich automatisch aktualisiert
- Nur noch das neue Design: die klassische Ansicht ist archiviert
- Abgeschlossene Trainings öffnen sich als eigene Seite, mit schönerem „Vergleichen“-Knopf; die Leiste oben am Handy ist ruhiger
- Ernährung ist vorerst ausgeblendet („Coming soon“)

## 2.4.29

Mobility-Einheiten dauern jetzt wirklich so lange wie geplant.

Neu in 2.4.29:
- Korrektur: Vom KI-Coach geplante Mobility-Einheiten waren oft viel zu kurz (z. B. 10 Minuten geplant, aber nur knapp 3 Minuten Übungen). Jetzt ergeben die Übungen zusammen immer ungefähr die geplante Dauer
- Dehnungen werden mindestens 30 Sekunden gehalten. Ist eine Einheit zu kurz, werden Übungen länger oder eine passende Übung kommt dazu; ist sie zu lang, wird gekürzt
- Schon geplante, zu kurze Mobility-Einheiten werden beim nächsten Öffnen automatisch passend gemacht – auch auf der Garmin-Uhr
- Bewegungsübungen zeigen mehr Wiederholungen, wenn sie länger dauern
- Der Mitmach-Modus läuft jetzt genau so lange, wie angezeigt

## 2.4.28

Trainings landen automatisch auf deiner Garmin-Uhr, und die Einstellungen sind schlichter.

Neu in 2.4.28:
- Trainings auf die Uhr: Deine geplanten Einheiten der nächsten 7 Tage kommen automatisch in den Garmin-Kalender und auf die Uhr – mit Schritten, Zielbereichen und Hinweisen. Änderst, verschiebst oder löschst du eine Einheit, zieht Garmin mit. Einmal einrichten unter Einstellungen → Garmin
- Auch Kraft und Mobility gehen jetzt auf die Uhr, mit Übungen, Sätzen, Wiederholungen und Gewicht
- An jeder geplanten Einheit siehst du, ob sie schon „Auf der Uhr“ ist
- Überall im Dashboard heißt es jetzt „KI-Coach“ statt „Claude“
- Am Computer stehen „Analyse“ und „Insights“ (früher „Alle Diagramme“) direkt in der Seitenleiste
- Einstellungen aufgeräumt: kürzere Texte, Schlüssel-Felder erst nach „Schlüssel ändern“, Kalender-Abo und Wetter in einem Bereich, Equipment unter „Du“

## 2.4.27

Einstellungen gehen nicht mehr verloren, eine aufgeräumte Einstellungsseite und die richtige Schwimm-Pace.

Neu in 2.4.27:
- Wichtige Korrektur: Beim Öffnen des Dashboards konnten Profil-Angaben (Name, FTP, Pulswerte …) und von Hand eingetragene Gewichte verloren gehen, sobald Garmin ein Gewicht lieferte. Das ist behoben – bitte fehlende Angaben einmal neu eintragen, danach bleiben sie
- Speichern ist jetzt viel robuster: Änderungen von Handy und Computer werden zusammengeführt statt überschrieben, bei schlechtem Netz im Gerät zwischengespeichert und automatisch nachgeschickt, und beim Schließen der App noch abgeschickt
- Profilfelder speichern schon beim Tippen; selbst eingetragene Werte überschreibt der Garmin-Abgleich nicht mehr (zurück mit „↺ Garmin“)
- Einstellungen neu als übersichtliche Liste wie am iPhone: Profil, Training & Planung, Garmin, KI-Coach, Kalender-Abo, Wetter, Equipment – mit dem aktuellen Stand rechts in jeder Zeile
- „Mobility einplanen“ gibt es nur noch einmal (unter Training & Planung); Details zu Körperstellen und Ausstattung sind eingeklappt
- Schwimmen im Becken: Die Pace wird jetzt wie bei Garmin aus der Zeit in Bewegung berechnet (ohne Pausen am Beckenrand) – auch für ältere Einheiten. Neu in der Trainingsansicht: „Dauer / in Bewegung“
- Für den Betreiber: „Admin · Statistik“ unter Mehr – wie oft das Dashboard genutzt wird, welche Bereiche beliebt sind, Claude und Garmin. Nur Zahlen je Person, keine Inhalte

## 2.4.26

Am Computer wie eine richtige App, das Menü steht fest, und alles bewegt sich ein bisschen.

Neu in 2.4.26:
- Computer: Seitenleiste links mit allen Bereichen, der Inhalt nutzt die ganze Breite – auf großen Bildschirmen in drei Spalten
- Übersicht am Computer zusätzlich mit „Als Nächstes“ (die nächsten geplanten Einheiten)
- Kalender am Computer: großer Monatskalender, in jedem Tag stehen die Einheiten (gemacht farbig, geplant gestrichelt)
- Das Menü oben steht jetzt fest: alle fünf Bereiche sind immer sichtbar, nichts rutscht mehr zur Seite
- Kleine Animationen: die Markierung im Menü gleitet mit, Karten gleiten herein, Ringe zeichnen sich auf, Knöpfe geben beim Antippen nach (aus, wenn „Bewegung reduzieren“ eingeschaltet ist)

## 2.4.25

Graphit auch am Computer, Garmin gleich beim Start und ein aufgeräumtes Profil.

Neu in 2.4.25:
- Die dunkle Ansicht „Graphit“ gibt es jetzt auch am Computer: dieselben Bereiche wie am Handy, nur breiter in zwei Spalten
- Hinweis „Neue Version“ steht am Computer oben und passt zum dunklen Stil
- Onboarding: Als Erstes wird Garmin verbunden (kurze Anleitung in 3 Schritten); Gewicht, Pulswerte, Schwellenpace, Geburtsdatum und Geschlecht kommen dann automatisch – abgefragt wird nur noch, was Garmin nicht weiß
- Einstellungen: „Persönliche Daten“, „Trainingswerte“ und „Planung“ sind jetzt eine übersichtliche Liste „Dein Profil“
- Werte von Garmin sind dort mit „Garmin“ markiert und gleichen sich einmal am Tag von selbst ab; antippen zum Ändern, „↺ Garmin“ nimmt wieder den Garmin-Wert

## 2.4.24

Coach plant auf Zuruf um, und alle wichtigen Nachtwerte der Uhr zählen mit.

Neu in 2.4.24:
- Coach am Handy: „Sag dem Coach Bescheid“ – kurz schreiben, was sich ändert (z. B. „Heute spontan 45 min schwimmen“), der Coach plant die nächsten 7 Tage um und sagt, was er geändert hat; mit „Rückgängig“
- „Nächste Einheiten“ nach Tagen getrennt: Heute, Morgen, Wochentag mit Datum und Gesamtdauer
- Garmin: Handgelenktemperatur, Atemfrequenz, Blutsauerstoff (SpO2), Stress und Trainingsbereitschaft werden jetzt gelesen
- Diese Werte fließen in den Erholungsring, die Planprüfung und alle Empfehlungen des Coachs ein – erhöhte Temperatur oder schnellere Atmung im Schlaf gelten als mögliches Infektzeichen
- Übersicht am Handy: Nachtwerte unter den Ringen, auffällige Werte rot
- Erholungs-Karte: neue Kacheln und Verläufe, sobald die Uhr diese Werte liefert

## 2.4.23

Garmin holt sofort, Mobility wird erkannt, Training direkt aus dem Kalender.

Neu in 2.4.23:
- Nach dem Speichern des Garmin-Schlüssels holt das Dashboard die Daten sofort – nicht erst am nächsten Morgen
- Am Handy oben: „Jetzt von Garmin holen“, solange noch keine Daten da sind; während des Abrufs „Holt Garmin-Daten …“
- Garmins neue Aktivität „Mobility“ wird erkannt (vorher stand dort nur „86“)
- Einheiten ohne Strecke (Mobility, Kraft) zeigen keine leeren Felder für Distanz, Pace und Höhenmeter mehr; dazu Min-Puls, Trainingseffekt und Atemfrequenz, wenn Garmin sie liefert
- Geplante Kraft- oder Mobility-Einheit im Kalender antippen öffnet direkt „Training“ mit Start-Knopf
- Kein weißer Balken mehr unten am Handy (z. B. unter „Mehr“)

## 2.4.22

Handy: Mitmachen auf einen Blick und aufgeräumte Trainings-Ansicht.

Neu in 2.4.22:
- Mitmach-Modus (Mobility und Kraft) passt jetzt komplett auf den Handy-Bildschirm – Zeichnung, Uhr und Knöpfe sind immer sichtbar
- Tippst du auf eine geplante Einheit, öffnet sich eine übersichtliche Ansicht: Dauer, Intensität, Ablauf als farbige Zeitleiste wie auf der Uhr und die Hinweise als kurze Punkte
- Direkt dort: „An Garmin senden“, „Bearbeiten“, „Erledigt“ und „Überspringen“
- Das Bearbeiten-Fenster ist heller und klarer, das Beschreibungsfeld größer
- „Heute geplant“ zeigt den Ablauf in Kurzform (z. B. 15′ Aufwärmen · 45′ Zone 2 · 10′ Abwärmen)

## 2.4.21

Neue Handy-Ansicht „Graphit“ und Krafttraining zum Mitmachen.

Neu in 2.4.21:
- Am Handy: neue, dunkle Ansicht mit dem Wichtigsten zuerst – Erholung, Woche und Schlaf als Ringe, heute geplant, Wochenpunkte, Form, Ziel und letzte Einheiten
- Bereiche oben: Übersicht, Kalender, Coach, Training und Mehr (Ernährung, Rekorde, Analyse, Einstellungen öffnen sich wie gewohnt)
- Training: Mobility und Kraft zusammen; Kraft-Einheiten mit Strichfiguren, Sätzen, Pausen und „Satz geschafft“
- Gewicht pro Übung mit −/+ einstellbar, das Dashboard merkt es sich fürs nächste Mal
- Der KI-Trainingsplan wählt Kraftübungen aus der Sammlung, damit jede eine Zeichnung hat
- Lieber die alte Ansicht? Einstellungen → Konto → „Neue Handy-Ansicht“ ausschalten. Am Computer ändert sich nichts.

## 2.4.2

Garmin: genaue Fehlermeldung statt „nicht erreichbar“.

Neu in 2.4.2:
- Klappt die Verbindung zu Garmin nicht, nennt das Dashboard jetzt den Grund (z. B. falsche Uhrzeit des Rechners, Internet/DNS, Zeitüberschreitung, Verbindung abgelehnt)
- Prüfprogramm für den Raspberry Pi: `.venv/bin/python tools/garmin_check.py` (optional mit `--athlete 1` für den gespeicherten Schlüssel)

## 2.4.1

Die Handy-Ansicht aus 2.4.0 ist wieder entfernt – das Dashboard sieht auf dem Handy wieder aus wie in 2.3.0.

## 2.3.0

Garmin nur noch über die offizielle Schnittstelle, Werte aus Garmin übernehmen und Updates ganz automatisch.

Neu in 2.3.0:
- Mobility nutzt jetzt die ganze Seitenbreite
- Garmin-Daten kommen nur noch über deinen eigenen Schlüssel (offizielle Personal API); „Aktualisieren → Von Garmin holen“ läuft über den Server
- „Aus Garmin übernehmen“: Gewicht, Max-/Ruhepuls, Schwellenpace Laufen, Geburtsdatum, Geschlecht (und FTP, falls Garmin ihn liefert) – in den Einstellungen und im Onboarding, dort auch Garmin direkt verbinden
- Programm-Updates: Schalter „Automatisch installieren“ – nachts zwischen 3 und 5 Uhr, vorher wird alles gesichert

## 2.2.0

Freunde erstellen ihr Konto selbst, und du bleibst angemeldet.

Neu in 2.2.0:
- „Konto erstellen“ auf der Anmeldeseite – nur mit deinem Einladungscode (Einstellungen → Freunde einladen)
- „Einladung senden“ teilt einen Link, der den Code schon einträgt; „Neuer Code“ macht den alten ungültig
- „Angemeldet bleiben“: Wer das Dashboard mindestens alle 90 Tage öffnet, muss sich nicht mehr neu anmelden
- Neu gestaltete Anmeldeseite

## 2.1.1

Raspberry Pi als Server mit fester https-Adresse für alle.

Neu in 2.1.1:
- Einsteiger-Anleitung für den Raspberry Pi (docs/RASPBERRY_PI_ANLEITUNG.md)
- Ein Befehl für eine feste, verschlüsselte Adresse von überall – auch für Freunde ohne App (Tailscale Funnel)
- Konten für weitere Personen mit einem Befehl anlegen
- Mehr Schutz bei öffentlicher Adresse: Sperre je Konto nach 10 Fehlversuchen, echte Besucher-Adresse hinter Tailscale, Schutz-Kopfzeilen
- Updates bleiben auch auf alten 32-Bit-Systemen möglich (dann ohne Claude)

## 2.1.0

Mobility mit Bildern, ein Trainingsprofil für alle Wünsche und Claude als KI-Coach.

Neu in 2.1.0:
- Neuer Tab „Mobility“: jeden Tag eine passende Einheit (z. B. nach dem Lauf gestern), Dauer und Schwerpunkt wählbar
- 33 Übungen, jede mit bewegter Zeichnung, 3 einfachen Schritten, typischen Fehlern, leichterer und schwererer Variante und Video-Link
- Mitmach-Modus fürs Handy: großer Timer, Seitenwechsel, Ansage, Bildschirm bleibt an
- Rückmeldung nach jeder Einheit (zu leicht / passt / zu schwer, tat etwas weh?) – die nächste Einheit passt sich an
- „Dein Trainingsprofil“ in den Einstellungen: Ziele, Beschwerden, Hilfsmittel, Ausschlüsse und Wünsche an einer Stelle – fließt in jede KI-Planung ein
- Claude als KI-Coach: Schlüssel einmal auf dem Server hinterlegen, gilt für alle Geräte; Mobility-Einheiten im Trainingsplan nutzen die Übungs-Sammlung

Hinweis: Das Update installiert das Python-Paket „anthropic“ mit.

## 2.0.0

Erste Version mit eingebauter Update-Funktion.

Neu in 2.0.0:
- Dashboard als Server auf dem eigenen PC, mit Login – jede Person sieht nur ihre eigenen Daten (Freunde über Tailscale)
- Garmin: offizielle Personal API (eigener Schlüssel je Person, kein Passwort) und „An Garmin senden“
- Trainingsplaner mit Regelwerk, Wettkampf-Countdown und Trainingsphasen
- Analyse-Tab, Rennplan, Wetter im Kalender, Material
- Handy/iPhone: als App auf den Home-Bildschirm
- Programm-Updates: neue Versionen erscheinen als Hinweis im Dashboard und lassen sich mit einem Klick installieren

Wichtig: Wer eine ältere Version hat, aktualisiert dieses eine Mal von Hand (ZIP neu herunterladen oder git pull). Danach geht es automatisch.
