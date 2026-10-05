# 02 · Positioning and canonical angle library

This is the **one canonical angle document**. It merges the owner's original 124-angle bank (*Loynara Marketing & Acquisition Playbook*, Appendix A, plus its priority matrix, verticals, ads, content scenarios and objection bank) with the bank rebuilt in the previous pass.

- Every original item is traceable in [14-angle-reconciliation.md](14-angle-reconciliation.md).
- Where each angle is used is in [16-execution-matrix.md](16-execution-matrix.md).
- Source data: [`data/angle-library.csv`](data/angle-library.csv) and [`data/angle-sources.csv`](data/angle-sources.csv). Edit the CSVs, then run `node gtm/data/angles.mjs`.

Evidence states come from [01-product-truth.md](01-product-truth.md):

| Status | Meaning | How to say it |
|---|---|---|
| **SELL NOW** | Live in production and evidenced | Plainly |
| **RC READY — not deployed** | Built and hardened in the merchant-completion RC, not deployed | „kommt mit dem nächsten Update“; say today's live path next to it |
| **QUALIFIED / PREVIEW** | Partly live, or built but gated (e.g. NFC before physical acceptance) | Only with the exact boundary sentence of the angle |
| **FUTURE / DO NOT SELL YET** | Not built or not enabled | Ausblick only, or not at all |

## North star (from the original playbook)

> **Keep the customers you earned. Bring them back. Let them bring the next ones.**
> „Behalte die Kunden, die du gewonnen hast. Gib ihnen einen Grund wiederzukommen. Lass sie die nächsten mitbringen.“

The third sentence (referrals) and the first (the card) are SELL NOW. „Bring them back“ is SELL NOW as *a reason to return*. As an *active win-back action* it is FUTURE (FUT-01).

## Final positioning

**One sentence (internal):** For owner-run barbers, pizzerias and cafés in Kassel, Loynara replaces the paper stamp card with a browser card the customer opens by QR code. The team confirms every visit, so the owner can see how many customers come back, what each card has done, and which recommendation became a real visit. It costs €39 per location, with no customer app and no hardware to buy.

**German, spoken (what the founder says):**
> „Das ist deine Stempelkarte, nur auf dem Handy deiner Kunden – ohne App. Dein Team bestätigt jeden Besuch, und du siehst, wie viele wiederkommen und welche Empfehlung ein echter Besuch war.“

**After the NFC gate passes** (see [15-copy-switches.md](15-copy-switches.md)), the first sentence becomes: „…ohne App – antippen oder QR-Code scannen.“

**What we are not:**
- Not a marketing-automation tool. Today Loynara sends nothing to customers.
- Not a POS.
- Not a discount platform.
- Not an app the customer must install.
- Not a CRM. Customer cards are pseudonymous.

**Category:** *digitale Stempelkarte / Kundenkarte*. Use these words, not „Loyalty-Plattform“ or „CRM“.

**Against the real alternatives:**

| Alternative | Why a merchant stays with it | Our honest wedge |
|---|---|---|
| Paper stamp card | Free, known, zero effort | Lost cards and self-stamping, and the owner learns nothing. We keep the ritual and add confirmation and an overview. |
| Nothing | No cost, no work | Regulars are the business; give them a visible reason to return. |
| App-based loyalty (chain-style) | Looks professional | Customers won't install an app for one barber. We run in the browser. |
| Competitor digital card tools | Feature-rich, free tiers | Per-location price with no card limits, staff confirmation built in, fair referrals. Never name competitors in public material. |
| Delivery-platform stamp offers (pizzeria) | Already there | Platform loyalty belongs to the platform. Ours belongs to the shop, for counter and pickup customers. |

## Message hierarchy (original §11, evidence-tagged)

| Level | Message | Status |
|---|---|---|
| 1 · Outcome | Bring customers back, by giving every visit a reason to return | SELL NOW (reason, not promise) |
| 2 · Expansion | Let regulars bring the next customer | SELL NOW |
| 3 · Control | Know what is happening: cards, confirmed visits, returning cards, referrals | QUALIFIED (pseudonymous, loyalty activity only) |
| 4 · Mechanism | QR (NFC after acceptance) → progress → staff confirmation → owner visibility | SELL NOW / NFC QUALIFIED |
| 5 · Advanced | Win-back, quiet-period activation, campaigns, automations, attribution | FUTURE |

**Operating rule (original):** never lead with a feature list („Stempel, Empfehlungen, Kampagnen, Analytics, NFC, Wallet, Automationen“). Lead with the merchant's business problem, show **one** mechanism, then prove the workflow.

**Homepage rule:** the homepage carries at most the core story: CORE-01, -03/-04, -05/-06, -07, -08, -09, plus ECO-03 (price card), TRU-08 (studio) and VER-04 (the café example). CORE-11 appears only as one FAQ line until its gate passes. Every other angle lives in supporting pages, ads, scripts, demos and collateral (see [16](16-execution-matrix.md)).

## Claim check (before anything leaves the founder's hands)

1. Is every capability **SELL NOW**? Is every RC READY item phrased „kommt mit dem nächsten Update“, with today's path next to it? Is every QUALIFIED item stated with its boundary sentence?
2. Is every number the price, arithmetic labelled *Rechenbeispiel*, or a measured number from [13-learning-system.md](13-learning-system.md) used with permission?
3. Is every example person, shop or screen labelled *Beispiel*? Do owner screens show pseudonymous cards, never named customers?
4. Is there no deadline, „nur noch“, „gratis“, or fake scarcity?
5. Do NFC, Wallet, logo and messaging appear only as „Ausblick“ / „vorbereitet“, until their gate has passed?

## Canonical angle library

<!-- angles:start -->
<!-- generated by gtm/data/angles.mjs from data/angle-library.csv — edit the CSV, not this block -->

**76 canonical angles** after merging the original 124-angle bank, its priority matrix, verticals, ads, content scenarios and objection bank (169 traced source items, see [14-angle-reconciliation.md](14-angle-reconciliation.md)) with the rebuilt bank from the previous pass.

| Class | Angles | | Status | Angles |
|---|---|---|---|---|
| CORE | 11 | | SELL NOW | 35 |
| VERTICAL | 8 | | RC READY — not deployed | 5 |
| OBJECTION | 4 | | QUALIFIED / PREVIEW | 14 |
| TRUST | 10 | | FUTURE / DO NOT SELL YET | 22 |
| ECONOMICS | 5 | |  |  |
| ACQUISITION | 5 | |  |  |
| RETENTION | 3 | |  |  |
| OPERATIONS | 9 | |  |  |
| FUTURE | 21 | |  |  |

### Index

