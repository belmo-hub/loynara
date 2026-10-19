# 17 October: Release 1 independent verification (X1)

**DRAFT for the Sunday ledger PR (launch plan v2, lane X1).** Status of this entry: **TESTED** (review, CI readback and one local full-suite run). It claims no DEPLOYED or ACCEPTED state; Release 1 is not deployed at the time of writing.

| Item | Value |
|---|---|
| Objective | Independent review of Release 1 before gate G1 / approval A-3 |
| Release 1 | `railway-rc` at `ddfed7f04bd1017801561c327628af9379188b27` (merge of PR #53, 2026-10-17 11:13 UTC) |
| Production web today | `680266d7d627bd781a8633f419e49275e6c27294` (ancestor of `ddfed7f`) |
| Range reviewed | `680266d..ddfed7f`: 193 files, +9955/−1407, 13 first-parent merges (PRs #27, #36–#40, #42–#46, #49, #53; the UI PRs arrive through #49 and #53) |
| Executed by | Separate verification session for lane X, 2026-10-17 17:15–17:45 UTC; the planned external verification tool was not used |
| External actions | None. No Railway command, no deploy, no merge, no production data touched |

## Verdict

**Overall: PASS. No blocking finding.** Release 1 may go to G1 on the evidence below, subject to the pre-deploy check P-1.

| Area | Verdict | Basis |
|---|---|---|
| Migration 0025 (CHECK constraints, append-only triggers, no down file) | PASS | Review below; rehearsal on the restored Saturday backup in [Migration 0025 rehearsal](2026-10-17-migration-0025-rehearsal.md) |
| 680266d tolerates schema 0025 (rollback target) | PASS | Code review of every writer of the affected tables, plus the X2 core smoke run with `680266d` code on migrated data (11/11) |
| Sign-in lock route | PASS | Review below; `src/app/api/auth/sign-in-account-limit.integration.test.ts` and `src/lib/sign-in-lock-notice.integration.test.ts` pass |
| Booking and tap locks | PASS | Review below; `src/lib/programme-lock-timeout.integration.test.ts`, `src/lib/nfc-cashier.integration.test.ts` pass |
| Revocation fixes | PASS | Review below; `src/lib/staff.integration.test.ts`, `src/lib/offline-earning.integration.test.ts` pass |
| UI | PASS | Review below; CI production build and typecheck/lint green; unit and style tests pass |
| Operations scripts (backup, migrate, ops-check, worker, config check, pool guards) | PASS with pre-deploy check P-1 | Review below |
| CI run `39027889014` | PASS | `gh run view`: push on `railway-rc`, head `ddfed7f`, conclusion success, 4/4 jobs (Tests 11:13:47–11:20:33, Production build, Backup and restore safety checks, Typecheck and lint) |
| Full suite on PostgreSQL 18 | PASS (see test record) | 2189 pass, 32 fail, 1 skip in the single full run; all 32 failures are missing local test configuration, and those 12 files pass 110/110 with CI-equivalent values |

## Review by area

**Migration 0025** (`drizzle/0025_data_integrity_guards.sql`, journal entry idx 25, `when` 1792092675299). It drops and re-adds `automation_rule_inactivity_valid` and `location_coordinates_valid` with explicit `IS NOT NULL` arms (the old forms let a half-NULL row pass, because a CHECK only rejects false), adds `ledger_kind_sign_valid`, `ledger_reversal_link_valid` and `redemption_cost_positive`, all `NOT VALID`, sets `consent_events.created_at` to `clock_timestamp()`, and adds `reject_reward_history_mutation()` with BEFORE UPDATE OR DELETE row triggers on `reward_versions` and `redemptions`. No down file exists. That is consistent with the rollback card: schema 0025 stays on a rollback.
- No code at `ddfed7f` or `680266d` updates or deletes `redemptions` or `reward_versions` (searched `src` and `scripts` for ORM and raw SQL writes). Neither table has a cascading foreign key, so the triggers break no existing path.
- `680266d` writes no row the new checks refuse: awards book a positive quantity and redemptions book `-cost` (`src/lib/loyalty.ts` at 680266d, lines 112–117 and 184–189); reversals always set `reversal_of_id` (`src/lib/loyalty.ts:235`, `src/lib/referrals.ts:201–202` at 680266d); coordinates are only accepted as a pair (`src/lib/product.ts:63` at 680266d), and the other location writers do not set them; inactive rules require days (`src/lib/automations.ts:29` at 680266d).
- `NOT VALID` means old rows are not scanned on deploy. The pre-check and the rehearsal's trial `VALIDATE CONSTRAINT` show the Saturday data satisfies all five.

**Sign-in lock route** (`src/app/api/auth/[...all]/route.ts`). Ten failed passwords per account per 15 minutes, counted from any address. Each attempt reserves a slot atomically before the password check; the slot is refunded unless the response is 401 (line 61). A locked account gets 429 even with the right password, so a guess cannot be confirmed. Unknown and known emails behave the same (no enumeration), and rate-limit keys are HMACs, never raw addresses. An unreadable or non-JSON body is refused with 400 instead of bypassing the limit. The lock notice (`src/lib/sign-in-lock-notice.ts`) queues at most one round per account per day, stores user ids only, and re-checks the recipient's access at send time. The worker dispatches the new job kind (`scripts/worker.ts:80`).

**Booking and tap locks** (`src/lib/loyalty.ts`, `src/lib/secure-tap.ts`, `src/lib/offline-earning.ts`). A new booking reads its programme `FOR SHARE` under a 3 s transaction-local `lock_timeout` (`src/lib/loyalty.ts:30`). It fails closed as `PROGRAMME_BUSY` (HTTP 409, nothing booked) on 55P03 (line 39). Replays are answered before the lock, so a booking that went through is never reported as "nothing booked". Offline sync rethrows `PROGRAMME_BUSY`, so the event stays pending instead of being rejected (`src/lib/offline-earning.ts:109`). Tap reads now lock programme before tag (`src/lib/secure-tap.ts:154`), matching provisioning and replacement. Staff confirmation takes programme, then tag, then card (`src/lib/secure-tap.ts:299`). No lock-order cycle was found against checkout (card, then programme share).

**Revocation fixes** (`src/lib/staff.ts`, `src/lib/offline-earning.ts`, `src/lib/secure-tap.ts`). Revoking staff also revokes their open invitations (line 97, matched on the lowercased address the invite stores, line 28). An invitation older than the person's latest revocation cannot restore access (lines 54–57). An offline replay reports the card balance only to staff who still have access, re-checked under the role lock. Tap cancellation holds the staff role row until commit.

**UI** (login, register, invitation, owner errors, card face, system states, tokens). Auth and owner errors are mapped to German messages and never show library diagnostics (`src/components/auth/auth-errors.ts`, `src/components/owner/owner-errors.ts`). The login form maps 429 to "Zu viele Anmeldeversuche". The new `/dev/states` pages call `notFound()` in production (`src/app/dev/states/page.tsx:6`, `src/app/dev/states/throw/page.tsx:7`). Removed `public/` files and components have no remaining references. `X-Powered-By` is off (`next.config.ts`). Next.js moves from 16.3.6 to 16.3.8 (security audit M-2).

**Operations scripts.** The migrate service sets `PGOPTIONS=-c lock_timeout=15s` for drizzle-kit. drizzle-kit uses node-postgres, which reads `PGOPTIONS`, and the rehearsal proved the timeout fires at 15 s and rolls back. Ops-check adds a `stalled` count for processing jobs 15 minutes past their lease. The backup script refuses a database without the Loynara schema and now needs `psql`, which the `postgres:18-bookworm` backup image already has; the backup service is not redeployed in Release 1 anyway. All pools get error listeners (`src/db/pool-errors.ts`). The config check now requires `PG_POOL_MAX` from 2 to 10 (`scripts/config-check.ts:55`).

## Findings (none blocking)

- **P-1, pre-deploy check (founder, Railway Variables, read only).** `PG_POOL_MAX` must be an integer from 2 to 10 on web, worker, ops-check and migrate. All four run `productionConfigIssues` at start (web through `scripts/production-guard.ts`), and a value of 1 now refuses to start (`scripts/config-check.ts:55`). `PRODUCTION_DEPLOYMENT.md:80` documents 5.
- **N-1, rollback note (worker).** Worker `251453d` marks an unknown job kind `failed` ("Unknown job kind", `scripts/worker.ts:155` at 251453d). If the worker is rolled back while `email.signin_lock` jobs are queued (`src/lib/sign-in-lock-notice.ts:29`), those jobs become `failed` and ops-check refuses (`scripts/production-ops-check.ts:18`). That is expected: review and accept them; no customer impact.
- **N-2, decision before A-3 (data).** After 0025, `redemptions` and `reward_versions` rows cannot be updated or deleted. The Saturday backup holds 5 redemptions and 3 reward versions (synthetic data). Any cleanup the founder wants must happen before the migration, as the pre-check notes. The PR #22 erasure design must also treat these tables as append-only.
- **N-3, low (sign-in).** If the refund query fails after a successful sign-in, the `finally` block turns the response into a 500 and the session cookie is lost (`src/app/api/auth/[...all]/route.ts:61`). The user retries; no security effect.
- **N-4, low (sign-in, by design).** Anyone who knows a staff address can lock that account for up to 15 minutes with ten wrong guesses. Signed-in devices stay signed in, and the owner is told at most once a day. Accepted trade-off of security audit M-1, recorded here for the support script.
- **N-5, test harness.** `npm test` (`scripts/test-local.sh:29`) sets only `DATABASE_URL`. Suites that sign customer sessions or build public links need `BETTER_AUTH_SECRET` (32+ characters) and `PUBLIC_BASE_URL`, which CI sets in `.github/workflows/ci.yml`, so a bare local run reports 32 false failures. Suggested follow-up: export throwaway values in `scripts/test-local.sh`.
- **N-6, operator note (migrate).** The migrate service hides drizzle-kit output (`scripts/production-migrate.ts:36`) and prints only "Application migration failed; inspect before retry" (line 45). The cause, for example "canceling statement due to lock timeout", is only in the PostgreSQL log.

## Test record

- Environment: Node 26.3.0, `npm ci` at `ddfed7f` (install scripts not run by npm's allow-scripts default), disposable container `loynara-x1v-pg18` (`postgres:18`, PostgreSQL 18.6, data on tmpfs inside the Docker VM, `127.0.0.1:54440`), database `looplocal_test` created and marked disposable by `scripts/test-local.sh`.
- Full suite, once: `TEST_PG_CONTAINER=loynara-x1v-pg18 TEST_PG_PORT=54440 npm test -- --hookTimeout 60000`, started 17:20:31 UTC, 349 s. **207 files: 195 passed, 12 failed. 2222 tests: 2189 passed, 32 failed, 1 skipped.** The run includes the two backup-publication suites CI excludes. The skip is the optional Mailpit capture (`MAILPIT_SMOKE`).
- Every one of the 32 failures is missing configuration: "Customer session signing unavailable" (`src/lib/customer-session.ts:17`), "Public application origin is not configured" (`src/lib/referrals.ts:58`), an HMAC key `undefined` in a test, and 500/404 responses from the same causes. Files: returning-card (16), passfast (4), location-http-scope (2), merchant-analytics (2), and one each in nfc-lifecycle, secure-tap, nfc-status, ten-merchant-release, purchase-concurrent-release, merchant-handoff, sign-in-lock-notice and programme-join-limit.
- Classification rerun of exactly those 12 files (not a second full run), with CI-equivalent `BETTER_AUTH_URL`, `PUBLIC_BASE_URL`, `BILLING_FIXTURE_MODE=true` and throwaway generated secrets: **12 files, 110/110 passed, 42 s.**
- Not run: Playwright end-to-end specs, production build (covered by CI job "Production build"), physical devices.

Token usage: unmeasured. Next: A-3 decision at G1 with P-1 confirmed; X2 entry linked above.
