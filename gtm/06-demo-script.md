# 06 · Demo script

## What you demo on (decide before day 1)

| Option | What the owner sees | Needs | Status |
|---|---|---|---|
| **A · Marketing-site demos** (`/`, `/fuer-barber/`, `/fuer-pizzerien/`, `/empfehlungen/`) | Interactive example card, counter confirmation, owner list, referral pair, calculator. All labelled *Beispiel*. | Public site published (O-014), or opened from the founder's laptop via `npm run marketing:preview` | Ready locally. Not public. |
| **B · Real demo merchant in production** ("Demo – Loynara", invented customers created by the founder scanning with a second phone) | The real product: real QR, real staff confirm, real owner overview | Founder decision D-3: creating a merchant in production through the normal signup/operator path is a production change. No `DEMO_MODE`/seed flags (the config check forbids them). | **Recommended**, not yet created |

**Recommendation:** B for the hand-the-phone moment, because a real scan beats any mockup. Use A for the owner, referral and economics views when the demo merchant has no history yet. Never show a real pilot merchant's customer list to another merchant.

Physical kit for each walk-in:
- Demo QR (printed A6 Tresenschild of the demo merchant)
- Founder phone (staff view)
- Second phone or tablet (owner view)
- Handouts (see [12-collateral.md](12-collateral.md))

## Canonical demo (2 minutes standing / 8 minutes seated)

Order is fixed:

```
Customer → Counter → Reward progress → Referral → Owner → Recovery/trust → Economics → Price
```

Each step has a one-line purpose. If time runs out, cut from the middle (Referral, Recovery), never the end.

| # | Step | Show | Say (German, natural) | Interaction point |
|---|---|---|---|---|
| 1 | **Customer** | Owner scans the demo QR with **their own** phone | „Halt mal deine Kamera drauf. … Das ist jetzt die Karte deines Kunden. Keine App, nichts runterladen.“ | They hold the card. Wait until they look at it. |
| 2 | **Counter** | Founder phone: staff scanner, confirm | „Der Kunde zeigt dir das, du scannst, tippst auf Bestätigen. Ohne dich gibt's keinen Stempel – Selbststempeln geht nicht.“ | Ask: „Wer steht bei dir meistens an der Kasse?“ |
| 3 | **Reward progress** | Card updates: 1/10, then reward state on a filled example | „Bei zehn – oder was du festlegst – ist die Prämie da. Dein Team löst sie ein, auch das wird bestätigt.“ | Ask: „Was wäre bei dir die Prämie?“ |
| 4 | **Referral** | `/empfehlungen/` pair (Beispieldaten) or the demo card's share link | „Dein Stammkunde teilt seinen Link. Kommt der Neue und dein Team bestätigt den ersten Besuch, kriegen beide den Bonus. Fürs Teilen allein gibt's nichts.“ | Ask: „Wie kommen neue Kunden heute zu dir?“ |
| 5 | **Owner** | Owner overview: customer list, last visit, stamps | „Das siehst du: wer da war, wann zuletzt, wie viele Stempel. Und wer länger fehlt.“ | Point at an „vor 9 Wochen“ row: „Kennst du so jemanden?“ |
| 6 | **Recovery / trust** | Say it, don't click it | „Verliert ein Kunde seinen Kartenlink, bekommt er eine neue Karte, und du buchst die Stempel nach, die du kennst. Jede Buchung hat einen Namen dahinter. Und was es noch nicht kann, sag ich dir auch: Nachrichten an Kunden, Wallet, Antippen per NFC – das ist Ausblick, nicht Teil des Angebots.“ | — |
| 7 | **Economics** | Calculator (`/#rechner`) with their basket | „Was kostet bei dir ein Haarschnitt im Schnitt? … 25 €? Dann sind 39 € zwei Haarschnitte im Monat. Das ist ein Rechenbeispiel, keine Prognose.“ | **They** type their basket in. |
| 8 | **Price** | Price card | „39 € pro Monat und Standort. Egal, wie viele Kunden oder Mitarbeiter. Alle Bedingungen schriftlich, bevor du etwas zahlst.“ | Then stop talking. |

**Close (after silence):**
> „Wollen wir's bei dir ausprobieren? Ich brauch eine halbe Stunde mit dir, wenn's ruhig ist.“

Things to avoid:
- No feature tour.
- No dashboard tabs they didn't ask about.
- Never say „KI“.
- Never say „mehr Umsatz“.

## Vertical adaptations

### Pizzeria
- **Step 1:** frame the customer as the pickup regular: „Der, der jeden Freitag die Familienbestellung abholt.“
- **Step 2:** show **multiple stamps in one step**. „Vier Pizzen, ein Scan, vier Stempel.“
- **Step 3:** reward example: „eine Pizza aufs Haus“.
- **Step 5:** „Montag bis Donnerstag ruhig? Hier siehst du, wer sonst donnerstags kommt und seit Wochen fehlt.“
- **Mandatory sentence:** „Lieferando- oder Wolt-Bestellungen laufen nicht über Loynara. Es gibt auch keine Anbindung an die Kasse.“
- **Step 7:** €18 basket gives 3 orders.

### Café
- **Step 1:** do this only when there's no queue.
- **Step 2:** address speed: „Der Scan passiert, während die Maschine läuft.“ Don't quote seconds until you've measured them at a real pilot ([13-learning-system.md](13-learning-system.md), `scan_seconds`).
- **Step 3:** reward example: „der zehnte Kaffee“.
- **Step 4:** keep it short; café referrals are weaker.
- **Step 7:** €6 basket gives 7 visits. Say it plainly; don't hide it.

### Barber
- **Step 1:** use the chair moment: „Nach dem Schnitt, beim Bezahlen.“
- **Step 4:** referral is the **main** step here. „Barber leben von Mundpropaganda.“
- **Step 5:** „Dein 4-Wochen-Kunde war seit 9 Wochen nicht da. Der sitzt gerade woanders.“
- **Step 7:** €25 basket gives 2 cuts.
- **Multiple chairs:** „Ein Preis für den Laden, egal wie viele Stühle.“ Each barber gets their own login.

### Salon / Nails (lower-fit, use the barber flow)
- **Step 3:** reward example: „eine Pflegebehandlung als Extra“. The merchant decides the reward. We don't suggest discounts.
- **Step 4:** referral first. Most new clients come through recommendations.
- **Step 5:** visit rhythm of 6–8 weeks. „Wer ist seit zwölf Wochen nicht mehr gekommen?“
- **Caveat:** the browser card shows the shop's name and colour, not its logo. Don't promise a logo.

## After the demo

Within 2 hours:
1. Log the outcome in `data/private/pipeline.csv`.
2. If they agreed to contact: send the after-demo summary ([12-collateral.md](12-collateral.md) §3) by the channel they chose.
