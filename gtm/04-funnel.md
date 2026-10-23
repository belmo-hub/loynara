# 04 · The 100-merchant funnel

**100 paid locations in month one is the stretch objective, not the expected outcome.** The realistic month-one operating target is in the month-one section below.

Editable model:
- [`data/funnel-model.xlsx`](data/funnel-model.xlsx): live formulas in two sheets, *Funnel* (the 100-location plan over weeks) and *Month one* (operating models A–F). Change only rows whose `type` is `input`.
- [`data/funnel-model.csv`](data/funnel-model.csv) and [`data/month-one-model.csv`](data/month-one-model.csv): the sources. Rebuild the workbook with `python3 gtm/data/build-xlsx.py`.
- [`data/funnel.mjs`](data/funnel.mjs): recalculates from the CSV and, with `--actuals data/private/pipeline.csv`, compares real rates with the floors below.

```bash
node gtm/data/funnel.mjs --month-one --actuals gtm/data/private/pipeline.csv
```

**All rates are planning assumptions, not benchmarks.** No Loynara conversion data exists yet. Replace them with real rates after the first 60 doors.

## Stages (one definition each, used everywhere)

| Stage | Counts when… | Logged in `pipeline.csv` column |
|---|---|---|
| Door | You entered the shop with intent to pitch | `visit_date` |
| Owner conversation | The decision-maker talked with you for over a minute | `owner_conversation_date` |
| Demo | The owner held the card on their own phone, or saw the 2-minute demo | `demo_date` |
| Pilot live | Counter sign is up, ≥ 1 staff login works, first real visit confirmed. Going live with real customer data is owner decision D-1. | `pilot_live_date` |
| Active | ≥ 25 confirmed visits in the first 14 days. This is a hypothesis; tune it per vertical. | `active_by_day14` |
| Pilot interest | The owner says they want to start once terms are ready. This is allowed before the commercial gates clear. | `pilot_interest_date` |
| Close | The owner agrees to the written terms (49 € list or the 39 € founding price). Only possible after the owner clears the commercial gates. | `close_date` |
| Paid | First invoice paid | `paid_date` |

## Three scenarios (from the model)

| | Conservative | **Target** | Stretch |
|---|---|---|---|
| Locations per paying merchant | 1.05 | 1.1 | 1.2 |
| Share of merchants from referrals | 5 % | 15 % | 25 % |
| Door → owner conversation | 35 % | 45 % | 55 % |
| Conversation → demo | 40 % | 50 % | 60 % |
| Demo → pilot | 25 % | 35 % | 45 % |
| Pilot → paid | 60 % | 75 % | 85 % |
| Doors per field day × days/week | 20 × 4 | 25 × 4 | 30 × 4 |
| **Paying merchants needed** | 96 | **91** | 84 |
| Pilots needed | 154 | **104** | 75 |
| Demos needed | 616 | **298** | 167 |
| Owner conversations | 1 540 | **596** | 279 |
| **Doors needed** | 4 400 | **1 325** | 508 |
| **Field weeks** | 55 | **14** | 5 |
| Demos per week | 11.2 | **21.3** | 33.4 |
| Pilot setups per week | 2.8 | **7.4** | 15 |

Add about 4 weeks to every scenario for the last pilots to reach their paid decision.

**Reading the table:**
- *Target* is a realistic plan for one founder: about 14 field weeks plus 4 weeks of tail.
- *Conservative* is a warning: if real rates sit there after 60 doors, door-to-door alone takes a year. Fix the weakest stage (see below) before adding hours.
- *Stretch* is only possible with strong referral loops and a high fit score at the door.

**Capacity check (target):** 7.4 setups per week × about 1 hour, plus follow-ups. Support load grows with every live pilot. From pilot #40 on, block half of day 5 for support. Kassel has enough barbers and pizzerias for the first 1 325 doors only if neighbouring towns are included. Before week 6, build the door list from public sources (`outreach/prospects-template.csv`) to confirm the count.

## Commercial gates (state them honestly in every conversation)

These are **project commercial / launch gates** that the owner set, not statements about what the law requires. Whether any of them is legally required before a first payment is for qualified legal and tax review (see [01](01-product-truth.md)).

| Gate | What it is |
|---|---|
| O-001 | Operator identity |
| O-011 | Invoice route |
| O-012 | VAT presentation of the price (49 € list, 39 € founding price) |
| O-013 | AGB / AVV |
| D-1 | Pilot terms before invoicing exists |

**Allowed before the gates clear:** door → conversation → demo → feedback → **pilot interest**.

**Not allowed until the owner clears the gates:** close (written terms), collecting payment, a promised paid-start date, going live with real customer data (D-1).

These docs don't invent free months or discounts. The founder line:
> „Pro Monat und Standort: normal 49 €, für die ersten Betriebe in Kassel 39 €, und das bleibt so, solange du dabei bist. Bevor du irgendetwas zahlst, bekommst du alle Bedingungen schriftlich – ein Startdatum nenne ich dir erst, wenn die stehen.“

