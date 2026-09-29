# Gate 1 release-environment test

Use the Railway Hobby release candidate under the owner's approved $10 Compute warning, $16 Compute hard limit and $0 Agent hard limit. Record timestamp, commit, environment, tester and redacted evidence for each row. **GitHub-source migrations, web startup and subsequent worker startup/live heartbeat have been observed; the full live checks below have not passed.** Do not paste secrets, card bearer URLs or token-bearing paths into reports. Passing Stage A establishes the architecture; repeat selected operational checks after the separately approved Pro upgrade before commercial go-live.

| Check | PASS evidence required |
| --- | --- |
| Clean build and database | Node 26 `npm ci --include=dev`, `npm run build`; new empty PostgreSQL; one-shot `npm run production:migrate` applies auth and Drizzle schema under lock; zero user/tenant/membership/ledger rows; ledger append-only trigger and expected indexes/constraints present; second migration is idempotent. No seed/demo account. |
| Production refusal | `npm start` and worker reject localhost/preview origin, wrong DB, demo seed, local Mailpit, fixture billing, test NFC key file, placeholder credentials, unsafe registration and short secret. Provider secrets absent from build output, client bundle and logs. |
| HTTPS and routing | `app.getloynara.com` serves valid HTTPS. Browser auth redirect and enrollment URLs stay on that host; Cloudflare → tunnel → private Railway service preserves Host and `https` scheme. Direct public Railway web/DB endpoint does not exist. `preview.getloynara.com` still requires Access. `mail-events` accepts only signed POST webhook path; `unsubscribe` exposes only its allowed GET/POST flow; unrelated paths return 404. |
| Sessions/tenants | Authorized owner/cashier and denied unauthorized/cross-tenant sessions via real HTTP; revocation remains effective after restart. No unrestricted merchant registration. |
| Web and worker | `/api/health` is 200 with DB reachable and 503 when unavailable. Restart web while a synthetic outbox job is queued: worker continues; restart worker during processing: lease recovers without duplicate committed action. Failed/blocked job visible in `npm run diagnose`; controlled replay of one reviewed job works. |
| Backup and restore | **Stage A:** automated daily `npm run production:backup` creates an age-encrypted object in a **private R2 EU-jurisdiction bucket**, no plaintext dump or secret in name/logs. Retention and backup-age monitoring are active. Owner proves possession of the separate decryption identity. `npm run production:restore-check` restores an actual object to a fresh **different DB host**, not production; tenant/location/membership/ledger counts, critical FKs, migration version and append-only trigger reconcile with backup inventory. Never restore over live DB. **Railway native backup: DEFERRED_TO_STAGE_B_BY_OWNER_DECISION**, then enable and restore-test it before commercial go-live. |
| Monitoring and cost controls | External five-minute HTTPS check detects forced web/DB failure and sends an alert to the designated owner. Worker heartbeat stops on forced worker failure and alerts. Ops heartbeat stops for failed/blocked/overdue outbox and alerts. Backup heartbeat/age check alerts after a deliberately missed scheduled backup. Restart events and TLS/domain expiry are visible to operator. Verify and retain the owner's approved $10 Compute warning, $16 Compute hard limit and $0 Agent hard limit; record measured RAM/CPU/volume and headroom below 5 GB. The Compute hard limit takes services offline and does not cap every invoice item or tax. Test actual alert receipt, not only dashboard setup. |
| Logging | Synthetic card/recovery/QR/Wallet/NFC token probes do not appear in avoidable Next, worker, cloudflared, Railway or Cloudflare exported logs. Verify Railway service has no public HTTP edge; inspect provider logging settings. Document any unavoidable provider-held URI telemetry and retention before PASS. |
| Mac independence | Disconnect and power down owner's Mac; production marketing/app, authorized card reopen, checkout, worker, Mailgun webhook and unsubscribe remain reachable and state persists. Preview may remain offline without affecting production. |

Regression hooks after infrastructure cutover: transactional verification/recovery through Mailgun EU, separately approved promotional campaign and signed webhook/unsubscribe path, second-send suppression, and real QR customer→cashier award/redeem. Do **not** send real mail as part of deployment preparation. Apple/Google install/update and NFC physical taps belong to Gates 2/3, not Gate 1 evidence.

