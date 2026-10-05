# 08 · Ad concepts (32)

## Ground rules for every concept

1. **Untested hypotheses.** No winning ads, reviews or comments exist yet, so every concept is grounded in product evidence ([01-product-truth.md](01-product-truth.md)), not in performance data. After the first 2 weeks of organic posting, rank by the measurement hypothesis and iterate. Keep a log in `data/private/learning-log.csv` (type `ad`).
2. **What can run when:**
   - **Organic** (IG Reels, TikTok, IG static/carousel): once the account shows an Impressum. That needs O-001 operator identity.
   - **Paid** (Meta geo-targeted Kassel + 15 km, TikTok): only after the public site with Impressum and Datenschutz is live (O-014). Each ad also needs a page that keeps the ad's promise.
3. **Footage rules:**
   - Every card or owner screen is the demo merchant or a marketing-site example, labelled „Beispiel“ on screen.
   - Staged scenes carry „Gestellte Szene“ in the corner.
   - Real shops appear only with written permission.
   - No actor plays a "happy merchant".
4. **Banned in every concept:**
   - NFC tap, Wallet buttons or a logo on the card shown as available
   - Sending a message to customers
   - Revenue or percentage claims
   - „kostenlos“, „nur noch“, deadlines
   - Competitor names
5. **CTAs available before the site exists** (inbound-only, so legal):
   - „Schreib uns ‚KARTE‘ per DM“: they start the conversation.
   - „Komm am Tresen vorbei? Nein – wir kommen zu dir: DM ‚VORBEI‘“
   - After O-014: link to the matching page (`/fuer-barber/`, `/fuer-pizzerien/`, `/empfehlungen/`, `/`).

**Measurement vocabulary:**
- **Hold3s:** 3-second view rate
- **Saves**
- **DM-KW:** DMs with the keyword
- **Walk-in recognition:** an owner says they saw us online, logged as `heard_of_us=yes` in `pipeline.csv`

Formats: **R** = IG Reel 9:16 · **T** = TikTok 9:16 · **S** = static 4:5 · **C** = carousel 4:5.

---

### AD-01 · „Fremde Jackentaschen“
- **Format:** R/T · **Vertical:** all · **Angle:** A1 · **Status:** SELL NOW
- **Hook:** „Wie viele deiner Stempelkarten liegen gerade in fremden Jackentaschen?“
- **On-screen text:** „Die Stempelkarte – jetzt auf dem Handy. Ohne App.“
- **Visual:** A crumpled paper card pulled from a jacket, then a phone scanning a counter QR, then a card opening (Beispiel).
- **15s:** Hook (0–3) → jacket/paper card (3–6) → scan, card opens (6–11) → „Ohne App. Dein Team bestätigt jeden Stempel.“ (11–15)
- **30s:** The 15s cut, plus the staff confirm close-up (15–21), the owner list „wer wiederkommt“ (21–26) and the price line „39 € pro Monat und Laden“ (26–30).
- **CTA:** DM „KARTE“
- **Measure:** Hold3s ≥ 30 % means the paper-card pain is recognised. Compare with AD-03.

### AD-02 · „Selbststempeln“
- **Format:** R/T · **Vertical:** pizzeria, café · **Angle:** A4 · **Status:** SELL NOW
- **Hook:** „Der Kunde hat zufällig auch einen Stempel zu Hause.“ (wink, staged)
- **On-screen text:** „Ein Stempel zählt erst, wenn dein Team ihn bestätigt.“
- **Visual:** A hand stamping a paper card under the table (Gestellte Szene), then staff scan and confirm on the phone.
- **15s:** Hook (0–4) → staged stamping (4–7) → staff scan + confirm (7–12) → text (12–15)
- **30s:** The 15s cut, plus „Jeder Besuch hat einen Namen dahinter“ with the booking line in the owner view (15–24) and the CTA (24–30).
- **CTA:** DM „KARTE“
- **Measure:** Comments mentioning fraud mean the trust angle has pull. Count comments by theme.

### AD-03 · „Keine App. Kein Gerät.“
- **Format:** S + R · **Vertical:** all · **Angle:** A3 · **Status:** SELL NOW
- **Hook:** „Keine App. Kein Gerät. Ein QR-Code am Tresen.“
- **On-screen text:** The headline plus a small „Beispiel“ on the card.
- **Visual (static):** A printed Tresenschild next to a register, with a phone showing the card.
- **15s:** Close-up of the sign (0–3) → scan (3–7) → card opens in the browser, URL bar visible (7–12) → headline (12–15)
- **30s:** The 15s cut, plus the owner printing the sign on an office printer (15–22) and „Heute eingerichtet, morgen stempelt dein erster Kunde“ (22–30).
- **CTA:** DM „KARTE“
- **Measure:** Static vs. Reel on Saves. If the static saves more, owners screenshot it to decide later.

