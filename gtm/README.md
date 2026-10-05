# Loynara: first 100 merchants (GTM system)

**Goal:** 100 paying German local-merchant locations at **€39 / Monat / Standort** (price unchanged; single source `marketing-site/src/site.ts`).
**Motion:** founder-led, walk-in first, Kassel first. **Branch:** `marketing/gtm-first-100`, marketing-only files.
**Written:** 2026-10-05.

## Verdict

**FIRST 100 MERCHANT GTM SYSTEM = READY TO EXECUTE**

Two stages are gated by items outside this branch:

| Gate | Blocks | Does not block |
|---|---|---|
| **D-3** demo merchant (founder creates it in the app) | The real-product hand-the-phone demo | Walk-ins with the marketing-site demos on the founder's laptop/phone via local preview |
| **O-001 · O-011 · O-012 · O-013** (operator identity, invoice route, VAT, AGB/AVV) | The **Paid** stage, and any digital promotional follow-up footer | Doors, conversations, demos, pilot setup (per D-1) |
| **O-014** public site | Paid ads, the site link in messages and handouts | Walk-ins, permitted follow-ups, organic content production |

## Final positioning

> „Das ist deine Stempelkarte, nur auf dem Handy deiner Kunden – ohne App. Dein Team bestätigt jeden Besuch, und du siehst endlich, wer wiederkommt und wer fehlt.“

**Who it's for:** owner-run barbers and pizzerias (then cafés) in Kassel that already know their regulars by face.

**What it is not:**
- Not marketing automation
- Not a POS
- Not an app
- Not a discount platform

**What it can't do yet, and we say so:**
- Messages to customers
- Wallet card
- NFC tap
- Logo on the card
- POS or delivery-platform integration

Detail in [02-positioning-angles.md](02-positioning-angles.md).

## Deliverables

| # | Deliverable | Where |
|---|---|---|
| 1 | Final positioning | above · [02](02-positioning-angles.md) |
| 2 | First two verticals + rationale | [03-verticals.md](03-verticals.md): **barber**, **pizzeria/Imbiss**; café third |
| 3 | Angle matrix A (10 core) · B (8) · C (6) · D (5) · E (5 future, do-not-use) | [02-positioning-angles.md](02-positioning-angles.md) |
| 4 | Sell-now / qualified / future claim matrix | [01-product-truth.md](01-product-truth.md) |
| 5 | 100-merchant funnel: 3 scenarios, editable, diagnostic floors | [04-funnel.md](04-funnel.md) · [data/funnel-model.xlsx](data/funnel-model.xlsx) · [data/funnel.mjs](data/funnel.mjs) |
| 6 | Daily / weekly founder plan | below |
| 7 | Walk-in script (German) | [05 §1](05-sales-playbook.md) |
| 8 | WhatsApp sequences | [05 §2](05-sales-playbook.md) |
| 9 | Instagram DMs | [05 §3](05-sales-playbook.md) |
| 10 | Email sequences | [05 §4](05-sales-playbook.md) |
| 11 | Phone script | [05 §5](05-sales-playbook.md) |
| 12 | Canonical demo + pizzeria / café / barber / salon | [06-demo-script.md](06-demo-script.md) |
| 13 | Objection bank (22 objections) | [07-objections.md](07-objections.md) |
| 14 | 32 ad concepts + 4-week test plan | [08-ad-concepts.md](08-ad-concepts.md) |
| 15 | 30-day content calendar | [09-content-calendar.md](09-content-calendar.md) |
| 16 | Merchant-to-merchant referral process (no cash reward) | [10-merchant-referrals.md](10-merchant-referrals.md) |
| 17 | Website page strategy | [11-website-strategy.md](11-website-strategy.md) |
| 18 | Implemented marketing pages | `/fuer-barber/`, `/fuer-pizzerien/`, `/empfehlungen/` in `marketing-site/` (below) |
| 19 | Collateral: handout, demo cheat sheet, after-demo summary, objection cheat sheet, onboarding checklist | [12-collateral.md](12-collateral.md) |
| 20 | First-merchant learning system (CSV) | [13-learning-system.md](13-learning-system.md) · `data/*-template.csv` |
| 21 | Test / QA results | below |
| 22 | Next 7 days | below |

