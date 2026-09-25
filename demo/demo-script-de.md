# LoopLocal: 80-Sekunden-Demonstration

**Nur synthetische Daten.** Diese Fassung zeigt den lokal geprüften Browserablauf. Kamera-Scan auf echter Hardware und Telefon-zu-Telefon-Zugriff gehören zur separaten Gerätetestliste.

## Vorbereitung außerhalb der Aufnahme

1. Die kompilierte, isolierte Vorschau auf `http://localhost:3001` starten. Das Anmeldeschild `counter-sign.html` verweist auf dieses Programm und funktioniert nur auf dem Mac selbst.
2. Die synthetische Vorschau nutzt die geprüfte Prämiengrenze von **8 Stempeln**. Für den Gast ein frisches Browserprofil an der öffentlichen Programmseite bereithalten; die Karte erst während der Aufnahme erstellen. Das Programm für diese Aufnahme nicht umstellen, damit `npm run preview:browser-check` mit derselben Grenze wiederholbar bleibt.
3. Den Kassenbildschirm in einem zweiten Browserfenster mit dem synthetischen Kassenkonto öffnen. Die neue Kartenadresse nach der Anmeldung nur lokal als Lesezeichen sichern. Keine Zugangsdaten oder Bearer-Token in der Aufnahme vorlesen oder als Klartext vergrößern.

| Zeit | Bild / Aktion | Sprechertext |
| --- | --- | --- |
| 0–10 s | Anmeldeschild und öffentliche Programmseite öffnen. | „Das ist LoopLocal als lokale Testvorschau für ein erfundenes Kasseler Café. Der QR führt zur digitalen Kaffeekarte.“ |
| 10–22 s | Regeln lesen, Teilnahme bestätigen, Karte ohne E-Mail erstellen. | „Gäste lesen die Regeln und erstellen ihre Browserkarte ohne E-Mail-Adresse oder App.“ |
| 22–32 s | Karte zeigen: Geschäftsname, vollständiger QR, Stand **0**; Kartenadresse als lokales Lesezeichen sichern. | „An der Kasse zählt der aktuelle Stand. Die Karte lässt sich später über ihre gespeicherte Adresse wieder öffnen.“ |
| 32–44 s | Kassenansicht zeigen; Kameraaktion kurz sichtbar machen, dann die manuelle Kennung eingeben und Karte finden. | „Die Kasse hat eine Kameraaktion. Den Hardware-Scan prüfen wir separat; hier nutze ich die geprüfte manuelle Suche. Das Finden der Karte bucht noch nichts.“ |
| 44–55 s | Standardmenge **1** zeigen, bewusst auf **8** erhöhen, Vergabe ausdrücklich bestätigen und die Serverbestätigung abwarten. | „Die Kasse beginnt bei eins. Für diese Vorführung wähle ich acht; erst die Bestätigung bucht sie. Eine Wiederholung derselben Anfrage erzeugt keine zweite Buchung.“ |
| 55–67 s | Kundenkarte neu laden: Stand **8** und `+8` Aktivität. Dann an der Kasse die Einlösung bestätigen. | „Nach dem Laden stehen acht Stempel auf der Karte. Die synthetische Prämie kostet acht; ich löse sie jetzt ein.“ |
| 67–80 s | Kartenfenster schließen, gespeicherte Kartenadresse wieder öffnen: Stand **0**, `+8` und `−8` Aktivität. | „Auch nach erneutem Öffnen stimmt der gespeicherte Stand: null. Beide Buchungen sind nachvollziehbar.“ |

**Aufnahmehinweis:** Wenn die Kamera im Mac-Smoke-Test tatsächlich funktioniert, kann die manuelle Suche in Sekunde 32–44 durch einen echten Scan ersetzt werden. Diesen Pfad erst nach Durchführung als Hardwaretest bezeichnen; die Aufnahme selbst bleibt eine lokale Demo und kein Telefon-zu-Telefon-Nachweis.