| ID | Angle | Class | Status | Used in |
|---|---|---|---|---|
| CORE-01 | Der nächste Besuch | CORE | SELL NOW | Walk-in, Demo, Static ad, Video, Content, Homepage |
| CORE-02 | Sichtbarer Fortschritt | CORE | SELL NOW | Demo, Video, Static ad, Content, Vertical page |
| CORE-03 | Papierkarte ablösen | CORE | SELL NOW | Walk-in, Demo, Static ad, Video, Content, FAQ, Retargeting |
| CORE-04 | Keine App | CORE | SELL NOW | Walk-in, Demo, Static ad, Video, Content, Retargeting, Homepage, FAQ, Vertical page |
| CORE-05 | Ein Ablauf im Stress | CORE | SELL NOW | Walk-in, Demo, Video, FAQ, Vertical page, Retargeting |
| CORE-06 | Team bestätigt jeden Stempel | CORE | SELL NOW | Walk-in, Demo, Static ad, Video, FAQ, Homepage |
| CORE-07 | Empfehlung zählt beim echten Besuch | CORE | SELL NOW | Walk-in, Demo, Static ad, Video, Content, Homepage, Vertical page |
| CORE-08 | Sehen, ob es genutzt wird | CORE | QUALIFIED / PREVIEW | Demo, Content, Sales follow-up, Vertical page, Homepage |
| CORE-09 | 39 € mit deinen eigenen Zahlen | CORE | SELL NOW | Walk-in, Demo, Static ad, Video, Homepage, Vertical page, Retargeting |
| CORE-10 | Mit dir eingerichtet | CORE | SELL NOW | Walk-in, Onboarding, Content, Trust collateral |
| CORE-11 | Antippen statt scannen (NFC) | CORE | QUALIFIED / PREVIEW | FAQ, Homepage, Walk-in |
| VER-01 | Barber: jeder Schnitt zählt | VERTICAL | SELL NOW | Vertical page, Walk-in, Video, Static ad |
| VER-02 | Pizzeria: aus einer Bestellung die nächste | VERTICAL | SELL NOW | Vertical page, Walk-in, Video, Static ad |
| VER-03 | Pizzeria: keine Provision | VERTICAL | SELL NOW | Static ad, Walk-in, Vertical page |
| VER-04 | Café/Bäckerei: Laufkundschaft wird Stammgast | VERTICAL | SELL NOW | Walk-in, Video, Homepage |
| VER-05 | Salon/Beauty: Termine werden Beziehung | VERTICAL | SELL NOW | Walk-in, Video, Sales follow-up |
| VER-06 | Autopflege: lange Intervalle | VERTICAL | QUALIFIED / PREVIEW | Learning log (demand signal) |
| VER-07 | Fitness: Regelmäßigkeit belohnen | VERTICAL | QUALIFIED / PREVIEW | Learning log (demand signal) |
| VER-08 | Restaurant: Gäste kommen regelmäßig wieder | VERTICAL | QUALIFIED / PREVIEW | Learning log (demand signal) |
| OBJ-01 | „Meine Stammkunden kommen sowieso“ | OBJECTION | SELL NOW | Walk-in, FAQ, Sales follow-up |
| OBJ-02 | „Ich hab doch Instagram“ | OBJECTION | SELL NOW | Walk-in, Retargeting, FAQ |
| OBJ-03 | „Meine Kunden sind älter“ | OBJECTION | SELL NOW | Walk-in, FAQ |
| OBJ-04 | „Ich weiß nicht, ob das funktioniert“ | OBJECTION | SELL NOW | Walk-in, Sales follow-up, Onboarding |
| TRU-01 | Nichts wird doppelt gebucht | TRUST | SELL NOW | FAQ, Demo, Trust collateral |
| TRU-02 | Jede Buchung nachvollziehbar | TRUST | RC READY — not deployed | Demo, Trust collateral, FAQ |
| TRU-03 | Daten exportieren | TRUST | SELL NOW | FAQ, Trust collateral |
| TRU-04 | Ehrliche Zahlen | TRUST | SELL NOW | Demo, FAQ, Vertical page, Trust collateral |
| TRU-05 | Was es noch nicht kann | TRUST | SELL NOW | Walk-in, Demo, Content, Trust collateral |
| TRU-06 | Kein Spam an deine Kunden | TRUST | QUALIFIED / PREVIEW | FAQ, Sales follow-up, Trust collateral |
| TRU-07 | Gründer vor Ort | TRUST | SELL NOW | Walk-in, Onboarding, Content, Trust collateral |
| TRU-08 | Deine Marke vorne | TRUST | QUALIFIED / PREVIEW | Homepage, Demo, Vertical page |
| TRU-09 | Pseudonyme Kundenkarten | TRUST | QUALIFIED / PREVIEW | FAQ, Sales follow-up, Trust collateral |
| TRU-10 | Hinweise nach festen Regeln, keine Fake-KI | TRUST | QUALIFIED / PREVIEW | Demo, FAQ |
| ECO-01 | Erst die Kunden, die du schon hast | ECONOMICS | SELL NOW | Content, Sales follow-up, Walk-in |
| ECO-02 | Ein Besuch mehr, aufs Jahr gerechnet | ECONOMICS | SELL NOW | Demo, Sales follow-up, Content |
| ECO-03 | Ein Preis pro Standort | ECONOMICS | SELL NOW | Walk-in, Static ad, Homepage, Vertical page |
| ECO-04 | Was kostet Nichtstun? | ECONOMICS | QUALIFIED / PREVIEW | Sales follow-up, Content |
| ECO-05 | Gründungspartner / früher Pilot | ECONOMICS | FUTURE / DO NOT SELL YET | Learning log (demand signal) |
| ACQ-01 | Mundpropaganda bekommt ein System | ACQUISITION | SELL NOW | Video, Walk-in, Vertical page, Content |
| ACQ-02 | Welche Empfehlung wurde ein Besuch? | ACQUISITION | QUALIFIED / PREVIEW | Demo, Content, Vertical page |
| ACQ-03 | Starke Empfehler erkennen | ACQUISITION | QUALIFIED / PREVIEW | Demo, Sales follow-up |
| ACQ-04 | Händler empfehlen Händler | ACQUISITION | SELL NOW | Sales follow-up, Onboarding |
| ACQ-05 | Nicht der Laden nebenan | ACQUISITION | SELL NOW | Content, Static ad |
| RET-01 | Ruhende Karten bemerken | RETENTION | QUALIFIED / PREVIEW | Content, Demo, Sales follow-up |
| RET-02 | Stempel oder Punkte | RETENTION | SELL NOW | Demo, Onboarding, FAQ |
| RET-03 | Gehört deinem Laden, nicht einer Plattform | RETENTION | SELL NOW | Walk-in, Static ad, Vertical page |
| OPS-01 | Gebaut für die echte Schicht | OPERATIONS | QUALIFIED / PREVIEW | Demo, Sales follow-up, Trust collateral |
| OPS-02 | Fehler korrigieren, Verlauf bleibt | OPERATIONS | RC READY — not deployed | Demo, FAQ, Onboarding |
| OPS-03 | Kamera streikt? Kartennummer | OPERATIONS | RC READY — not deployed | Demo, FAQ, Onboarding |
| OPS-04 | Karte verloren: neu ausstellen, Stand bleibt | OPERATIONS | RC READY — not deployed | Demo, FAQ, Onboarding, Trust collateral |
| OPS-05 | Eigene Zugänge und Rollen | OPERATIONS | SELL NOW | Demo, Onboarding, FAQ |
| OPS-06 | Mehrere Standorte | OPERATIONS | SELL NOW | FAQ, Sales follow-up |
| OPS-07 | Netz weg? Stempel kommen nach | OPERATIONS | SELL NOW | FAQ, Demo |
| OPS-08 | Startklar-Check | OPERATIONS | RC READY — not deployed | Onboarding |
| OPS-09 | Das Schild am Tresen | OPERATIONS | SELL NOW | Demo, Onboarding, Content |
| FUT-01 | Verschwundene Stammkunden zurückholen | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-02 | Persönlicher Besuchsrhythmus | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-03 | Kurz vor der Prämie / Prämie wartet | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-04 | Willkommensstrecke | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-05 | Geburtstag und Anlässe | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal) |
| FUT-06 | Eigene Zielgruppe statt Algorithmus | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-07 | Richtiges Angebot an die Richtigen | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-08 | Ruhige Zeiten nutzen | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-09 | Muster nach Tag und Uhrzeit | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-10 | Was nach einer Aktion passierte | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-11 | Woher Kunden kommen | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-12 | Sehen → Verstehen → Handeln | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-13 | Branchenwissen | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-14 | Wallet-Karte | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-15 | Logo auf der Karte | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-16 | Premium-Aufsteller | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-17 | Prämienkatalog | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-18 | Stufen und Status | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-19 | Pakete und Vorauszahlung | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal) |
| FUT-20 | Standorte vergleichen | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal), Ausblick line only |
| FUT-21 | Bewertung nach einem guten Moment | FUTURE | FUTURE / DO NOT SELL YET | Learning log (demand signal) |

### CORE

#### CORE-01 · Der nächste Besuch
**SELL NOW** · sources: O1, O2, O3, O26, P1, AD-A

- **Merchant pain:** After the first sale nothing gives the customer a concrete reason to come back.
- **Commercial outcome:** Every visit ends with a visible reason to return: the card and the next reward.
- **Strongest hook:** „Deine Kunden waren schon da. Gib ihnen einen Grund, wiederzukommen.“
- **Strongest verticals:** All; strongest café, pizzeria, barber
- **Best channel:** Walk-in opener, homepage hero, static ad
- **Sales/demo proof:** Customer card right after the first confirmed visit (1/10, next reward shown)
- **Objection addressed:** „Ich hab genug Kunden.“
- **CTA:** Demo anfragen
- **Used in:** Walk-in, Demo, Static ad, Video, Content, Homepage
- **Boundary:** Gives a reason to return; never promises more visits or revenue.

#### CORE-02 · Sichtbarer Fortschritt
**SELL NOW** · sources: O4, O5, O6, P5

