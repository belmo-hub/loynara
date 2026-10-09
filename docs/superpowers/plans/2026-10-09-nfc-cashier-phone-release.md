# NFC cashier phone release implementation and verification plan

**Goal:** Integrate a93fb82f3acd46045c94a89b34c140c88e4e1b9a onto exact production 792e218a17287009067ce0993c33eda3bfc3f4b7, fixing release blockers only.
**Spec:** User-provided NFC cashier-phone final integration and security review, 9 October 2026.
**Execution:** Local isolated branch codex/nfc-cashier-phone-release-v1; independent scoped reviews and focused test-first fixes, authorized by the supplied mission.

## Constraints
No deploy, push, production migration, secrets, feature activation, tags, billing/campaign changes or real accounts. Preserve PassFast binding and all production Wallet/worker behavior. No physical success claim.

## Tasks
- [x] Create isolated worktree from exact production SHA and merge candidate without committing; no conflicts.
- [x] Independently inspect push/security, NFC/core/UI and migration/worker/configuration.
- [x] Reproduce and fix customer polling shared crypto-rate exhaustion and frozen transient failures. Bind read-only status to request/tag/program/current member cookie, separate status rate bucket; browser retries; status reads never write stamps.
- [x] Reproduce and fix lost wake-up after process crash. Push-specific short leases in immediate and worker claims; renew before recipient sends and fence completion. Preserve five-minute Wallet leases.
- [x] Reproduce the expiry-during-membership-lock race and reject confirmation immediately before award.
- [x] Rehearse exact 0020 to 0021 journal 21 to 22 and rollback, including populated Wallet/ledger history and invalid subscription relationships.
- [x] Run focused security tests, then full unit/integration once, typecheck, lint, production build and relevant synthetic browser suite.
- [x] Independently review final diffs; commit merge then focused fixes and report clean final SHA and physical acceptance requirements.

## Review focus
Shared-IP/tag polling; two-cashier membership locking/idempotency; missing/expired/foreign sessions and customer credentials; process death after push claim; no notification customer credential or authenticated service-worker cache.

## Final evidence
Full Vitest: 138 files, 1,196 passed, one opt-in Mailpit skip. Typecheck and production build passed; lint zero errors/two pre-existing service-worker warnings. Compiled browser: 28 distinct relevant cases passed across scoped runs, with synthetic signup pacing respecting production auth limits. Exact populated schema 0020/journal 21 upgrade, rollback and reapply passed. Three focused P1 fixes and the integration merge are committed; final documentation records physical approval and configuration requirements. No production or physical action taken.