**Consequence for month one:** if the gates are not cleared before week 1, month one produces *pilot interest*, not paid locations. Every month-one number below assumes the gates were cleared before the first field day.

## Month one: what 100 would take

Editable: sheet *Month one* in the workbook, or `month-one-model.csv`. Run `node gtm/data/funnel.mjs --month-one`. The rates are the target-scenario planning assumptions above (column F uses the stretch rates). **No rate is measured yet.**

Definitions for this sheet:
- **Close** = agrees to the written terms (49 € list or 39 € founding price).
- **Activated** = live and ≥ 25 confirmed visits by day 14. Closes from weeks 3–4 activate in month two, so these figures are an upper bound for month one.

| Operating model | Doors in 4 weeks | Demos | Activated merchants | Paying locations expected | Doors needed for 100 | …per seller field day | Demo rate needed | Close rate needed | Activation rate needed |
|---|---|---|---|---|---|---|---|---|---|
| **A** Solo founder | 400 | 90 | 23.6 | **26** | 1 540 | 96.3 | 1.92 ✗ | 1.35 ✗ | 2.89 ✗ |
| **B** Founder + one seller (newer seller closes at 90 %) | 800 | 180 | 42.5 | **46.8** | 1 711 | 53.5 | 1.07 ✗ | 0.75 | 1.60 ✗ |
| **C** Founder + merchant-referral acceleration (0.5 intros per activated merchant, 40 % become activated) | 400 | 90 | 28.3 | **31.2** | 1 283 | 80.2 | 1.60 ✗ | 1.12 ✗ | 2.41 ✗ |
| **D** Founder + paid/inbound (10 leads/week, 60 % to demo; needs O-014) | 400 | 114 | 29.9 | **32.9** | 1 433 | 89.6 | 1.79 ✗ | 1.06 ✗ | 2.28 ✗ |
| E · B + C + D combined | 800 | 204 | 57.8 | **63.6** | 1 319 | 41.2 | 0.82 | 0.55 | 1.18 ✗ |
| F · E at the stretch rates | 800 | 288 | 119 | **142.8** | 539 | 16.8 | 0.40 | 0.32 | 0.60 |

✗ = the required rate is above 100 %, so no rate improvement alone can close the gap at that volume.

**What has to change for 100 in about one month:**
1. **Volume:** two people in the field from week 1 (B). A solo founder would need about 96 doors per field day.
2. **Rates at stretch level, simultaneously:**
   - door → conversation 55 %
   - conversation → demo 60 %
   - demo → close 45 %
   - activation 85 %
   Only F reaches 100. That means the opener, demo and offer must already be proven before month one starts; they are not proven today.
3. **Referrals and inbound both running:** merchant introductions inside the month, plus about 10 inbound leads per week, which needs the public site (O-014) and organic content (O-001).
4. **Commercial gates cleared before week 1.** Otherwise the month yields pilot interest only.
5. **Onboarding capacity:** about 120 closes in F means about 30 setups per week. That needs a second person able to run setups, or setup sessions for several merchants at once.

**Realistic month-one operating target:**
- **Solo:** 20–25 activated locations (model A gives 26 at untested target rates; plan for less until the first 60 doors produce real rates).
- **With a second seller from week 1:** about 40–45 (model B).
- **100 stays the stretch:** it needs model F conditions.
- Re-run the model with real rates after the first Friday review.

## Diagnostic floors (target scenario)

Judge a stage only after the minimum sample. Change **one** thing at a time. Note the change in `learning-log.csv`.

| Stage | Floor | Judge after | If below: likely cause, then first fix |
|---|---|---|---|
| Door → owner conversation | 30 % | 60 doors | Wrong time or street. Go Tue–Thu 14:30–17:00. Barbers: avoid Saturdays and lunch. Pizzerias: 15:00–17:00, before the evening rush. Many barbers close on Mondays. |
| Conversation → demo | 35 % | 40 conversations | Opener too long or too "SaaS". Switch to the hand-the-phone opener: let them scan the demo QR within 20 seconds. |
| Demo → pilot interest (before the gates) / pilot (after) | 20 % | 25 demos | Fit or offer. Tag each lost demo with its objection code ([07-objections.md](07-objections.md)). If "price" is the top 2, test the break-even line earlier. If "trust", lead with D-angles. |
| Pilot active by day 14 | 60 % | 10 pilots | Staff don't scan. Do the day-3 visit, re-brief staff, move the sign to the payment spot. |
| Pilot → paid | 60 % | 10 decisions | Value not visible. Run the day-21 review in person with the owner's own numbers. |
| Referral intros | 1 per 5 live merchants | 30 days after pilot #10 | Ask at the wrong time. Ask at the day-21 review, right after showing their own numbers. |

## Weekly scoreboard (Friday, 15 minutes)

| Week | Doors | Conversations | Demos | Pilot interest | Closes | Pilots live | Active d14 | Paid | Referral intros | Top objection | One change for next week |
|---|---|---|---|---|---|---|---|---|---|
| W1 | | | | | | | | | | | |

Copy this into `data/private/weekly-scoreboard.csv`, or run the funnel script with `--actuals`.
