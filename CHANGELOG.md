# Was ist neu

Jede Version hat hier einen Abschnitt `## <Versionsnummer>` (genau wie in der
Datei `VERSION`). Der Text darunter erscheint auf GitHub als Release-Text und
im Dashboard unter „Was ist neu?“. Neueste Version oben.

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
