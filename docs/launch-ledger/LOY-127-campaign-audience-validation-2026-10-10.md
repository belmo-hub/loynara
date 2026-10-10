# LOY-127 / LOY-125 campaign audience validation — local evidence

Base: d733234b4d8637760efe34176153b002e60c36bc. Environment: isolated exact-lock install, Node 26.3.0 / Next 16.3.6, synthetic localhost PostgreSQL :55433, no production credentials or provider activation. Evidence recorded 2026-10-10 Europe/Berlin.

## Verified gap and change

Eight component regressions failed on the unchanged implementation: invalid selected audience thresholds still enabled forward navigation. Zero/oversized days, fractional days, invalid checkout counts and fractional/oversized missing-reward amounts could reach API rejection instead of useful builder feedback.

Moved the unchanged audience schema into a database-free module shared by server and composer; segments reexports preserve existing consumers. Selected audience validation now guards preview/save handlers, forward navigation and builder scheduling, and presents an inline alert. Inactive fields do not invalidate a different selected segment. Server authorization, consent and audience semantics remain unchanged.

## Verification

- Unchanged implementation: 8 expected failures, 13 passes in campaign component tests. Corrected implementation: 21 passes.
- Nine focused suites: 85 tests pass, zero failures. Campaign creation/editing, schedule idempotency, isolation/authorization, eligibility/consent/suppression, disabled-channel safety, segments, rate limits and automations covered by existing integration tests.
- Synthetic Chrome browser: 1 pass. Blank, zero, fractional and oversized days disable preview/forward controls and make zero preview/save requests; correcting to 60 days enables preview and exactly one draft save with the correct audience. Disabled delivery offers no scheduling.
- ESLint: pass without warnings. Next default production build: pass. Typecheck: pass after build generated route types; initial fresh-worktree typecheck reported missing generated LayoutProps in unchanged layouts, no source workaround used.
- Initial browser assertion matched both validation and Next route-announcer alerts; scoped to the validation content and reran successfully. No assertion weakened.
- Independent read-only code review: no Critical or Important finding. Reviewer did not independently execute tests/build/browser.
- git diff --check and preserved NFC/campaign/diagnostic ancestry: pass.

## Limits and acceptance

This is local engineering evidence, not merchant/provider/physical acceptance. LOY-127, LOY-125 and their independent acceptance gates remain open. No external sends, deployment, migration, protected-ref merge or configuration activation. Prior full-suite result at d733234 (1392 pass, 1 pre-existing Mailpit skip) is historical; this slice ran focused compatibility tests, not a repeated full suite. Generic audience validation feedback can later be refined per field. Asynchronous stale preview/save responses are a separate unverified candidate, not fixed or accepted here.