### AD-04 · „Du kennst Gesichter, nicht Abstände“
- **Format:** R · **Vertical:** barber · **Angle:** A2/B3 · **Status:** SELL NOW
- **Hook:** „Du kennst deine Stammkunden. Aber weißt du, wer seit sechs Wochen fehlt?“
- **On-screen text:** „Sieh, wer wiederkommt – und wer fehlt.“
- **Visual:** The founder in a barber chair (own footage). The phone shows the owner list (Beispieldaten), zooming on „vor 9 Wochen“.
- **15s:** Hook (0–4) → list scroll (4–10) → zoom on 9 weeks (10–13) → text (13–15)
- **30s:** The 15s cut, plus „Was du damit machst, entscheidest du – persönlich, wie bisher.“ (15–22) and the price (22–30).
- **CTA:** DM „KARTE“
- **Measure:** DM-KW from barber accounts. This is the barber-specific pain test.

### AD-05 · „Zwei Haarschnitte“
- **Format:** S · **Vertical:** barber · **Angle:** A6 · **Status:** SELL NOW (Rechenbeispiel)
- **Hook:** „39 € im Monat. Das sind zwei Haarschnitte.“
- **On-screen text:** The headline plus a small „Rechenbeispiel bei 25 € pro Haarschnitt. Keine Prognose.“
- **Visual:** Two pairs of scissors on a mirror shelf, with the price card overlay.
- **15s:** Scissors (0–3) → „39 €“ (3–7) → „= 2 Haarschnitte“ (7–11) → fine print + CTA (11–15)
- **30s:** The 15s cut, plus „Ob die zusätzlich kommen, kann dir keiner versprechen. Aber du siehst es.“ with the owner list (15–30).
- **CTA:** DM „RECHNEN“
- **Measure:** If DM „RECHNEN“ > DM „KARTE“, price clarity is a driver, so move the break-even earlier in the walk-in.

### AD-06 · „Die zehnte Pizza“
- **Format:** R/T · **Vertical:** pizzeria · **Angle:** B4 · **Status:** SELL NOW
- **Hook:** „Die zehnte Pizza kennt jeder. Jetzt ohne Pappkarte.“
- **On-screen text:** „Ohne App. Am Tresen bestätigt.“
- **Visual:** A pizza box with a paper card taped on, then a phone card filling to 9/10, then 10/10 reward state (Beispiel).
- **15s:** Hook (0–3) → paper card (3–5) → stamps filling (5–12) → reward state (12–15)
- **30s:** The 15s cut, plus „Lieferplattform-Bestellungen laufen nicht darüber – das ist für deine Abholer.“ (15–23) and the CTA (23–30).
- **CTA:** DM „PIZZA“
- **Measure:** Pizzeria owner DMs. If comments say „und Lieferando?“, the qualifier lands.

### AD-07 · „Familienbestellung“
- **Format:** R · **Vertical:** pizzeria · **Angle:** B6 · **Status:** SELL NOW
- **Hook:** „Vier Pizzen. Ein Scan. Vier Stempel.“
- **On-screen text:** The same line, then „Beispiel“.
- **Visual:** Staff screen choosing 4 stamps in one step.
- **15s:** Hook (0–3) → stack of 4 boxes (3–6) → staff picks 4 (6–11) → card shows +4 (11–15)
- **30s:** The 15s cut, plus „Ein Stempel pro Pizza, nicht pro Besuch – du legst fest, wie gezählt wird.“ (15–30). Check first that the programme setting supports this wording; otherwise cut the line.
- **CTA:** DM „PIZZA“
- **Measure:** Saves. A demonstration of a practical counter problem.

