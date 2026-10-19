# 17 October: Release 1 production deploy (S-5)

**DRAFT for the Sunday ledger PR (launch plan v2, §4.1, task S-5).** Status: **DEPLOYED**. Core acceptance (C1–C10, O1–O3) is recorded separately; nothing here claims ACCEPTED.

| Item | Value |
|---|---|
| Environment | Railway project `loynara-rc`, environment `production` |
| Release | Release 1 = `railway-rc` at `ddfed7f04bd1017801561c327628af9379188b27` (merge of PR #53) |
| Schema | 0024 → **0025** (journal 25 → 26) |
| Window | 19:07:21–19:30:35 UTC, Saturday 17 October 2026 |
| Approver | Founder, A-3. G1 answered in chat about 18:50 UTC; at about 19:05 UTC: "Go for the whole Release 1 sequence: drain, migrate, web, worker, ops-check, verify. Do not ask me per step. Stop only if a check deviates from the plan." |
| Operator | Release operator session on the founder's workstation (Railway CLI session of the founder's account; exact-SHA deploys through the Railway API `serviceInstanceDeployV2`, one request per service; production SQL only as read-only SELECTs in the Railway Postgres Data view) |
| Evidence before | CI run `39027889014` success on `ddfed7f`; X1 PASS with conditions; X2 0025 rehearsal PASS on the restored 17:26 UTC backup `loynara/2026/10/17/20261017T172629Z-6c83a3c27f6f.dump.age` (restore PASS, journal 25) |

## G1 (gate before A-3)

| Check | Result |
|---|---|
| S-1 Mailgun rotation, S-2 secrets off iCloud | **Waived by the founder in writing for A-3** ("Waive 1"). They stay launch blockers (M4) until done |
| `PG_POOL_MAX` 2–10 on web, worker, ops-check, migrate | 5, 5, 2, 5: PASS, no change (Release 1 raises the minimum from 1 to 2) |
| Synthetic data (5 redemptions, 3 reward versions) | Founder accepted it as permanent before 0025 made it append-only |
| `PRODUCTION_MIGRATION_APPROVED` | `true` on migrate only, already set; unset on web, worker, ops-check. No variable was changed |
| Switches | Read as on/off only (names filtered before display, secret-bearing names as set/unset): public registration false everywhere, staff invite sign-up true on web, transactional email true on web and worker, promotional email false everywhere, NFC trio and VAPID unset, PassFast and wallet approval false, billing false, `TRUSTED_INGRESS=cloudflare_tunnel` on all four |
| 0025 pre-check on production, before drain (about 19:00 UTC) | Five rule counts 0; journal 25; jobs in flight 0; 2 tenants, 6 cards, 17 ledger rows (same as the restored backup) |
| Deployments before | web `c581e349-4869-40d4-8cdf-33854867e2e6` (680266d), worker `1e63e0bd-85b9-41c2-ba1c-9a34e3b749e2` (251453d), migrate `9fff53e7-7ba4-4a1c-9324-cc4aa0fb3221` (a436b77), ops-check `4b6e6aa8-3e56-4c02-8a7d-11c9ecd2fb8e` (a436b77), backup `493cec2e-dde9-4d24-826b-2861c33f99da` (90ad26a), all SUCCESS |

## Actions (UTC)