- **Merchant pain:** Paper progress is invisible until the card turns up; customers forget how close they are.
- **Commercial outcome:** The customer sees 8/10 on the phone, so the next visit is concrete.
- **Strongest hook:** „9 von 10 fühlt sich anders an als 1 von 10.“
- **Strongest verticals:** Café, bakery, pizzeria, barber
- **Best channel:** Reel/TikTok, demo
- **Sales/demo proof:** Card states 8/10 → 9/10 → 10/10 → reward redeemed
- **Objection addressed:** „Papier funktioniert doch.“
- **CTA:** Digitale Karte ansehen
- **Used in:** Demo, Video, Static ad, Content, Vertical page
- **Boundary:** Describe the mechanism, not a behaviour effect.

#### CORE-03 · Papierkarte ablösen
**SELL NOW** · sources: O74, O75, AD-C, OB-paper · prev A1

- **Merchant pain:** Paper cards get lost, get self-stamped and tell the owner nothing.
- **Commercial outcome:** Same ritual on the phone: only staff can stamp, and the owner sees activity.
- **Strongest hook:** „Eine Papierkarte zählt Stempel. Mehr weiß sie nicht.“
- **Strongest verticals:** Every shop with paper cards (barber, pizzeria, café)
- **Best channel:** Walk-in when a paper card is on the counter; Reel
- **Sales/demo proof:** Scan → staff confirm → owner analytics
- **Objection addressed:** „Papier ist kostenlos.“
- **CTA:** Ausprobieren
- **Used in:** Walk-in, Demo, Static ad, Video, Content, FAQ, Retargeting

#### CORE-04 · Keine App
**SELL NOW** · sources: O52, O55, O56, O111, O123, P6, AD-D, OB-app · prev A3, C1

- **Merchant pain:** Customers will not install an app for one shop.
- **Commercial outcome:** Camera on the code; the card opens in the browser.
- **Strongest hook:** „Keine App. Kamera auf den Code. Fertig.“
- **Strongest verticals:** All
- **Best channel:** Walk-in hand-the-phone moment, TikTok, static, retargeting
- **Sales/demo proof:** Owner scans the demo QR (production demo merchant only after D-3; until then the founder tablet with local demo data)
- **Objection addressed:** „Meine Kunden laden keine App.“
- **CTA:** Ablauf ausprobieren
- **Used in:** Walk-in, Demo, Static ad, Video, Content, Retargeting, Homepage, FAQ, Vertical page
- **Boundary:** QR is the live entry. NFC only as prepared outlook until CORE-11 passes its gate.

#### CORE-05 · Ein Ablauf im Stress
**SELL NOW** · sources: O57, O58, P7, OB-staff, OB-slow · prev C2

- **Merchant pain:** If staff cannot use it in a rush, it fails.
- **Commercial outcome:** Customer shows the card, staff scans and confirms: one step, several stamps at once if needed.
- **Strongest hook:** „Kunde zeigt. Team bestätigt. Fertig.“
- **Strongest verticals:** Pizzeria, café, restaurant, salon
- **Best channel:** Walk-in with staff present, demo, objection ad
- **Sales/demo proof:** Staff confirm screen; several stamps in one step
- **Objection addressed:** „Das hält an der Kasse auf.“
- **CTA:** Kassenablauf ansehen
- **Used in:** Walk-in, Demo, Video, FAQ, Vertical page, Retargeting
- **Boundary:** No timing in seconds until measured at pilots. Card-number fallback when the camera fails is RC READY (OPS-03).

#### CORE-06 · Team bestätigt jeden Stempel
**SELL NOW** · sources: O79 · prev A4

- **Merchant pain:** Self-stamping, friends and screenshots.
- **Commercial outcome:** A visit counts only after a staff member confirms it, exactly once.
- **Strongest hook:** „Ein Stempel zählt erst, wenn dein Team ihn bestätigt.“
- **Strongest verticals:** Pizzeria, café, barber
- **Best channel:** Walk-in, FAQ ad
- **Sales/demo proof:** Confirm flow; a screenshot of a card earns nothing
- **Objection addressed:** „Das nutzen die doch aus.“
- **CTA:** Zeigen
- **Used in:** Walk-in, Demo, Static ad, Video, FAQ, Homepage
- **Boundary:** Per-card booking history in the owner UI arrives with the RC (TRU-02).

#### CORE-07 · Empfehlung zählt beim echten Besuch
**SELL NOW** · sources: O18, O20, O23, O25, P4, AD-B · prev A5

- **Merchant pain:** Loyalty only retains; word of mouth goes unrewarded and unseen.
- **Commercial outcome:** A regular shares a link; the bonus comes only after the newcomer's first staff-confirmed visit.
- **Strongest hook:** „Dein bester Kunde kennt vielleicht deinen nächsten.“
- **Strongest verticals:** Barber, salon, pizzeria
- **Best channel:** Reel, carousel, walk-in, /empfehlungen/
- **Sales/demo proof:** Referral pair: shared → card created → first visit confirmed → bonus
- **Objection addressed:** „Kundenbindung bringt keine neuen Kunden.“
- **CTA:** Empfehlungsablauf ansehen
- **Used in:** Walk-in, Demo, Static ad, Video, Content, Homepage, Vertical page
- **Boundary:** No monthly cap exists; the same verified email is held for review; bonus frozen at signup; no causation claims.

#### CORE-08 · Sehen, ob es genutzt wird
**QUALIFIED / PREVIEW** · sources: O38, O41, O42, O44, O112, O113, O114, O115, P9 · prev A2

- **Merchant pain:** The owner knows faces but not the pattern, and cannot tell whether the programme works.
- **Commercial outcome:** The analytics show new cards, confirmed visits, returning cards (two or more visits) and rewards; each card shows its balance and last visit.
- **Strongest hook:** „Wer kommt wirklich wieder? Nicht raten – bestätigte Besuche sehen.“
- **Strongest verticals:** All
- **Best channel:** Demo owner view, day-21 review, carousel
- **Sales/demo proof:** Auswertung: Neue Karten · Bestätigte Kassenvorgänge · Wiederkehrende Karten · Prämien
- **Objection addressed:** „Ich kenne meine Kunden.“
- **CTA:** Inhaber-Ansicht ansehen
- **Used in:** Demo, Content, Sales follow-up, Vertical page, Homepage
- **Boundary:** Cards are pseudonymous: no names, no contact data. Counts only confirmed loyalty activity, not revenue. Days are UTC-based.

#### CORE-09 · 39 € mit deinen eigenen Zahlen
**SELL NOW** · sources: O16, O17, P11, OB-39 · prev A6

- **Merchant pain:** "Noch ein Abo."
- **Commercial outcome:** The merchant puts in their own basket and sees how many extra visits cover €39.
- **Strongest hook:** „39 € im Monat. Bei dir sind das [n] Besuche.“
- **Strongest verticals:** Price-sensitive shops; barber €25 → 2, pizzeria €18 → 3, café €6 → 7
- **Best channel:** Walk-in close, calculator, static ad
- **Sales/demo proof:** /#rechner with the merchant's own basket
- **Objection addressed:** „Zu teuer.“
- **CTA:** Mit meinen Zahlen rechnen
- **Used in:** Walk-in, Demo, Static ad, Video, Homepage, Vertical page, Retargeting
- **Boundary:** Rechenbeispiel, keine Prognose. Never „garantiert“.

#### CORE-10 · Mit dir eingerichtet
**SELL NOW** · sources: O91, O93, O94 · prev A8, D2

- **Merchant pain:** No time for setup, and fear of being left alone with software.
- **Commercial outcome:** The founder sets up the programme, sign and staff on site; first real scan the same day where possible.
- **Strongest hook:** „Ich richte es mit dir ein – am Tresen, nicht per Ticket.“
- **Strongest verticals:** All
- **Best channel:** Walk-in close
- **Sales/demo proof:** Onboarding checklist (12-collateral §5)
- **Objection addressed:** „Keine Zeit.“ / „Marketing ist mir zu kompliziert.“
- **CTA:** Einrichtungstermin
- **Used in:** Walk-in, Onboarding, Content, Trust collateral
- **Boundary:** Staff accounts are operator-provisioned until invite signup (RC) is deployed. Never promise minutes.

#### CORE-11 · Antippen statt scannen (NFC)
**QUALIFIED / PREVIEW** · sources: O53, O54 · prev E2

