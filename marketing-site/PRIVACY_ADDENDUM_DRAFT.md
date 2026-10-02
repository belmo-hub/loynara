# Datenschutz – sachlicher Zusatz (ENTWURF, nicht angewendet)

Status: Entwurf zur Freigabe durch den Betreiber. `legal/datenschutz.html` wurde **nicht** verändert. Der Text beschreibt nur Verhalten, das im Code und per Browsertest am 2. Oktober 2026 geprüft wurde (Chromium, lokal). Er ist kein Rechtstext und keine rechtliche Bewertung.

## Geprüfte Fakten
- Das Rechenbeispiel läuft vollständig im Arbeitsspeicher der geöffneten Seite. Beim Ändern der Werte (Schieberegler oder Eingabe) wurden **keine** Netzwerkanfragen ausgelöst (gemessen: 0 Anfragen nach Eingaben und nach dem Übernehmen).
- Die Eingaben werden **nicht** gespeichert: `localStorage` und `sessionStorage` sind leer, es gibt keine Cookies, die Adresszeile ändert sich nicht, und nach einem Neuladen stehen wieder die Beispielwerte (50 / 7 € / 26 / 10 %) da. Der Code enthält keinen Zugriff auf Browser-Speicher oder `fetch`/`XMLHttpRequest`; die Content-Security-Policy erlaubt keine ausgehenden Verbindungen (`connect-src 'none'`).
- Nur nach Klick auf „Diese Zahlen in meiner Anfrage übernehmen“ werden die eingegebenen Werte (Käufe pro Tag, durchschnittlicher Einkaufswert, Öffnungstage, angenommene Zunahme, Gebühr, errechneter Zusatzumsatz und Differenz) in den vorbereiteten E-Mail-Text der Anfrage aufgenommen. Das Formular zeigt dies an und bietet „Entfernen“.
- „E-Mail vorbereiten“ öffnet über einen mailto-Link das E-Mail-Programm der Besucherin oder des Besuchers. Die Seite sendet nichts; gesendet wird erst, wenn die Nachricht dort abgeschickt wird. „Text kopieren“ legt denselben Text (mit den Zahlen, falls übernommen) auf Wunsch in die Zwischenablage (bereits in der bestehenden Erklärung beschrieben).

## Vorgeschlagener Zusatz (zur Ergänzung in Abschnitt 3 „Produktdemo, Cookies und externe Inhalte“)

> **Rechenbeispiel.** Im Rechenbeispiel können Sie eigene Geschäftszahlen eingeben (zum Beispiel Käufe pro Tag, durchschnittlicher Einkaufswert, Öffnungstage und eine angenommene Zunahme). Die Berechnung und die Grafik erfolgen ausschließlich im Arbeitsspeicher Ihres Browsers. Beim Ändern der Werte werden keine Daten an einen Server übermittelt, und die Werte werden nicht gespeichert; nach dem Neuladen der Seite sind sie wieder zurückgesetzt. Nur wenn Sie ausdrücklich auf „Diese Zahlen in meiner Anfrage übernehmen“ klicken, werden die eingegebenen Werte in den vorbereiteten E-Mail-Text aufgenommen; Sie können sie dort wieder entfernen. Gesendet wird der Text erst, wenn Sie die Nachricht in Ihrem E-Mail-Programm abschicken.

## Zur Freigabe offen
1. Betreiber entscheidet, ob und in welchem Wortlaut der Zusatz in `legal/datenschutz.html` übernommen wird (vor der Veröffentlichung der neuen Seite).
2. Der Satz „… die lokale Produktdemo …“ im Einleitungsabsatz bezieht sich auf die In-Page-Demo (Abschnitt 3 erklärt dies) und ist sachlich nicht veraltet; ob er verständlicher formuliert werden soll, ist eine redaktionelle Entscheidung.
