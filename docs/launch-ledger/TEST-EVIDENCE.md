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

2026-10-10 LOY-276: actual concurrent cashier award old/fresh analytics snapshot reconciliation and PostgreSQL error rollback/clientreuse regressions;22focusedPASS; configured154files1429PASS0FAIL1existingMailpitSKIP; type/lint/defaultbuildPASS; independent review no material findings. [Entry](LOY-276-analytics-snapshot-2026-10-10.md).

2026-10-10 LOY-277: sequential/concurrent authenticated unsubscribe cannot downgrade hard suppression, same-delivery terminal state and priorunsubscribe upgrades;129focusedPASS; global154files1436PASS0FAIL1existingSKIP on finalapp, followedbytestcleanup-onlyallsettled/final129focusedPASS; type/lint/buildPASS. [Entry](LOY-277-hard-suppression-2026-10-10.md).

2026-10-10 LOY139 actualsignedhandler eventID reusedacrossUTCday RED1FAIL/33filteredSKIP; expected2events got1. Reproducerpatchpreserved; failing testisolated, no application correction or globalgreenclaim. [Checkpoint](LOY-139-event-day-compatibility-2026-10-10.md).


2026-10-10 LOY-278: real-PG export concurrency RED1 →focused5files27PASS; real division-by-zero rollback/reused-client and 50k boundary coverage; [evidence](LOY-278-owner-export-snapshot-2026-10-10.md).


2026-10-10 assignment038: actual webhook503→rollback→sameevent200→duplicate200; owner redemption/reversal consistent snapshots. Focused4files47PASS; unchanged app; [entry](LOY-139-retry-and-owner-export-regressions-2026-10-10.md).


2026-10-10 assignment039: actual cancellation/reschedule/competingdispatch guards and referral event timestamps/tenant boundaries. No applicationfix fabricated. [Entry](LOY-129-schedule-and-referral-boundaries-2026-10-10.md).


2026-10-10 LOY279 actual child-worker stale404/410/403/201 × changed/unchanged registration keys; refreshed state and foreign-row isolation, subsequent wake-up. [Evidence](LOY-279-push-registration-fence-2026-10-10.md).


2026-10-10 assignment041 actual PostgreSQL closure membership-lock ordering; focused4files31PASS0FAIL1existingMailpitSKIP, unchanged app. [Evidence](LOY-161-policy-and-closure-ordering-2026-10-10.md).


2026-10-10 LOY280 real authenticated manager HTTP reissue, role revocation and onboarding user-lock control; final focused5files28PASS0FAIL1existingMailpitSKIP. [Evidence](LOY-280-reissue-revocation-ordering-2026-10-10.md).


LOY85 fallback: actual worker retry/expiry tests, finalfocused3files33PASS0FAIL0SKIP, negative six-attempt control2expectedFAIL; no provider/device acceptance. [Evidence](LOY-85-worker-retry-boundaries-2026-10-10.md).


LOY43 ordinary PostgreSQL failure atomicity: two new tests, focused5files27PASS0FAIL1existingMailpitSKIP; exact rollback/client reuse/foreign isolation. [Evidence](LOY-43-privacy-failure-atomicity-2026-10-10.md).


LOY153 actual HTTP/session role/origin/tenant/actor-identity matrix15PASS0FAIL; owner positive and idempotent audit controls. [Evidence](LOY-153-authenticated-http-permissions-2026-10-10.md).


2026-10-11 [LOY-281 deferral lease fence](LOY-281-deferral-lease-fence-2026-10-11.md): RED3 expired-owner database/real-worker failures; focused4files42PASS; independent review no material application finding, test cleanup/lockwait suggestions addressed; typecheck/lint/buildPASS after fixture literal correction. Global environment failure and unchanged-base comparison preserved; final receipt in entry.


2026-10-11 [LOY-282 claim generation](LOY-282-claim-generation-2026-10-11.md): RED actual two-worker committed deferral/claim reusedattempt1 overwrotefreshlease; tokenfences/replay/migration history compatibility and61focusedPASS; finalglobalreceipt inentry.


[LOY-283](LOY-283-enrollment-brand-contrast-2026-10-11.md): real Chrome/Postgres RED then browser1PASS; focused3files25PASS, static/build PASS; full/integration receipt in entry.


[LOY-284](LOY-284-campaign-report-snapshot-2026-10-11.md): actual PG report/delivery RED then concurrency+query-failure/rollback/reuse+empty checks; focused3files52PASS; final/full receipt in entry.


[LOY-285](LOY-285-manual-card-refresh-feedback-2026-10-11.md): initial fakeclockfixture invalidRED explicitly corrected; exactHEAD1GET503 validRED then mobile/desktop2PASS, keyboard2reads0mutations/cardunchanged; focused4files12PASS.


[LOY-286](LOY-286-operations-heartbeat-ack-2026-10-11.md): actual CLI synthetic transports;2 validRED failures; focused3files11PASS, configured159files1481PASS0FAIL1existingoptionalMailpitSKIP.


[LOY-287](LOY-287-secret-safe-ops-diagnostics-2026-10-11.md): actualCLI2validRED then focused3files80PASS, private fields withheld/usefulclassificationpreserved; full/static receipts separately appended.


[LOY-288](LOY-288-migration-safe-diagnostics-2026-10-11.md): actual subprocess PG/childdrizzle intercepted; focused3files32PASS plus static/build; full receipt pending at draft.


LOY-177/057: valid unchangedapp401RED; partial3browserPASS; bounded redesign1fixtureFAIL3NOTRUN. FullGREEN absent; see stalled record. [Evidence](LOY-177-cashier-session-feedback-stalled-2026-10-11.md).


LOY-289: actualsignup/signin/signout/401without mocks orlimitbypass;4browserPASS53s, focused3files6PASS, finalconfigured160files1506PASS0FAIL1optionalMailpitSKIP128.54s. [Evidence](LOY-289-cashier-session-feedback-2026-10-11.md).


[LOY-290](LOY-290-atomic-local-backup-2026-10-11.md): unchanged-base three race RED failures; six focused GREEN passes; independent review and static/build PASS. First global Wallet hook timeout preserved; base and changed Wallet nine PASS each; bounded final global 161 files/1,512 PASS/0 FAIL/1 existing optional SKIP.


[LOY-291](LOY-291-preview-backup-publication-2026-10-11.md): four RED failures/four PASS; four focused files/24 PASS; actual synthetic dump/list/restore, exclusive two-owner race and guard refusal. Independent review/static/build PASS; final 162 files/1,520 PASS/0 FAIL/1 existing optional SKIP, 145.46s.


[Assignment062](2026-10-11-push-safety-062.md): new LOY-33 late PostgreSQL abort rolls back credential/challenge/audit state; same-link retry and foreign-tenant isolation PASS. Affected file12 PASS/1 existing optional SKIP; first test-only lint failure corrected, final types/lint/targeted regression PASS. Application suite/build unchanged from061, not rerun.

- 2026-10-11 LOY-292 /063: [canonical evidence](LOY-292-customer-export-feedback-2026-10-11.md). Actual browserRED closed-card404missingfeedback; finalisolated8PASS8.8s, helper13PASS162ms, static/buildPASS, complete163files1534PASS0FAIL1existingoptionalMailpitSKIP150.97s. Shared peer quota/alert-selector/native-vs-Docker initialization failures preserved; no limiter reset or assertion weakening.

- Assignment064: readonly status/ancestry/logs-HEAD/du/lsof + native ownership observations; JSON arithmetic/classification and diff validation only. No product/test-suite rerun for documentation-only change. [Evidence](2026-10-11-worktree-preservation-064.md).