Local preparation commands: `npm run production:local-dry-run`, `npm run typecheck`, `npm run lint`, `npm run build`, and targeted `vitest` for config, migration and monitoring decisions. Production backup/restore tooling requires `pg_dump`/`pg_restore`, `age`, AWS CLI and a selected PostgreSQL version; full execution requires approved infrastructure and is **NOT RUN** here.

Stage-A preparation update (28 September 2026): local `Dockerfile` production build passed from a secret-excluding context, and local `Dockerfile.backup` built with PostgreSQL 18 `pg_dump`, `age` and AWS CLI. The app image refused startup without production configuration as expected. No Railway/R2 resource or external acceptance test has run. The image's production dependency audit reported four moderate advisories, none high or critical, in `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit` and `esbuild`; review upstream fixes before commercial release. This is preparation evidence, not Gate-1 PASS.

Stage-A live checkpoint (29 September 2026, commit `0f6bbff8186ef795822ecaa7844f5a7ff316cf62`): Railway Hobby in EU West built the private GitHub `railway-rc` source. One-shot migration deployment `46ae14d0-ad5c-454e-a8e7-7173f3166d80` completed with auth/app schema and append-only trigger present and no seed. Web deployment `e38600d2-9016-42dc-a603-9dd7ea5b45d4` passed the production configuration gate and Railway health check. Worker image built, but its production guard rejected startup because the reviewed external `WORKER_HEARTBEAT_URL` is not configured; its two failed deployments were stopped. No public app route or external monitoring exists yet. A 15:11 UTC Railway metrics snapshot showed web 114 MB RAM, PostgreSQL 88 MB RAM and 135 MB PostgreSQL volume; this is an idle snapshot, not a monthly usage estimate. All remaining Gate-1 rows above are pending.

Pre-exposure checkpoint (29 September 2026, source `200cdb3b7609a540c8afe5fc744c012ce71be403`): worker deployment `d47a109c-afaa-45e3-8d89-2a132b54c0e5` showed active startup logs and Healthchecks.io received current worker pings; GitHub autodeploy was verified OFF. The Railway deployment list still showed Deploying at the preceding observation, so final deployment completion is not asserted. The current source peer-identity concern is **CONFIRMED / UNRESOLVED by static review**: the fallback identity is shared within each scope, while the production guard refuses the existing proxy-trust switch. Existing identity-test assertions corroborate the fallback behavior; that integration test was inspected, not re-run. `vitest run scripts/config-check.test.ts` passed **12/12** locally. No external traffic/exhaustion test was used. Public tunnel/DNS, external log probes, backup/restore, forced alert, restart/Mac-off and callback cutovers were not attempted in this checkpoint because the owner requires stopping on this unresolved finding. No infrastructure or spending configuration changed.

## Local trusted-ingress fix — 29 September 2026

Base: clean `d0d74268521531ed36724af4ab64ed5ff2356898`. Software remediation is local only; independent review and the private-origin/header checks in `PRODUCTION_DEPLOYMENT.md` still block public exposure. No external configuration, push, deployment or message send occurred; new spending €0. Existing Railway usage is not remeasured or claimed zero.

- Before implementation: `vitest run src/lib/peer-identity.test.ts` reported **15 failed / 3 passed**. The positive distinct-visitor assertion received the same fallback for both synthetic addresses; missing/invalid metadata and unsupported mode rejection were absent. No network reproduction or live exhaustion was used.
- Final targeted regressions: **23 files passed; 138 tests passed, 1 skipped** on isolated local `looplocal_test`. The skipped test is the opt-in Mailpit recovery capture (`MAILPIT_SMOKE` not enabled); provider/email fixtures passed. Local Docker startup initially needed a readiness retry. A new preview-mode test caught a misplaced preparation check, corrected before the final pass.
- Coverage: opaque distinct/stable peers, IPv4/IPv6/mapped normalization, untrusted forwarding headers, strict malformed/missing fields and unsupported configuration; real PostgreSQL per-peer counters and concurrent atomic decisions; handler-level enrollment/sign-in/card/recovery checks with mocked business/auth handlers plus real rate storage; unchanged programme/token/destination limits; internal health without visitor metadata; Better Auth's actual IP parser with application options; provider signature/event regressions; card lifecycle, roles/tenant boundaries and ledger regression. This is local automated evidence, not physical device or live ingress evidence.
- Privacy review: no logging added in peer/auth handlers. `respondError` returns a generic non-cacheable ingress error and only logs error class names for unexpected failures. Peer and database rate keys are HMAC-derived. Better Auth's existing session IP field remains; no new IP analytics or customer export is introduced. Platform logs require separate deployment review.

