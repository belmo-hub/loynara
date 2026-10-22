# 05 · Sales playbook: walk-in, WhatsApp, Instagram, email, phone

## Outreach policy (Loynara's conservative default)

**Walk in first. Go digital only on an appropriate permission basis.**

Walk-in-first is **Loynara's own conservative GTM policy**. It is not a claim that German law requires every first B2B contact to be in person. It is the safest default because:
- UWG §7 restricts unsolicited advertising by email, messenger and DM without prior express consent, including towards businesses.
- Telephone advertising to businesses requires at least the recipient's presumed consent.
- Applying that to a specific case is a legal question, and this playbook does not answer it.

The policy below stays deliberately narrower than what the law may allow. It does not broaden cold email or WhatsApp use. Any change to it needs the owner's decision and qualified legal review.

| Channel | Use for | Not used for (policy) |
|---|---|---|
| Walk-in | First contact (default) | — |
| WhatsApp | Follow-up after the owner said „schick mir das“ / gave the number; replies to people who wrote first | First contact from a number found online |
| Instagram DM | Follow-up after permission; replies to people who wrote first or commented | Cold DMs to shop accounts |
| Email | Follow-up after permission; replies to inbound requests | Cold sequences to addresses from websites |
| Phone | Calls the owner agreed to; callbacks to inbound requests | Cold calling as a routine channel. A single B2B call is considered only with a strong, documented relevance basis, e.g. the owner asked a third party to have us call. Record that basis before calling. |

Log every permission in `data/private/pipeline.csv` (`permission_channel`, `permission_date`, `permission_words`). This matches the existing `outreach/` tooling, where every prospect starts at `CONSENT_UNKNOWN`. *This is a working practice, not legal advice. Have the Datenschutz/UWG setup reviewed once before scaling.*

**About the original playbook's „Cold DM / WhatsApp“ lines.** They are kept, not deleted, and serve as **permitted follow-up and inbound-reply** texts under this policy ([§6](#6--original-playbook-messages-as-permitted-follow-ups)).

Tone everywhere:
- A local founder talking to another owner. Short sentences, no SaaS words: never „Lösung“, „Plattform“, „optimieren“, „Customer Journey“, „Engagement“.
- „Du“ by default with barbers and younger owners. Switch to „Sie“ the moment the owner uses it.

---

## 1 · Walk-in script (barber version; pizzeria and café variations below)

**Before you enter (10 seconds):**
- Is there a paper stamp card at the counter?
- Is the owner there?
- Is it busy? If a customer is waiting, come back. Say so: „Ich seh, du hast zu tun – wann passt's besser? Heute 16 Uhr?“

**Opener (≤ 20 seconds):**
> „Hi, ich bin [Name], ich mach hier in Kassel digitale Stempelkarten für Läden wie deinen. Darf ich dir in zwei Minuten zeigen, wie das aussieht? Wenn's nichts für dich ist, bin ich direkt wieder weg.“

If they have a paper card at the counter:
> „Ich seh, ihr habt Stempelkarten – genau darum geht's. Nur ohne Papier.“

**Show-the-card moment (the actual pitch):**

*Until a production demo merchant exists (D-3, see [06](06-demo-script.md)):* hold out the tablet with the isolated demo.
> „Schau, so sieht das dein Kunde: Kamera auf den Code am Tresen, die Karte ist im Browser. Keine App, nix runterladen.“

*After D-3:* hold out the demo QR.
> „Scann mal kurz mit deiner Kamera.“

Wait until the card opens in their browser.

Then, either way:
> „Wenn er nächstes Mal da ist, zeigt er dir die, du scannst, Stempel ist drauf. Selbst stempeln geht nicht.“

**The one question that matters (discovery, 3 questions max):**
1. „Wie viele von deinen Kunden sind Stammkunden – so grob?“
2. „Merkst du, wenn einer davon ein paar Wochen nicht mehr da war?“
3. „Was nervt dich an den Papierkarten?“ Only ask this if they have them.

Let them talk. Write the answer down after you leave, not in front of them.

**Show the owner side (only if question 2 landed):**
> „Und das hier siehst du: wie viele Karten diesen Monat wiederkamen, und pro Karte Stand und letzten Besuch. Diese Karte war vor neun Wochen das letzte Mal da. Namen zeigt Loynara nicht – aber du siehst, dass sich da was tut oder eben nicht.“

