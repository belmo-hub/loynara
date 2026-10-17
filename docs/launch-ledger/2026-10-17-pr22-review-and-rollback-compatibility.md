# 17 October 2026: PR #22 independent review (X3) and Release 1 rollback compatibility (X4)

**DRAFT, for the Sunday docs-only ledger PR (plan v2, U-10).** Launch plan v2 blocks X3 and X4. Tracks LOY-43, LOY-193, LOY-195, LOY-197, LOY-201 and LOY-209 through PR #22.

| Item | Value |
|---|---|
| Objective | X3: bring PR #22 up to Release 1 and do the independent security and release review the PR lists as a gate. X4: decide whether Release 1 is an eligible rollback target once 0026–0028 are applied. |
| Execution context | Independent verification lane, run in a separate review session on Saturday 17 October 2026 (Berlin evening). No production access, no Railway command, no merge, no deploy. |
| Starting SHAs | PR #22 head `ca7a856baef818be49e91e4953859cae49b66d15`; `railway-rc` (Release 1) `ddfed7f04bd1017801561c327628af9379188b27` |
| Resulting SHA | PR #22 head `ed8ffbafe74a92f7cf47b79ccdff0cb508ff0748`, a normal merge of `ddfed7f` into the PR branch (fast-forward push, no rebase, no force-push) |
| CI on resulting SHA | Run [39053068506](https://github.com/belmo-hub/loynara/actions/runs/39053068506): Tests (10m22s), Typecheck and lint, Production build, Backup and restore safety, all **success** |
| External actions | One push to `feature/data-lifecycle-resilience`. One PR comment ([review](https://github.com/belmo-hub/loynara/pull/22#issuecomment-6237714847)). This ledger branch. Nothing else. |
| Status | PR #22: **TESTED** at `ed8ffba`, review **blocking: yes** (B-1). Not DEPLOYED, not ACCEPTED. |

## X3: merge

`ddfed7f` adds 10 UI and spec files to the earlier merge base `610a44b` (PRs #47, #48, #50, #51, #53). PR #22 touches none of them, so there were no conflicts. `drizzle/0025_data_integrity_guards.sql` and `drizzle/meta/0025_snapshot.json` are byte-identical to Release 1. The journal timestamps of 0026–0028 (`1792171378607`, `1792171384991`, `1792171385568`) come after 0025 (`1792092675299`), so the migrator applies them on a database already at 0025.

## X3: migrations on disposable PostgreSQL 18.6

Container `loynara-x3x4-pg`, 127.0.0.1:54460, no host volume, outside `~/Desktop`.

| Path | Result |
|---|---|
| Fresh: empty → `auth.sql` → 0028 with PR code | exit 0, 29 journal rows |
| Release 1 → 0025 (26 rows), Release 1 writes data (onboarding, 2 cards, award, replay, redemption, reversal, one closed card), then PR code → 0028 | exit 0, 29 rows. History fingerprint over ledger, redemptions, reward versions, memberships and consent is identical before and after. |
| Schema equality | `pg_dump -s` of the upgraded database equals the fresh install. Journal `hash:created_at` digest is identical. |

SQL file sha256, equal to the journal hashes: 0025 `952e5cf30e76185fe4969e9d9aff2f32ca8eb47b2aedf9032eda9962f0ae04f3`, 0026 `4a39d468e2297a560bbb1d0e292c8264e19c0fef34734c34b151a6bc8c677231`, 0027 `f1b83a218d8243aa5a61fa0766cc9a4b9164ff89f6ceb22301932e0fbe4b6c98`, 0028 `11526008e7f4ad42588498620ddcbd75699afb1ab999df3f7f5c2286e23faec0`.

## X3: restricted runtime role

`scripts/provision-retention-roles.sql` ran as administrator: PASS. The logins and the ordinary allowlist from `PRODUCTION_STEPS.md` §4 were then applied exactly as written. The allowlist covers all 59 tables; `retention_holds`, `tenant_retention_classifications` and `tenant_retention_auth_subjects` are left out on purpose.

- As `loynara_web_login`, these are refused: DELETE/TRUNCATE on `memberships` and `tenants`, ledger UPDATE, reading `retention_holds`, EXECUTE on `loynara_purge_member`, and USAGE on schema `drizzle`.
- PR #22 runtime library code as `loynara_web_login`: **22/22**. Covered: onboarding, enrol, award, redeem, reversal, customer activity, bearer personal export, merchant export, service-budget reservation, operational counters, the ops-check counts query and the refusals above.
- Card closure with no archive configured returns `CLOSURE_ARCHIVE_UNAVAILABLE`. The card stays open with no deletion receipt, and a later award succeeds.
- Not exercised: closure with a live archive (no bucket exists yet), and HTTP routes end to end.

## X3: review result

**Blocking: yes.** The full text is in the PR comment.

**B-1 (blocking).** The plan deploys PR #22 with the retention job **not** deployed. Under that plan:
- The customer card page and the owner page promise deletion within 24 hours, or 7 days at most, and the closure APIs return a `deleteBy` date. Nothing performs the deletion.
- `loynara_retention_health().overdue_cards` counts each such card after 24 h (or 7 days). Ops-check then refuses with `card_erasure_overdue`. Reproduced: two cards closed two days earlier gave `overdue_cards=2`.
- Cards already closed in production make ops-check fail on its first run after deploy.

Options: postpone (recommended), activate the retention job with the release (excluded this weekend), or a reviewed code and wording change.

**Reviewed without a blocking finding:**
- 0028 append-only carve-out: DELETE only as `loynara_purge_owner` on a closed, unheld subject; UPDATE refused for every role.
- Closure and export paths.
- Award and redeem under 0025 + 0028 (`loyalty.ts` unchanged).
- Cashier-approved stamping and NFC: tap confirmation unchanged, closure cancels pending taps, the push budget falls back to polling.
- Merchant isolation and Wallet revocation.
- The restore check's exact five-constraint exemption.

**Non-blocking findings:**
- N-1: one shared monthly email budget for transactional and promotional mail (default 1000).
- N-2: R2 tokens have no write-only scope; put a bucket lock on the closure bucket.
- N-3: the Docker image with `python3`/`age`/`awscli` is not built in CI; the synthetic closure smoke test is mandatory.
- N-4: no per-process cap on closure child processes.
- N-5: error logs no longer name the error.
- N-6: create the maintenance login only at activation, and keep `PG*` variables off web, worker and ops-check.
- N-7 (pre-existing, Release 1): the account-wide sign-in lock lets anyone lock a known email out for 15 minutes.

**How the release avoids the retention job.** No Railway service runs `npm run retention:prune`, and none gets maintenance credentials or `RETENTION_HEARTBEAT_URL`. Web, the worker and the image never call it. The job itself refuses to start without `ERASURE_POLICY_APPROVED`, separate `PGHOST`/`PGUSER`/`PGDATABASE` and a heartbeat URL.

## X4: Release 1 on schema 0028 under the restricted role

Release 1 (`ddfed7f`) library code:

| Run | Role and schema | Result |
|---|---|---|
| Baseline | owner role, 0025 | 18/18: onboarding, enrol ×2, award, replay (`duplicate`), redeem (balance 1), redeem replay (`duplicate`), award, reversal, customer export, merchant export, card closure, award and export on the closed card refused |
| Rollback case | `loynara_web_login`, 0028 + grants | the same **18/18** |
| Worker | Release 1 `scripts/worker.ts --once`, `loynara_web_login`, 0028 | Housekeeping deletes ran. A job of PR #22's `email.export-proof` kind was marked `failed` ("Unknown job kind"); no crash. |
| Ops-check | Release 1 | Reads only `outbox_jobs`; compatible. |
| Merchant closed the way PR #22 closes one (simulated in SQL) | `loynara_web_login`, 0028 | Release 1 refused award, redeem, enrolment, customer export and the deactivated owner's merchant export (5/5) |

**Verdict: yes.** Before any closure has happened under PR #22 code, Release 1 `ddfed7f` is an eligible rollback target for web, worker and ops-check, under these conditions:

1. Select the newest Release 1 deployment of each service. Railway Rollback restores that deployment's variables, including `DATABASE_URL`, and removes the `ERASURE_*` settings. Release 1 works both as the owner role and as `loynara_web_login`.
2. Never down-migrate. The schema stays at 0028 with 29 journal rows.
3. Expect `email.export-proof` jobs to fail (Release 1 ops-check reports `failed_jobs`; do not replay them) and outstanding personal-export links to stop working.
4. Release 1 closures write no archive intent and no deletion receipt. Before rolling forward again, capture every card closed since the rollback (`closed_at` after the rollback time and `deletion_receipt_id IS NULL`) with `erasure_manifest.py record-closure` (`PRODUCTION_STEPS.md` §5.4). Otherwise a restore of an older backup could revive those cards.
5. Roll back web, worker and ops-check together; mixed versions were not tested.

After closures under PR #22 have happened, Release 1 still refused closed cards and a closed merchant in these tests. Condition 4 then applies. Whether that case is eligible stays the founder's decision under `INCIDENT_ROLLBACK.md`.

### Rollback record (from `INCIDENT_ROLLBACK.md`)

Deployment ids do not exist yet. Release 1 was not deployed at the time of writing, and PR #22 is not merged. The Release Operator fills them in at U-4, before any confirmation.

| Service | Current deployment ID / full SHA | Selected successful deployment ID / full SHA | Schema compatibility approved by |
| --- | --- | --- | --- |
| `loynara-web` | PR #22 deployment: id recorded at U-4 / merged PR #22 SHA (head `ed8ffbafe74a92f7cf47b79ccdff0cb508ff0748` + merge commit) | Newest Release 1 web deployment (after Sunday's U-1 variable changes): id recorded at S-5/U-1 / `ddfed7f04bd1017801561c327628af9379188b27` | Tested compatible with 0028 under `loynara_web_login` (X4, this entry, 18/18). Approval: founder, A-8, **pending** |
| `loynara-worker` | PR #22 deployment: id recorded at U-4 / same SHA as web | Newest Release 1 worker deployment: id recorded at S-5/U-1 / `ddfed7f04bd1017801561c327628af9379188b27` | Tested: `--once` housekeeping OK; PR-only export-proof jobs end `failed`. Approval: founder, A-8, **pending** |
| `loynara-ops-check` (added) | PR #22 deployment: id recorded at U-4 | Newest Release 1 ops-check deployment / `ddfed7f04bd1017801561c327628af9379188b27` | Reads only `outbox_jobs`; expect `failed_jobs` from step 3. Approval: founder, **pending** |
| `loynara-migrate` | stays at the PR #22 SHA; no down migration | not rolled back | n/a |
| `loynara-backup` | unchanged by PR #22 at the time of writing | not rolled back | n/a |

## Limits and next steps

- Disposable database only. No production row was read, and the production count of closed cards (which B-1 depends on) is unknown.
- One full-suite run, in CI. Locally only targeted scenarios ran. Their scripts live in git-ignored `var/` folders of the run checkouts and are not committed.
- Token usage is not measured.
- Next: the founder decides A-8 at G2 (Sunday 12:00), most likely to postpone because of B-1. If PR #22 goes ahead after a fix, rerun X4 condition 4 and the step-7 synthetic closure on the real image.
