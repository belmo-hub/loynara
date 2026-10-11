# LOYNARA — release preparation and 23:00 operator handoff 123

Assignment 123, 11 October 2026. Issues: LOY-28, LOY-282, LOY-195/196 and LOY-185/186. Direct founder authority covers local release tooling, focused tests, independent read-only review and compatible local integration. Deadline: 13 October, 13:00 Europe/Berlin. The founder is at work until approximately 23:00 tonight; no immediate participation is required for this preparation.

Codex `/root` reused the isolated `staff-http-permissions/Loynara` checkout on `codex/full-stack-release-110`, starting at `5e5e61af4b8d34ab5fcb28f8cc4efc785db6847b`. Requested executor: gpt-6.1-sol high; the root model setter is unavailable, so the effective executor was retained. Independent reviewer: gpt-6.1-sol medium. The resulting commit is identified by containment; the exact integration and notification receipts are retained in the native Goal checkpoint. No new worktree, dependency installation or paid resource was needed.

## Release identities and evidence freshness

The reviewed, already-pushed GitHub release candidate is **`ee4af7b79e9e4a667d383b0b9f815f31daa53956`**. The one-time push authorization was exhausted by Assignment 119. This assignment adds local operator tooling and makes no further push. Production deployment must still target that reviewed commit, not the new local preparation commit. The operator tooling can run locally without being present in the production image.

The last exact production web/worker readback, Assignment 120, was **`792e218a17287009067ce0993c33eda3bfc3f4b7`**, the October 8 release. Fresh founder-supplied coordinator evidence in Assignment 123 confirms that web and worker are online on the October 8 release, with seven services and no staged configuration changes. This task does not repeat the general Railway inventory or imply a newer exact process-SHA attestation.

Assignment 123 also reports an October 11, **03:02 UTC** daily backup log showing successful encrypted offsite upload and HEAD verification. This strengthens the older scheduled-success observation. It does **not** establish independent R2 retrieval, key custody or successful independent restoration of production. Preserve the historical [104 manifest](2026-10-11-release-manifest-104.json), [120 readback](2026-10-11-hosted-preflight-120.json) and [121 role/API evidence](2026-10-11-railway-exact-sha-path-121.json); this entry is a traceable amendment, not a rewrite.

## Executable offline preflight

The existing migration entrypoint now has a separate read-only mode. No additional executor or Autopilot infrastructure was created.

```sh
npm run production:release-preflight
# Equivalent using the existing Node loader:
node --import tsx scripts/production-migrate.ts --release-preflight
# A sanitized receipt file can be supplied by an authorized operator:
node --import tsx scripts/production-migrate.ts --release-preflight --evidence /approved/path/release-evidence.json
```

Default result: **BLOCKED**, exit 2. Committed-source validation: **PASS**. A complete declared manifest can return offline PASS, exit 0, but `executionEnabled` is always `false`. The command neither authenticates founder permission nor performs a production operation. An authorized operator must authenticate every referenced receipt before proceeding.

The read-only path does not load dotenv, connect to a database, request a network resource, invoke a migration subprocess or write a file. Git reads pinned committed blobs with optional locks, prompts and lazy fetching disabled. Input and low-level errors are not echoed. Malformed or missing evidence, unknown arguments including `--execute`, source/role mismatch, stale attestations, unknown writers, uncertain flags, running claims, missing recovery evidence or absent separate approvals cause BLOCKED.

The source check verifies all 25 ordered migration entries against the pinned commit and Assignment 104's 21 prior hashes/timestamps. Pending order is:

1. `0021_staff_push_subscriptions`
2. `0022_email_rate_limit_retry`
3. `0023_reward_ready_automation`
4. `0024_outbox_claim_token`

The canonical journal fingerprint through 0020 is `e0996eb13fa3a48ef941e895e6ea1459c9c384cb2e5facc3a450c91332060d43`. This is a **journal fingerprint**, not proof of the physical schema. Separate source and restored schema receipts must accept critical tables, tenant constraints, the append-only trigger and structures through 0020. Restoration must identify the same independently retrieved encrypted object and canonical journal, and accept source-bound membership/ledger history, tenant isolation and reconciled counts.

