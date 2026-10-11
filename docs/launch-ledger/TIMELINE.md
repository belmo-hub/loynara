# Development evidence timeline

Append chronological events; retain historical records. Git author timestamps below are source timestamps, not independently verified execution timestamps. Historical agent/model and usage categories remain unknown unless their linked record establishes them. No entry implies deployment or acceptance.

| Git date | Result SHA | Evidence | Local event |
| --- | --- | --- | --- |
| 2026-10-10T14:09:14+02:00 | `1cf32d3b3a91780002773e900fabe64d11e9e7bc` | [LOY-133-reward-reminders-2026-10-10.md](LOY-133-reward-reminders-2026-10-10.md) | feat(automations): add consent-safe catalogue reward reminders |
| 2026-10-10T14:34:05+02:00 | `76821a310567a6084bb75bf766c7e64e106a848d` | [LOY-139-webhook-normalization-2026-10-10.md](LOY-139-webhook-normalization-2026-10-10.md) | fix(email): normalize authenticated Mailgun failure events |
| 2026-10-10T14:56:22+02:00 | `fb73e0798cc042ffdfda8c0760352535471b1269` | [LOY-145-setup-validation-2026-10-10.md](LOY-145-setup-validation-2026-10-10.md) | fix: validate merchant setup review before onboarding |
| 2026-10-10T15:17:08+02:00 | `75e07514c78b54e887d14a0bab5d0beb793c8734` | [LOY-119-verified-referral-duplicates-2026-10-10.md](LOY-119-verified-referral-duplicates-2026-10-10.md) | fix: hold duplicate verified referral identities for review |
| 2026-10-10T15:23:23+02:00 | `1c2345367a8b2fa9fce7293790d1a163b799f2ac` | [2026-10-10-integrated-test-configuration.md](2026-10-10-integrated-test-configuration.md) | docs: record configured integration failure classification |
| 2026-10-10T15:33:50+02:00 | `667aafbe107aa0c2e54c88c220da50d19800ebd8` | [LOY-153-invitation-serialization-2026-10-10.md](LOY-153-invitation-serialization-2026-10-10.md) | fix(staff): serialize invitation role assignment per account |
| 2026-10-10T15:42:54+02:00 | `3156a4039c44bdb08ce67273a1057cb1d73f25a0` | [LOY-157-checkout-revocation-ordering-2026-10-10.md](LOY-157-checkout-revocation-ordering-2026-10-10.md) | fix(loyalty): order checkout commits against staff revocation |
| 2026-10-10T15:57:45+02:00 | `d733234b4d8637760efe34176153b002e60c36bc` | [2026-10-10-full-configured-integration.md](2026-10-10-full-configured-integration.md) | docs: record configured full integration results |
| 2026-10-10T16:09:45+02:00 | `154821c14630566f0462cee5506a8088cd3758ac` | [LOY-127-campaign-audience-validation-2026-10-10.md](LOY-127-campaign-audience-validation-2026-10-10.md) | fix: validate campaign audiences before preview and save |
| 2026-10-10T16:17:18+02:00 | `2c73a11ca693d43fdc087ff4fa9df32d0cf53247` | [LOY-127-draft-save-race-2026-10-10.md](LOY-127-draft-save-race-2026-10-10.md) | fix: acknowledge only submitted campaign draft revisions |
| 2026-10-10T16:24:54+02:00 | `aae6dcc6f4428e6058651382011d8b9b29da3ce7` | [LOY-125-preview-ordering-2026-10-10.md](LOY-125-preview-ordering-2026-10-10.md) | fix: discard superseded campaign audience previews |
| 2026-10-10T16:40:19+02:00 | `95e97934d52a53d2e67543d37b84344ab567636a` | [LOY-49-redemption-catalogue-ordering-2026-10-10.md](LOY-49-redemption-catalogue-ordering-2026-10-10.md) | fix: serialize selected reward booking with catalogue changes |
| 2026-10-10T16:53:32+02:00 | `9552b3773e6df8581127b230abb0535150e6fa50` | [LOY-49-purchase-rule-snapshot-2026-10-10.md](LOY-49-purchase-rule-snapshot-2026-10-10.md) | test(loyalty): characterize purchase rule snapshot concurrency |
| 2026-10-10T16:59:09+02:00 | `e03dc685e9330cd2ce099c116b705232e1ff1006` | [2026-10-10-current-integrated-regression.md](2026-10-10-current-integrated-regression.md) | docs(launch): record current integrated compatibility results |
| 2026-10-10T17:12:55+02:00 | `7e5da56d8de0a157dfb0242c494161c43cc6e9a3` | [2026-10-10-recovery-mailpit-capture.md](2026-10-10-recovery-mailpit-capture.md) | docs(recovery): record real local Mailpit capture verification |
| 2026-10-10T17:28:59+02:00 | `cd38bdcdcb72135e236fd533ad5c921712347246` | [LOY-43-customer-export-snapshot-2026-10-10.md](LOY-43-customer-export-snapshot-2026-10-10.md) | fix: export customer activity from one database snapshot |