| Time | Action | Check read afterwards | Result |
|---|---|---|---|
| 19:07:21 | `railway down` on loynara-ops-check | deployment list: `4b6e6aa8` REMOVED | done (see anomaly) |
| 19:07:44 | `railway down` on loynara-worker | deployment list: `1e63e0bd` REMOVED | done |
| 19:08:44 | Lease check (read-only) | processing jobs 0 (in flight 0), transactions older than 30 s 0, other sessions 0 | PASS |
| 19:08:56 | `railway down` on loynara-web | deployment list: `c581e349` REMOVED; `/api/health` 502 | done |
| 19:09:55 | 0025 pre-check, immediately before migrating | five rule counts 0, long transactions 0, jobs in flight 0, journal 25 | PASS |
| 19:10:28 | Deploy loynara-migrate at `ddfed7f` | deployment `b960a4cf-0948-4eb3-8c44-f5b410bf41a7` SUCCESS; log 19:15:49 "Production migration PASS: auth, app schema and append-only ledger trigger present. No seed was run." | PASS |
| 19:17 | Schema read-back (read-only) | journal **26**; last hash `952e5cf30e76185fe4969e9d9aff2f32ca8eb47b2aedf9032eda9962f0ae04f3` = SHA-256 of `drizzle/0025_data_integrity_guards.sql`, `created_at` 1792092675299; `automation_rule_inactivity_valid`, `ledger_kind_sign_valid`, `ledger_reversal_link_valid`, `location_coordinates_valid`, `redemption_cost_positive` present and NOT VALID; `redemptions_append_only` and `reward_versions_append_only` enabled | PASS |
| 19:18:19 | Deploy loynara-web at `ddfed7f` | deployment `e51eefe4-8094-41ee-8090-4a1114436c1b` SUCCESS; log "Production configuration gate passed", Next.js 16.3.8 ready; `/api/health` 200 `{"status":"ok","database":"reachable"}` | PASS |
| 19:20:34 | Deploy loynara-worker at `ddfed7f` | deployment `f4ecab28-28d7-4ffb-96f9-cee2077abd3c` SUCCESS; started 19:23:52; no configuration rejection and no heartbeat failure line through 19:31 (the worker logs heartbeat only on failure; the monitor dashboard was not opened) | PASS |
| 19:24:51 | Deploy loynara-ops-check at `ddfed7f` | deployment `26d5751b-5e84-42cf-a236-6bb054a6e54e` SUCCESS; 19:30:35 "Production operations check PASS: database and outbox healthy" (this version refuses unless the operations heartbeat is acknowledged) | PASS |
| 19:31:50 | Outbox read-back (read-only) | 16 complete, nothing pending, retrying, processing or failed; 0 `email.signin_lock` jobs; journal 26 | PASS |

Every deploy request was sent once and returned a deployment id; none was resent. No variable was changed. loynara-backup (`493cec2e`, 90ad26a) and loynara-cloudflared (`cd3b71ad`) were not touched.

## Anomaly

`railway down` does not pause a cron service. At the 19:10 tick Railway created a new ops-check deployment `867469b1-aeb5-4120-9d87-6c786900daf8` at `a436b77`, which ran the read-only operations check at 19:14:33 and 19:15:33 (both PASS, both finished before the migration ran at 19:15:49). It had no effect on the migration and was replaced by the `ddfed7f` ops-check deployment. For the next drain, remove the cron schedule instead, or accept the read-only runs.

## Deployments after

| Service | Deployment | Commit | Rollback target |
|---|---|---|---|
| loynara-web | `e51eefe4-8094-41ee-8090-4a1114436c1b` | `ddfed7f` | `c581e349-4869-40d4-8cdf-33854867e2e6` (680266d) |
| loynara-worker | `f4ecab28-28d7-4ffb-96f9-cee2077abd3c` | `ddfed7f` | `1e63e0bd-85b9-41c2-ba1c-9a34e3b749e2` (251453d), only after web |
| loynara-migrate | `b960a4cf-0948-4eb3-8c44-f5b410bf41a7` | `ddfed7f` | none: schema 0025 stays |
| loynara-ops-check | `26d5751b-5e84-42cf-a236-6bb054a6e54e` | `ddfed7f` | `4b6e6aa8-3e56-4c02-8a7d-11c9ecd2fb8e` (a436b77), after the outbox is clean |
| loynara-backup | `493cec2e-dde9-4d24-826b-2861c33f99da` | `90ad26a` | unchanged |
| loynara-cloudflared | `cd3b71ad-bcf9-47ec-8f29-498be3f14beb` | image | unchanged |

## Rollback drill (read-only)

Confirmed at 19:32 UTC from the deployment history: web `c581e349…` (680266d) directly precedes `e51eefe4`, and worker `1e63e0bd…` (251453d) directly precedes `f4ecab28`. X2 showed 680266d passing the core smoke on schema 0025. Order from X1: roll web back first, then drain or cancel `email.signin_lock` jobs (0 at 19:31), then roll the worker back, then run ops-check once the outbox is clean. Never roll the worker back alone. Use Rollback on the selected deployment, never "Deploy Latest Commit" and never the CLI `redeploy`. No Rollback was clicked in this drill. The plan's live drill (O2: roll web back, check health and a card page, roll forward) stays open.

## Open

- Core acceptance C1–C10 and O1–O3 on production (separate ACCEPTED entry).
- S-1 and S-2 remainder (`.env` on the iCloud Desktop): waived for A-3 only, still launch blockers.
- Worker heartbeat seen only as the absence of failure lines; the monitor's own status was not read.