Reproduce the affected set with `npm test --` followed by these files (local runner only):

```text
src/lib/peer-identity.test.ts
src/lib/auth-ingress.test.ts
src/app/api/trusted-ingress.integration.test.ts
src/lib/rate-limit.integration.test.ts
src/app/api/public-abuse.integration.test.ts
src/app/api/email/mailgun/webhook/route.test.ts
src/lib/transactional-email.test.ts
src/lib/card-recovery.integration.test.ts
src/lib/card-lifecycle.integration.test.ts
src/lib/product.integration.test.ts
src/lib/staff.integration.test.ts
src/lib/loyalty.integration.test.ts
src/lib/http.test.ts
src/lib/email.integration.test.ts
src/lib/contact-verification.integration.test.ts
src/lib/contact-verification-delivery.integration.test.ts
src/lib/unsubscribe.integration.test.ts
scripts/config-check.test.ts
scripts/production-migrate-config.test.ts
scripts/preview-config.test.ts
scripts/device-test-config.test.ts
scripts/device-test-google-config.test.ts
src/proxy.test.ts
```

Validation of this local fix:

| Check | Result |
| --- | --- |
| `npm run typecheck` (also after build) | PASS |
| `npm run lint` | BLOCKED by 11 pre-existing `no-require-imports` errors in three ignored `work/*.cjs` scripts; unrelated files preserved |
| `npm run lint -- --ignore-pattern 'work/**'` | PASS for application/repository code outside ignored supporting work |
| Default `npm run build` | Environment BLOCKED: Turbopack local subprocess port binding denied, including after scoped permission attempts |
| `DATABASE_URL=<isolated looplocal_test URL> NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack` | PASS, 74 pages generated; no build configuration changed. An earlier webpack run needed font-fetch permission and used an unmigrated default local DB; the final migrated-test-DB build completed without those errors. |
| `git diff --check` | PASS |
| `gitleaks git --staged --redact` | PASS; no leaks found in the staged fix/evidence |

No tests used real customer data, live rate-limit exhaustion, public Cloudflare/Railway traffic, or external email. Network access for existing build fonts/documentation is not a deployment. The fix changes peer keys once on adoption; old rate counters retain their normal expiry/pruning, with no database reset or migration. Shared public IPs/NAT still intentionally share peer limits; this is not a unique-person identifier.

## Bounded review follow-up F-1–F-5 — 29 September 2026

Base: clean `0946c81b23ab03caefb004ebccb64f53de3733c4`. Native IPv6 is masked to /64 before the existing HMAC; IPv4 and IPv4-mapped IPv6 retain the exact previous IPv4 identity. Thresholds and programme/member/destination limits are unchanged. The earlier 400 ingress-response evidence is superseded: public ingress failures now return generic HTTP 503 with no-store, and the constant `invalid_ingress` operational event is capped at one per minute per process across route-module reloads. Mailgun retains retryable 503/signature checks; health remains independent.

Before implementation, the focused unit run had **6 failed / 19 passed** (four /64 expectations, the 503 response and bounded signal expectations). After implementation, **16 targeted files passed: 106 tests passed, 1 optional Mailpit smoke skipped**. Fixtures only; no live rate-limit or provider test. Database tests exercise the explicit `2001:db8:1234:5678::1`/`::abcd` pair in one atomic bucket and `2001:db8:1234:9999::1` independently. Unit tests cover compressed/full forms, exact unchanged IPv4 HMAC, mapped IPv4, generic non-leaking responses, unchanged domain errors, and the log throttle at 59,999/60,000ms including module reload. Handler tests cover enrollment/sign-in/card/recovery and header-independent health. Auth ingress, public abuse, webhook/signature, config, lifecycle and recovery regressions passed.