### AD-08 · „Keine Provision pro Bestellung“
- **Format:** S · **Vertical:** pizzeria · **Angle:** B5/A7 · **Status:** SELL NOW
- **Hook:** „Keine Provision pro Bestellung. Ein Preis pro Laden.“
- **On-screen text:** Headline plus the small line „Bestellungen über Lieferplattformen laufen nicht über Loynara.“
- **Visual:** Plain receipt-style graphic: „Loynara: 39 € / Monat / Standort“.
- **15s:** Receipt prints (0–6) → headline (6–11) → qualifier + CTA (11–15)
- **30s:** The 15s cut, plus the founder to camera: „Deine Stammkunden gehören dir, nicht einer Plattform.“ (15–30)
- **CTA:** DM „PIZZA“
- **Measure:** Engagement versus AD-06. Is anti-platform sentiment stronger than the ritual?

### AD-09 · „Barber leben von Mundpropaganda“
- **Format:** R/T · **Vertical:** barber · **Angle:** B2/A5 · **Status:** SELL NOW
- **Hook:** „Barber leben von Mundpropaganda. Jetzt zählt sie.“
- **On-screen text:** „Bonus erst nach dem ersten bestätigten Besuch.“
- **Visual:** The referral pair Deniz → Tim (Beispieldaten). Phone A shares a link, phone B opens the card, staff confirm, both get a bonus.
- **15s:** Hook (0–3) → share (3–6) → newcomer at the chair (6–10) → both bonus (10–15)
- **30s:** The 15s cut, plus „Fürs bloße Teilen gibt's nichts. So bleibt's fair.“ (15–22) and the CTA (22–30).
- **CTA:** DM „EMPFEHLUNG“
- **Measure:** If DM „EMPFEHLUNG“ beats DM „KARTE“, lead barber walk-ins with referrals.

### AD-10 · „Fürs Teilen gibt's nichts“
- **Format:** C (5 slides) · **Vertical:** barber, salon · **Angle:** A5/D5 · **Status:** SELL NOW
- **Hook (slide 1):** „Empfehlungsprogramme, die nicht ausgenutzt werden.“
- **On-screen text:**
  1. Hook
  2. „Stammkunde teilt seinen Link“
  3. „Neuer Kunde kommt – dein Team bestätigt“
  4. „Erst dann: Bonus für beide“
  5. „Teilen allein bringt nichts. Ob jemand auch ohne Empfehlung gekommen wäre, kann niemand wissen.“
- **Visual:** Example cards per slide.
- **15s:** Slides 1–4 as a quick cut.
- **30s:** All 5 slides with founder voice-over.
- **CTA:** DM „EMPFEHLUNG“
- **Measure:** Saves, and swipe-through to slide 5.

### AD-11 · „Montag bis Donnerstag ruhig?“
- **Format:** R · **Vertical:** pizzeria, café · **Angle:** A9 · **Status:** SELL NOW (with qualifier)
- **Hook:** „Montag bis Donnerstag ruhig? Dann weißt du zumindest, wen du vermisst.“
- **On-screen text:** „Heute: sehen. Nachrichten: Ausblick.“
- **Visual:** An empty shop on a Tuesday (own footage), then the owner list.
- **15s:** Empty shop (0–4) → hook text (4–8) → list with „vor 5 Wochen“ (8–15)
- **30s:** The 15s cut, plus „‚Lange nicht gesehen!‘ – beim nächsten Mal. Persönlich.“ (15–25) and the CTA (25–30).
- **CTA:** DM „KARTE“
- **Measure:** If comments ask „kann ich denen schreiben?“, demand exists for the future messaging feature. Log it as product signal, not a sales promise.

### AD-12 · „Ein Laden, ein Preis“
- **Format:** S · **Vertical:** barber, café · **Angle:** A7 · **Status:** SELL NOW
- **Hook:** „Egal, wie viele Stühle. Egal, wie viele Karten.“
- **On-screen text:** „39 € / Monat / Standort.“
- **Visual:** A row of 4 barber chairs with one price tag.
- **15s:** Pan across the chairs (0–8) → price tag (8–15)
- **30s:** The 15s cut, plus „Jeder Mitarbeiter bekommt seinen eigenen Zugang“ (15–30).
- **CTA:** DM „KARTE“
- **Measure:** CTR on paid (after O-014) versus AD-05.

### AD-13 · „Heute eingerichtet“
- **Format:** R · **Vertical:** all · **Angle:** A8/D2 · **Status:** SELL NOW
- **Hook:** „Heute eingerichtet. Morgen stempelt dein erster Kunde.“
- **On-screen text:** „Wir richten's mit dir ein – am Tresen.“
- **Visual:** Timelapse of the founder with an owner (own footage, with permission): picking the reward, printing the sign, a staff login.
- **15s:** Three quick steps (0–12) → text (12–15)
- **30s:** The 15s cut, plus the first real scan (15–25) and the CTA (25–30).
- **CTA:** DM „VORBEI“
- **Measure:** DM „VORBEI“ is the strongest intent signal. Track it against setups booked.

