# PassFast production baseline integration plan

> Execution: local reconciliation in this session. User's 23-phase mission is the binding spec and already authorizes implementation and verification.

Goal: preserve both reviewed lines on an isolated branch whose first parent starts at production 5a60017ff66b3b2cd2f5627513fe2ebc8578d001.
Architecture: ledger/membership authoritative; Wallet outbox projects into mocked PassFast only. Disabled providers preserve the browser loyalty flow.
Tech stack: Next 16.3.6, React 19, PostgreSQL, Drizzle, Vitest, Playwright.

Constraints: no deploy/push/production mutation; no real provider or credentials; migration 0020 must stay byte-identical; disk >=10 GiB before large operations.

## Conflict inventory and rulings
- card-client.tsx: keep production focus/visibility/pageshow + bounded 20s/60s refresh, manual refresh and revoked-link message; replace old Wallet URL props with reviewed capability/POST/ticket actions.
- loyalty-ui.tsx: keep all production cashier changes, K-number prominence, recovery steps and hidden sc_ code; add reviewed Wallet section with new props.
- globals.css: retain both independent additions.
- product.ts: preserve production programId response plus Wallet transaction-scoped refresh/reward hooks.
- Semantic: remembered bearer must revalidate after reissue/closure; Wallet tickets/generations must also retire; K-number is never Wallet authorization; provider failure must not affect committed loyalty transactions.
- Semantic: Wallet OFF must render no Wallet placeholder, fake action or changed closure copy.

## Tasks
- [x] Map merge-base, both commit ranges and overlap before integration.
- [x] Create native isolated worktree at exact production baseline; name product/passfast-wallet-production-v1.
- [x] Audited no-commit merge of 542a2bbc006d37dee7fc323303abc7e2e346da09; manually reconcile the four overlaps; inspect both directional diffs.
- [x] Reuse source regression tests; add combined remembered-card/reissue/closure tests and exact 0019 -> 0020 rehearsal without changing SQL.
- [x] Run focused + full unit/integration with isolated localhost database and fake provider; inspect red tests and classify.
- [x] Run providers-OFF startup/worker, config guards, typecheck, lint, disk gate and production build.
- [x] Run first-merchant/Wallet browser suites and visual QA at 1440x900, 768, 390x844, 320; correct integration regressions with failing tests first.
- [x] Focused security/no-loss review, preservation matrices and complete evidence report; commit local candidate; confirm clean exact SHA.

Review focus: stale cookie with fresh Wallet generation; revoked browser bearer with stale issuance ticket; provider timeout during ledger operation; delayed cashier A response after opening B; capability-off UI at narrow widths.

Verification commands: TEST_PG_CONTAINER=loynara-combined-pg TEST_PG_PORT=54407 npm test; npm run typecheck; npm run lint; npm run build; local Playwright targeted suites using a synthetic loopback database only.

## Verification outcome

- Full suite: 114 files; 1,021 passed, one optional Mailpit smoke skipped.
- Browser: 23 unique cases passed across hardening, Wallet, counter/recovery, programme, purchase, referral, offline and four-width combined visual suites.
- Local compiled production-like application: providers OFF, public registration OFF, staff invite ON; smoke and four-width browser checks passed.
- Actual worker child: providers OFF makes zero fake HTTP calls; fake outage attempts both platforms independently and stops after five attempts, with healthy subsequent work.
- Typecheck, lint and production build passed.
- Migration 0020/snapshot/journal unchanged; exact populated 0019 journal transition 20 -> 21 preserves loyalty, ledger, balance and K-number.
- Independent focused review: no P0/P1/P2 findings. No deploy, push, real provider calls or production mutations.
- Evidence retained under ignored var/integration-evidence; exact final SHA reported after local commits.