F-3: every applicable production process/job (web, worker, production-ops-check, diagnose, production migration) requires `TRUSTED_INGRESS=cloudflare_tunnel` before restart/deploy; shared guard architecture unchanged. F-4: synthetic production-style preview may share Better Auth's no-trusted-IP per-path bucket; explicit regression/documentation accepts this only as synthetic behavior, never production isolation evidence. F-5: session IP storage remains unchanged; the Gate-7 privacy TODO now requires Datenschutz/retention/deletion review without inventing a period.

Targeted command: `npm test --` with `src/lib/{peer-identity,ingress-error,auth-ingress,rate-limit.integration,transactional-email,card-recovery.integration,card-lifecycle.integration,product.integration,http}.test.ts`, `src/app/api/{trusted-ingress.integration,public-abuse.integration}.test.ts`, `src/app/api/email/mailgun/webhook/route.test.ts`, and `scripts/{config-check,production-migrate-config,preview-config,device-test-config}.test.ts` (shell brace expansion or individual filenames).

No push, deployment, infrastructure/cost-limit change, email send or new spending. Gate 1 remains **PARTIAL**, pending independent re-review and the previously documented deployment verification.

Follow-up build checks: `npm run typecheck` PASS (also after build); `npm run lint -- --ignore-pattern 'work/**'` PASS, with known ignored/pre-existing scripts left unchanged. Default Turbopack build remains environment-blocked by local port binding (`Operation not permitted`), not an application compilation error. `DATABASE_URL=<isolated looplocal_test URL> NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack` PASS with 74 pages generated and no project build-configuration change. `git diff --check` PASS.

Follow-up secret check: `gitleaks git --staged --redact` PASS, no leaks in the staged bounded fix/evidence.

## Reviewed deployment checkpoint — 29 September 2026

Owner confirmed the exposed review-transcript credential belonged only to the Claude harness and was revoked; no production credential was exposed. Independent review approved runtime commit `e94fd5c1fa20da5b4fbdcb086ad01034947bcea0`. Clean local `railway-rc` and private GitHub remote matched that SHA before deployment. No runtime changes were made in this checkpoint.

- Production web, worker and migration configuration read back `TRUSTED_INGRESS=cloudflare_tunnel` and `TRUST_PROXY_CLIENT_IP=false`, saved before deployment without implicit restart. Promotional external email remains disabled. Future ops/diagnose jobs must use the same guard configuration; none were created. Preview configuration was unchanged. Web/worker/migration GitHub autodeploy was OFF.
- Exact-SHA migration `8ded1625-3560-4582-b0fd-4a1ba20facfb` succeeded: auth/app schema and append-only ledger trigger present, no seed run. Private web deployment `af00b970-1b02-4008-bafb-6a0c64dabc59` returned SUCCESS at the reviewed SHA. Worker remains on successful `200cdb3b7609a540c8afe5fc744c012ce71be403`, with observed heartbeat; it was not redeployed during this checkpoint.
- Railway API returned no public custom domains, generated domains or TCP proxies for the four inventoried services: web, worker, migrate and PostgreSQL. All four are expected owner-controlled workloads. This is configuration evidence, not a completed public ingress/bypass exercise.
- Created only the dedicated Cloudflare tunnel record `loynara-production` (`f8ae7570-6b6a-4ca1-a8c5-93fe888e3344`): inactive, zero connectors and no routes. Connector token stored in ignored restricted local storage, never printed. No connector workload, app DNS, public exposure or callback cutover occurred. A connector-only official-image approval question remains pending under the earlier public-image restriction.
- Cloudflare actual settings: Pseudo IPv4 OFF, managed visitor-IP-header removal unchecked, no Workers routes. Full public header/ingress test is NOT RUN. Existing preview tunnel/settings were preserved; its dashboard showed Down, so preview availability was not demonstrated.
- R2 `loynara-rc-backups` is EU-jurisdiction, private, public development URL disabled, no custom domain and zero objects. Encrypted upload, scoped-credential verification and isolated restore are NOT RUN.
- Existing UptimeRobot app health monitor is paused; worker Healthchecks pings were observed. Ingress-sensitive monitor, forced alerts, log probes, restart/recovery and Mac-off drill are NOT RUN. No external email was sent.