### AD-14 · „Die Gründer-Runde“
- **Format:** R/T · **Vertical:** all · **Angle:** D1 · **Status:** SELL NOW (only if the founder is local)
- **Hook:** „Kein Callcenter. Ich bin der Gründer, und ich lauf hier durch Kassel.“
- **On-screen text:** „Tag 1 von 100 Läden.“ Only if true and counted honestly.
- **Visual:** The founder walking a Kassel street, entering a shop (no shop name visible unless permitted).
- **15s:** Walk (0–5) → hook (5–10) → „Digitale Stempelkarte, ohne App“ (10–15)
- **30s:** The 15s cut, plus what happened today in honest numbers: „12 Läden, 4 Gespräche, 1 Ja“ (15–30). Real numbers only.
- **CTA:** Follow plus DM „VORBEI“
- **Measure:** Follows from Kassel, and walk-in recognition.

### AD-15 · „Was es noch nicht kann“
- **Format:** C · **Vertical:** all · **Angle:** D3 · **Status:** SELL NOW
- **Hook:** „Was unsere Stempelkarte (noch) nicht kann.“
- **On-screen text:**
  1. Hook
  2. „Keine Nachrichten an Kunden – Ausblick“
  3. „Keine Wallet-Karte – Ausblick“
  4. „Kein Antippen per NFC – Ausblick“
  5. „Was sie kann: QR, Team bestätigt, du siehst, wer wiederkommt“
  6. Price
- **Visual:** Clean text slides.
- **15s / 30s:** Founder to camera reading the slides.
- **CTA:** DM „KARTE“
- **Measure:** A trust-angle test. Do comments and DMs carry more sincerity, i.e. fewer „Preis?“-only DMs?

### AD-16 · „Kamera drauf“
- **Format:** T · **Vertical:** all · **Angle:** A3 · **Status:** SELL NOW
- **Hook:** „Der schnellste Weg zu deiner Stempelkarte:“ (then silence and the scan)
- **On-screen text:** „0 Downloads.“
- **Visual:** One continuous take: QR, scan, card. Real timing, no cuts.
- **15s:** The take itself.
- **30s:** The take, plus the staff confirm take.
- **CTA:** DM „KARTE“
- **Measure:** Hold to the end. Does the real flow look fast? If drop-off occurs mid-take, the flow feels slow; feed that to product.

### AD-17 · „Papier vs. Handy“
- **Format:** S (split) · **Vertical:** all · **Angle:** A1 · **Status:** SELL NOW
- **Hook:** „Papierkarte: weg, nass, selbst gestempelt. Handy: da.“
- **On-screen text:** Split screen. Left: a wet, torn card. Right: the phone card (Beispiel).
- **Visual:** The split.
- **15s:** Left half (0–6) → right half (6–12) → CTA (12–15)
- **30s:** The 15s cut, plus the owner view as a bonus „und du siehst, wer wiederkommt“ (15–30).
- **CTA:** DM „KARTE“
- **Measure:** Static CTR versus AD-03.

### AD-18 · „Der 4-Wochen-Kunde“
- **Format:** R · **Vertical:** barber · **Angle:** B3 · **Status:** SELL NOW
- **Hook:** „Dein Kunde kommt alle 4 Wochen. Jetzt sind's 9.“
- **On-screen text:** „Der sitzt gerade woanders.“
- **Visual:** A calendar flip of 4 weeks then 9 weeks, then the owner list row.
- **15s:** Hook (0–5) → calendar (5–10) → list row (10–15)
- **30s:** The 15s cut, plus „Du siehst es. Was du machst, entscheidest du.“ (15–30).
- **CTA:** DM „KARTE“
- **Measure:** Comment sentiment. Too confrontational? Compare with AD-04.

