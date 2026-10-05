# 13 · First-merchant learning system

The first 10 merchants are the most valuable data Loynara will ever collect. They decide the price story, the café entry, the counter-speed claim and the first honest proof. The system is four CSV files and one rule.

## Files (templates committed; real data stays local)

Copy each template into `gtm/data/private/`. That folder is git-ignored because it holds owner names, permission evidence and quotes, which are personal data. Back it up yourself, encrypted.

| Template | One row per | What it answers |
|---|---|---|
| [`pipeline-template.csv`](data/pipeline-template.csv) | Shop visited | Where the funnel leaks; which objections; which source works |
| [`merchant-metrics-template.csv`](data/merchant-metrics-template.csv) | Live merchant × week | Is the product being used? Read from the owner overview, manually. |
| [`learning-log-template.csv`](data/learning-log-template.csv) | Observation | What we learned, what we changed, and with what evidence |
| [`weekly-scoreboard-template.csv`](data/weekly-scoreboard-template.csv) | Week | The Friday 15-minute review |

```bash
mkdir -p gtm/data/private && for f in pipeline learning-log merchant-metrics weekly-scoreboard; do cp -n gtm/data/$f-template.csv gtm/data/private/$f.csv; done
```

```bash
node gtm/data/funnel.mjs --actuals gtm/data/private/pipeline.csv
```

**Field notes:**
- `pipeline.csv`:
  - `fit_score` is the door score from [03-verticals.md](03-verticals.md).
  - `top_objection` uses the codes from [07-objections.md](07-objections.md).
  - `permission_words` is the owner's exact words when allowing contact. This is the evidence for UWG-safe follow-up.
  - `suppressed=yes` means never contact again.
- `learning-log.csv`:
  - `type` is one of `walkin · demo · setup · day3 · day7 · day21 · ad · content · process`.
  - `quote_permission=yes` only with the owner's explicit OK to use the quote publicly, with or without the shop name (note which).
- `merchant-metrics.csv`:
  - `scan_seconds_sampled` is the median of 5 stopwatch-timed counter scans during a visit. This is the number the café page needs.

## The ten questions the first 10 merchants must answer

| # | Question | Where it's measured | Decision it unlocks |
|---|---|---|---|
| 1 | How long does a counter scan + confirm take on a busy afternoon? | `scan_seconds_sampled` | Café entry; any speed claim |
| 2 | What share of customers accept the card when the staff mention it? | Ask staff on day 7, then `cards_new` vs. owner's estimate of transactions | Script for staff; the sign wording |
| 3 | Do staff confirm without the owner present? | `staff_confirming` | Onboarding: the day-3 visit rule |
| 4 | Which reward do owners pick, and does it change by day 21? | `reward` in pipeline + learning log | Reward suggestions content (AD-24/25) |
| 5 | How many cards come back for a second confirmed visit within 30 days? | `returning_cards_2plus` | The first honest usage statement (see rule below) |
| 6 | Does anyone use referrals in the first 30 days? | `referral_bonuses_booked` | Whether referrals lead the barber pitch |
| 7 | What do owners actually look at in the overview? | Ask on day 21: „Was hast du dir angeschaut?“ | Demo order; owner-view priorities for product |
| 8 | Which objection kills the most demos? | `top_objection` where `pilot_live_date` is empty | Script and angle order |
| 9 | What makes a pilot owner say yes to paying? | Day-21 notes | Price story; D-1 terms |
| 10 | Which features do owners ask for (and how often)? | Learning log, type `day21`/`demo` | Product backlog input (messaging? Wallet? logo?). Never a sales promise. |

## Cadence

| When | What | Minutes |
|---|---|---|
| After every visit | One pipeline row | 2 |
| Day 3 of each pilot | Visit or call. Is staff scanning? Is the sign placed right? | 15 |
| Day 7 | Merchant-metrics row; WhatsApp with real numbers (if permitted) | 10 |
| **Day 21** | In-person review: their numbers, what they looked at, would they pay, introduction ask ([10-merchant-referrals.md](10-merchant-referrals.md)) | 30 |
| Fridays | Weekly scoreboard, one change for next week, learning-log entry for it | 15 |
| After pilot #10 | Write `gtm/findings-first-10.md`: answers to the 10 questions, with n | 120 |

## The rule: when an observation may become a public claim

A sentence about outcomes may leave the founder's notebook only when **all** of these hold:

1. It is measured in `merchant-metrics.csv`, not estimated.
2. It holds for **≥ 5 merchants** in the same vertical (or it names the single merchant, with their written permission).
3. It is phrased as an **observation, never as causation**:
   - Allowed: „Bei unseren ersten fünf Barbern kamen im ersten Monat im Schnitt X Karten ein zweites Mal.“
   - Not allowed: „Loynara bringt X % mehr Stammkunden.“
4. It states n and the period.
5. Any quote has `quote_permission=yes`. A shop name needs its own permission.
6. [01-product-truth.md](01-product-truth.md) gets a new *Proof* row before the claim appears anywhere.

## Privacy (founder operations)

The files hold:
- Business names: public data.
- Owner first names and permission words: personal data, with a legitimate interest for B2B follow-up only.

Rules:
- Never store customers' data from the product here. Merchant metrics are aggregate counts read from the owner overview.
- Delete rows marked `suppressed` from everything except a minimal suppression list.
- Have the Datenschutzerklärung cover this once O-001/O-013 are settled.