**STOP: Hobby backup capability contradicts the approved preparation assessment.** The authenticated PostgreSQL Backups screen says “Upgrade to Pro to enable Backups and PITR” and restricts creating backups to Pro. Volume settings offer no separate backup scheduler. The frozen acceptance row above requires a Railway daily volume backup in addition to encrypted R2 logical backup/restore. No Pro upgrade is authorized; do not silently drop that requirement. Evidence screenshot: ignored local `var/gate1-evidence/hobby-backups-pro-required.png`. Gate 1 remains **PARTIAL**.

Hobby and the $10 warning/$16 Compute/$0 Agent limits were verified and unchanged. Final usage screen: $0.03 current usage; $0.00 estimated/current bill after displayed included usage/credits; project cost $0.0301. Aggregate counters: memory 125.78 minutely GB, CPU 0.65 minutely vCPU, egress 0.00 GB, volume 174.13 minutely GB. These are cumulative billing units, not per-service instantaneous RAM/CPU or a monthly forecast. No plan/add-on purchase; incremental build/runtime cost is metered and cannot be claimed zero separately.

Next owner decision: resolve the required Railway snapshot layer being unavailable on the current Hobby account before provisioning resumes. No gate criterion was weakened.

Owner amendment after this checkpoint: Railway native backup is **DEFERRED_TO_STAGE_B_BY_OWNER_DECISION** because the authenticated Hobby account requires Pro. **STAGE_A_BACKUP: REQUIRES_EXTERNAL_ENCRYPTED_AUTOMATED_BACKUP_AND_VERIFIED_RESTORE.** This replaces only the native-backup clause in the Stage-A row; automation, private EU R2, technical retention, backup-age alert and isolated restore/reconciliation remain mandatory before Gate 1 can pass. Pro and a native Railway backup/restore test remain mandatory before the first paying merchant. No backup or restore is yet evidenced by this decision alone.

## Stage-A encrypted backup and isolated restore — 29 September 2026

- Railway `loynara-backup` is a private EU West cron service using the reviewed `e94fd5c1fa20da5b4fbdcb086ad01034947bcea0` source, PostgreSQL 18 client and `0 3 * * *` UTC schedule. Its first manual run completed successfully at **20:38:48 UTC**. `pg_dump` streamed through age encryption before R2 upload and HEAD verification. The private EU-jurisdiction R2 bucket contains one encrypted object, `loynara/2026/09/29/20260929T203848Z-ba174a8f0cba.dump.age`, **141,669 bytes**; no plaintext dump was uploaded. This proves a real run, not yet that tomorrow's scheduled run executes.
- R2 public access is disabled. The active lifecycle rule expires objects under `loynara/` after **14 days**. The scoped backup credential has bucket object read/write access; the age private identity remains outside Railway in restricted local storage. Retention is technical disaster recovery, not a legal customer-data retention decision.
- Retrieved that encrypted R2 object and restored it into a **new disposable PostgreSQL 18.6 database** on a separate loopback-only cluster. Decryption, `pg_restore`, critical tables/foreign keys, `ledger_append_only` trigger and Drizzle migration table passed. Reconciliation: **tenants 0, locations 0, memberships 0, ledger entries 0, migrations 18**. The four data counts matched the source database's empty tables as inspected after the backup. The temporary cluster was stopped and disposed of. This proves an empty release-candidate schema restore; recovery of populated transaction data remains unexercised.
- A free daily backup heartbeat check exists with a three-hour grace period, but the deployed `e94fd5c` backup script does **not** signal it. The locally tested heartbeat change is not deployed. **Backup-age/missing-run alerting, forced alert receipt and a scheduled (rather than manual) cron occurrence remain NOT VERIFIED.**
- The private web has no configured Railway domain/TCP proxy. Railway reported **SUCCESS** for worker deployment `fbc5ac5a-90d7-4337-b4e3-1c192adc5569` at the exact reviewed `e94fd5c` SHA; a fresh post-deploy heartbeat check is still needed. The production tunnel has no connector or route, so app DNS/HTTPS, public ingress, sensitive-path logs, callback cutovers, restart/recovery and Mac-off tests remain open. Gate 1 is **PARTIAL**.
