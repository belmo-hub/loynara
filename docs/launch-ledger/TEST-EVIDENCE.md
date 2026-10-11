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

- 2026-10-11 064-01 preservation verified: fresh per-candidate clean/no cwd/exact branch, archive paths/count/bytes/hash before-after, all branch refs unchanged, retained13 raw statuses unchanged; empty prune dryrun then registry prune. Two formatting/stale expected-value corrections preserved. [Receipt](2026-10-11-worktree-cleanup-064-01.md).

- 2026-10-11 /065 [LOY-293 recovery request feedback](LOY-293-recovery-request-feedback-2026-10-11.md): actualHTTP400 browserRED; fixed German failure feedback/retained retry,6browser+9unitPASS; type/lint/normalbuildPASS; configuredglobal and integration receipts recorded in entry. Parent33/34 OPEN.

- 2026-10-11 /066 [LOY-294 recovery confirmation uncertainty](LOY-294-recovery-confirm-feedback-2026-10-11.md): actualHTTP500/challenge-preserved RED, fixed invalid-proof vs temporary/ambiguous feedback;12real browser+18helperPASS, static/normalbuild/reviewPASS. Final global and integration receipts in entry; parent33/34 OPEN.

- /067: [LOY-295 campaign outcome browser evidence](LOY-295-campaign-outcome-feedback-2026-10-11.md), persisted positive/zero/foreign fixtures, real API500/transport loss/explicit current-data retry, abandoned old success/error, mobile/desktop; failed test observations retained.

- 2026-10-11 /068 LOY-296:9browserPASS13.4s,17focusedPASS, static/build/reviewPASS;166files1575globalPASS0FAIL1existingSKIP. Initial enrollment fixture failure preserved. [Evidence](LOY-296-branding-save-feedback-2026-10-11.md).

- 2026-10-11 /069 LOY-297:6actualstaffbrowserPASS19.3s plus mobileartifact1PASS4.3s; primaryreporting2PASS4.9s unchanged;3focused/static/build/reviewPASS. [Evidence](LOY-297-staff-confirmation-feedback-2026-10-11.md).


2026-10-11 /070: [LOY-298 explicit referral error recovery](LOY-298-referral-error-recovery-2026-10-11.md), bounded177 coding correction after115 unchanged browser verification. Actual foreign referral rejection is preserved; localized explicit ordinary-enrollment action,7browser/21focused/static PASS. Global/integration/tracker receipts follow.115/116/119/177/178 independent scope and185/186 remote hold OPEN; no deployment/acceptance claim.


2026-10-11 /071: [LOY-299 idle connection survival after export](LOY-299-export-idle-connection-2026-10-11.md), actual process-exit RED corrected with sanitized idle handler/real database regression; primary47 unchanged customer/cashier browser evidence. Implemented/tested locally; integrated/tracker receipts follow.43/44/209 and47/48 external/full gates OPEN; no deployment/acceptance claim.


2026-10-11 /072: [LOY-300 later Wallet success survives old lease expiry](LOY-300-wallet-late-expiry-2026-10-11.md). Actual customer-status RED corrected with tenant/card coverage and concurrent completion/expiry regression; focused/static/build/global/review evidence in entry. Primary163 bounded unchanged classification PASS;97/98 and163/164 full gates OPEN. Local integration/tracker receipts follow; no remote/deployment/acceptance claim.

2026-10-11 /073: [LOY-113-125-recovery-eligibility-verification-2026-10-11](LOY-113-125-recovery-eligibility-verification-2026-10-11.md), TESTED unchanged actual Google-worker429/503 recovery and real501page2optout afterpreview;26focused/static/build/reviewPASS. No application defect/change, complete-feature or provider acceptance claim;113/114 and125/126 OPEN.

2026-10-11 /074: [LOY-301 mobile menu focus](LOY-301-mobile-menu-focus-2026-10-11.md). Genuine unchanged Escape focus RED; restore after inert removal; Escape/backdrop, keyboard reopening and desktop guard/Back 4 browser PASS; role/PG staff 11 PASS; static/build/review PASS. Global/local integration/tracker receipts follow. LOY-169/170 and LOY-181/182 full acceptance OPEN; no deployment.

/074 receipt: source555854d9e4ba71cd42c4cd7b5fc7f7968e72354c LOCAL integrated11PASS;301Done/comment7-131/readback04:37:50UTC. Final configured170files1584PASS0FAIL1existingSKIP146.10s. Full181/182 and169/170 acceptance OPEN.

2026-10-11 /075: [LOY-302 worker housekeeping shutdown](LOY-302-worker-housekeeping-shutdown-2026-10-11.md). Genuine realPG/worker SIGTERM exit1 RED corrected by cancellable housekeeping only; pending attempts0/fresh-worker failure-path1 preserved,22focusedPASS; primary183 unchanged reduced-motion4browserPASS. Static/build/reviewPASS; global/integration/tracker receipts follow.187/188 and183/184 full acceptance OPEN.

/075 receipt: sourcec8a32a6acc0296aa44e2f1e33de305656c19a3c6 LOCAL integrated22PASS4.82s;302Done/comment7-133/readback04:51:15UTC,183evidencecomment7-132. Current171files1586PASS0FAIL1existingSKIP151.65s;183/184 and187/188 full gatesOPEN.