**Price, plainly (when they ask, or after the owner view):**
> „Normal 49 €, für die ersten Betriebe in Kassel 39 €, und das bleibt so, solange du dabei bist. Pro Monat für den Laden, egal wie viele Stühle oder Kunden. Bei 25 € pro Haarschnitt sind 49 € zwei Haarschnitte im Monat. Ob die zusätzlich kommen, kann dir keiner versprechen – aber du siehst es schwarz auf weiß.“

**Close: ask for the smallest real step:**
- Strong fit (score ≥ 8, see [03-verticals.md](03-verticals.md)):
  - *Before the owner clears the commercial gates* (ask for pilot interest only):
    > „Ich starte gerade mit den ersten Läden hier. Wenn die Bedingungen schriftlich stehen – willst du dabei sein? Dann melde ich mich bei dir, sobald ich dir alles geben kann. Zahlen oder ein festes Startdatum gibt's vorher nicht.“
  - *After the gates are cleared:*
    > „Wollen wir's ausprobieren? Ich komm diese Woche einmal vorbei, wir legen die Prämie fest, drucken das Schild, und ab dem nächsten Kunden läuft's. Bevor du irgendwas zahlst, bekommst du alles schriftlich.“
- Medium fit:
  > „Ich lass dir das hier da (Handzettel). Darf ich dir nächste Woche kurz per WhatsApp schreiben, ob du Fragen hast?“
  Only a clear yes counts as permission. Write down their words.
- No:
  > „Alles klar, danke dir für die zwei Minuten. Wenn du jemanden kennst, für den das passt – ich freu mich.“

**Leave within 5 minutes unless they keep asking.** Respect is the brand.

**Variations:**
- **Pizzeria:**
  - Opener: „Ihr habt doch bestimmt auch so 'ne Karte – die zehnte Pizza umsonst?“
  - Price line: „Bei 18 € pro Bestellung sind 49 € aufgerundet drei Bestellungen.“
  - Say unprompted: „Lieferando-Bestellungen laufen da nicht drüber – das ist für die, die bei dir am Tresen bestellen oder abholen.“
  - Show multiple stamps in one step for family orders.
- **Café:**
  - Go only when there's no queue.
  - Opener: „Der zehnte Kaffee – kennst du. Darf ich dir zeigen, wie das ohne Papierkarte aussieht?“
  - Price: „Bei rund 6 € pro Besuch – Kaffee und was dazu – sind das sieben Besuche im Monat.“ Use their real average basket and calculate it live, rounding up.
  - Address queue fear directly: „Der Scan passiert, während die Maschine läuft.“
- **Salon / Nails:**
  - Opener via the referral angle: „Wie kommen eigentlich neue Kundinnen zu dir? … Meistens über Empfehlung, oder?“

---

## 2 · WhatsApp (only after a recorded „ja, schreib mir“)

Keep each message under 4 lines, with no attachments in message 1 and no voice notes unless they send one first.

**W1: same day (thank you + the one thing they asked about):**
> Hi [Vorname], hier ist [Name] – war vorhin mit der digitalen Stempelkarte bei dir im Laden. Danke für die Zeit! Wie versprochen: so sieht die Karte aus ↓
> [Link zur Seite /fuer-barber/ – erst nach Veröffentlichung, sonst Screenshot mit „Beispiel“]
> Wenn du Fragen hast, schreib einfach.

**W2: day 3–4 (answer their objection, one new piece of information):**
> Hi [Vorname], du hattest gefragt, [was wenn Kunden kein Smartphone haben / ob das an der Kasse aufhält]. Kurz: [eine Antwort aus 07-objections.md, max. 2 Sätze].
> Soll ich Donnerstag kurz vorbeikommen und dir das am Tresen zeigen?

**W3: day 10 (last message, easy out):**
> Hi [Vorname], ich will dich nicht zuschreiben – das ist meine letzte Nachricht dazu. Wenn du's irgendwann ausprobieren willst, meld dich einfach. Und falls du einen Kollegen kennst, für den's passt: ich freu mich über den Kontakt.

After W3: stop, and mark the contact `closed_no_reply`. If they ask to stop at any point, reply „Alles klar, danke dir!“ and mark them `SUPPRESSED`.

