# 18 October: Release 1 core acceptance on production (S-6)

**DRAFT for the Sunday ledger PR (launch plan v2, §5 core tests C1–C10 and O1).** Status: **ACCEPTED** for C1–C10 and O1, on the founder's results below. O2 (live rollback drill) and O3 (test alert to both phones) were not run and stay open.

| Item | Value |
|---|---|
| Criterion | Launch plan v2 §5, core tests C1–C10 (mandatory) and operations test O1 |
| Release under test | Release 1, `ddfed7f04bd1017801561c327628af9379188b27`, schema 0025, deployed 17 October ([DEPLOYED entry](2026-10-17-release-1-production-deploy.md)) |
| Environment | Production, `https://app.getloynara.com` |
| Window | Sunday 18 October 2026, 10:40–11:35 UTC |
| Reviewer and decision | Founder ran C1–C10 himself and reported each result in chat; the release operator session checked every result against the production ledger with read-only SELECTs and sent the replay requests listed under C3, C4 and C5. The founder's acceptance decision is the merge of this entry (A-14) |
| Shop and card | Synthetic stamp shop "Synthetic RC Hygiene 51cbb56e" (reward costs 2 stamps), test card `K-RCDUAB` created 10:57 UTC. Cross-tenant check against the second synthetic shop ("test", points) |
| Devices | Founder's iPhone (Safari, customer) and laptop browser (owner and cashier). **No Android phone was available**, so the plan's "cashier on Android" was run on the laptop browser |

## Results

| Test | Result | Evidence |
|---|---|---|
| C1 enrol via the shop's QR | **PASS** | Card created 10:57 UTC, shows 0 and its card number |
| C2 cashier awards 1 stamp | **PASS** (laptop browser, not Android) | Awards at 10:58:22 and 10:59:27 UTC, card updated |
| C3a double tap books once | **PASS** | Founder double-tapped "1 Stempel" at 11:30 UTC: exactly one award row (11:30:11), balance 1 → 2 |
| C3b replay with the same key | **PASS** | 11:27:43 UTC, same-origin request from the founder's signed-in browser with his explicit permission: award `quantity 1` → 200, balance 1; exact replay → 200 `duplicate: true`, balance 1, no second row |
| C3c same key, other quantity | **PASS** | Same key with `quantity 2` → 409 `KEY_REUSED` ("Idempotency key was used for another operation"), nothing booked |
| C4 redeem, and replay | **PASS** | Founder redeemed at 10:59:45 UTC (−2, listed). Replay check at 11:27:42 UTC: redeem → 200 balance 0; exact replay → 200 `duplicate: true`, balance 0, one redemption row |
| C5a correction refused below zero | **PASS** | At balance 0, reversal of an earlier `+1` award → 409 `INSUFFICIENT_BALANCE` ("Correction would make the balance negative"), nothing booked (11:27:42 UTC). Note: the founder's own first attempt reversed the redemption (+2 at 11:04:48 UTC), which is an allowed correction, not this test case |
| C5b award 3, reverse it | **PASS** | Award +3 at 11:07:03, reversal −3 at 11:07:52 UTC with a reason of at least 10 characters; balance back to its prior value, both rows visible |
| C5c second reversal refused | **PASS** | UI: "Korrigieren" no longer offered on a reversed entry. API: second reversal of the +3 award → 400 `ALREADY_REVERSED`, nothing booked |
| C5d cashier cannot correct | **PASS** | Founder report |
| C5e manager above 100 needs owner | **n/a** | Stamp shop; covered by the automated suite (`src/lib/corrections.integration.test.ts`) |
| C6 reissue | **PASS** | Old link shows "Karte nicht erreichbar."; new link shows the same balance (2) and history |
| C7 recovery email | **PASS** | Founder report: address verified, recovery at `/recover` worked, old link dead |
| C8 invite, accept, revoke | **PASS** | Founder report: revoked cashier refused |
| C9 cross-tenant | **PASS** | Founder report: signed in as the owner of the second synthetic shop, the card was found neither by card number nor by QR |
| C10 exports | **PASS** | Owner JSON export and customer export downloaded |
| O1 health and operations | **PASS** | 10:40 UTC: `/api/health` 200, database reachable; all four services on `ddfed7f`; ops-check PASS every 5 minutes; no worker error since start; nightly backup 03:04 UTC uploaded and HEAD-verified (`loynara/2026/10/18/20261018T030412Z-cf47808c90e2.dump.age`, the first on schema 0025); outbox clean the evening before (16 complete, nothing pending or failed) |
| O2 live rollback drill | **OPEN** | Only the read-only drill was done (targets and order confirmed in the DEPLOYED entry) |
| O3 test alert to both phones | **OPEN** | Not run |

Ledger check after the tests (read-only, 11:31 UTC): card balance 2 equals the sum of its 9 ledger rows; 2 redemption rows; refused and duplicate requests booked nothing.

## Observations

- **Owner export format (product feedback, not a blocker).** Both exports are JSON. The founder notes a shop owner cannot read that; an owner-friendly spreadsheet export (CSV) is a product follow-up.
- **Android.** The cashier flow was not exercised on an Android phone. Run C2 once on Android before the first real merchant uses one at the counter.

## Amendments to the X1 and X2 drafts (PR #55)

PR #55 was still open when this entry was written, so these notes are recorded here instead of in its files.

1. **Rollback order is binding (X1 finding N-1).** N-1 describes rolling the worker back while `email.signin_lock` jobs are queued and accepting the resulting failed jobs. The binding order is the rollback card's, from the independent verification report: roll web back first, then drain or cancel the `email.signin_lock` jobs, then roll the worker back; never roll the worker back alone, and run ops-check only once the outbox is clean.
2. **Two X1 full-suite runs exist.** (a) The run recorded in the X1 draft: 207 files, 2189 passed, 32 failed (all missing local test configuration), 1 skipped, with the 32 confirmed by a 110/110 rerun of those 12 files. (b) A second, independent run with CI-equivalent configuration: 205 files, 2207 passed, 0 failed, 1 skipped, verdict "PASS WITH CONDITIONS" (the conditions are the drained deploy order and the rollback order in item 1), report `X1-release-1-verification.md`.
3. **Release 1 is live.** The X1 and X2 drafts say Release 1 was not deployed at the time of writing. Release 1 has been live since 17 October 2026, 19:20 UTC (web deployment `e51eefe4`); all four services ran `ddfed7f` by 19:27 UTC.