- **Merchant pain:** Even a QR scan is one step too many at a busy counter.
- **Commercial outcome:** The customer taps the phone on the counter tag and the card opens; QR stays the fallback.
- **Strongest hook:** „Antippen per NFC ist vorbereitet – heute startest du mit dem QR-Code.“
- **Strongest verticals:** All; café and bakery benefit most
- **Best channel:** Today: FAQ and walk-in outlook line only. After the gate: hero, video, walk-in
- **Sales/demo proof:** After the gate: a physical tag tap on a real phone
- **Objection addressed:** „Scannen ist umständlich.“
- **CTA:** Ablauf ansehen
- **Used in:** FAQ, Homepage, Walk-in
- **Boundary:** PREVIEW until the RC is deployed AND physical tag acceptance passes. Then it becomes the primary entry claim: „Antippen. Öffnen. Sammeln.“ with QR as fallback (15-copy-switches.md).


### VERTICAL

#### VER-01 · Barber: jeder Schnitt zählt
**SELL NOW** · sources: V-barber · prev B1

- **Merchant pain:** Visit rhythm and word of mouth carry the business.
- **Commercial outcome:** Card per cut, referral bonus after a confirmed first visit, last visit per card.
- **Strongest hook:** „Jeder Schnitt zählt. Auch für den nächsten Termin.“
- **Strongest verticals:** Barber
- **Best channel:** /fuer-barber/, walk-in, Reel
- **Sales/demo proof:** Barber page example card
- **Objection addressed:** „Ich hab Stammkunden.“
- **CTA:** Demo anfragen
- **Used in:** Vertical page, Walk-in, Video, Static ad
- **Boundary:** The rhythm view exists per card only (RET-01).

#### VER-02 · Pizzeria: aus einer Bestellung die nächste
**SELL NOW** · sources: V-pizzeria · prev B4, B6

- **Merchant pain:** Weekly regulars order elsewhere without anyone noticing.
- **Commercial outcome:** The familiar tenth-pizza card on the phone, with several stamps in one step for big orders.
- **Strongest hook:** „Die zehnte Pizza kennt jeder. Jetzt ohne Pappkarte.“
- **Strongest verticals:** Pizzeria, Imbiss
- **Best channel:** /fuer-pizzerien/, walk-in, Reel
- **Sales/demo proof:** Pizzeria page example; several stamps in one step
- **Objection addressed:** „Hält an der Kasse auf.“
- **CTA:** Demo anfragen
- **Used in:** Vertical page, Walk-in, Video, Static ad
- **Boundary:** Orders through delivery platforms are not counted; there is no POS integration.

#### VER-03 · Pizzeria: keine Provision
**SELL NOW** · sources: prev B5

- **Merchant pain:** Platform fees per order.
- **Commercial outcome:** A flat €39 per location, with no fee per order.
- **Strongest hook:** „Keine Provision pro Bestellung.“
- **Strongest verticals:** Pizzeria, Imbiss
- **Best channel:** Static ad, walk-in
- **Sales/demo proof:** Price card
- **Objection addressed:** „Ich bin bei Lieferando.“
- **CTA:** Demo anfragen
- **Used in:** Static ad, Walk-in, Vertical page
- **Boundary:** Always say: platform orders do not run through Loynara.

#### VER-04 · Café/Bäckerei: Laufkundschaft wird Stammgast
**SELL NOW** · sources: V-cafe · prev B7

- **Merchant pain:** High frequency, small baskets, paper cards in every wallet.
- **Commercial outcome:** The tenth coffee on the phone; staff scan while the machine runs.
- **Strongest hook:** „Aus Laufkundschaft können Stammgäste werden.“
- **Strongest verticals:** Café, bakery
- **Best channel:** Expansion vertical (evidence trigger in 03-verticals)
- **Sales/demo proof:** Homepage café demo
- **Objection addressed:** „Die Schlange an der Kasse.“
- **CTA:** Demo anfragen
- **Used in:** Walk-in, Video, Homepage
- **Boundary:** No speed claim until scan time has been measured at pilots.

#### VER-05 · Salon/Beauty: Termine werden Beziehung
**SELL NOW** · sources: V-salon · prev B8

- **Merchant pain:** Long gaps between appointments; clients drift to competitors.
- **Commercial outcome:** A card across appointments, with referrals.
- **Strongest hook:** „Mach aus einzelnen Terminen eine langfristige Kundenbeziehung.“
- **Strongest verticals:** Salon, nails, beauty
- **Best channel:** Walk-in (barber playbook), Reel
- **Sales/demo proof:** Owner view per card
- **Objection addressed:** „Meine Kundinnen kommen eh.“
- **CTA:** Demo anfragen
- **Used in:** Walk-in, Video, Sales follow-up
- **Boundary:** The browser card shows the shop name and colour, not a logo. Packages are FUTURE (FUT-19).

#### VER-06 · Autopflege: lange Intervalle
**QUALIFIED / PREVIEW** · deferred / unsuitable for now · sources: V-carwash

- **Merchant pain:** Customers come every few months.
- **Commercial outcome:** A stamp card that also works across long intervals.
- **Strongest hook:** „Ein Kunde kommt nicht jede Woche. Gerade deshalb zählt jeder Besuch.“
- **Strongest verticals:** Car wash, detailing
- **Best channel:** Later
- **CTA:** Keiner (später)
- **Used in:** Learning log (demand signal)
- **Boundary:** Deferred vertical (low frequency). Due-date reminders are FUTURE.

#### VER-07 · Fitness: Regelmäßigkeit belohnen
**QUALIFIED / PREVIEW** · deferred / unsuitable for now · sources: V-gym

- **Merchant pain:** Members drop off.
- **Commercial outcome:** Attendance progress.
- **Strongest hook:** „Belohne Regelmäßigkeit, bevor die Motivation weg ist.“
- **Strongest verticals:** Gym
- **Best channel:** Later
- **CTA:** Keiner (später)
- **Used in:** Learning log (demand signal)
- **Boundary:** Deferred vertical: membership and check-in models differ, and reactivation is FUTURE.

#### VER-08 · Restaurant: Gäste kommen regelmäßig wieder
**QUALIFIED / PREVIEW** · deferred / unsuitable for now · sources: V-restaurant

- **Merchant pain:** Guests come once.
- **Commercial outcome:** A reward for coming back.
- **Strongest hook:** „Gib Gästen einen Grund, regelmäßig wiederzukommen.“
- **Strongest verticals:** Restaurant
- **Best channel:** Later
- **CTA:** Keiner (später)
- **Used in:** Learning log (demand signal)
- **Boundary:** Deferred vertical: table service weakens the counter moment, and off-peak offers are FUTURE.


### OBJECTION

#### OBJ-01 · „Meine Stammkunden kommen sowieso“
**SELL NOW** · sources: OB-regulars

- **Merchant pain:** The owner sees no problem.
- **Commercial outcome:** Reward exactly that behaviour and see how many there are.
- **Strongest hook:** „Gut – dann belohn genau das und sieh, wie viele es sind.“
- **Strongest verticals:** All
- **Best channel:** Walk-in, FAQ, follow-up
- **Sales/demo proof:** Returning cards in the analytics
- **Objection addressed:** „Meine Stammkunden kommen sowieso.“
- **CTA:** Auswertung ansehen
- **Used in:** Walk-in, FAQ, Sales follow-up

#### OBJ-02 · „Ich hab doch Instagram“
**SELL NOW** · sources: OB-instagram

- **Merchant pain:** Social media feels like enough.
- **Commercial outcome:** Instagram brings people in; Loynara is about what happens after the first purchase.
- **Strongest hook:** „Instagram bringt Leute rein. Loynara kümmert sich darum, was nach dem ersten Kauf passiert.“
- **Strongest verticals:** All
- **Best channel:** Walk-in, retargeting
- **Objection addressed:** „Ich hab Instagram.“
- **CTA:** Demo anfragen
- **Used in:** Walk-in, Retargeting, FAQ

#### OBJ-03 · „Meine Kunden sind älter“
**SELL NOW** · sources: OH-older