2026-10-11 /076: [LOY-303 offline sync view fence](LOY-303-offline-sync-view-2026-10-11.md). Actual samecard stale balance RED corrected;4realChrome/36focused/global1586PASS;static/build/read-only reviewPASS,LOCAL integrated36PASS5.15s.303Done/comment7-135/readback05:06:41UTC;57evidencecomment7-134.55/56and57/58full gatesOPEN,no deployment.

2026-10-11 /077: [LOY-304 redemption key conflict](LOY-304-redemption-key-conflict-2026-10-11.md). Genuine concurrent two-card200/500 RED corrected to definitive409 after rollback; real late-fault/security negatives, focused29PASS, current global1590PASS/1existingSKIP, static/build/read-only review PASS, LOCAL integrated29PASS4.67s. Coding tracker receipt follows;37/38/49/50 full gates OPEN, no deployment.

/077 receipt: LOY-304 Done/comment7-136/readback05:23:02UTC; sourcef67ba931a8cec5fbffdba8a2f500307a5b808435 LOCAL integrated29PASS4.67s.37/38/49/50 broad gates OPEN; no deployment or independent acceptance.

2026-10-11 /078: [LOY-305 award/reversal key conflicts](LOY-305-award-reversal-key-conflict-2026-10-11.md). Genuine2RED200/500 corrected to definitive409 after rollback;40focused/global1601PASS/1existingSKIP/static/build/read-only review PASS; LOCAL integrated40PASS7.28s.305Done/comment7-137/readback05:36:07UTC.37/38/49/50 full gates OPEN; no deployment.

2026-10-11 /079: [LOY-306 offline interruption regressions](LOY-306-offline-interruption-2026-10-11.md). New durable actual Chrome3PASS/PG15PASS/static/build/read-only reviewPASS, clean LOCAL integrated15PASS1.52s; application unchanged, initial wrong blocked-text assertion corrected transparently.306Done/comment7-138/readback05:52:09UTC;55/56and165/166 full gatesOPEN. Same-context page restart only; browser-process crash/physical acceptance unverified. No deployment.

2026-10-11 /080: [LOY-307 correction audit retry](LOY-307-correction-audit-retry-2026-10-11.md). Genuine editable pending reason RED corrected;2realChrome/8focused/currentglobal1601PASS/1existingSKIP, static/build/read-only reviewPASS, LOCAL integrated8PASS0.948s.307Done/comment7-140/readback06:09:55UTC.93operational cap lacks unattended transactional contract; exact owner action queued/comment7-139.53/54and93/94full gatesOPEN; no deployment.

2026-10-11 /081: [LOY-308 first-login outcomes](LOY-308-login-outcome-2026-10-11.md). Genuine2RED corrected;2realChrome/40focused/static/build/read-only reviewPASS, finalglobal1601PASS/1existingSKIP158.31s, LOCAL integrated40PASS5.84s. First global campaign-deferral contended-lock failure preserved; isolated base/changed and single fullretryPASS, root cause unresolved.308Done/comment7-141/readback06:31:07UTC;143InProgress/full143/144OPEN. No deployment.

2026-10-11 /082: [LOY-309 precise lease test synchronization](LOY-309-deferral-clock-precision-2026-10-11.md). ClassificationB: actualPG probe proves999us client-Date precision loss/false expiry. Test-only exact DB deadline/claim identity repair;22focused/static/build/read-onlyreview/LOCAL integrated22PASS12.35s.309Done/comment7-142/readback06:41:30UTC;281/282Done and139/140/133 full gates preserved. Original081 event causation unproven; no new global/application repair/deployment claim.

2026-10-11 /083: [LOY-310 campaign draft-save feedback](LOY-310-campaign-save-feedback-2026-10-11.md). Verified delivery-OFF actualPG/Chrome2RED→2PASS9.0s;4existing composer races/51focused/static/build/read-onlyreviewPASS;global173files1601PASS0FAIL1existingSKIP150.94s; LOCAL integrated51PASS2.77s.310Done/comment7-143/readback06:57:26UTC;127/128fullacceptanceOPEN. No deployment.

2026-10-11 /084: [LOY-311 staff invitation recovery](LOY-311-staff-invitation-recovery-2026-10-11.md). ActualChrome1baselinePASS/2genuineRED→3PASS8.0s;18focused/static/build/read-only reviewPASS;global173files1601PASS0FAIL1existingSKIP153.02s; LOCAL integrated18PASS3.77s.311Done/comment7-144/readback07:09:22UTC;153/154fullacceptanceOPEN. Non-idempotent creation/one-display token policy unchanged; no deployment or independent acceptance.

2026-10-11 /085: [LOY-312 redemption acknowledgment identity](LOY-312-redemption-ack-recovery-2026-10-11.md). Actual committed200 unreadableJSON2RED/double spend→3ChromePASS16.1s original-key duplicate/one spend/customer-cashier convergence;22focused/static/build/read-only reviewPASS;global173files1601PASS0FAIL1existingSKIP158.90s; LOCAL integrated22PASS3.61s.312Done/comment7-145/readback07:26:13UTC;49/50 fullacceptanceOPEN. Foreground/gate fixture failures retained. No deployment.