The strict manifest schema is in `scripts/production-release-preflight.ts`. Test fixtures are synthetic examples, never real approvals. Required receipts cover:

- Exact project, environment, seven unique service identities, source generations, unchanged repository/branch and deployment roles.
- Concrete provider-OFF flags for both web and worker; no staged changes.
- A complete live writer inventory, including scheduled, manual and external clients; confirmed exact-commit deployment eligibility.
- All old writers stopped, zero in-flight work, then a fresh encrypted archive with source identity, date, size, digest, independent retrieval, approved destination and named key custodian. Never record the key.
- An approved, initially empty isolated target distinct from production, an independent verifier and accepted physical schema/history restoration of that exact object.
- Separate authenticated founder receipts for backup/restore and production cutover, bound to the reviewed candidate.

The initial attestation and subsequent drain, backup and restore must fit a one-hour engineering validity window. Expired, extended or future-dated evidence is BLOCKED. Refresh and re-establish applicable receipts if the window expires; do not weaken the guard to fit a delayed release. This is a tooling rule, not a product or legal retention decision.

## Writer and service inventory

Project: `b07a3919-b3fc-4637-8b91-d0b4418d2856`. Production environment: `a3ba3a4a-3d4c-4149-91c4-735e8bae3447`.

| Service | Verified identity and command | Cutover consequence |
| --- | --- | --- |
| Web | `5c1303ad-42c2-4094-a996-3ac6140d088d`; `/Dockerfile`, default guarded `npm start` | HTTP/API application writes. Immediate NFC handling in `staff-push.ts` also claims, renews and completes outbox jobs. Stopping only the worker is insufficient. |
| Worker | `3bfad7e8-c638-41bd-8f50-743e68c0633f`; `/Dockerfile`, `npm run worker` | Outbox claim/replay/outcome, campaign/reward/Wallet processing, recovery/contact challenge cleanup and revoked Apple registration housekeeping. Account for manual `--once` and `--replay` processes. |
| Migrate | `ba6a41c5-b9ee-463a-bc25-f7745c549f59`; `/Dockerfile`, `npm run production:migrate` | Schema, authorization and trigger writer. Historically Completed/Never. Keep automatic, scheduled and pre-deploy invocation absent until explicitly authorized. |
| Backup | `78ee0c58-c306-4f3a-95c0-1c94e72e793c`; `/Dockerfile.backup`, backup script entrypoint | Reads production with pg_dump; writes encrypted offsite backup and monitor data. A fresh invocation needs explicit approval. Assignment 121 recorded the daily 03:00 UTC schedule. |
| Ops check | `c3189719-e305-4c4c-b8ca-4d0b0335c25f`; `/Dockerfile`, `npm run production:ops-check` | Reviewed source performs database health reads and a monitor heartbeat, rather than outbox claims. Attest actual helper generation and scheduled/manual custody; 121 recorded a five-minute schedule. |
| PostgreSQL | `7eb7c68b-c890-4f79-844f-f439f9fe0234` | Keep storage available. Account for database jobs, administration and outside writer clients. Never stop/delete the database as a drain shortcut. |
| cloudflared | `131ff3f7-3eb8-4837-a9f9-694db14f623b` | Ingress service. The existing maintenance mechanism and any control operation require operator confirmation and applicable authorization. |

The five known source pathways are web HTTP, immediate NFC, worker outbox, worker housekeeping and migration schema writes. This inventory is not exhaustive proof of live processes, replicas or outside clients. A UI status alone does not prove a complete drain.

## Operator sequence — prepared, not executed