- **Merchant pain:** Fear of excluding loyal customers.
- **Commercial outcome:** No app needed; anyone without a smartphone keeps the paper card.
- **Strongest hook:** „Keine App nötig – und wer kein Smartphone hat, behält einfach die Papierkarte.“
- **Strongest verticals:** All
- **Best channel:** Walk-in, FAQ
- **Sales/demo proof:** The owner scans the demo themselves
- **Objection addressed:** „Meine Kunden sind älter.“
- **CTA:** Selbst scannen
- **Used in:** Walk-in, FAQ

#### OBJ-04 · „Ich weiß nicht, ob das funktioniert“
**SELL NOW** · sources: OB-works

- **Merchant pain:** No proof yet.
- **Commercial outcome:** A review of the shop's own numbers after three weeks.
- **Strongest hook:** „Nach drei Wochen schauen wir gemeinsam auf deine Zahlen.“
- **Strongest verticals:** All
- **Best channel:** Walk-in, follow-up
- **Sales/demo proof:** Day-21 review
- **Objection addressed:** „Bringt das was?“
- **CTA:** Pilot mit Tag-21-Termin
- **Used in:** Walk-in, Sales follow-up, Onboarding
- **Boundary:** Never cite other merchants' results until 13-learning-system allows it.


### TRUST

#### TRU-01 · Nichts wird doppelt gebucht
**SELL NOW** · sources: O80

- **Merchant pain:** A retry or double tap creates double stamps.
- **Commercial outcome:** Each confirmation is booked exactly once.
- **Strongest hook:** „Zweimal getippt? Trotzdem nur ein Stempel.“
- **Strongest verticals:** Busy counters
- **Best channel:** FAQ, demo
- **Sales/demo proof:** Confirming twice in the demo
- **Objection addressed:** „Was, wenn das Netz hakt?“
- **CTA:** Zeigen
- **Used in:** FAQ, Demo, Trust collateral

#### TRU-02 · Jede Buchung nachvollziehbar
**RC READY — not deployed** · sources: O61, O82

- **Merchant pain:** The owner cannot see which staff action changed a balance.
- **Commercial outcome:** The card history shows source and reason for every booking and correction.
- **Strongest hook:** „Jede Buchung hat einen Ursprung und einen Grund.“
- **Strongest verticals:** Owners with staff
- **Best channel:** Demo after RC deployment
- **Sales/demo proof:** Card timeline with source labels (RC)
- **Objection addressed:** „Was, wenn ein Mitarbeiter Mist baut?“
- **CTA:** Zeigen
- **Used in:** Demo, Trust collateral, FAQ
- **Boundary:** Live today: team access history (Zugriffsverlauf) and the owner export. Per-card booking history in the UI arrives with the RC.

#### TRU-03 · Daten exportieren
**SELL NOW** · sources: O84 · prev A10

- **Merchant pain:** Fear that the data is trapped.
- **Commercial outcome:** The owner can export at any time.
- **Strongest hook:** „Deine Daten bleiben nicht eingesperrt.“
- **Strongest verticals:** All
- **Best channel:** FAQ, trust collateral
- **Sales/demo proof:** Owner export
- **Objection addressed:** „Was, wenn ich aufhöre?“
- **CTA:** Export ansehen
- **Used in:** FAQ, Trust collateral
- **Boundary:** JSON export, not CSV or Excel.

#### TRU-04 · Ehrliche Zahlen
**SELL NOW** · sources: O47 · prev D4, D5

- **Merchant pain:** Tools take credit for everything.
- **Commercial outcome:** Definitions are shown; only confirmed activity counts; no causation claims.
- **Strongest hook:** „Gezählt wird nur, was dein Team bestätigt hat.“
- **Strongest verticals:** All
- **Best channel:** Demo, FAQ, vertical pages
- **Sales/demo proof:** „So zählen wir“ in the analytics
- **Objection addressed:** „Woher weiß ich, ob das wirkt?“
- **CTA:** Auswertung ansehen
- **Used in:** Demo, FAQ, Vertical page, Trust collateral

#### TRU-05 · Was es noch nicht kann
**SELL NOW** · sources: prev D3

- **Merchant pain:** Sales pitches hide the gaps.
- **Commercial outcome:** The Ausblick list is said out loud.
- **Strongest hook:** „Ich zeig dir auch, was es noch nicht kann.“
- **Strongest verticals:** All
- **Best channel:** Walk-in, carousel
- **Sales/demo proof:** The Ausblick list
- **CTA:** Ausblick-Liste ansehen
- **Used in:** Walk-in, Demo, Content, Trust collateral

#### TRU-06 · Kein Spam an deine Kunden
**QUALIFIED / PREVIEW** · sources: O85, O86, O87, OB-spam

- **Merchant pain:** „Ich will meine Kunden nicht zuspammen.“
- **Commercial outcome:** Today Loynara sends nothing. Sending, once enabled, checks consent, frequency and quiet hours.
- **Strongest hook:** „Loynara verschickt heute nichts an deine Kunden. Und später nur mit Einwilligung und Grenzen.“
- **Strongest verticals:** All
- **Best channel:** FAQ, follow-up
- **Objection addressed:** „Ich will keinen Spam.“
- **CTA:** Frag mich
- **Used in:** FAQ, Sales follow-up, Trust collateral
- **Boundary:** Messaging is FUTURE; the quiet-hours policy is RC READY. Never present the safeguards as an active feature.

#### TRU-07 · Gründer vor Ort
**SELL NOW** · sources: O92 · prev D1

- **Merchant pain:** Fear of being left alone with a dashboard.
- **Commercial outcome:** The founder comes in person, gives a phone number and follows the day-3/7/21 rhythm.
- **Strongest hook:** „Kein Callcenter. Wenn's hakt, ruf mich an.“
- **Strongest verticals:** All
- **Best channel:** Walk-in, Instagram bio
- **Objection addressed:** „Und wenn was nicht geht?“
- **CTA:** Ruf mich an
- **Used in:** Walk-in, Onboarding, Content, Trust collateral
- **Boundary:** Say "local" only if it is true.

#### TRU-08 · Deine Marke vorne
**QUALIFIED / PREVIEW** · sources: O69, O70, O71, O73, O110, P8

- **Merchant pain:** Generic loyalty looks cheap.
- **Commercial outcome:** The card uses the shop's name and colour, and the printed sign matches.
- **Strongest hook:** „Deine Marke. Vom Tresen bis zur Kundenkarte.“
- **Strongest verticals:** Premium café, salon, barber
- **Best channel:** Homepage studio, demo
- **Sales/demo proof:** Card studio: colour and name
- **Objection addressed:** „Sieht billig aus.“
- **CTA:** Gestaltung ansehen
- **Used in:** Homepage, Demo, Vertical page
- **Boundary:** Logo on the card, Wallet card and premium stand are FUTURE (FUT-14, FUT-15, FUT-16).

#### TRU-09 · Pseudonyme Kundenkarten
**QUALIFIED / PREVIEW** · sources: prev C5

- **Merchant pain:** „Datenschutz?“
- **Commercial outcome:** The owner list is pseudonymous, with no names or phone numbers.
- **Strongest hook:** „Pseudonyme Karten, keine Telefonnummern.“
- **Strongest verticals:** All
- **Best channel:** FAQ, follow-up
- **Sales/demo proof:** Customer list header
- **Objection addressed:** „Datenschutz?“
- **CTA:** Datenschutzunterlagen anfordern
- **Used in:** FAQ, Sales follow-up, Trust collateral
- **Boundary:** Do not name a hosting region or certification until the data-protection documents (O-013) are final.

#### TRU-10 · Hinweise nach festen Regeln, keine Fake-KI
**QUALIFIED / PREVIEW** · sources: O51, O120

- **Merchant pain:** Dashboards are noise; AI claims are hype.
- **Commercial outcome:** The owner gets rule-based hints, each with its reason.
- **Strongest hook:** „Hinweise nach festen Regeln – mit Begründung, ohne KI-Versprechen.“
- **Strongest verticals:** All
- **Best channel:** Demo
- **Sales/demo proof:** Adviser: „Nach festen Regeln“, „Warum dieser Hinweis?“
- **Objection addressed:** „Noch ein Dashboard?“
- **CTA:** Hinweise ansehen
- **Used in:** Demo, FAQ
- **Boundary:** Hints only; acting on them (campaigns) is FUTURE (FUT-12). Never call it KI.


### ECONOMICS

#### ECO-01 · Erst die Kunden, die du schon hast
**SELL NOW** · sources: O13, O99

