# 03 · First two verticals

**Decision:**
1. **Barber shops** (#1)
2. **Pizzerias / Imbiss with counter or pickup trade** (#2)

**Cafés** are the next expansion vertical (#3). Expansion follows an **evidence trigger**, not a fixed count of live merchants (see below).

**Check against the original playbook (2026-10-05):** the original 124-angle bank lists cafés and bakeries first in several priority angles (repeat visits, reward progress), and adds car wash, gym and restaurant positioning. That is a positioning assertion, not field evidence, so it does not overturn the scoring below. Barber and pizzeria stay first. The original vertical lines are preserved as VER-01…VER-08 in [02](02-positioning-angles.md); car wash, gym and restaurant are deferred verticals.

Target geography: **Kassel** first, the city the outreach tooling is configured for (`outreach/`, `targetCountry: "DE"`). Saturate one city before opening a second: density makes walk-ins cheap and lets merchants refer neighbours.

## Scoring

Scores run 1–5 and are the founder's judgement, not measured data. Re-score after 30 conversations per vertical.

| Criterion (weight) | Barber | Pizzeria/Imbiss | Café | Bakery | Salon (women) | Nails | Gym | Car wash | Restaurant |
|---|---|---|---|---|---|---|---|---|---|
| Visit frequency fits a 10-stamp card (×3) | 4 (every 2–5 weeks) | 5 (weekly) | 5 (daily) | 5 | 3 (every 6–8 weeks) | 3 | 2 (membership) | 3 | 2 |
| €39 vs basket: visits to break even (×3) | 5 (≈2 at €25) | 4 (≈3 at €18) | 2 (≈7 at €6) | 1 (≈13 at €3) | 5 | 4 | 3 | 4 | 4 |
| Owner present, decides alone on the spot (×3) | 5 | 4 | 3 | 2 (chains, staff) | 4 | 4 | 2 | 3 | 3 |
| Paper cards already common, so no education needed (×2) | 4 | 5 | 5 | 4 | 3 | 4 | 1 | 4 | 2 |
| Word of mouth drives new customers, so referrals fit (×2) | 5 | 3 | 3 | 2 | 5 | 5 | 3 | 2 | 3 |
| Counter moment where staff can scan (×2) | 5 (at checkout) | 5 (pickup) | 4 (queue pressure) | 2 (queue) | 4 | 4 | 2 | 3 | 2 (table service) |
| Density in Kassel, so many doors per hour (×1) | 5 | 5 | 4 | 4 | 4 | 4 | 2 | 2 | 4 |
| Competition / incumbent tools (×1, higher = less) | 4 | 3 | 2 | 3 | 3 | 3 | 2 | 3 | 3 |
| **Weighted total (max 85)** | **79** | **73** | 60 | 47 | 67 | 66 | 37 | 53 | 48 |

Salon and nails score well but sit behind barbers. They overlap in motion and messaging, so they become #4/#5 using the barber playbook almost unchanged.

## Why barber first

- **The maths is easiest to say out loud:** „39 € sind zwei Haarschnitte.“
- **The owner is at the chair:** no gatekeeper. You can wait for a gap between cuts.
- **Referrals are native:** a barber's growth *is* word of mouth, and our referral rules are the most differentiated sell-now feature.
- **The visit rhythm speaks to a real fear:** a 4-week regular who's been gone for 9 weeks is probably at another barber. Today this shows per card (last visit, pseudonymous); a list of dormant regulars is FUTURE (RET-01 / FUT-01).
- **Risks:**
  - Some barbers run on booking tools (Treatwell, Booksy, Planity). Booking ≠ loyalty, so this is not a conflict, but don't claim integration.
  - Some are cash-only and not tech-minded. The browser card helps; the price may still be the objection.

## Why pizzeria second

- **Weekly frequency** with a paper card already in the drawer („Die zehnte Pizza…“).
- **Owner usually at the oven or counter** in the afternoon (15–17 h is the quiet window).
- **Lieferando resentment is a real wedge:** say only what's true. „Keine Provision pro Bestellung“ is about our pricing model. Never claim we count Lieferando orders: *„Bestellungen über Lieferplattformen laufen nicht über Loynara.“*
- **Risks:**
  - A high delivery share means fewer counter scans, so qualify on pickup/counter share in discovery.
  - Families order in groups. Use the multiple-stamps-in-one-step feature.

## Why café is not first, and when it starts

The café has the highest frequency, but:
- Break-even needs about 7 extra visits at a €6 basket.
- Queue pressure makes the staff scan the hardest moment.
- Free-tier digital card tools compete most densely here.

**Evidence trigger for the café test.** Start café walk-ins when **all** of these hold for barbers and pizzerias combined:
1. **Enough real conversations:** ≥ 40 owner conversations and ≥ 20 demos logged in `pipeline.csv`.
2. **Repeatable objections:** the top three objection codes have been the same for two consecutive Friday reviews.
3. **A viable pitch:** demo → pilot interest is at or above the 20 % floor across at least 15 demos with one stable script.

A small **café probe** (about 10 doors) may run earlier as a learning sample. It does not count as entering the vertical.

The **`/fuer-cafes/` page** additionally waits for a measured counter scan time from real use (`scan_seconds_sampled` in the learning system), because speed is the café owner's first question.

## Ideal merchant profile (score each walk-in on the spot)

| Signal | Points |
|---|---|
| Owner-operated, owner in the shop | +3 |
| Paper stamp card visible at the counter | +3 |
| ≥ 1 staff member besides the owner | +1 |
| Customers mostly local regulars (owner says "Stammkunden") | +2 |
| Counter / checkout moment exists (not table-only, not delivery-only) | +2 |
| Owner uses a smartphone for business (WhatsApp, Instagram, card terminal) | +1 |
| Part of a franchise/chain needing HQ approval | −4 |
| Already using a digital loyalty tool with a contract | −2 |
| > 70 % of orders through delivery platforms | −3 |

- **8 or more:** push for a demo today.
- **5–7:** leave the handout and ask permission to follow up.
- **Below 5:** be friendly and leave.