## Founder decisions needed (nothing below was decided for you)

| ID | Decision | Recommendation | Needed by |
|---|---|---|---|
| **D-1** | How pilots that go live before invoicing exists (O-011) are billed | Decide in writing before the first setup. These docs don't offer free months or discounts; the founder line is „Bedingungen schriftlich, bevor du etwas zahlst“. | First pilot setup |
| **D-2** | Merchant-referral reward | Non-monetary only for now (thank-you visit, priority support). If money later: one month's credit after the referred location's first paid invoice, written into the AGB. | Pilot #10 |
| **D-3** | Create a demo merchant („Demo – Loynara“) in production through the normal app flow, with test customers created by scanning with the founder's second phone | Yes. It's the strongest demo. It is a production change, so the founder does it personally. No demo/seed flags (the config check forbids them). | Day 1 |
| **D-4** | Approve the homepage wording change: NFC moved from today's claim to „Ausblick“, QR-first | Approve. The old wording sold physical NFC acceptance that isn't evidenced. | Before publishing |
| **D-5** | Publish the site (O-014) and whether to add cookieless analytics | Publish once O-001 legal data is in. Analytics optional; mailto subjects and „Wie bist du auf uns gekommen?“ suffice for now. | Week 3 |

## Founder operating plan (deliverable 6)

**Week shape:**
- **Mon:** pizzerias and Imbiss only. Many barbers are closed.
- **Tue–Thu:** full field days.
- **Fri:** setups, follow-ups, the Friday review, content batch.
- **Sat:** no field; barbers are busiest.

**Field day (target: 25 doors):**

| Time | Block |
|---|---|
| 09:00–10:00 | Route from the door list (public data, `outreach/prospects-template.csv`), and permitted follow-ups only (`permission_words` filled) |
| 10:00–12:00 | Barber walk-ins (quiet mornings) |
| 12:00–14:30 | No walk-ins (lunch rush). Pilot setups at barbers, day-3 calls, pipeline logging. |
| 14:30–17:00 | Pizzeria + barber walk-ins (the quiet window) |
| 17:00–17:30 | Log every door in `data/private/pipeline.csv`; same-day permitted messages (W1/E1/I2) |

**Weekly targets (target scenario):** about 100 doors · 45 conversations · 21 demos · 7 pilot setups.

**Friday review (15 min):**
1. `node gtm/data/funnel.mjs --actuals gtm/data/private/pipeline.csv`
2. Weekly scoreboard row
3. Top objection
4. **One** change for next week, logged in `learning-log.csv`

**Pilot rhythm per merchant:** day 0 setup → day 3 check → day 7 numbers → **day 21 in-person review** (the paid decision and the referral ask).

## Next 7 days (deliverable 22)

