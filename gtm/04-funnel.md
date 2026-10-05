# 04 · The 100-merchant funnel

Editable model:
- [`data/funnel-model.xlsx`](data/funnel-model.xlsx): live formulas. Change only the input rows 2–10 (column `type` = input).
- [`data/funnel-model.csv`](data/funnel-model.csv): the source.
- [`data/funnel.mjs`](data/funnel.mjs): recalculates from the CSV and, with `--actuals data/private/pipeline.csv`, compares real rates with the floors below.

```bash
node gtm/data/funnel.mjs --actuals gtm/data/private/pipeline.csv
```

**All rates are planning assumptions, not benchmarks.** No Loynara conversion data exists yet. Replace them with real rates after the first 60 doors.

## Stages (one definition each, used everywhere)

| Stage | Counts when… | Logged in `pipeline.csv` column |
|---|---|---|
| Door | You entered the shop with intent to pitch | `visit_date` |
| Owner conversation | The decision-maker talked with you for over a minute | `owner_conversation_date` |
| Demo | The owner held the card on their own phone, or saw the 2-minute demo | `demo_date` |
| Pilot live | Counter sign is up, ≥ 1 staff login works, first real visit confirmed | `pilot_live_date` |
| Active | ≥ 25 confirmed visits in the first 14 days. This is a hypothesis; tune it per vertical. | `active_by_day14` |
| Paid | First invoice paid. Possible only after O-001/O-011/O-012/O-013. | `paid_date` |

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

## Commercial gate (state this honestly in every pilot conversation)

The funnel can run through **Pilot live** today, but only once a demo merchant exists (see the README decisions). **Paid** needs:
- O-001: operator identity
- O-011: invoice route
- O-012: VAT treatment of the €39
- O-013: AGB / AVV

How pilots are billed before invoicing exists is **founder decision D-1** (see [README](README.md)). These docs don't invent free months or discounts. Until D-1 is decided, the founder says:
> „Der Preis ist 39 € pro Monat und Standort. Bevor du irgendetwas zahlst, bekommst du alle Bedingungen schriftlich.“

## Diagnostic floors (target scenario)

Judge a stage only after the minimum sample. Change **one** thing at a time. Note the change in `learning-log.csv`.

| Stage | Floor | Judge after | If below: likely cause, then first fix |
|---|---|---|---|
| Door → owner conversation | 30 % | 60 doors | Wrong time or street. Go Tue–Thu 14:30–17:00. Barbers: avoid Saturdays and lunch. Pizzerias: 15:00–17:00, before the evening rush. Many barbers close on Mondays. |
| Conversation → demo | 35 % | 40 conversations | Opener too long or too "SaaS". Switch to the hand-the-phone opener: let them scan the demo QR within 20 seconds. |
| Demo → pilot | 20 % | 25 demos | Fit or offer. Tag each lost demo with its objection code ([07-objections.md](07-objections.md)). If "price" is the top 2, test the break-even line earlier. If "trust", lead with D-angles. |
| Pilot active by day 14 | 60 % | 10 pilots | Staff don't scan. Do the day-3 visit, re-brief staff, move the sign to the payment spot. |
| Pilot → paid | 60 % | 10 decisions | Value not visible. Run the day-21 review in person with the owner's own numbers. |
| Referral intros | 1 per 5 live merchants | 30 days after pilot #10 | Ask at the wrong time. Ask at the day-21 review, right after showing their own numbers. |

## Weekly scoreboard (Friday, 15 minutes)

| Week | Doors | Conversations | Demos | Pilots live | Active d14 | Paid | Referral intros | Top objection | One change for next week |
|---|---|---|---|---|---|---|---|---|---|
| W1 | | | | | | | | | |

Copy this into `data/private/weekly-scoreboard.csv`, or run the funnel script with `--actuals`.
