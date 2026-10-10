# Configured full local integration — 2026-10-10

Source/base: `3156a4039c44bdb08ce67273a1057cb1d73f25a0`, isolated `codex/full-configured-integration`. All six local implementation slices and the configuration evidence commit are ancestors; frozen NFC/customer policy `32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388`, campaign `e1aae658` and diagnostic `9848e759` remain preserved. This commit adds evidence only.

## Reproducible local run

Node26.3.0/npm11.16.0, clean exact-lock offline npm ci using the disposable task cache. No production environment files or credentials copied. The repository Vitest configuration runs files serially (`fileParallelism:false`) and includes src/scripts *.test.ts.

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin \
  DATABASE_URL=postgresql://looplocal:looplocal_local_only@localhost:55433/looplocal_test \
  TEST_PG_PORT=55433 \
  BETTER_AUTH_SECRET=loynara-synthetic-integration-only-no-live-credential \
  PUBLIC_BASE_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 \
  node_modules/.bin/vitest run --reporter=default --reporter=json \
  --outputFile=/private/tmp/loy-global-results.json
```

The URL contains the repository-approved synthetic local-only test credential, required by billing fixture guards. Provider transports are repository mocks/synthetic fixtures, not live activation. Tests set their own local billing mode/secret as needed. No security guard or assertion was modified.

Result: **150 files PASS; 1,392 tests PASS; zero failures; one pre-existing skipped test** (1,393 total), exit0, 101.72seconds. JSON's suite count386 includes nested describe suites;150 is the actual file count. Full logs and assertion results preserved in native Goal state under global-integration.

Local schema journal24 entries ending0023_reward_ready_automation. Actual isolated database migration hash `15a15cfac72e146a1ec744ce65918ebe13f2ee46d95da4cb731229cdafe024aa` matches SHA256 of candidate0023 SQL; database migration timestamp1791632400000. This is local metadata evidence, not fresh production health or a new migration rehearsal.

## Unverified case and limits

The unchanged `src/lib/card-recovery.integration.test.ts` opt-in case “captures the recovery message in loopback Mailpit through the real sender” uses `it.skipIf(process.env.MAILPIT_SMOKE !== "true")`. It remains skipped because the capture-service smoke environment was not enabled. No new skip was added. Other recovery cases passed; real local sender/capture acceptance is not established by this run.

There were no failing tests to compare against base and no source correction. Do not repeat the resolved six-suite configuration investigation or failed broad base-build parity attempts. At source3156a40 targeted lint, standalone TypeScript, default Next/Turbopack build and independent sensitive review already passed in its exact-lock source worktree. This documentation-only commit requires diff verification, not another source build.

Full configured automated coverage improves local compatibility confidence; it is not comprehensive browser E2E, independent staff/customer/operator acceptance, physical NFC/Wallet acceptance, provider publishing/delivery, deployment approval, legal/commercial approval or full canonical scope completion. LOY133 catalogue dispatch concurrency, inherited suppression serialization, audience>500 capacity, referral historical-contact limits and inherited member-lock cycles remain open despite this result. Customer90/365 policy, frozen branch and founder boundaries remain unchanged.
