# Current integrated compatibility — 2026-10-10

Verified source/base9552b3773e6df8581127b230abb0535150e6fa50, clean isolated codex/configured-regression-current. Result is the evidence-only commit containing this document. Frozen32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388, campaign e1aae658 and diagnostic9848e759 ancestry verified; frozen branch exact SHA retained. No product, dependency, assertion or policy change.

## One configured full run

Exact-lock offline npm ci; synthetic-only env-i configuration, no copied environment files or production credentials. All tests run serially under repository fileParallelism:false. Providers use existing mocks/fixtures; no activation or live transport.

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin \
 DATABASE_URL=postgresql://looplocal:looplocal_local_only@localhost:55433/looplocal_test \
 TEST_PG_PORT=55433 \
 BETTER_AUTH_SECRET=loynara-synthetic-integration-only-no-live-credential \
 PUBLIC_BASE_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 \
 ./node_modules/.bin/vitest run --reporter=default --reporter=json \
 --outputFile=/private/tmp/loy28-current-results.json \
 > /private/tmp/loy28-current-suite.log 2>&1
```

Exit0;102.52seconds; **152 actual files PASS,1414 tests PASS,0 failures,1 skipped (1415 total)**. JSON391 suites includes nested describe groups; actual file count comes from152 testResults. Historicald733234 result150files/1392PASS/1skip is superseded for current local compatibility by +2files/+22passingcases. The additions include selected-reward catalogue5, earning snapshot3 and composer validation/preview test additions; counts are measured rather than inferred.

The only skipped assertion is lost browser-card recovery / captures the recovery message in loopback Mailpit through the real sender. Existing conditional MAILPIT_SMOKE=true was not enabled. No new skip or failure classification needed. No second full run or unchanged-source build/browser repeat.

Schema evidence:24 journal entries ending0023_reward_ready_automation, actual database last timestamp1791632400000/hash15a15cfac72e146a1ec744ce65918ebe13f2ee46d95da4cb731229cdafe024aa equals current SQL SHA256. This is disposable local metadata, not production health or migration rehearsal. Initial sandbox-default metadata read denied loopback EPERM; authorized local metadata read with standard escalation passed. No security control bypass.

Full stdout, JSON assertion report, schema and install logs retained under native Goal state/current-integrated-regression. No source correction, new build or lint required for this document-only result; git diff verification applies. Earlier exact-source production changes have recorded build/type/lint/focused/browser evidence in their own ledgers.

## Acceptance and accounting

LOY-28 and full launch remain OPEN. This run establishes automated compatibility only, not complete browser E2E, independent staff/customer/operator, physical NFC/Wallet, provider publishing/delivery, production GO, legal or commercial acceptance. Founder effective-time decision37/38, device50, reminder architecture133, inherited suppression concurrency, audience>500, referral-history limitations and159 policy remain unresolved.

Native Goal preparation measurement1,943,012 reportedtokens/11,290sec; since checkpoint0181,913,659/10,935 +29,353tokens/+355seconds. Input/cache/output split/browser inference unmeasured. No resets; original2.5M ceiling/deadline19:50:28Berlin unchanged, native hardcap unavailable/checkpoint accounting enforced. Next candidates: existing local Mailpit capture, privacy/export/deletion targeted gap, retention/rewards suppression concurrency discovery under established policy.