**After pilot go-live (operational, not promotional):**
- Day 1: „Läuft? Wenn beim ersten Scan was hakt, ruf mich direkt an: [Nummer].“
- Day 7: „Kurzer Blick in deine Übersicht: [X] Karten, [Y] bestätigte Besuche diese Woche. Passt das zu deinem Gefühl?“ Real numbers only.

---

## 3 · Instagram DMs

Allowed only:
- (a) as a reply to someone who messaged us or commented
- (b) after permission was given in person

**I1: reply to a comment like „Was kostet das?“:**
> Hi! 49 € pro Monat und Standort, ohne App für deine Kunden. Was für einen Laden hast du? Dann zeig ich dir das passende Beispiel.

**I2: after in-person permission:**
> Hey, [Name] hier – wir haben heute im Laden gesprochen 👋 Hier wie besprochen das Beispiel für Barber: [Link/Screenshot „Beispiel“]. Sag Bescheid, wann ich zum Einrichten vorbeikommen soll.

**I3: follow-up after 5 days (once only):**
> Kurze Frage noch: Passt diese Woche oder lieber nächste? Wenn's gerade nicht passt, auch völlig ok.

Never send:
- Cold DMs
- Mass DMs
- „Ich hab euer Profil gesehen und…“
- Links in the first DM to someone who didn't ask

---

## 4 · Email (after permission, or as a reply to an inbound request)

Plain text, one link at most, no images. Subject lines are short and internal-sounding.

**E1: day 0. Subject: `stempelkarte – wie besprochen`**
> Hallo [Vorname],
>
> danke für das Gespräch heute bei [Laden]. Wie versprochen, kurz das Wichtigste:
>
> – Dein Kunde scannt einmal den QR-Code am Tresen, die Karte öffnet sich im Browser. Keine App.
> – Ein Stempel zählt erst, wenn dein Team ihn bestätigt.
> – Du siehst, wie viele wiederkommen, und pro Karte den letzten Besuch.
> – 49 € pro Monat und Standort. Für die ersten Betriebe gibt es einen Gründungspreis – im persönlichen Gespräch. Alle Bedingungen bekommst du schriftlich, bevor du etwas zahlst.
>
> Wenn du's ausprobieren willst: Antworte einfach mit einem Tag, an dem ich vorbeikommen kann.
>
> Viele Grüße
> [Name]
> [Telefon] · support@getloynara.com

**E2: day 4. Subject: `deine frage zu [thema]`**
> Hallo [Vorname],
>
> du hattest gefragt, [Frage]. [Antwort in 2–3 Sätzen, aus 07-objections.md.]
>
> Passt dir [Tag] am Nachmittag für 30 Minuten? Ich zeig's dir am Beispiel deines Ladens. (Nach Freigabe der Bedingungen: „…für die Einrichtung?“)
>
> [Name]

**E3: day 12. Subject: `letzte nachricht dazu`**
> Hallo [Vorname],
>
> ich melde mich hierzu nicht mehr, versprochen. Falls du später doch ausprobieren willst, reicht eine kurze Antwort.
>
> Eine Bitte noch: Wenn dir ein anderer Ladeninhaber einfällt, für den das passen könnte, freu ich mich über einen Hinweis.
>
> [Name]

**Sie-variant:** replace du/dein with Sie/Ihr and use „Guten Tag Herr/Frau [Nachname]“. Keep the length the same.

**Footer:** every promotional email after permission needs a sender identity (Impressum data, O-001) and an easy opt-out line: „Wenn du keine weiteren Nachrichten möchtest, antworte einfach mit ‚Stopp‘.“

---

## 5 · Phone (only agreed calls)

**Use:**
- Calls the owner asked for („ruf mich morgen an“)
- Callbacks to inbound requests
- Pilot support

**Opening:**
> „Hallo [Vorname], [Name] hier – wir hatten gestern im Laden gesprochen, du meintest, ich soll heute anrufen. Passt's gerade zwei Minuten?“

If not: „Wann passt's besser?“ Then hang up.

**Structure (≤ 5 min):**
1. Ask about the open question from the visit. Listen.
2. Answer in one or two sentences.
3. Ask for the next step: a demo visit, or a setup appointment once the commercial gates are cleared („Dienstag oder Donnerstag, eher 15 oder 16 Uhr?“).
4. Confirm by WhatsApp or email only if they agree: „Soll ich dir den Termin kurz per WhatsApp bestätigen?“