Current documentation task: [permanent-record requirement](2026-10-10-permanent-build-launch-record.md), resulting commit is its containing commit until a later index records its exact SHA. Earlier history remains an explicit reconstruction gap; preserve Git and source documents.

2026-10-10: [LOY-165 bounded evidence](LOY-165-reporting-evidence-2026-10-10.md), base5a58f247; result is its containing commit. Four existing analytics fixtures PASS; no runtime discrepancy reproduced; staff/location breakdown and export scope gaps remain open.

2026-10-10 exact post-commit references: permanent ledger requirement5a58f247fa84e3c9e47e944b11b9c13483b7a7a0; LOY165 evidence9085a2b22366d4944d3a233f75ab167ec5badfb2. [Remaining-work checkpoint](2026-10-10-remaining-work-checkpoint.md) preserves cached all-lane inventory and human actions without a repeated audit; result is its containing commit.

2026-10-10 [owner-export characterization](LOY-165-owner-export-characterization-2026-10-10.md), base38e3990; one corrected temporary fixture and final1PASS, no tracked test/source changes.


2026-10-10 amendment: [Founder-authorized continuation, local integration and tracker reconciliation](2026-10-10-founder-continuation.md). Historical internal resource hold superseded by direct founder instruction; cumulative accounting preserved. Latest sourcea71d782 local suite1416PASS/0FAIL/1existingSKIP. No deployment, remote push, independent acceptance or scope completion. LOY-133 real-PG race remains open.


2026-10-10: [LOY-43 redemption/reversal export snapshot coverage](LOY-43-redemption-export-snapshot-2026-10-10.md) adds two durable real-PG cases; actual fixed source passes, read-committed control fails. No application/policy change or external acceptance. LOY-133 dispatch cutoff queued for founder decision; independent engineering continues.


2026-10-10: [LOY-273 campaign audience pagination](LOY-273-campaign-audience-pages-2026-10-10.md), related125/129: realPG499/500/501/1001 boundaries and interruption/replay; finalglobal153files1422PASS/0FAIL/1existingSKIP, build/type/lintPASS. Sending quotas retained. FirstWallet-hook timeout preserved with current/base9PASS comparisons. No deployment/provider acceptance or fullscope completion.

2026-10-10: TESTED LOY-157 saved audience cursor after real staff departure/reassignment,15focusedPASS; negativeguardcontrol1expectedFAIL,source restored; build/type/lintPASS. [Entry](LOY-157-audience-cursor-lifecycle-2026-10-10.md). Referral contract gap preserved; no deployment/acceptance.

2026-10-10: TESTED LOY-157 real credential-change/old-session/fresh-login cashier authorization;14focusedPASS, no app defect; type/lint/buildPASS. [Entry](LOY-157-credential-session-authorization-2026-10-10.md). Reset-email and independent acceptance remain open.

2026-10-10: IMPLEMENTED/TESTED LOY274staffactivity,existingownerledgercountingrule/UI. REDabsentreport→15focusedPASS; final154file1425PASS0FAIL1existingconditionalSKIP; type/lint/buildPASS. [Entry and prior157receipts](LOY-274-staff-activity-reporting-2026-10-10.md). No deployment/acceptance.

2026-10-10: IMPLEMENTED/TESTED LOY-275 transaction-location owner activity; RED two missing-report cases →20 focused PASS. Final154files1427PASS0FAIL1existingMailpitSKIP; type/lint/defaultbuild PASS. Staff and aggregate compatibility retained. [Entry](LOY-275-location-activity-reporting-2026-10-10.md).

2026-10-10: IMPLEMENTED/TESTED LOY-276 analytics read-only repeatable snapshot; deterministic concurrent award REDbusiness1breakdown2 →22focusedPASS; final154files1429PASS0FAIL1existingSKIP; type/lint/build PASS. [Entry](LOY-276-analytics-snapshot-2026-10-10.md).

