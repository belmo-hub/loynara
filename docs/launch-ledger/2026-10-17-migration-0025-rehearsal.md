# 17 October: Migration 0025 rehearsal on the restored Saturday backup (X2)

**DRAFT for the Sunday ledger PR (launch plan v2, lane X2).** Status: **TESTED** on an isolated restored copy. Nothing here is DEPLOYED or ACCEPTED, and no production database was connected.

| Item | Value |
|---|---|
| Objective | Apply 0025 to a restored copy of Saturday's production backup before approval A-3; prove the pre-check, the journal step 25 → 26, the constraint and trigger state, a core smoke, and the failure path the rollback card relies on |
| Backup object | `loynara/2026/10/17/20261017T172629Z-6c83a3c27f6f.dump.age`, the S-4 manual backup of 17:26 UTC (founder "Run now" on the backup cron) |
| Restore | S-4 session, about 17:30 UTC: `scripts/production-restore-check.sh` → `Isolated restore PASS: tenants=2, locations=2, memberships=6, ledger_entries=17, migrations=25`. Target container `loynara-restore-20261017`, PostgreSQL 18.6, `127.0.0.1:55418`, database `loynara_restore_20261017` |
| Code | `ddfed7f04bd1017801561c327628af9379188b27`. The migration ran from the verification worktree at `ddfed7f` because the restore checkout's `node_modules` had been removed by its owner; `drizzle/` is identical (tree `e44ad8cdf74f6946ba3b9f174c4acbba3109aab2` in both) |
| Executed by | Separate verification session for lane X, 17:29–17:42 UTC; the planned external verification tool was not used |
| External actions | None. No Railway command, no production connection, no secret printed; the restore connection was read from a 600-mode file and never echoed |

## Verdict

**PASS. No blocking finding.**

| Step | Result |
|---|---|
| Pre-check `var/0025-precheck.sql` | PASS: all five rule counts 0 (`ledger_kind_sign`, `ledger_reversal_link`, `location_coordinates`, `redemption_cost`, `automation_inactivity`), no transaction older than 30 s, 0 jobs in flight, journal 25. Information: 2 tenants, 6 cards, 17 ledger rows, 5 redemptions |
| Business invariants before | PASS: 0 balance/ledger mismatches, 0 negative balances, 0 redemptions without a matching redeem entry, 0 non-conserving reversals, 0 cross-tenant ledger rows |
| Failure path (lock timeout) | PASS: with another session holding `ACCESS SHARE` on `ledger_entries`, the migration exited 1 after 15 s; server log "canceling statement due to lock timeout" at 17:34:07 UTC; journal stayed 25, no 0025 object existed, the two dropped checks were still present and validated, the `consent_events` default was still `now()` |
| Apply | PASS: exit 0 in under 1 s at about 17:35 UTC; journal **25 → 26** |
| Journal | Row 26: hash `952e5cf30e76185fe4969e9d9aff2f32ca8eb47b2aedf9032eda9962f0ae04f3`, equal to the SHA-256 of `drizzle/0025_data_integrity_guards.sql`; `created_at` 1792092675299, equal to the journal `when`. Row 25 unchanged (`created_at` 1791674938227) |
| Constraints | PASS: `ledger_kind_sign_valid`, `ledger_reversal_link_valid`, `redemption_cost_positive` added; `location_coordinates_valid` and `automation_rule_inactivity_valid` re-created with the `IS NOT NULL` arms; all five `NOT VALID`. Public constraints 599 → 602; 0 invalid or unready indexes |
| Triggers | PASS: `redemptions_append_only` and `reward_versions_append_only` enabled, function `reject_reward_history_mutation`; the five earlier append-only triggers still enabled |
| Default | `consent_events.created_at` is `clock_timestamp()` |
| Migrate-service verification query | PASS: `user`, `tenants`, `ledger_entries` present, `ledger_append_only` = 1 (the check `scripts/production-migrate.ts` prints PASS on) |
| Trial validation | PASS: `ALTER TABLE … VALIDATE CONSTRAINT` for all five succeeded inside a rolled-back transaction, so the Saturday data already satisfies every new rule |
| Rule enforcement | PASS 10/10, SKIP 1 (see below) |
| Core smoke, `ddfed7f` code | PASS 11/11 |
| Core smoke, `680266d` code | PASS 11/11 (rollback target on schema 0025) |
| Business invariants after | PASS: all 0 on the restored copy and on both smoke clones |