- **Merchant pain:** Paying to find strangers while existing customers drift away.
- **Commercial outcome:** Start with the people who already bought.
- **Strongest hook:** „Die schwerste Arbeit hast du schon gemacht: Sie waren bei dir.“
- **Strongest verticals:** All
- **Best channel:** Content, follow-up
- **Objection addressed:** „Ich brauche neue Kunden, nicht Stammkunden.“
- **CTA:** Demo anfragen
- **Used in:** Content, Sales follow-up, Walk-in
- **Boundary:** Framing only; no claim about saved ad costs.

#### ECO-02 · Ein Besuch mehr, aufs Jahr gerechnet
**SELL NOW** · sources: O14, O15

- **Merchant pain:** One extra visit looks small.
- **Commercial outcome:** The calculator shows a repeated extra visit over twelve months.
- **Strongest hook:** „Ein zusätzlicher Besuch ist wenig. Jeden Monat einer ist etwas.“
- **Strongest verticals:** All
- **Best channel:** Calculator, follow-up
- **Sales/demo proof:** Calculator 12-month line
- **Objection addressed:** „Das bringt doch nichts.“
- **CTA:** Mit meinen Zahlen rechnen
- **Used in:** Demo, Sales follow-up, Content
- **Boundary:** Rechenbeispiel based on the merchant's own assumption.

#### ECO-03 · Ein Preis pro Standort
**SELL NOW** · sources: O95, O96 · prev A7

- **Merchant pain:** Tiered pricing by cards or staff is confusing.
- **Commercial outcome:** €39 per location, without counting cards or staff.
- **Strongest hook:** „Ein Preis pro Laden. Egal, wie viele Stühle.“
- **Strongest verticals:** Barber with several chairs, busy café
- **Best channel:** Static ad, walk-in
- **Sales/demo proof:** Price card
- **Objection addressed:** „Was kostet das am Ende wirklich?“
- **CTA:** Preis ansehen
- **Used in:** Walk-in, Static ad, Homepage, Vertical page
- **Boundary:** Contract term, VAT presentation and billing start are owner commercial gates (D-1, O-012).

#### ECO-04 · Was kostet Nichtstun?
**QUALIFIED / PREVIEW** · sources: O98

- **Merchant pain:** Lost repeat business is invisible.
- **Commercial outcome:** The merchant estimates their own lost regulars.
- **Strongest hook:** „Wie viele Stammkunden hast du letztes Jahr verloren, ohne es zu merken?“
- **Strongest verticals:** Barber, salon
- **Best channel:** Follow-up, content
- **Sales/demo proof:** The merchant's own estimate
- **Objection addressed:** „Läuft doch.“
- **CTA:** Gespräch
- **Used in:** Sales follow-up, Content
- **Boundary:** Ask, don't quantify. No industry statistics.

#### ECO-05 · Gründungspartner / früher Pilot
**FUTURE / DO NOT SELL YET** · deferred / unsuitable for now · sources: O97

- **Merchant pain:** Early merchants want a say.
- **Commercial outcome:** Early merchants shape the product.
- **Strongest hook:** „Mach früh mit und gestalte Loynara mit.“
- **CTA:** Keiner, bis Konditionen freigegeben
- **Used in:** Learning log (demand signal)
- **Boundary:** Only if genuinely offered. Depends on the D-1 commercial terms; not used until the owner approves them.


### ACQUISITION

#### ACQ-01 · Mundpropaganda bekommt ein System
**SELL NOW** · sources: O19, O21 · prev B2

- **Merchant pain:** Word of mouth already happens but goes unseen and unthanked.
- **Commercial outcome:** Regulars share a personal link, and the referral is booked fairly.
- **Strongest hook:** „Barber leben von Mundpropaganda. Jetzt zählt sie.“
- **Strongest verticals:** Barber, salon, nails
- **Best channel:** Reel, walk-in
- **Sales/demo proof:** Referral link on the customer card
- **Objection addressed:** „Empfehlungen kommen eh.“
- **CTA:** Empfehlungsablauf ansehen
- **Used in:** Video, Walk-in, Vertical page, Content
- **Boundary:** Same rules as CORE-07.

#### ACQ-02 · Welche Empfehlung wurde ein Besuch?
**QUALIFIED / PREVIEW** · sources: O22, O45, O77, CC-referral

- **Merchant pain:** Nobody can tell which recommendations became real customers.
- **Commercial outcome:** Each card shows its referral status (waiting / bonus credited / in review) and how many it referred successfully.
- **Strongest hook:** „Ein geteilter Link ist kein Kunde. Ein bestätigter Besuch schon.“
- **Strongest verticals:** Barber, salon
- **Best channel:** Demo, carousel
- **Sales/demo proof:** Card detail: Als geworbene Karte · Erfolgreich geworben
- **Objection addressed:** „Woher weiß ich, dass das stimmt?“
- **CTA:** Empfehlungen ansehen
- **Used in:** Demo, Content, Vertical page
- **Boundary:** Per card and pseudonymous; no aggregate referral report is claimed.

#### ACQ-03 · Starke Empfehler erkennen
**QUALIFIED / PREVIEW** · sources: O24

- **Merchant pain:** The best ambassadors are invisible.
- **Commercial outcome:** Cards with several qualified referrals stand out in their detail view.
- **Strongest hook:** „Manche Kunden bringen immer wieder jemanden mit.“
- **Strongest verticals:** Barber
- **Best channel:** Demo
- **Sales/demo proof:** Card detail: Erfolgreich geworben
- **CTA:** Empfehlungen ansehen
- **Used in:** Demo, Sales follow-up
- **Boundary:** Pseudonymous and per card; there is no ranking view.

#### ACQ-04 · Händler empfehlen Händler
**SELL NOW** · sources: S6-mm

- **Merchant pain:** Cold doors are slow; owners trust peers.
- **Commercial outcome:** Each live merchant introduces one or two other owners.
- **Strongest hook:** „Das läuft bei [Laden] – soll er dir zeigen, wie?“
- **Strongest verticals:** All
- **Best channel:** Day-21 review, follow-up
- **Sales/demo proof:** A live merchant's own counter
- **Objection addressed:** „Wer nutzt das schon?“
- **CTA:** Vorstellen lassen
- **Used in:** Sales follow-up, Onboarding
- **Boundary:** No cash reward without D-2. Introductions only with permission (10-merchant-referrals.md).

#### ACQ-05 · Nicht der Laden nebenan
**SELL NOW** · sources: O109

- **Merchant pain:** The shop next door competes for the same regulars.
- **Commercial outcome:** Your regulars have a running card with you.
- **Strongest hook:** „Gib deinen Stammkunden noch einen Grund, zu dir zu kommen – und nicht nebenan.“
- **Strongest verticals:** Barber, café, Imbiss
- **Best channel:** Content, static ad
- **CTA:** Demo anfragen
- **Used in:** Content, Static ad
- **Boundary:** No competitor names.


### RETENTION

#### RET-01 · Ruhende Karten bemerken
**QUALIFIED / PREVIEW** · sources: O7, O39, O76, CC-barber, CC-pizzeria · prev B3, A9

- **Merchant pain:** A regular disappearing goes unnoticed.
- **Commercial outcome:** Each card shows its last confirmed visit, so a dormant card is visible when you look.
- **Strongest hook:** „Ein Stammkunde kommt plötzlich nicht mehr. Würdest du es merken?“
- **Strongest verticals:** Barber, salon, pizzeria
- **Best channel:** Content series „Was würdest du tun?“, demo
- **Sales/demo proof:** Card detail: Letzter Vorgang
- **Objection addressed:** „Ich kenne meine Stammkunden.“
- **CTA:** Zeig mir, wie das funktioniert
- **Used in:** Content, Demo, Sales follow-up
- **Boundary:** Today per card and pseudonymous. A list of dormant regulars exists in code but is withheld in production (FUT-01). Never say you see „wer“ is missing.

#### RET-02 · Stempel oder Punkte
**SELL NOW** · sources: O104, O105

- **Merchant pain:** Not every business fits „buy ten, get one“.
- **Commercial outcome:** Stamps or points, chosen per programme.
- **Strongest hook:** „Kauf zehn, bekomm eins – ohne Papier. Oder Punkte, wenn das besser passt.“
- **Strongest verticals:** All
- **Best channel:** Demo, onboarding
- **Sales/demo proof:** Programme setup
- **Objection addressed:** „Stempeln passt bei uns nicht.“
- **CTA:** Programm ansehen
- **Used in:** Demo, Onboarding, FAQ
- **Boundary:** One programme per location in the pilot.