2026-10-10: IMPLEMENTED/TESTED LOY-277 hard email suppression/delivery terminal guards;RED5→129focusedPASS; global154files1436PASS0FAIL1existingSKIP; type/lint/buildPASS. Independent reviewtestcleanup findings corrected. [Entry](LOY-277-hard-suppression-2026-10-10.md).

2026-10-10: LOY139 event-day collision RED1 at UTCmidnight, nofix. Legacyhashed rowslackgenerationtimestamp; compatibility checkpoint/conditionalproviderdiagnostic queued. [Checkpoint](LOY-139-event-day-compatibility-2026-10-10.md).


2026-10-10: IMPLEMENTED/TESTED LOY-278 owner format4 export snapshot; actual balance2/ledger5 RED →27focusedPASS; failure cleanup and 50,000/50,001 boundary preserved. [Entry](LOY-278-owner-export-snapshot-2026-10-10.md).


2026-10-10 TESTED LOY139 actual signed route failed-PG rollback/retry/idempotency; authorizedfallback165 concurrent redemption/reversal owner exports, negativecontrol2expectedFAIL. Four durable regressions, noappdefect. [Entry](LOY-139-retry-and-owner-export-regressions-2026-10-10.md).


2026-10-10 TESTED campaign stalecancel/reschedule claim races and exact30/90UTC referral lifecycle boundaries, focused5files77PASS; negativeguardcontrol2expectedFAIL; noappdefect. [Entry](LOY-129-schedule-and-referral-boundaries-2026-10-10.md).


2026-10-10 IMPLEMENTED/TESTED LOY279 cashier Web Push registration-generation fence; actual-worker stale404/403/201 RED3, eight races plus existing focused20PASS. [Entry](LOY-279-push-registration-fence-2026-10-10.md).


2026-10-10 assignment041:161 inactive-entitlement policy undefined; executed33fallback, two real-PG closure-vs-recovery/reissue regressions pass on unchanged app. [Entry](LOY-161-policy-and-closure-ordering-2026-10-10.md).


2026-10-10 IMPLEMENTED/TESTED LOY280 staff reissue versus completed departure authorization ordering; actual authenticated RED2→focused28PASS1existingSKIP, identity-before-role lock pattern. [Entry](LOY-280-reissue-revocation-ordering-2026-10-10.md).


2026-10-10 TESTED LOY85 actual-worker final retry, expired fourth/fifth lease and tap expiry; four new regressions, negative limit control2expectedFAIL, finalfocused33PASS, no app defect. [Entry](LOY-85-worker-retry-boundaries-2026-10-10.md).


2026-10-10 TESTED LOY43 actual query-failure rollback for closure/contact/queues/Wallet and export client reuse; finalfocused27PASS1existingSKIP, no app/policy change. [Entry](LOY-43-privacy-failure-atomicity-2026-10-10.md).


2026-10-10 TESTED LOY153 real authenticated invitation/revocation HTTP permission matrices, focused4files15PASS; no appfix or159policy. [Entry](LOY-153-authenticated-http-permissions-2026-10-10.md).


2026-10-11 IMPLEMENTED/TESTED [LOY-281 deferral lease fence](LOY-281-deferral-lease-fence-2026-10-11.md): actual expired campaign worker rescheduled/refunded its claim on base; post-lock expiry fence and lease_lost handling, four durable real-PG/actual-process regressions. Exact final integration and suite receipt in entry.


2026-10-11 [LOY-282 claim generation](LOY-282-claim-generation-2026-10-11.md): IMPLEMENTED/TESTED real-worker lost-deferral-ack ABA correction, separate per-claim UUID; populated additive0024 migration and61focusedPASS.


2026-10-11 IMPLEMENTED/TESTED [LOY-283 enrollment contrast](LOY-283-enrollment-brand-contrast-2026-10-11.md): owner-persisted light colour was white-on-white; existing contrast rule reused with actual mobile-width first/returning browser regression.


2026-10-11 IMPLEMENTED/TESTED [LOY-284 campaign report snapshot](LOY-284-campaign-report-snapshot-2026-10-11.md): real delivery committed between reads, summary/outcome contradicted; one read-only snapshot preserves report consistency and fresh next read.


2026-10-11 IMPLEMENTED/TESTED [LOY-285 manual refresh feedback](LOY-285-manual-card-refresh-feedback-2026-10-11.md): valid request-observed browserRED for silently failed customer GET; localized last-known-balance alert/recovery, mobile+desktop2PASS.


2026-10-11 LOY-286: actual CLI503/network falselyPASS RED -> required heartbeat acknowledgment. No remote monitor contacted.


