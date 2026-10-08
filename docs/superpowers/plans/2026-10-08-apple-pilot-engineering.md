# Apple Pilot Engineering Implementation Plan

**Goal:** clear asynchronous issuance, worker lifetime and one-location engineering P1s while providers remain OFF.
**Architecture:** reuse stable Wallet projections, transactional outbox and current schema; authenticated card polling and archive-only download; explicit tenant/location/template configuration; bounded fenced worker lifetime.
**Spec:** docs/superpowers/specs/2026-10-08-apple-pilot-engineering-design.md
**Execution:** root integrates issuance and verification; independent worker and eligibility domains follow the dispatching-parallel-agents skill with disjoint file ownership, followed by a fresh whole-branch review.

## Global constraints
Base SHA 21bf48cb5fdc4139a4b931f282b197c8eb97ec83, schema 0020/journal 21, no real provider/production actions. Only synthetic local data and mocked HTTP. No badges/NFC/billing/campaign changes.

## Review focus
- Expired ownership while a remote response is still unknown: no stale completion or new identity.
- Parent SIGKILL must not leave a live Wallet child making requests.
- Closure/reissue or eligibility removal during archive retrieval: do not release a usable archive.
- Malicious polling cannot select another membership, pass, tenant, location or template.
- Failed/exhausted preparation is not revived indefinitely by repeated customer issuance.

### Task 1: Explicit tenant/location/template eligibility
Files: src/lib/wallet/passfast.ts, capability.ts, eligibility.ts, issue.ts, data.ts, types.ts, passfast-lifecycle.ts, refresh.ts, readiness.ts; relevant configuration/identity tests.
Interfaces: passFastConfig(env?,tenantId?,locationId?); passFastStatus and walletAvailability same scoped arguments. walletCardEligibility(token,reader=db) returns tenantId/locationId/membershipId/credentialHash/availability. issueWalletPass accepts optional database as fourth argument; activeApplePass accepts optional reader. Actual database joins supply location; startup no-scope validation may use one binding but customer capability must never use startup availability.
- [x] Add failing parser/scope and real DB eligibility tests; run to establish RED.
- [x] Require exact UUID triples and remove managed fallback; validate actual card programme/location scope and selected platform.
- [x] Preserve native nonproduction test behavior, provider OFF startup, opaque serial and identity validation. Update synthetic fixture maps explicitly.
- [x] Run scoped unit tests and serialized integration tests, then report evidence to root. No independent commit while another task writes.

### Task 2: Fenced worker renewal and bounded lifetime
Files: src/lib/outbox.ts, scripts/worker.ts, scripts/worker-supervisor.ts, scripts/wallet-worker-job.ts, scripts/ops-heartbeat.ts as needed; new worker ownership/process tests and combined-worker integration test.
Interfaces: current attempt number is the fence; renewal returns a boolean and requires unexpired processing ownership. Root owns HTTP routes and eligibility agent owns provider/lifecycle/refresh; worker changes must not write those files. Child executes real refresh and reports sanitized outcome; parent marks current fenced outcome. Provider mocks exist only in test preload files.
- [x] Add failing renewal, stale owner, max duration, shutdown and orphan tests; run RED.
- [x] Implement current-attempt renewal, independent bounded heartbeat, enforceable 270-second total Wallet job supervisor and stop/recovery lifecycle.
- [x] Preserve five retries/backoff, transactional enqueue and unknown provider outcome reconciliation. Reap child before continuing; parent-death guard terminates child.
- [x] Test real competing claims and termination with the synthetic DB in an exclusive test window, then report evidence to root.

### Task 3: Pending issuance, protected readiness and archive-only download
Files: src/app/api/wallet/apple/route.ts, src/app/api/wallet/status/route.ts, src/app/api/wallet/apple/download/[ticket]/route.ts, src/lib/wallet/preparation.ts, src/lib/wallet/database.ts, src/components/card-client.tsx; async integration/budget tests, existing route and PassFast regressions.
Interfaces: consume Task 1 scope and optional bounded database. POST issue returns {status:pending} HTTP 202 until ready; status POST returns availability and applePass:{status:not_requested|pending|ready|failed,url?}. Native local fixture issue retains url. GET status discloses only unavailable defaults. Fresh ready ticket uses createDownloadTicket. Worker success produces existing created status/syncedAt; outstanding initial outbox failure distinguishes pending/retry/failed.
- [x] Write real transaction tests proving slow provider cannot delay issue, protected polling, existing-ready archive retrieval only, repeated issue/no duplicate, expired/old-generation ticket refusal and failed retry handling; run RED.
- [x] Implement bounded acquired-client HTTP DB helper with destroy-on-timeout and late-acquisition cleanup; test cancellation before writes can commit.
- [x] Implement status/preparation and archive-only GET; preserve pre/post-download current credential recheck and limits.
- [x] Update customer to card-bearer availability and bounded status polling; test canceled/failed polling and fresh download navigation.
- [x] Run focused integration/route/provider regressions with fake provider only.

### Task 4: Operator guide, regression, browser and branch review
Files: docs/operations/apple-wallet-pilot.md, docs/apple-wallet-production-readiness.md, e2e/wallet-review.spec.ts and affected Wallet browser expectations; ignored var evidence only.
- [x] Document exact synthetic-only configuration format and required owner decisions, full-account risk, quota/cap, secure two-service key rotation/revocation, OFF release and rollback/void implications.
- [x] Run full npm test on exclusive localhost synthetic DB, next typegen, typecheck, lint and production build with providers OFF. Verify mocked pilot-enabled gates separately.
- [x] Run browser checks for pending/download flow, denied locations/tenant, Google OFF and existing card/returning join; no physical test.
- [x] Fresh whole-branch review, address material findings with RED/GREEN tests and relevant regression, inspect source diff/schema/activation flags.
- [x] Commit only reviewed engineering changes and deliver clean branch SHA, verdicts and minimal OFF release procedure. No push/deploy.

Verification details: [engineering verification](../../apple-pilot-engineering-verification.md). Browser PKPass navigation was blocked by Chrome; protected archive-only API verification passed. The isolated clean commit is retained for review, without push/deploy.