| Day | Date | Exact actions | Done when |
|---|---|---|---|
| 1 | Tue 6 Oct | (a) Decide **D-1** and **D-3**. Create the demo merchant in the app, print its Tresenschild, and create 3 test cards from your second phone with stamps at 2, 7 and 10. (b) Start **O-001** (Impressum data). (c) Copy the CSV templates to `gtm/data/private/`. (d) Build the first 60-door list: barbers + pizzerias in **Kassel-Mitte** and **Vorderer Westen** from public sources. (e) Print 100 handouts ([12 §1](12-collateral.md); site QR replaced by demo-card QR) and laminate the demo cheat sheet. (f) Rehearse the 2-minute demo 10 times aloud, with a stopwatch. | Demo QR scans to a real card; door list ≥ 60 rows |
| 2 | Wed 7 Oct | Field day: 25 doors, barber-first, Kassel-Mitte. Walk-in script [05 §1](05-sales-playbook.md). Log every door by 17:30. | 25 pipeline rows, with objections coded |
| 3 | Thu 8 Oct | Field day: 25 doors, pizzeria-weighted, Vorderer Westen. Send W1/E1 **only** to owners who said yes to contact. | 50 rows total; permissions recorded verbatim |
| 4 | Fri 9 Oct | AM: permitted follow-ups; book setups for any yes (≤ 5 days out). PM: 15 doors. 16:30: **first Friday review**: run `funnel.mjs --actuals`, note door → conversation rate and top objection, pick one change. | Scoreboard W1 row; one logged change |
| 5 | Sat 10 Oct | No field. Record raw footage on the demo merchant for AD-01, AD-03, AD-14, AD-16 (labelled „Beispiel“). **Don't publish** until O-001 is done. Update [07-objections.md](07-objections.md) with any objection heard that isn't in it. | 4 raw clips; objection bank updated |
| 6 | Sun 11 Oct | Rest. 20 minutes: re-read the claim check ([02](02-positioning-angles.md), bottom); mark any line you caught yourself saying that isn't in *Sell now*. | — |
| 7 | Mon 12 Oct | PM: 20 pizzeria/Imbiss doors (barbers closed). First pilot setups, if booked: use the onboarding checklist. With ≈ 85 doors done, compare door → conversation against the 30 % floor (judge at 60+). | Setups done per checklist; first floor check |

## Implemented marketing pages (deliverable 18)

All in `marketing-site/`. Static and script-free; the price comes from `SITE.price`; every example is labelled.

| Path | Content |
|---|---|
| `/fuer-barber/` | „Jeder Schnitt zählt.“ Example card, referral pair, owner list, break-even €25 → 2, five FAQs |
| `/fuer-pizzerien/` | „Die zehnte Pizza kennt jeder.“ Multiple stamps in one step, Lieferplattform qualifier, break-even €18 → 3 |
| `/empfehlungen/` | Four steps, fairness rules, causation caveat, links to both verticals |

**Homepage:** NFC-as-today wording replaced with QR-first plus an NFC „Ausblick“ (D-4). New footer nav to the three pages, and the pages are in `sitemap.xml`.

**Not published, not deployed.**

## Test / QA results (deliverable 21)

Run on 2026-10-05 against the local loopback preview.

| Check | Result |
|---|---|
| `npm run marketing:test` (node:test incl. new `tests/pages.test.ts`: claims, price source, boundaries, linking, a11y structure) | **60 / 60 pass** |
| `npm run marketing:build` | PASS: 6 static pages, public mode off |
| `verify.mjs` | PASS: 6 pages, 180 links/anchors/assets, metadata, private-output checks |
| `browser-check.mjs` (homepage interactions) | **400 / 400** |
| `pages-check.mjs` (new): 4 pages × 320/360/390/768/1280/1440, reduced motion, keyboard skip link + FAQ, 200 % text at 640 px, no-JS completeness, overflow/clipping, tap targets ≥ 24 px, console, external requests | **211 / 211** |
| `a11y-check.mjs` (axe): 14 states incl. the three new pages, desktop + mobile | No violations |
| Funnel model: spreadsheet formulas vs. `funnel.mjs` (independent evaluator) | Identical across all 3 scenarios |
| `funnel.mjs --actuals` on a synthetic 20-row pipeline (quoted commas) and on the empty template | Correct rates and „too early“ verdicts |

**Not covered:**
- WebKit/Safari
- A physical phone
- A screen reader
- Opening the `.xlsx` in Excel. Numbers automation timed out; formulas were verified by an evaluator instead.
- Any production system. None was touched.

## Scope kept

**Touched:** `gtm/` and `marketing-site/` only.

**Not touched:**
- `product/merchant-completion`, RC branches
- Auth, schema, migrations
- Ledger, referrals, campaigns, automations
- NFC, Wallet
- Railway, Cloudflare, production env

**Not done:** no push, no deploy, no production mutation, no messages sent, no payments or commercial terms implemented, no Concept E.

The original 124-angle bank was not found; see the note in [02](02-positioning-angles.md).