2026-10-11 LOY-287: connect/query rawstderr syntheticsecretRED -> fixed safecategories/controlled refusal diagnostics; no actual secret exposure asserted.


2026-10-11 LOY-288:3validRED connect/query/nested syntheticstderrleaks -> shared allowlisted diagnostics/private refusal; no actual migration executed.


2026-10-11 LOY-177 assignment057 stalled after real401 browserRED; two fixture approaches and bounded shared-identity redesign hit actual signup limit. Not integrated/accepted. [Evidence](LOY-177-cashier-session-feedback-stalled-2026-10-11.md).


2026-10-11 LOY-289: assignment059 resumed preserved057 after verified naturalcooldown; realbrowser4PASS, finalfull1506PASS/0FAIL/1existingSKIP. Localintegration receipt pending. [Evidence](LOY-289-cashier-session-feedback-2026-10-11.md).


2026-10-11 IMPLEMENTED/TESTED [LOY-290 atomic local backup publication](LOY-290-atomic-local-backup-2026-10-11.md): three actual publication races reproduced; six real synthetic dump/list/restore regressions pass; final full suite 1,512 PASS. Earlier Wallet hook timeout and clean base comparison preserved.


2026-10-11 IMPLEMENTED/TESTED [LOY-291 preview backup publication](LOY-291-preview-backup-publication-2026-10-11.md): four real unchanged-source race failures; shared publication helper correction; 24 focused and 1,520 global tests PASS.


2026-10-11 [Assignment062 push safety and recovery retry](2026-10-11-push-safety-062.md): live GitHub/Railway/Cloudflare read-only triggers narrowed; Supabase signed-out integration prevents safe-push proof. One actual recovery database-abort regression passes existing source; no product defect fabricated.

- 2026-10-11 — [LOY-292 customer export failure feedback](LOY-292-customer-export-feedback-2026-10-11.md), assignment063: actual revoked-card404 browserRED, checked HTTP/complete JSON downloads,8browserPASS375/1280,13unitPASS,163files1534globalPASS1existingoptionalSKIP; parent43/44/209 OPEN. Native Goal fresh ACTIVE7,368,879tokens/37,317s supersedes historical paused observation without reset.

- 2026-10-11 /063 receipt: LOY-292 source0629c6f locally integrated,13focusedPASS; comment7-118/readback01:55:57UTC verified codingDone. Parent43/44/209 OPEN; no remote/launch acceptance.

- 2026-10-11 assignment064: read-only44-worktree preservation manifest18.37GiB;31 conditional cleanup candidates11.11GiB,10KEEP,3investigation,0automaticallysafe. No cleanup/push. GitHub Supabase Configure blocked at owner reauthentication. [Evidence](2026-10-11-worktree-preservation-064.md).

- 2026-10-11 Delegated064-01: exact31 worktrees removed without force after private archive/hash checks; every branch and retained13 raw status unchanged. Net disk6.704GiB,30→37GiB; archives28files7,982B. [Receipt](2026-10-11-worktree-cleanup-064-01.md).

- 2026-10-11 /065 [LOY-293 recovery request feedback](LOY-293-recovery-request-feedback-2026-10-11.md): actualHTTP400 browserRED; fixed German failure feedback/retained retry,6browser+9unitPASS; type/lint/normalbuildPASS; configuredglobal and integration receipts recorded in entry. Parent33/34 OPEN.

- /065 receipt: LOY-293 c13eb1ac5f12a957bcb6a22c68c525ffae4e52af locally integrated;9focusedPASS,comment7-121/readback02:34:45UTC verified codingDone. Parent33/34 unresolved; no push/deployment/independent acceptance.

- 2026-10-11 /066 [LOY-294 recovery confirmation uncertainty](LOY-294-recovery-confirm-feedback-2026-10-11.md): actualHTTP500/challenge-preserved RED, fixed invalid-proof vs temporary/ambiguous feedback;12real browser+18helperPASS, static/normalbuild/reviewPASS. Final global and integration receipts in entry; parent33/34 OPEN.

- /066 receipt: LOY-294 source56cb97ad2a409402b08e8111aa49a4bff10b71dc locally integrated;18focusedPASS;comment7-122/readback02:48:51UTC verified codingDone. Parent33/34 unresolved; GmailreceiptUNVERIFIED.

- 2026-10-11 /067 [LOY-295 campaign detail freshness](LOY-295-campaign-outcome-feedback-2026-10-11.md): actualGET500/stale-panel RED; clear previous detail at read start, explicit loading/error/retry and abandoned-response guard. Verification/integration receipt in entry;167/168 OPEN.
