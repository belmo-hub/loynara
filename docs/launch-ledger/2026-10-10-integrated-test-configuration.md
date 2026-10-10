# Focused integrated failure classification

Source base: 75e07514c78b54e887d14a0bab5d0beb793c8734. Isolated branch codex/launch-integration-classification. No source, test assertion, security guard or dependency change.

The earlier clean-install full suite at fb73e079 had 1345 passing tests, 30 failing tests and one skip. All 30 failure names reproduced on unchanged 9848e759 using the same minimal environment. Six-suite configured verification at this source base passes all 98 tests: PassFast 44, returning-card 16, NFC lifecycle 12, secure tap 11, billing 10 and NFC status 5.

Failure classification: seven billing tests received BILLING_DISABLED because the minimal loopback URL did not match the exact allowed synthetic fixture URL/TEST_PG_PORT. This rejection is intended; the URL-query override rejection test still passes. The other 23 failures involved absent synthetic BETTER_AUTH_SECRET, including cascading failed enrollment, invalid/absent card tokens and stale cookie expectations. All unchanged affected tests pass with valid synthetic configuration. No failing assertion was removed, loosened or skipped. The six-suite run contains no skipped tests.

Reproduction after exact-lockfile npm ci, using a disposable local database named looplocal_test on port 55433 (synthetic local-only password, no production environment files):

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin \
  DATABASE_URL=postgresql://looplocal:looplocal_local_only@localhost:55433/looplocal_test \
  TEST_PG_PORT=55433 \
  PUBLIC_BASE_URL=http://localhost:3000 \
  BETTER_AUTH_URL=http://localhost:3000 \
  BETTER_AUTH_SECRET=loynara-synthetic-integration-only-no-live-credential \
  ./node_modules/.bin/vitest run \
  src/lib/billing.integration.test.ts \
  src/lib/nfc-lifecycle.integration.test.ts \
  src/lib/nfc-status.integration.test.ts \
  src/lib/secure-tap.integration.test.ts \
  src/app/api/enroll/returning-card.integration.test.ts \
  src/lib/wallet/passfast.integration.test.ts
```

Tests supply their own bounded local billing fixture settings and mocked provider adapters. No hosted resources, live billing, real provider credentials, customer sends or physical tags are used. Existing production guards remain intact. Evidence includes individual original failure names/classifications in durable native Goal state; runtime Node26.3.0/npm11.16.0, clean exact-lock install. Tests execute sequentially against the disposable database.

This resolves the reported 30-failure cluster under the documented synthetic configuration. It does not establish a fully configured global suite, independent release acceptance, physical NFC/Wallet/provider acceptance or same-environment unchanged-base build parity. Earlier clean-candidate build/typecheck evidence remains valid; stalled broad base-build attempts were not restarted. Existing NFC/Wallet/session acceptance and frozen refs are preserved.
