# LOY-275 — transaction-location activity in owner analytics

2026-10-10 Europe/Berlin. Assignment LOY-ENG-20261010-033, bounded coding child of LOY-165. Codex isolated branch codex/location-activity-reporting; base 3d8ea248529010e7658fdfc9e16cd8779f23d88d. Requested gpt-6.1-sol High engineering / Medium review; effective model/effort setter unavailable and unverified, existing executor retained as coordinator permitted. Result: commit containing this entry, followed by explicit integration receipt.

IMPLEMENTED: src/lib/merchant-analytics.ts returns locationActivity grouped by recorded ledger location_id, award booking counts and separate stamp/point units. Reuses existing accepted_awards tenant, window and reversal filters. Includes all owned locations, including zero activity; uses current names and includes archived programme transactions. src/app/merchant/analytics/page.tsx displays the breakdown, booking-versus-checkout distinction and no revenue claim. Existing staff activity, aggregate totals, owner-only authorization and adviser aggregate payload whitelist preserved. No schema change, new programme policy or provider action.

TESTED: both new real-PostgreSQL 30/90-day cases failed on unchanged source because locationActivity was absent. Focused analytics/adviser/location suites: 20 PASS, 0 FAIL, 0 SKIP. Fixtures cover exact UTC [from,asOf) edges; multiple locations; renamed locations; archived programme; departed/reassigned cashier whose transaction remains at its recorded location; duplicate request booking distinction; separate units; full reversal, seed and foreign tenant exclusions; zero activity and sums agreeing with existing totals. Typegen, tsc, changed-file ESLint, diff check and default Next 16.3.6 build PASS. The adviser typed fixture adds an empty required locationActivity field without weakening assertions.

Independent read-only technical review found no Critical/Important issues; reviewer did not independently run tests. Existing analytics queries execute separately, not in a repeatable-read database snapshot. Supported ledger location_id is NOT NULL and protected by tenant/location composite foreign key; no invented unattributed history bucket. Browser/operator/production acceptance remains unverified.

YouTrack duplicate check of LOY-165 children returned only independent gate LOY-166 and completed staff child LOY-274. Necessary child LOY-275 created In Review with bounded local criteria. Parent/gate full scope preserved. Commit/integration/Done receipt follows actual verification.

External actions: genuine YouTrack child creation only. PUSHED / DEPLOYED / INDEPENDENTLY ACCEPTED / COMMERCIALLY READY: not established. Remote deployment triggers remain unverified; no customer/provider actions. Native Goal remains ACTIVE, latest measured cumulative 3,298,231 reported tokens / 18,618 seconds, no accounting reset; input/cached/output and browser usage not separately measurable.

Next dependencies: complete global verification and local integration, child Done readback, coordinator review and next assignment. Full LOY-165/166 reporting/export/independent acceptance, LOY-159 policy and LOY-209 retention decisions remain open.

## Final configured verification — 2026-10-10

Final application/test source: 154 actual files, 1,427 PASS, 0 FAIL, 1 existing opt-in Mailpit SKIP, exit 0. Evidence: /private/tmp/loy165-location-global.json and corresponding log; focused JSON/log, RED JSON/log and build/type logs use the same loy165-location prefix. No unexpected failures or weakened assertions. The skip does not establish current real email/provider acceptance.