#### RET-03 · Gehört deinem Laden, nicht einer Plattform
**SELL NOW** · sources: prev A10

- **Merchant pain:** Platforms own the customer relationship.
- **Commercial outcome:** The card runs under the shop's name, and the data can be exported.
- **Strongest hook:** „Deine Stammkunden gehören dir – nicht einer Plattform.“
- **Strongest verticals:** Pizzeria/Imbiss (vs. delivery platforms)
- **Best channel:** Walk-in, static ad
- **Sales/demo proof:** Card with the shop name; owner export
- **Objection addressed:** „Was passiert mit meinen Daten?“
- **CTA:** Zeigen
- **Used in:** Walk-in, Static ad, Vertical page
- **Boundary:** The export is JSON. No marketing contact data is collected in production.


### OPERATIONS

#### OPS-01 · Gebaut für die echte Schicht
**QUALIFIED / PREVIEW** · sources: O116, O118, O124, P12, OB-wrong

- **Merchant pain:** Demos look fine; real shifts break things.
- **Commercial outcome:** Live: staff confirmation, offline queue, roles, no double booking. With the RC: corrections, card number, reissue.
- **Strongest hook:** „Was passiert, wenn etwas schiefgeht?“
- **Strongest verticals:** Owners with staff
- **Best channel:** Demo and sales follow-up, not broad ads
- **Sales/demo proof:** Offline queue + confirm flow (live); correction/reissue (RC)
- **Objection addressed:** „Was, wenn was schiefgeht?“
- **CTA:** Demo mit echtem Ablauf
- **Used in:** Demo, Sales follow-up, Trust collateral
- **Boundary:** RC parts are said as „mit dem nächsten Update“ until deployed.

#### OPS-02 · Fehler korrigieren, Verlauf bleibt
**RC READY — not deployed** · sources: O62, O81, OH-mistake

- **Merchant pain:** A wrong stamp cannot be undone cleanly.
- **Commercial outcome:** An owner or manager corrects a booking with a reason; the original stays visible as a compensating entry.
- **Strongest hook:** „Falscher Stempel? Korrigieren, ohne die Geschichte umzuschreiben.“
- **Strongest verticals:** Owners with staff
- **Best channel:** Demo after RC deployment
- **Sales/demo proof:** „Korrigieren“ on a history row (RC)
- **Objection addressed:** „Was, wenn sich mein Mitarbeiter vertippt?“
- **CTA:** Zeigen
- **Used in:** Demo, FAQ, Onboarding
- **Boundary:** Live today: no correction button for merchants. Say „kommt mit dem nächsten Update“.

#### OPS-03 · Kamera streikt? Kartennummer
**RC READY — not deployed** · sources: O63

- **Merchant pain:** When scanning fails, the counter stalls.
- **Commercial outcome:** Staff find a card by its short random number (K-XXXXXX).
- **Strongest hook:** „Scan klappt nicht? Kartennummer eintippen.“
- **Strongest verticals:** Busy counters
- **Best channel:** Demo, FAQ after RC deployment
- **Sales/demo proof:** Cashier lookup by card number (RC)
- **Objection addressed:** „Und wenn die Kamera nicht will?“
- **CTA:** Zeigen
- **Used in:** Demo, FAQ, Onboarding
- **Boundary:** Live today: the owner list can search by the first characters of the internal card ID only.

#### OPS-04 · Karte verloren: neu ausstellen, Stand bleibt
**RC READY — not deployed** · sources: O64, O78, O83, O117, OH-lost · prev C6

- **Merchant pain:** A lost phone or link means lost progress.
- **Commercial outcome:** An owner or manager reissues the card: same membership, balance, history and card number; the old link and QR stop working.
- **Strongest hook:** „Handy weg? Neue Karte, gleicher Stand.“
- **Strongest verticals:** All
- **Best channel:** Demo, FAQ after RC deployment
- **Sales/demo proof:** „Neu ausstellen“ dialog (RC)
- **Objection addressed:** „Was, wenn ein Kunde sein Handy verliert?“
- **CTA:** Zeigen
- **Used in:** Demo, FAQ, Onboarding, Trust collateral
- **Boundary:** Live today: the customer starts a new card and the merchant re-books known stamps as normal bookings (pilot-recovery-runbook §A). Copy switch: 15-copy-switches.md.

#### OPS-05 · Eigene Zugänge und Rollen
**SELL NOW** · sources: O59, O60, OB-employees

- **Merchant pain:** Staff share the owner password.
- **Commercial outcome:** Each staff member has their own access, in a cashier or management role, and access can be revoked.
- **Strongest hook:** „Dein Team arbeitet mit eigenen Zugängen – nicht mit deinem Passwort.“
- **Strongest verticals:** Owners with staff
- **Best channel:** Demo, onboarding
- **Sales/demo proof:** Team page: roles, revocation
- **Objection addressed:** „Ich hab mehrere Mitarbeiter.“
- **CTA:** Team-Ansicht ansehen
- **Used in:** Demo, Onboarding, FAQ
- **Boundary:** Self-signup through the invite link is RC READY; until then the operator provisions staff accounts.

#### OPS-06 · Mehrere Standorte
**SELL NOW** · sources: O68, O100, O102, OB-stores

- **Merchant pain:** Several shops, several systems.
- **Commercial outcome:** One account, several locations, each priced separately; lists filter by location.
- **Strongest hook:** „Ein Konto, mehrere Läden.“
- **Strongest verticals:** Owners with two or more shops
- **Best channel:** FAQ, follow-up
- **Sales/demo proof:** Location switch in the owner view
- **Objection addressed:** „Ich hab mehrere Läden.“
- **CTA:** Mehrere Standorte besprechen
- **Used in:** FAQ, Sales follow-up
- **Boundary:** Location comparison is FUTURE (FUT-20). Verify per-location staff scoping before claiming it.

#### OPS-07 · Netz weg? Stempel kommen nach
**SELL NOW** · sources: prev C4

- **Merchant pain:** Wi-Fi drops at the counter.
- **Commercial outcome:** Stamps are queued offline and booked later.
- **Strongest hook:** „WLAN weg? Stempel kommen trotzdem an.“
- **Strongest verticals:** All
- **Best channel:** FAQ, demo
- **Sales/demo proof:** Offline queue
- **Objection addressed:** „Was, wenn das Netz weg ist?“
- **CTA:** Zeigen
- **Used in:** FAQ, Demo
- **Boundary:** Rewards are redeemed online only.

#### OPS-08 · Startklar-Check
**RC READY — not deployed** · sources: O88, O89

- **Merchant pain:** Unsure whether everything is ready before the first customer.
- **Commercial outcome:** Readiness is derived from the real state, with one next step.
- **Strongest hook:** „Du weißt immer, was vor dem Start noch fehlt.“
- **Strongest verticals:** All
- **Best channel:** Onboarding
- **Sales/demo proof:** Readiness checklist (RC)
- **CTA:** Kommt mit dem nächsten Update
- **Used in:** Onboarding
- **Boundary:** Live today: a short setup list for new accounts.

#### OPS-09 · Das Schild am Tresen
**SELL NOW** · sources: O65, O66, O122

- **Merchant pain:** Software alone is invisible in the shop.
- **Commercial outcome:** A printable counter sign turns the counter into the entry point.
- **Strongest hook:** „Der Tresen wird zum Eingang in die Kundenbeziehung.“
- **Strongest verticals:** All
- **Best channel:** Demo, onboarding, content
- **Sales/demo proof:** Printed Tresenschild
- **CTA:** Schild ansehen
- **Used in:** Demo, Onboarding, Content
- **Boundary:** The merchant prints the sign; Loynara does not ship stands (FUT-16).


### FUTURE

#### FUT-01 · Verschwundene Stammkunden zurückholen
**FUTURE / DO NOT SELL YET** · sources: O8, O36, P2 · prev E3

- **Merchant pain:** A regular stops coming.
- **Commercial outcome:** Merchant-approved win-back message to dormant regulars.
- **Strongest hook:** „Sieh, wer früher regelmäßig kam – und heute fehlt.“
- **Strongest verticals:** Barber, salon, gym, detailing
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: production email off; audiences/automations withheld in production