### AD-19 · „Kartenlink speichern“
- **Format:** C · **Vertical:** all · **Angle:** C6 · **Status:** SELL NOW (today's path)
- **Hook:** „Kunde hat sein Handy verloren. Und jetzt?“
- **On-screen text:**
  1. Hook
  2. „Neue Karte per QR“
  3. „Du buchst die Stempel nach, die du kennst“
  4. „Tipp beim Start: Kartenlink speichern“
  5. „Neuausgabe am Tresen: mit dem nächsten Update“
- **Visual:** Text slides.
- **15s / 30s:** Founder answering a „real“ question only if someone actually asked it. Otherwise frame it as FAQ.
- **CTA:** DM „KARTE“
- **Measure:** Saves from owners who are close to deciding.

### AD-20 · „Was ist dein Tresen?“
- **Format:** R · **Vertical:** café · **Angle:** B7/C2 · **Status:** SELL NOW
- **Hook:** „Der zehnte Kaffee – ohne Papierkarte im Portemonnaie.“
- **On-screen text:** „Scan, während die Maschine läuft.“
- **Visual:** An espresso pour in the foreground, a staff scan in the background (Gestellte Szene).
- **15s:** Pour + scan (0–10) → text (10–15)
- **30s:** The 15s cut, plus the owner view (15–30).
- **CTA:** DM „KAFFEE“
- **Measure:** Café owner DMs. This decides whether to pull cafés forward.

### AD-21 · „Deine Kunden. Deine Daten.“
- **Format:** S · **Vertical:** pizzeria · **Angle:** A10 · **Status:** SELL NOW
- **Hook:** „Deine Stammkunden gehören dir – nicht einer Plattform.“
- **On-screen text:** „Export jederzeit.“
- **Visual:** Owner screen with the export button highlighted (Beispiel).
- **15s / 30s:** Founder to camera, then the export screen.
- **CTA:** DM „PIZZA“
- **Measure:** Engagement from pizzeria owners versus AD-08.

### AD-22 · „Probier's selbst“ (interactive story)
- **Format:** IG Story · **Vertical:** all · **Angle:** A3 · **Status:** SELL NOW
- **Hook:** „Scan den Code mit einem zweiten Handy.“
- **On-screen text:** The demo QR full-screen.
- **Visual:** The demo merchant's QR (requires D-3).
- **15s:** QR plus instruction.
- **30s:** n/a. Story sequence: QR, then „Was hast du gesehen?“ poll.
- **CTA:** Poll and DM
- **Measure:** Scans on the demo merchant over the following hour (owner view, cards created).

### AD-23 · „Eine Frage an Barber“
- **Format:** T · **Vertical:** barber · **Angle:** discovery · **Status:** SELL NOW
- **Hook:** „Barber, ehrliche Frage: Wie viele deiner Kunden sind Stammkunden?“
- **On-screen text:** „Schreib's in die Kommentare.“
- **Visual:** Founder to camera.
- **15s:** The question.
- **30s:** The question, plus why it matters: „Weil du nur die verlieren kannst, die du nicht siehst.“
- **CTA:** Comment
- **Measure:** Comment count. Replies can be followed up because they started the conversation.

### AD-24 · „Prämie, die nichts kostet“
- **Format:** C · **Vertical:** barber, salon · **Angle:** setup idea · **Status:** SELL NOW
- **Hook:** „5 Prämien für deine Stempelkarte, die dich wenig kosten.“
- **On-screen text:** Bartpflege extra · Augenbrauen extra · Pflegeprodukt-Probe · Getränk · Haarwäsche mit Massage. These are ideas only; the merchant decides.
- **Visual:** Simple icons.
- **15s / 30s:** Founder to camera with the list.
- **CTA:** Save plus DM „KARTE“
- **Measure:** Saves. Value content builds trust before the pitch.

### AD-25 · „Prämien-Ideen Pizzeria“
- **Format:** C · **Vertical:** pizzeria · **Angle:** setup idea · **Status:** SELL NOW
- **Hook:** „Nicht immer nur die Pizza aufs Haus: 5 Prämien-Ideen.“
- **On-screen text:** Dessert · Getränk · Extra-Belag · Pizzabrot · kleiner Salat. Ideas only; the merchant decides.
- **Visual:** Icons.
- **15s / 30s:** Voice-over.
- **CTA:** Save
- **Measure:** Saves.

### AD-26 · „Der Tresenschild-Test“
- **Format:** R · **Vertical:** all · **Angle:** A3/A8 · **Status:** SELL NOW
- **Hook:** „Wo muss der QR-Code hin, damit er gescannt wird?“
- **On-screen text:** „Da, wo bezahlt wird.“
- **Visual:** The sign in 3 positions (Gestellte Szene); the right one is at the payment spot.
- **15s / 30s:** Three placements, then the right answer, plus why.
- **CTA:** DM „SCHILD“
- **Measure:** Educational value, measured by Saves. Owners can learn the setup from the video.

### AD-27 · „Wer hat bestätigt?“
- **Format:** R · **Vertical:** pizzeria, café (with staff) · **Angle:** A4/D4 · **Status:** SELL NOW
- **Hook:** „Jeder Stempel hat einen Namen dahinter.“
- **On-screen text:** „Gezählt wird nur, was dein Team bestätigt hat.“
- **Visual:** Owner view of the activity history with the staff name (Beispieldaten).
- **15s / 30s:** Scan → confirm → history row.
- **CTA:** DM „KARTE“
- **Measure:** Engagement from owners with staff.

### AD-28 · „Netz weg?“
- **Format:** S · **Vertical:** all · **Angle:** C4 · **Status:** SELL NOW
- **Hook:** „WLAN weg? Stempel kommen trotzdem an.“
- **On-screen text:** „Prämien werden online eingelöst.“
- **Visual:** A phone with a no-signal icon and a queued stamp.
- **15s / 30s:** Animation: queue, then sync.
- **CTA:** DM „KARTE“
- **Measure:** Objection-ad test. Does it reduce „was wenn…“ questions in DMs?

### AD-29 · „Rechner“
- **Format:** R (screen recording) · **Vertical:** all · **Angle:** A6 · **Status:** SELL NOW (Rechenbeispiel)
- **Hook:** „Ab wie vielen Besuchen rechnet sich das? Rechnen wir's aus.“
- **On-screen text:** „Rechenbeispiel, keine Prognose.“
- **Visual:** Screen recording of `/#rechner` with three baskets: €25, €18, €6.
- **15s:** One basket.
- **30s:** Three baskets.
- **CTA:** Link to `/#rechner` (after O-014) or DM „RECHNEN“
- **Measure:** Clicks to the calculator; time on page.

### AD-30 · „Familie Weber war 6 Wochen nicht da“
- **Format:** S · **Vertical:** pizzeria · **Angle:** A2 · **Status:** SELL NOW
- **Hook:** „Familie Weber hat seit 6 Wochen nicht bestellt.“ (Beispieldaten)
- **On-screen text:** „Du würdest es wissen.“
- **Visual:** The owner list row from the pizzeria page.
- **15s / 30s:** Row zoom plus voice-over.
- **CTA:** DM „PIZZA“
- **Measure:** CTR versus AD-04. Does the family frame beat the individual frame?

### AD-31 · „Ein Tag, ein Laden“ (series)
- **Format:** T series · **Vertical:** all · **Angle:** D1/D2 · **Status:** SELL NOW (real only)
- **Hook:** „Laden Nr. [n]: [Branche] in [Stadtteil].“ Real merchant, with written permission.
- **On-screen text:** What they chose as a reward, and why.
- **Visual:** Setup with the real owner. No outcome claims until data exists.
- **15s / 30s:** Setup moments, plus the owner saying in their own words why they're trying it. Not a testimonial of results.
- **CTA:** DM „VORBEI“
- **Measure:** Walk-in recognition in the same Stadtteil.

### AD-32 · „Was sagst du deinen Kunden?“
- **Format:** C · **Vertical:** all · **Angle:** A8 · **Status:** SELL NOW
- **Hook:** „So erklärst du deinen Kunden die neue Stempelkarte in einem Satz.“
- **On-screen text:** „Kamera auf den Code – ist deine Karte. Ohne App.“
- **Visual:** A counter conversation in comic-strip style.
- **15s / 30s:** Voice-over.
- **CTA:** Save
- **Measure:** Saves. Also reused in onboarding.

---

## Testing plan (first 4 weeks after the account is live)

| Week | Run (organic, 3–4 posts/week) | Question it answers |
|---|---|---|
| 1 | AD-01, AD-03, AD-14 | Does paper-card pain or no-app stop the scroll better? Does the founder story work? |
| 2 | AD-04, AD-06, AD-09 | Which vertical responds: barber pain, pizzeria ritual or barber referral? |
| 3 | AD-05, AD-15, AD-23 | Price clarity vs. honesty vs. conversation |
| 4 | Best 2 from weeks 1–3, re-cut with a new hook each | Iterate. Change one variable only. |

**Paid tests** (after O-014):
- €5–10/day, Kassel + 15 km, owner and small-business interest targeting.
- 3 concepts at a time.
- Judge after ≥ 1 000 impressions each.
- The KPI is DM-KW or landing-page CTA clicks, not likes.