The [supported Railway service API](https://docs.railway.com/integrations/api/manage-services) documents a commit-SHA deployment path. Existing evidence identifies the operation as `serviceInstanceDeployV2(serviceId, environmentId, commitSha)`. Actual connected-source eligibility and operator deployment permission still require confirmation. A default redeploy/restart can reuse the old generation. [Deployment actions](https://docs.railway.com/integrations/api/manage-deployments) document stopping a running deployment, but the precise authorized stop mechanism, signature, termination grace and restart prevention remain **OPERATOR_CONFIRMATION_REQUIRED**. No mutation, invalid-SHA test or denied permission query was attempted.

1. **Confirm the operator facts.** Authenticate current deployment IDs/generations, complete writers, helper/cron custody, all runtime safety flags and exact-commit eligibility. Preserve `railway-rc`, repository source and protected refs. Confirm no hidden pre-deploy migration or staged change. Web `fe8b9d81-d6a9-452f-8807-c811f3c49421` and worker `5471cb46-237e-40a5-a3eb-ad780db9bc59` are last-observed deployment IDs, not unconditional future stop targets. Confirm current IDs before an approved action.
2. **Obtain the first authorization: backup and independent restore.** Name the existing source database, approved EU R2 destination/object, key custodian, approved empty isolated target and independent verifier. The bounded approval must cover a fresh encrypted `production:backup`, independent retrieval and existing `production:restore-check`, plus accepted schema/history evidence and cleanup. It does not permit service stops, migrations or source rollout. Codex access to recovery keys and new paid resources are not implied. A rehearsal with active writers can establish recovery capability; it cannot serve as the final drained cutover recovery point.
3. **Obtain separate cutover authorization.** After independent recovery acceptance, obtain explicit authority for maintenance, all old-writer shutdown/drain, a fresh recovery point and independent restoration, migrations 0021–0024, the reviewed web/worker generation and bounded synthetic hosted smoke checks. Prevent new ingress and manual/scheduled writers. Gracefully stop old web **and** old worker. Require zero in-flight claims and independent exit/database-activity evidence. Abort if any writer or provider completion is uncertain. Worker SIGINT/SIGTERM handling exists; actual platform grace remains an operator confirmation. Do not hold database locks over provider I/O.
4. **Establish the final drained recovery point.** Keep the database available and old writers stopped. Run the approved encrypted backup, independently retrieve the exact object and restore it to the approved empty isolated target. Record nonsecret source, object digest, time, size, custody, journal, physical schema, tenant/history reconciliation and verifier acceptance. Do not migrate on a scheduled upload/HEAD log alone. Keep writers stopped throughout this decision window.
5. **Run the pinned migration role only after prerequisites PASS.** The planned deployment parameters are service `ba6a41c5-b9ee-463a-bc25-f7745c549f59`, environment `a3ba3a4a-3d4c-4149-91c4-735e8bae3447`, commit `ee4af7b79e9e4a667d383b0b9f815f31daa53956`. Deploying this role starts the migration command and is itself a restricted deployment/migration. Confirm target and explicit migration approval privately. Existing advisory-lock/guard tooling applies 0021 → 0022 → 0023 → 0024 without seeding. Independently verify all 25 hashes/timestamps and physical structures, constraints and append-only trigger. A partial/refused result means STOP, not a blind retry or manual success mark.
6. **Deploy web first with ingress contained.** Use web service `5c1303ad-42c2-4094-a996-3ac6140d088d`, the same environment and reviewed commit. Confirm the default guarded start command and no worker/migration override or pre-deploy hook. Record the returned deployment ID and actual running source, schema and flags. Verify private health and database reachability through `/api/health`. Online status alone is not merchant acceptance.
7. **Deploy the identical worker generation second.** After web verification, use worker service `3bfad7e8-c638-41bd-8f50-743e68c0633f`, the same environment and commit. Confirm `npm run worker`, runtime identity, flags and heartbeat. The worker can dispatch immediately on startup, so recovery/schema and safe configuration must already be accepted. Attest no old helper, cron, manual replay or application writer can restart after 0024: old binaries ignore claim tokens.
8. **Perform only authorized acceptance checks and reopen.** Using approved synthetic identities, verify source/schema/health, onboarding, customer/staff sessions and recovery, one approved award and duplicate replay, selected reward/redemption, stable Wallet identity, consent/suppression/unsubscribe/quota/retry and reporting. Two-tenant foreign reads/writes and staff revocation negatives must fail closed. Keep providers OFF; no real customer sends, physical tag writes or unapproved customer-data changes. Retain case-level evidence for the exact running SHA before authorized reopening. Physical NFC, live Wallet/provider and commercial gates remain separate.
9. **Respect rollback limits.** If verification fails, stop/drain affected writers, preserve award/consent/outbox history and seek reviewed compatible roll-forward or separately authorized recovery accounting for post-backup writes. Application rollback does not undo database migrations. Running old binaries against 0023/0024, downgrading SQL or overwriting the live database is not declared safe. Platform rollback eligibility does not establish schema or loyalty compatibility.

## 23:00 founder handoff

The local preflight can run now, but the production procedure is **BLOCKED**. First provide the named source, destination/object, custodian, approved empty restore target and independent verifier, then bounded backup/restore authority. No secrets should enter chat or tracker records. Once those facts and authorization exist, the established recovery workflow can immediately produce independent retrieval and restoration evidence. No target is created by this assignment.

After recovery acceptance, a **separate** exact-candidate cutover approval is required for the actions in steps 3–8. Once applicable approvals and prerequisite evidence are complete, execution can proceed through drain, a fresh accepted recovery point, ordered migrations, pinned web then worker, health and tenant-negative checks. A general “go” does not fill missing operator facts or authorize additional restricted operations.

Existing canonical records also retain unfinished product requirements. Deploying this candidate does not close them:

| Requirement | Outstanding implementation or decision |
| --- | --- |
| LOY-133 | Dispatch/suppression cutoff race; approved referral campaign audience and personalization contract. |
| LOY-139 | Provider-generation-day identity and legacy compatibility; preserved RED and missing historical compatibility evidence. |
| LOY-43/209 | Broader privacy export, deletion and retention coverage/authorization. The verified narrow snapshot/export fixes do not prove full rights coverage. |
| LOY-38/159/161 | Programme, shared staff/location policy and inactive-location billing entitlement semantics where still dependent on founder decisions. |
| LOY-93 | Approved Wallet admission scope and quota/threshold contract. |
| External acceptance | Physical passive NTAG424, iPhone/Android, actual Wallet/provider, independent hosted and commercial/legal acceptance. |

This is a scoped register from existing evidence, not a new whole-board audit or a claim that all other unknown requirements are complete. Preserve the passive NFC stand and accepted membership/session/Wallet decisions.

## Verification, review and limitations

Focused tests: **67 PASS in 3 files, 20.68 seconds**. Full TypeScript check and lint of the three changed scripts: **PASS**. Actual default CLI: **BLOCKED**, source PASS, exit 2. Synthetic complete evidence returns offline PASS with execution disabled; missing backup/restore, unknown writers, mixed generations, incorrect roles/flags, stale receipts, wrong objects, absent physical schema/history and unaccepted restoration all refuse. Tests exercise the real CLI and existing migration cleanup behavior with synthetic transports; they do not execute production migrations.

Independent medium review found an Important false-PASS gap: journal-only evidence did not require source/restored physical schema and tenant history acceptance. A new regression reproduced exit 0 where exit 2 was required. Explicit receipts and source binding corrected it; targeted read-only review confirmed closure and no material regression. The reviewer inspected tests and did not independently rerun them.

Initial test-harness escaping and disposable-cwd loader resolution were corrected before genuine RED evidence. A typecheck environment-type error was corrected before the final passing check. The direct tsx CLI hit sandbox IPC EPERM; the existing supported Node import loader worked. Existing Vite configuration and Node 26 loader deprecation warnings remain visible. No control was bypassed or tests weakened.

Previously accepted ten-merchant, browser, encrypted synthetic restore and global suites were not repeated. No Next application feature changed; focused real-loader execution and full typecheck verify this tooling change. No new Next build or global acceptance is claimed. The migration's no-argument behavior is preserved; preflight dispatch occurs before dotenv or connection setup.

Statuses are separate: **IMPLEMENTED**, **TESTED** and subsequently **INTEGRATED locally** when the receipt is recorded; operator actions are **PLANNED**. This assignment is **NOT PUSHED**, **NOT DEPLOYED**, **NOT INDEPENDENTLY ACCEPTED IN PRODUCTION** and **NOT COMMERCIALLY READY**. Original Goal accounting is preserved. Granular input, cached subset, output, browser and reviewer usage are unmeasured; native cumulative usage snapshots are in the structured evidence and checkpoint.