#### FUT-02 · Persönlicher Besuchsrhythmus
**FUTURE / DO NOT SELL YET** · sources: O9

- **Merchant pain:** A customer breaks their usual cadence.
- **Commercial outcome:** Detect cadence breaks per customer.
- **Strongest hook:** „Sonst alle drei Wochen – jetzt sieben.“
- **Strongest verticals:** Barber, salon
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not built (advanced analytics)

#### FUT-03 · Kurz vor der Prämie / Prämie wartet
**FUTURE / DO NOT SELL YET** · sources: O33, O34, O40, CC-near-reward

- **Merchant pain:** Customers one visit from a reward, or with an unredeemed reward, forget it.
- **Commercial outcome:** Near-reward and reward-waiting reminders.
- **Strongest hook:** „Noch ein Besuch bis zur Prämie.“
- **Strongest verticals:** Café, bakery, pizzeria
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: audience withheld in production; email off

#### FUT-04 · Willkommensstrecke
**FUTURE / DO NOT SELL YET** · sources: O32

- **Merchant pain:** The first visit leaves no trace.
- **Commercial outcome:** A welcome step after the first visit.
- **Strongest hook:** „Der erste Besuch ist der Anfang.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: automations withheld; email off

#### FUT-05 · Geburtstag und Anlässe
**FUTURE / DO NOT SELL YET** · deferred / unsuitable for now · sources: O35

- **Merchant pain:** No occasion to celebrate with the customer.
- **Commercial outcome:** Occasion rewards with permission.
- **Strongest hook:** „Ein Grund zum Feiern – bei dir.“
- **Strongest verticals:** Café, restaurant
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal)
- **Boundary:** Blocked by: no birthday data collected; needs data-protection basis

#### FUT-06 · Eigene Zielgruppe statt Algorithmus
**FUTURE / DO NOT SELL YET** · sources: O27, O28, O29

- **Merchant pain:** Reach depends on social algorithms.
- **Commercial outcome:** Permission-based direct contact with existing customers.
- **Strongest hook:** „Deine nächste Aktion startet mit Leuten, die schon bei dir gekauft haben.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: marketing contact + sending not enabled in production

#### FUT-07 · Richtiges Angebot an die Richtigen
**FUTURE / DO NOT SELL YET** · sources: O30, O31

- **Merchant pain:** Every offer goes to everybody.
- **Commercial outcome:** Segmented, relevant offers.
- **Strongest hook:** „Nicht jedes Angebot passt zu jedem Kunden.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: campaigns/audiences withheld in production

#### FUT-08 · Ruhige Zeiten nutzen
**FUTURE / DO NOT SELL YET** · sources: O10, O11, O12, O37, P3, AD-E, CC-cafe · prev A9, E4

- **Merchant pain:** Tuesday 15:30: staff there, tables empty; fixed costs run.
- **Commercial outcome:** Merchant-approved action for weak periods to eligible regulars.
- **Strongest hook:** „Dienstag. 15:30. Der Laden ist leer.“
- **Strongest verticals:** Café, restaurant, takeaway, beauty, car wash
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: campaigns withheld; email off; day/time analytics not built (quiet-hours send policy is RC READY)

#### FUT-09 · Muster nach Tag und Uhrzeit
**FUTURE / DO NOT SELL YET** · sources: O43

- **Merchant pain:** Unclear when loyalty activity is strong or weak.
- **Commercial outcome:** Day/time pattern view.
- **Strongest hook:** „Wann ist bei dir wirklich wenig los?“
- **Strongest verticals:** Café, pizzeria
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not in live analytics

#### FUT-10 · Was nach einer Aktion passierte
**FUTURE / DO NOT SELL YET** · sources: O46

- **Merchant pain:** Sends without outcome.
- **Commercial outcome:** Post-action outcome view without causation claims.
- **Strongest hook:** „Nicht beim Versenden aufhören.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: campaigns not enabled

#### FUT-11 · Woher Kunden kommen
**FUTURE / DO NOT SELL YET** · sources: O48

- **Merchant pain:** Unknown whether customers came from counter, referral, QR or campaign.
- **Commercial outcome:** Acquisition source per card.
- **Strongest hook:** „Woher kam dein neuer Kunde?“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not shown in production (referral status per card is QUALIFIED via ACQ-02)

#### FUT-12 · Sehen → Verstehen → Handeln
**FUTURE / DO NOT SELL YET** · sources: O49, O50, O119, P10

- **Merchant pain:** A dashboard only reports.
- **Commercial outcome:** Observation paired with the next supported action.
- **Strongest hook:** „Nicht nur sehen. Handeln.“
- **Strongest verticals:** All serious merchants
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: action paths (campaigns) withheld; rule-based hints live via TRU-10

#### FUT-13 · Branchenwissen
**FUTURE / DO NOT SELL YET** · sources: O90, O121

- **Merchant pain:** A barbershop gets café assumptions.
- **Commercial outcome:** Industry-aware setup and hints.
- **Strongest hook:** „Ein Barbershop ist kein Café.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not built

#### FUT-14 · Wallet-Karte
**FUTURE / DO NOT SELL YET** · sources: O72 · prev E1

- **Merchant pain:** Customers want the card where their tickets are.
- **Commercial outcome:** Apple/Google Wallet pass with merchant brand.
- **Strongest hook:** „Karte im Wallet, immer griffbereit.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: Wallet provider-blocked; previews withheld in production

#### FUT-15 · Logo auf der Karte
**FUTURE / DO NOT SELL YET** · sources: prev E5

- **Merchant pain:** Brand only as colour.
- **Commercial outcome:** Merchant logo on the browser card.
- **Strongest hook:** „Dein Logo auf jeder Karte.“
- **Strongest verticals:** Premium café, salon
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: logo display withheld in production

#### FUT-16 · Premium-Aufsteller
**FUTURE / DO NOT SELL YET** · sources: O67

- **Merchant pain:** A printed sheet looks cheap.
- **Commercial outcome:** A professional physical stand, location-specific.
- **Strongest hook:** „Ein Aufsteller, der zu deinem Laden passt.“
- **Strongest verticals:** Premium café, salon, barber
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: hardware not offered; commercial terms open

#### FUT-17 · Prämienkatalog
**FUTURE / DO NOT SELL YET** · sources: O106

- **Merchant pain:** One reward does not fit everyone.
- **Commercial outcome:** Customers choose what they work toward.
- **Strongest hook:** „Deine Kunden wählen ihre Prämie.“
- **Strongest verticals:** Café, salon
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not built (one reward per programme)

#### FUT-18 · Stufen und Status
**FUTURE / DO NOT SELL YET** · sources: O107

- **Merchant pain:** Best customers are treated like everyone else.
- **Commercial outcome:** Tiers worth keeping.
- **Strongest hook:** „Für deine besten Kunden.“
- **Strongest verticals:** Café, salon
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not built

#### FUT-19 · Pakete und Vorauszahlung
**FUTURE / DO NOT SELL YET** · deferred / unsuitable for now · sources: O108

- **Merchant pain:** Repeat visits are not sold upfront.
- **Commercial outcome:** Prepaid packages.
- **Strongest hook:** „Zehn Termine im Paket.“
- **Strongest verticals:** Salon, car wash
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal)
- **Boundary:** Blocked by: not built; financial/legal complexity

#### FUT-20 · Standorte vergleichen
**FUTURE / DO NOT SELL YET** · sources: O101

- **Merchant pain:** Several shops, no comparison.
- **Commercial outcome:** Activity compared by location.
- **Strongest hook:** „Welcher Laden läuft besser?“
- **Strongest verticals:** Multi-location owners
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal), Ausblick line only
- **Boundary:** Blocked by: not verified in live analytics

#### FUT-21 · Bewertung nach einem guten Moment
**FUTURE / DO NOT SELL YET** · deferred / unsuitable for now · sources: O103

- **Merchant pain:** Happy customers rarely leave reviews.
- **Commercial outcome:** A neutral review request after a positive moment; never incentivised.
- **Strongest hook:** „Zufrieden? Erzähl es weiter.“
- **Strongest verticals:** All
- **Best channel:** Not outward until enabled
- **CTA:** Keiner, bis freigeschaltet
- **Used in:** Learning log (demand signal)
- **Boundary:** Blocked by: not built; platform rules and UWG forbid incentivised reviews — keep neutral
<!-- angles:end -->