## Method

The apply reproduced the migrate service's invocation (`scripts/production-migrate.ts`). That means `drizzle-kit migrate` with `PGOPTIONS=-c lock_timeout=15s`, while a separate session held the production advisory lock `pg_try_advisory_lock(731849, 1001)`. The service's production environment gate was not run, because it requires the production configuration.

The rule and smoke checks ran on two clones made after the migration (`CREATE DATABASE … TEMPLATE loynara_restore_20261017`: `…_smoke` and `…_smoke680`). The restored copy itself still holds exactly the backup's 17 ledger rows and 5 redemptions at journal 26.

Rule enforcement (one savepoint per attempt, transaction rolled back, rows copied from existing ones with one field changed):
- Award with delta −1: refused by `ledger_kind_sign_valid`.
- Award carrying a reversal link: refused by `ledger_reversal_link_valid`.
- Reversal without a link: refused by `ledger_reversal_link_valid`.
- Ledger delete: refused by "ledger history is append-only".
- Redemption with cost 0: refused by `redemption_cost_positive`.
- Redemption update and delete: refused by "Reward versions and redemptions are append-only".
- Reward version update and delete: refused by the same trigger.
- Location with latitude only: refused by `location_coordinates_valid`.
- SKIP: the Saturday data has no automation rule to copy. The definition is verified above, and the behaviour is covered by `src/lib/data-integrity-guards.integration.test.ts` in the X1 full suite.

Core smoke: the real `award`, `redeem` and `reverseEntry` functions, on the oldest open card of an active stamp programme (reward cost 2) with that tenant's active owner. It ran once with `ddfed7f` code on `…_smoke`, and once with `680266d` code (`git archive 680266d`, `npm ci`) on `…_smoke680`. Both runs reported 11/11:
- C0: balance equals the ledger sum before and after.
- C2: an award books once.
- C3b: a replay with the same key is a duplicate and the balance is unchanged.
- C3c: the same key with another quantity returns `KEY_REUSED`.
- C4: a redemption deducts the cost once, its replay is a duplicate, and exactly one redemption row exists.
- C5b: a reversal restores the prior balance.
- C5c: a second reversal returns `ALREADY_REVERSED`.
- C5a: a correction that would go negative is refused with `INSUFFICIENT_BALANCE` and nothing is booked.

Outputs are ids-free; no token, email or name was printed.

## Findings (none blocking)

- **R-1, rollback card confirmed.** The STATUS row "Migration 0025 failed: … a failure leaves schema 0024" holds on real data. The migrate service will only say "Application migration failed; inspect before retry" (`scripts/production-migrate.ts:45`). The cause is in the PostgreSQL log, so read it there before a retry.
- **R-2, decision before A-3 (same as X1 N-2).** Once 0025 runs in production, the 5 existing redemptions and 3 reward versions can no longer be updated or deleted. If the synthetic merchant's data is to be cleaned, do it before the migration.
- **R-3, timing.** With no competing session the migration finished in under a second on this data size. In production the risk is the lock wait, not the run time: the s6a drain (web and worker stopped, pre-check part 2 empty) removes it.

## Left in place

The container `loynara-restore-20261017` and its three databases (`loynara_restore_20261017` at journal 26, `…_smoke`, `…_smoke680`) stay running. Per STATUS, the founder decides when to drop the container. The scratch copy of `680266d` and the clones hold no secrets.

Token usage: unmeasured. Next: G1 with X1 and X2 PASS, pre-check zeros, S-1 and S-2; then A-3.
