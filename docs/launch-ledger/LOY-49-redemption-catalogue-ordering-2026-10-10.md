# LOY-49 selected-reward catalogue ordering — local evidence

Base aae6dcc6f4428e6058651382011d8b9b29da3ce7. Environment: isolated exact-lock Node 26.3.0 / Next 16.3.6, synthetic localhost PostgreSQL :55433, localhost-built server :55435, Chrome. Date: 2026-10-10 Europe/Berlin. No production credentials/provider operations.

## Requirements and policy boundaries

| Capability | Local evidence | Outstanding |
| --- | --- | --- |
| Purchase earning | Existing integer floor calculation, version/audit, role caps and retry tests pass; authenticated route and cashier browser award 14 points for synthetic 4.99 EUR at 3 points/EUR | LOY-38 exact founder-approved variants and LOY-50 independent/device acceptance |
| Selected reward redemption | Existing balance/idempotency, authorization and simultaneous-balance protection tests pass; this slice corrects catalogue edit/archive ordering | Physical multi-cashier/customer and device acceptance remain open |
| Multiple reward catalogue | Existing create/edit/reorder/archive and last-active guard tests pass; authenticated route scenario persists catalogue, selected reward and history | LOY-37/38 scope-decision gates are not closed by source/tests |
| Offline purchase replay | Seven existing offline integration tests pass | Physical disconnect/reconnect acceptance remains open |

Live LOY-49/37/38 were refreshed. LOY-50 is Blocked with ACTION-A-POINTS-CATALOGUE dependency. Canonical source labels exact points/catalogue variants Scope Decision Required. This correction changes no variant, amount limit, rate, rounding, lifecycle or reminder policy.

## Reproduction and correction

Four real PostgreSQL interleavings fail unchanged base. With redemption paused before its ledger insert, actual edit/archive commits first and the old booking completes afterwards. When catalogue mutation holds its uncommitted reward update first, redemption reads the old available reward and books an 8-unit cost, ending at balance 12 instead of rejecting and retaining 20.

Selected reward read now holds FOR SHARE OF rewards through the redemption transaction. Edit/archive first makes redemption wait and then reject stale/unavailable reward; redemption first completes before catalogue mutation returns. Latest-version lookup remains after acquiring the reward lock. Member → user → staff ordering and exact idempotent replay are preserved. Wallet enqueue is transactional SQL; no provider I/O is introduced or locked.

## Verification

- Base: four expected failures, including actual incorrect return ordering and stale booking outcomes; no tests weakened.
- 41 unique focused tests PASS across seven files: four controlled ordering cases plus new foreign-reward/tenant/location/revoked/closed denial case, loyalty/product/points, staff revocation, NFC cashier and offline earning. Main run 33 PASS; follow-up affected/added coverage 12 PASS with four overlapping cases, hence 41 unique.
- Two existing authenticated synthetic end-to-end checks PASS on the production build: saved purchase rules/reward catalogue/routes/card history; actual cashier purchase confirmation/selected redemption/customer card reload.
- Initial E2E sign-up returned 403. Changed and unchanged-base built servers both returned identical Registration is not enabled with PUBLIC_REGISTRATION_ENABLED absent. Rerun uses the documented local synthetic-test registration setting on localhost only; auth source, tests and production configuration unchanged. External email disabled. Test servers stopped and no :55435 listener remains.
- ESLint, typecheck, default Next build, diff check: PASS. Sensitive design and final read-only review: no Critical/Important; reviewer did not rerun tests.
- Frozen NFC policy remains exact 32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388; campaign/diagnostic ancestry verified.

## Limits

Local engineering evidence only. LOY-49/50 and LOY-37/38 acceptance/policy gates stay open. No deployment, migration, activation, external purchase, customer send, tag write or protected merge. Full new-SHA global suite is unverified. Only selected-reward edit/archive ordering is corrected; programme-wide earning-rule concurrency, future-effective version policy, broader catalogue/reminder architecture and physical acceptance remain separate unverified work.

Latest native measurement before final commit: 1,705,161 cumulative reported tokens /10,000 seconds, no reset; +90,104 tokens/+773 seconds since preceding checkpoint measurement. Input/cached/output split and browser inference unavailable/unmeasured. Original six-hour deadline and 2.5M ceiling preserved.