**Voicemail:** leave one, once.
> „Hallo [Vorname], [Name] wegen der Stempelkarte, wie besprochen. Ich versuch's morgen Nachmittag nochmal, oder du rufst kurz zurück: [Nummer].“

---

## Sequence map

```
Walk-in ─┬─ Pilot interest ─────────► before gates: log pilot_interest_date, promise nothing
         │                             after gates:  setup appointment (≤ 5 days) → onboarding checklist (12-collateral.md)
         ├─ "Schick mir das" (permission) → W1/E1/I2 day 0 → W2/E2 day 3–4 → visit or call → W3/E3 day 10–12 → stop
         ├─ "Komm nochmal vorbei" ──► second walk-in at the time they named (no digital contact)
         └─ No ─────────────────────► log objection, ask for an introduction, leave
```

---

## 6 · Original playbook messages as permitted follow-ups

The original playbook wrote one „Cold DM / WhatsApp“ line per priority angle. Under this policy each one is sent **only** after recorded permission or as a reply to someone who wrote first. Each is adjusted to today's evidence state.

| Angle | Original line (adjusted) | Adjustment |
|---|---|---|
| CORE-01 Der nächste Besuch | „Kurze Frage noch von gestern: Was machst du aktuell, damit ein Kunde nach seinem ersten Besuch wirklich wiederkommt?“ | Framed as a follow-up |
| RET-01 Ruhende Karten | „Was wäre für dich interessant: zu sehen, welche Karten früher regelmäßig benutzt wurden und plötzlich ruhen?“ | „welche Stammkunden“ → „welche Karten“ (pseudonymous) |
| FUT-08 Ruhige Zeiten | Not sent. Original: „…Aktionen an bestehende Kunden möglich machen.“ | Campaigns are FUTURE; at most say „ist Ausblick“ |
| CORE-07 Empfehlungen | „Wenn ein Stammkunde einen Freund mitbringt: würdest du ihn dafür belohnen? Genau so einen Ablauf hat Loynara – Bonus erst nach dem ersten bestätigten Besuch.“ | Bonus rule added |
| CORE-02 Fortschritt | „Nutzt ihr aktuell Stempelkarten? Stell dir vor, der Kunde sieht seinen Fortschritt direkt auf dem Handy.“ | unchanged |
| CORE-04 Keine App | „Das Wichtigste: Der Kunde muss keine App installieren. QR-Code scannen, Karte öffnet sich direkt.“ | „NFC antippen oder“ removed until the NFC gate ([15](15-copy-switches.md)) |
| CORE-05 Ablauf im Stress | „Mitarbeiter müssen im Stress nichts Kompliziertes lernen: Karte scannen → bestätigen → fertig.“ | unchanged |
| TRU-08 Marke | „Das Schild und die Kundenkarte sehen nach deinem Laden aus – in deiner Farbe und mit deinem Namen.“ | Logo and premium stand removed (FUTURE) |
| CORE-08 Sehen, ob es genutzt wird | „Du kennst viele Stammkunden vom Gesicht. Willst du auch sehen, wie viele wirklich regelmäßig kommen?“ | „wer“ → „wie viele“ |
| FUT-12 Insight → Action | Not sent | FUTURE |
| CORE-09 49 € | „Ich will dir nicht erzählen, dass Loynara garantiert X Umsatz bringt. Trag lieber deine Zahlen ein und schau dir das Szenario an.“ | unchanged (it already refuses the guarantee) |
| OPS-01 Echte Schicht | „Wenn ein Kunde seinen Link verliert, soll das nicht in Chaos enden. Heute legst du eine neue Karte an und buchst nach; mit dem nächsten Update stellst du die Karte mit gleichem Stand neu aus.“ | RC wording until release |

Original pizzeria example (§5), as a permitted follow-up:
> „Kurze Frage noch: Was macht ihr aktuell, damit jemand, der heute bei euch bestellt, in zwei Wochen wieder bei euch bestellt – und nicht irgendwo anders? Kunden sammeln bei uns digital Prämien, können Freunde empfehlen und brauchen keine App. Ich zeig's dir gern fünf Minuten und will ehrlich wissen, ob du das in deinem Laden nutzen würdest.“

