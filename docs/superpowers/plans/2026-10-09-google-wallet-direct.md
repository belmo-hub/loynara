# Direct Google Wallet implementation plan

> Execution: inline, as requested. User's supplied hybrid architecture and execution instruction supersede additional design-approval pauses.

Goal: Apple remains PassFast; Google uses Loynara's own issuer, scoped to approved synthetic locations until separately activated for production.

Base: 21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec. Production remains 792e218a17287009067ce0993c33eda3bfc3f4b7 / schema 0020. New branch codex/google-wallet-direct-v1. No NFC or PassFast-account changes.

Architecture: Keep wallet_passes, credential generation identity, membership issuance lock, Google pass write lock and wallet.refresh outbox. Add explicit Google Direct configuration with exact tenant/location/program/class bindings and fail-closed demo/publishing eligibility. Resolve Google configuration from authenticated card scope on every route and worker write. Freeze that scope into object identity so remapping cannot redirect an existing projection. PassFast Apple routing and mappings remain intact.

Global constraints: No production deployment/configuration/migration; no managed PassFast Google resource reuse. No business declarations or legal acceptance by the agent. No secret material in git, browser content, logs or YouTrack. Android owner consent/account must be established before tester setup or physical save.

Review focus: Misrouting under simultaneous provider flags; unmapped locations; binding changes affecting existing projections; lifecycle changes during provider latency; demo acceptance mistaken for public publishing.

## Task 1 — Routing and exact Direct configuration
- [x] Write failing behavior tests for hybrid availability, OFF, wrong scopes/issuer, missing demo eligibility and changed binding identity.
- [x] Run those tests and observe failures before implementation.
- [x] Add google-direct.ts for operator bindings/status/config, extend scope resolution to program, decouple Google availability/deployment gates from PassFast.
- [x] Run focused Wallet/production/device-test checks; preserve disabled configuration behavior.

## Task 2 — Bound issuance and lifecycle
- [x] Write failing route/integration tests for direct issuance with PassFast Apple enabled, duplicate issuance, isolation, corrections/redemption/closure and changed binding refusal.
- [x] Resolve scoped Direct config in Google route and worker; prevent existing managed Google projection routing into Direct; preserve PassFast Apple sync.
- [x] Keep Google object PATCH targeted, verify class/object identity before writes, add status retrieval and bound total operation time.
- [x] Exercise temporary provider failure/retry, concurrency, reissue and worker recovery with real local PostgreSQL and in-process provider transport.

## Task 3 — Runtime, docs and official button
- [x] Update declarative/runtime checks to admit approved Direct production configuration while rejecting Demo Mode in production.
- [x] Preserve isolated demo guards and key custody. Use current official Google button asset if existing UI lacks it.
- [x] Document exact configuration, approved issuer versus Merchant ID, synthetic eligibility, credential custody/rotation, merchant class isolation and remaining public publishing steps.
- [x] Run npm test in a dedicated disposable DB, typecheck, lint and build; review final branch and commit only non-secret implementation artifacts.

## Task 4 — Authorized Google setup and physical demo
- [x] Inspect founder's existing Wallet/Cloud account; do not create duplicate issuer/project/service account.
- [x] Stop only at legal terms, security-sensitive grant/key approval, missing Android owner/account consent or credentials; continue independent code work.
- [ ] After access/branding/testing consent: one synthetic class/pass, +1/replay/correction/closure, actual handset observations and separate provider/device timings.
- [ ] Update LOY-108/110/112/114 to the hybrid direction with verified evidence and leave production gates open.

Progress: all implementation tasks and focused regressions complete; reviewer fixes verified. Full dedicated-database suite: 1214 passed, 1 skipped across 142 files. Typecheck and production build passed after the two fixes; lint passed with zero errors and two existing service-worker warnings. Founder accepted Cloud/API terms; demo project created without billing; API active; dedicated service account has issuer Developer access; one key secured outside Git. OAuth/class-list reads returned 200. One approved tester and synthetic branding consent recorded. Temporary one-PNG tunnel explicitly approved; physical class/save/lifecycle and YouTrack evidence remain in progress. No production mutation.
