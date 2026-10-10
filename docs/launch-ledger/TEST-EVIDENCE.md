# Test evidence index

Use task records as the source of actual counts, commands, expected RED regressions, error paths, isolation/auth/consent/idempotency coverage and limitations. Never combine separate executions into a fictional single-run result.

| Run | Actual scope/outcome | Evidence |
| --- | --- | --- |
| Latest customer export, sourcecd38bdcd |27PASS/0FAIL/1existing optional MailpitSKIP,5files; typegen/typecheck/scoped lint/default Next build/diff PASS; no fresh global/browser run | [LOY-43](LOY-43-customer-export-snapshot-2026-10-10.md) |
| Configured integrated, source9552b377 |152actual files,1414PASS/0FAIL/1SKIP,1415total; exact-lock synthetic environment | [global evidence](2026-10-10-current-integrated-regression.md) |
| Recovery Mailpit, sourcee03dc685 |10PASS/0FAIL/0SKIP focused; actual local HTTP sender capture, not external delivery | [capture](2026-10-10-recovery-mailpit-capture.md) |
| Earlier configured integration, source3156a403 |150files,1392PASS/0FAIL/1SKIP; historical separate run | [earlier full run](2026-10-10-full-configured-integration.md) |

All other preserved focused regressions are indexed chronologically in [TIMELINE](TIMELINE.md). Documentation-only slice validation checks relative link existence, exact SHA/ancestry, preserved historical file hashes and whitespace; no application test rerun is warranted without a source change. Commands and runtime credentials remain outside new documentation; use sanitized fixture/configuration references.

2026-10-10 bounded LOY-165: [one existing analytics suite](LOY-165-reporting-evidence-2026-10-10.md), source5a58f247,4PASS/0FAIL/0SKIP; no global/export/browser rerun.

2026-10-10 [owner export temporary probe](LOY-165-owner-export-characterization-2026-10-10.md): final1PASS/0FAIL/0SKIP, two-tenant synthetic category/isolation characterization; not a durable tracked regression.


2026-10-10 amendment: [Founder-authorized continuation, local integration and tracker reconciliation](2026-10-10-founder-continuation.md). Historical internal resource hold superseded by direct founder instruction; cumulative accounting preserved. Latest sourcea71d782 local suite1416PASS/0FAIL/1existingSKIP. No deployment, remote push, independent acceptance or scope completion. LOY-133 real-PG race remains open.


2026-10-10: [LOY-43 redemption/reversal export snapshot coverage](LOY-43-redemption-export-snapshot-2026-10-10.md) adds two durable real-PG cases; actual fixed source passes, read-committed control fails. No application/policy change or external acceptance. LOY-133 dispatch cutoff queued for founder decision; independent engineering continues.


2026-10-10: [LOY-273 campaign audience pagination](LOY-273-campaign-audience-pages-2026-10-10.md), related125/129: realPG499/500/501/1001 boundaries and interruption/replay; finalglobal153files1422PASS/0FAIL/1existingSKIP, build/type/lintPASS. Sending quotas retained. FirstWallet-hook timeout preserved with current/base9PASS comparisons. No deployment/provider acceptance or fullscope completion.

2026-10-10: TESTED LOY-157 saved audience cursor after real staff departure/reassignment,15focusedPASS; negativeguardcontrol1expectedFAIL,source restored; build/type/lintPASS. [Entry](LOY-157-audience-cursor-lifecycle-2026-10-10.md). Referral contract gap preserved; no deployment/acceptance.

2026-10-10: TESTED LOY-157 real credential-change/old-session/fresh-login cashier authorization;14focusedPASS, no app defect; type/lint/buildPASS. [Entry](LOY-157-credential-session-authorization-2026-10-10.md). Reset-email and independent acceptance remain open.

2026-10-10: IMPLEMENTED/TESTED LOY274staffactivity,existingownerledgercountingrule/UI. REDabsentreport→15focusedPASS; final154file1425PASS0FAIL1existingconditionalSKIP; type/lint/buildPASS. [Entry and prior157receipts](LOY-274-staff-activity-reporting-2026-10-10.md). No deployment/acceptance.

2026-10-10 LOY-275: real PG30/90-day recorded-location, UTC edge, reassign/departure, rename/archive, zero activity, reversal/seed/tenant and unit reconciliation tests;20focusedPASS. Final configured suite154files1427PASS0FAIL1existingconditionalMailpitSKIP exit0; defaultbuild/type/lint PASS; independent source review no material findings. [Entry](LOY-275-location-activity-reporting-2026-10-10.md).
