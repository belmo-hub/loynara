# Loynara: first 100 merchants (GTM system)

**Goal:** paying German local-merchant locations at **49 € / Monat / Standort** (founding shops: „Gründungspreis 39 € für die ersten Betriebe, fest für die Vertragslaufzeit, nur im persönlichen Gespräch“, D-016).
- The price is unchanged; its single source is `marketing-site/src/site.ts`.
- **100 paid locations in month one is the stretch objective, not the expected outcome** ([04](04-funnel.md)).

**Motion:** founder-led, walk-in first (Loynara's conservative policy), Kassel first.

**Branch:** `marketing/gtm-first-100`, marketing-only files.

**Versions:**
- First system: `5364478`.
- Canonical reconciliation with the owner's original *Marketing & Acquisition Playbook* (124-angle bank): 2026-10-05.

## Verdict

**LOY NARA GTM CANONICAL SYSTEM = READY**

Ready means: the angle library, scripts, demo, pages and measurement can be used tomorrow for walk-ins, demos, feedback and pilot interest. These stages wait for gates outside this branch:

| Gate | Kind | Blocks | Does not block |
|---|---|---|---|
| **O-001 · O-011 · O-012 · O-013 · D-1** | Project commercial / launch gates (owner decisions; not a statement of legal requirements) | Close on written terms, payment, paid-start dates, going live with real customer data | Visits, demos, product feedback, pilot interest |
| **O-014** public site | Project launch gate | Paid ads, site links in messages and flyers, retargeting | Walk-ins, permitted follow-ups, organic content production |
| **RC release** | Product release gate | Selling card number, corrections and reissue as live | Saying them as „kommt mit dem nächsten Update“ |
| **NFC acceptance** | Product + physical test gate | NFC as the primary entry claim | „Antippen per NFC ist vorbereitet“ |
| **D-3** production demo merchant | Waits for RC rehearsal + approved deployment + production verification | A real scan on the owner's own phone | Demos on the tablet with local or isolated demo data |

## Final positioning

> **Keep the customers you earned. Bring them back. Let them bring the next ones.** (original north star)

> „Das ist deine Stempelkarte, nur auf dem Handy deiner Kunden – ohne App. Dein Team bestätigt jeden Besuch, und du siehst, wie viele wiederkommen und welche Empfehlung ein echter Besuch war.“

Detail, message hierarchy and claim check: [02-positioning-angles.md](02-positioning-angles.md).

## Contents

| # | Document | What it holds |
|---|---|---|
| 01 | [01-product-truth.md](01-product-truth.md) | Three evidence states: LIVE NOW / RC READY — not deployed / FUTURE, with before/after phrasing; project gates vs legal requirements |
| 02 | [02-positioning-angles.md](02-positioning-angles.md) | Positioning + the **canonical angle library**: 76 angles (generated from `data/angle-library.csv`) |
| 03 | [03-verticals.md](03-verticals.md) | Barber #1, pizzeria/Imbiss #2, café #3 by evidence trigger; original verticals preserved |
| 04 | [04-funnel.md](04-funnel.md) | 100-location funnel, diagnostics, **month-one models A–F**; editable `data/funnel-model.xlsx` |
| 05 | [05-sales-playbook.md](05-sales-playbook.md) | Outreach policy, walk-in, WhatsApp, Instagram, email, phone; original DM lines as permitted follow-ups |
| 06 | [06-demo-script.md](06-demo-script.md) | Canonical demo + pizzeria / café / barber / salon; demo environments A/B/C |
| 07 | [07-objections.md](07-objections.md) | 29 objections with evidence-aware answers |
| 08 | [08-ad-concepts.md](08-ad-concepts.md) | 36 ad concepts incl. the original ads A–D (E held) + test plan |
| 09 | [09-content-calendar.md](09-content-calendar.md) | 30-day calendar + the original „Was würdest du tun?“ series |
| 10 | [10-merchant-referrals.md](10-merchant-referrals.md) | Merchant-to-merchant referrals (ACQ-04), no cash reward |
| 11 | [11-website-strategy.md](11-website-strategy.md) | Page map, claim review of the built pages, next pages by trigger |
| 12 | [12-collateral.md](12-collateral.md) | Demo cheat sheet, after-demo summary, objection sheet, onboarding checklist |
| 13 | [13-learning-system.md](13-learning-system.md) | CSV learning system, with angle tracking and FUTURE demand logging |
| 14 | [14-angle-reconciliation.md](14-angle-reconciliation.md) | All 124 original angles + 45 other original items → canonical angle, coverage before, status |
| 15 | [15-copy-switches.md](15-copy-switches.md) | NFC and RC copy switches: exact website strings and GTM replacements |
| 16 | [16-execution-matrix.md](16-execution-matrix.md) | Core angles → walk-in / demo / static / 15s video / post / objection / vertical; long-tail placements |
| 17 | [17-field-kit.md](17-field-kit.md) | **Field kit:** 60 Kassel prospects + routes, printed German collateral, learning sheet, and the physical counter stand (pre-/post-NFC artwork, laser files, fabrication sheet) |

## Founder decisions

| ID | Decision | Status / recommendation |
|---|---|---|
| **D-1** | Pilot terms, and when a merchant may go live with real customer data before invoicing exists | **Open.** Decide in writing. Until then: pilot interest only. No free months or discounts are invented in these docs. |
| **D-2** | Merchant-referral reward | Non-monetary for now. If money later: one month's credit after the referred location's first paid invoice, written into the AGB. |
| **D-3** | Production demo merchant | **Do not create yet.** Wait until (1) the merchant-completion RC rehearsal passes, (2) production deployment is separately approved, (3) targeted production verification passes. Then create one controlled demo merchant through the normal approved product path. Until then use local, isolated or preview demo data. |
| **D-4** | Homepage NFC wording | **Approved temporarily by the owner:** QR is the live entry claim; NFC is „vorbereitet“ / „Ausblick“. Switch plan in [15](15-copy-switches.md). |
| **D-5** | Publish the site (O-014); cookieless analytics | Publish once O-001 legal data is in. Analytics optional. |

## Month-one target

From [04](04-funnel.md). All rates are untested planning assumptions.

| Model | Expected paying locations (if the gates clear before week 1) |
|---|---|
| A · Solo founder | ≈ 26 |
| B · Founder + one seller | ≈ 47 |
| C · Founder + merchant-referral acceleration | ≈ 31 |
| D · Founder + paid/inbound | ≈ 33 |
| A–D combined (E) | ≈ 64 |
| Combined at stretch rates (F) | ≈ 143 |

**Operating target:**
- **20–25 activated locations solo**, or **≈ 40–45 with a second seller from week 1**.
- **100 stays the stretch.** It needs F: two sellers, stretch-level rates at every stage, referrals and inbound running, and gates cleared before week 1.

## Founder operating plan

**Week shape:**
- **Mon:** pizzerias and Imbiss only (many barbers are closed).
- **Tue–Thu:** full field days.
- **Fri:** follow-ups, setups (only after the gates), the Friday review, content batch.
- **Sat:** no field.

**Field day (target: 25 doors):**

| Time | Block |
|---|---|
| 09:00–10:00 | Route from the door list (public data); permitted follow-ups only (`permission_words` filled) |
| 10:00–12:00 | Barber walk-ins |
| 12:00–14:30 | No walk-ins. Setups (after the gates), day-3 calls, logging. |
| 14:30–17:00 | Pizzeria + barber walk-ins |
| 17:00–17:30 | Log every door in `data/private/pipeline.csv`, with `angle_ids`; same-day permitted messages |

**Friday review (15 min):**
1. `node gtm/data/funnel.mjs --month-one --actuals gtm/data/private/pipeline.csv`
2. Scoreboard row
3. Top objection
4. Best-performing `angle_ids`
5. **One** change for next week, in `learning-log.csv`

**Pilot rhythm (after the gates):** day 0 setup → day 3 check → day 7 numbers → **day 21 in-person review** (paid decision + ACQ-04 introduction ask).

## Next seven GTM actions

| # | When | Action | Done when |
|---|---|---|---|
| 1 | Tue 6 Oct | Decide **D-1** in writing and start **O-001**. Write the open questions for the legal/tax review: which launch gates are legal requirements, and before what. | D-1 written; review questions sent to the advisor of your choice |
| 2 | Tue 6 Oct | Prepare the tablet demo: marketing preview (A) + an isolated product demo with synthetic data (B). Print handouts **without** a QR code. Rehearse the canonical demo 10× aloud. Copy the CSV templates to `gtm/data/private/`. Build a 60-door list (barbers + pizzerias, Kassel-Mitte and Vorderer Westen) from public sources. | The demo runs offline-safe on the tablet; door list ≥ 60 rows |
| 3 | Wed 7 Oct | 25 doors, barber-first. Lead with CORE-03 / CORE-04 / CORE-09. Ask for **pilot interest** only. Log `angle_ids`. | 25 rows with objection codes and angles |
| 4 | Thu 8 Oct | 25 doors, pizzeria-weighted (VER-02 / VER-03; say the Lieferplattform sentence unprompted). Send follow-ups only to owners who said yes. | 50 rows; permissions recorded verbatim |
| 5 | Fri 9 Oct | First Friday review with `--month-one --actuals`. Decide whether to recruit a second seller (model B), based on the door → conversation rate and your capacity. | Scoreboard W1 row; B decision noted |
| 6 | Sat 10 Oct | Pre-produce AD-01, AD-03, AD-16 and AD-33 from the local/isolated demo (labelled „Beispiel“; **no publishing** before O-001). Add new objections and FUTURE requests (FUT-xx) to the learning log. | 4 raw clips; learning log updated |
| 7 | Mon 12 Oct | 20 pizzeria/Imbiss doors; optional café probe of ≤ 10 doors as a learning sample. Ask the product workstream for the RC rehearsal status, so the RC and NFC copy switches ([15](15-copy-switches.md)) can be scheduled. Do not touch the RC. | ≈ 85 doors logged; first floor check; switch dates known or „pending“ |

## Implemented marketing pages

All in `marketing-site/`. Static, script-free supporting pages. Not published, not deployed.

| Path | Content |
|---|---|
| `/` | Concept D. QR-first, NFC „vorbereitet“. Owner view now pseudonymous (Karte A/B/C). Roles line no longer claims day/time patterns. FAQ and price card gated in `src/claims.ts`. |
| `/fuer-barber/` | Owner section: „Du siehst, wie viele wiederkommen. Und welche Karten länger ruhen.“ Pseudonymous rows; dormant list as Ausblick. |
| `/fuer-pizzerien/` | Same correction („…welche Karten seit Wochen ruhen“). Lieferplattform qualifier unchanged. |
| `/empfehlungen/` | Unchanged; claims verified against the live referral rules |

## Test / QA results (2026-10-05, local loopback preview)

| Check | Result |
|---|---|
| `npm run marketing:test`: site, pages, claim safety, **gate switch** (`claims.test.ts`, renders every gate combination) and **angle library** (`gtm-angles.test.ts`: 124 traced, statuses, uses, claim safety, docs fresh, reconciliation sums to 124) | **73 / 73 pass** |
| `npm run marketing:build` (incl. `tsc`) | PASS: 6 static pages, public mode off; refuses a test gate override |
| `npm run marketing:verify` | PASS: 6 pages, 180 links/anchors/assets |
| `browser-check.mjs` | **400 / 400** |
| `pages-check.mjs` (4 pages × 6 widths, reduced motion, keyboard, 200 % text, no-JS) | **211 / 211** |
| `a11y-check.mjs` (axe, 14 states) | No serious or critical violations |
| `node gtm/data/angles.mjs --check` | Generated angle docs up to date |
| Funnel + month-one spreadsheet formulas vs. `funnel.mjs` (independent evaluator) | Identical |

**Not covered:** Safari/WebKit, a physical phone, a screen reader, Excel itself (the formulas were verified by an evaluator), any production system (none was touched).

## Scope kept

**Touched:** `gtm/` and `marketing-site/` only.

**Not touched:**
- `product/merchant-completion`, RC branches
- Auth, schema, migrations
- Ledger, referrals, campaigns, automations backends
- NFC, Wallet
- Railway, Cloudflare, production env

**Not done:** no push, no deploy, no production mutation, no messages sent, no payments or commercial terms implemented, no Concept E.
