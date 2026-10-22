# 06 · Demo script

## What you demo on

| Option | What the owner sees | Needs | Status |
|---|---|---|---|
| **A · Marketing-site demos** (`/`, `/fuer-barber/`, `/fuer-pizzerien/`, `/empfehlungen/`) | Interactive example card, counter confirmation, owner view, referral pair, calculator. All labelled *Beispiel*. | Opened from the founder's laptop or tablet via `npm run marketing:preview`, until the site is published (O-014) | **Use now** |
| **B · Isolated product demo** (local or preview stack with synthetic data, never production) | The real product screens: card, staff confirm, owner analytics, pseudonymous card list | A local or approved preview environment on the founder's laptop or tablet; synthetic data only | **Use now** for the owner view |
| **C · One controlled demo merchant in production** | The real product with a real scan on the owner's own phone | All three: (1) the merchant-completion RC rehearsal passed; (2) production deployment separately approved; (3) targeted production verification passed. Then create one demo merchant through the normal approved product path. No `DEMO_MODE`/seed flags (the config check forbids them). | **Not yet. Do not create it before all three conditions hold** (D-3) |

**Until C exists:** the „scan with your own phone“ moment becomes „look at it on my tablet“. The merchant does not scan anything that points at production. Never show a real pilot merchant's customer list to another merchant.

Physical kit for each walk-in:
- Tablet with A and B open (offline-capable screenshots as a backup, labelled *Beispiel*)
- Founder phone (staff view in B)
- Printed example Tresenschild (*Beispiel*, no live QR until C exists)
- The flyer (Marketing) as the leave-behind; cheat sheets in [12-collateral.md](12-collateral.md)

## Canonical demo (2 minutes standing / 8 minutes seated)

Order is fixed:

```
Customer → Counter → Reward progress → Referral → Owner → Recovery/trust → Economics → Price
```

Each step has a one-line purpose. If time runs out, cut from the middle (Referral, Recovery), never the end.

| # | Step | Show | Say (German, natural) | Interaction point |
|---|---|---|---|---|
| 1 | **Customer** | Until C: the card on the tablet (B or A). After C: the owner scans the demo QR with **their own** phone | Until C: „So sieht das dein Kunde: Kamera auf den Code am Tresen, Karte ist im Browser. Keine App.“ After C: „Halt mal deine Kamera drauf.“ | Hand them the tablet or let them scan. Wait until they look at it. |
| 2 | **Counter** | Founder phone: staff scanner, confirm | „Der Kunde zeigt dir das, du scannst, tippst auf Bestätigen. Ohne dich gibt's keinen Stempel – Selbststempeln geht nicht.“ | Ask: „Wer steht bei dir meistens an der Kasse?“ |
| 3 | **Reward progress** | Card updates: 1/10, then reward state on a filled example | „Bei zehn – oder was du festlegst – ist die Prämie da. Dein Team löst sie ein, auch das wird bestätigt.“ | Ask: „Was wäre bei dir die Prämie?“ |
| 4 | **Referral** | `/empfehlungen/` pair (Beispieldaten) or the demo card's share link | „Dein Stammkunde teilt seinen Link. Kommt der Neue und dein Team bestätigt den ersten Besuch, kriegen beide den Bonus. Fürs Teilen allein gibt's nichts.“ | Ask: „Wie kommen neue Kunden heute zu dir?“ |
| 5 | **Owner** | Analytics (new cards, confirmed visits, returning cards, rewards) and one pseudonymous card with its last visit | „Das siehst du: wie viele Karten wiederkommen, und pro Karte Stand und letzten Besuch. Namen zeigt Loynara nicht.“ | Point at a card with a long gap: „Merkst du sowas heute?“ |
| 6 | **Recovery / trust** | Say it, don't click it (until the RC is live) | Before the RC: „Wer seinen Kartenlink speichert, kommt immer wieder rein. Ist er weg, legt der Kunde eine neue Karte an und du buchst nach, was du kennst. Mit dem nächsten Update stellst du die Karte neu aus, mit gleichem Stand und Verlauf.“ After the RC: the reissue wording in [15](15-copy-switches.md). Then always: „Und was es noch nicht kann, sag ich dir auch: Nachrichten an Kunden, Wallet, Logo auf der Karte – das ist Ausblick. Antippen per NFC ist vorbereitet.“ | Optional, original playbook „future action“: „Wenn ein Stammkunde verschwindet oder dienstags nichts los ist – da soll Loynara später mehr können als eine Stempelkarte. Heute ist das Ausblick.“ |
| 7 | **Economics** | Calculator (`/#rechner`) with their basket | „Was kostet bei dir ein Haarschnitt im Schnitt? … 25 €? Dann sind 49 € zwei Haarschnitte im Monat. Das ist ein Rechenbeispiel, keine Prognose.“ | **They** type their basket in. |
| 8 | **Price** | Price card | „Normal 49 €, für die ersten Betriebe in Kassel 39 €, und das bleibt so, solange du dabei bist. Pro Monat und Standort, egal wie viele Kunden oder Mitarbeiter. Alle Bedingungen schriftlich, bevor du etwas zahlst.“ | Then stop talking. |

**Ask (original playbook §8), then close:**
> „Würde dir das bei etwas Konkretem helfen?“

Then, before the commercial gates are cleared:
> „Wenn die Bedingungen schriftlich stehen – willst du einer der ersten Läden sein? Ich melde mich, sobald ich dir alles geben kann.“ (log `pilot_interest_date`)

After the gates are cleared:
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
- **Step 5:** „Hier siehst du, wie viele Karten jede Woche wieder bestellen, und pro Karte die letzte Bestellung.“ Quiet weekdays as a pattern are Ausblick (FUT-08/09).
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
- **Step 5:** „Diese Karte kam sonst alle vier Wochen – jetzt ist der letzte Besuch neun Wochen her.“ It is shown per card and pseudonymous; a list of dormant cards is Ausblick.
- **Step 7:** €25 basket gives 2 cuts.
- **Multiple chairs:** „Ein Preis für den Laden, egal wie viele Stühle.“ Each barber gets their own login.

### Salon / Nails (lower-fit, use the barber flow)
- **Step 3:** reward example: „eine Pflegebehandlung als Extra“. The merchant decides the reward. We don't suggest discounts.
- **Step 4:** referral first. Most new clients come through recommendations.
- **Step 5:** visit rhythm of 6–8 weeks. „Pro Karte siehst du den letzten Termin – auch wenn er zwölf Wochen her ist.“
- **Caveat:** the browser card shows the shop's name and colour, not its logo. Don't promise a logo.

## After the demo

Within 2 hours:
1. Log the outcome in `data/private/pipeline.csv`.
2. If they agreed to contact: send the after-demo summary ([12-collateral.md](12-collateral.md) §3) by the channel they chose.
