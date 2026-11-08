# Was ist neu

Jede Version hat hier einen Abschnitt `## <Versionsnummer>` (genau wie in der
Datei `VERSION`). Der Text darunter erscheint auf GitHub als Release-Text und
im Dashboard unter „Was ist neu?“. Neueste Version oben.

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
