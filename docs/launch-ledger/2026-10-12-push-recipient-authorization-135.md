# LOY-330 / Assignment135 — Push recipient authorization at send boundary

2026-10-12 Europe/Berlin. Base338230bca3eeb06f49e8dea8e54379b99997b03f → proposed application43b54d2edbf5059d662ffa4aeb50ae6cced72ee9. Existing reviewed deployment pin519e1569195c20a01c8b55c3877dfc0ab0ca3463 is preserved; a separate reviewed source alignment is required before selecting the new application for release. Local integration/GitHub/tracker completion have later exact receipts, not advance claims.

LiveLOY85 requires bounded retry, notification expiry, failure recovery and revoked-session/merchant authorization. Existing claim fences, registration generation and accepted retry/lease matrices were excluded from discovery. New gap confirmed within7.42minutes: actual PostgreSQL recipient selection completes, then the supported owner revokeStaff operation commits before transport through the renewal boundary; unchanged source still calls fake transport once. Genuine deterministicRED1, no actualprovider call. Narrow child330createdafterduplicate search; parent85/86remainOPEN. Fallback197was read but not executed once primary produced the concrete gap.

## Minimum correction and exact guarantee

src/lib/staff-push.ts adds one fresh SELECT per selected recipient immediately before transport. It binds the exact registration generation to the request's tenant/location, current active staff permission, corresponding live session and existing last-success retry eligibility. Invalidated registrations are skipped. Existing request expiry/lease checks and late-registration-result fences remain unchanged. No database locks cross provider I/O; no schema, TTL, identity, programme or dispatch policy changed.

This corrects revocation/session expiry committed before the final authorization read. It does not cancel a send already in flight or guarantee cancellation of revocation after that read. Generic wake-ups contain no customer data and grant no cashier authorization; authoritative award checks remain independent.

## Actual verification

4focusedfiles36PASS0FAIL7.69seconds. Durable realPG cases: owner revocation before send, expiry after selection, valid own device despite unrelated merchant revocation, and explicit supported owner reinvitation/acceptance restoring the same staff role followed by exactly one wake-up/replay no-op. Membership balances, pending request and loyalty ledger remain unchanged; revoked audit is recorded once. Existing push/role/outbox compatibility cases also pass.

New installed-Chrome coverage375/1280:2PASS0FAIL6.1seconds. Actual authenticated owner staff UI commits revoke through API inside the selected-recipient boundary; UI showsGesperrt, fake transport0, revokedcashier actualaward403, exactly1audit and own/foreign balances/ledger unchanged. These browser tests prove local authorization ordering, not provider or hardware acceptance. Disposable browser database and ownedcompiledloopbackserver were removed after0activeDBconnections; existingnativePG/Docker/otherDB/worktrees preserved. No realcredentials/privatekeys/customers/providercalls.

Typegeneration/typecheck/zero-warning changedfilelint/productionbuild/diffPASS. Finalconfiguredglobal184files1706PASS0FAIL1existingoptionalMailpitSKIP238.14seconds. Existing independent readonlyreviewer found no materialfindings insource/tests and then newbrowserextension; no tests/services/sensitiveartifacts accessed. Same effective executor/reviewer retained where model switching unavailable; no newagent/worktree/install/modelupgrade.

Traceable failures: first expandedtest SQL quotingerror was corrected without weakening assertions. Initialglobal underNODE_ENVdevelopment had7billingfixtureFAIL/1699PASS; identical unchangedbase hadsame7FAIL. RequiredNODE_ENVtest unchangedbase10PASS; finalfullsuite1706PASS. Nobilling/securitysource or testguards changed. Basebilling ended03:40:47.15 and fullcorrected began03:40:50, so DB tests did not overlap. Browserprecreationpsql quotingprobe failed, but createdb itself succeeded and would refuse anyexistingDB; subsequentempty-schemainitialization confirms noexistingDBwasreused. ExistingNode/Vite/Nextdevelopment-runtimewarnings recorded; no production-runtime experiment.

## Preserved prior receipts and scope

132operator4609ebc/integrationGitHub338230b verified normalnonforcepush,85integratedPASS61.38seconds/typecheck,329Done7-213/7-214readback and completeGPT132acceptance;0newRailwaydeployments/GitHubactionschecksdeployments observed. Fullgate28OPEN.

133corrected a coordinatorissue mismatch: live143ismerchantprovisioning/recovery, not customerWallet. No new143/153gap established; no source/test/push or falseacceptance.134live33/34 customerlifecycle and173reporting selections found no newgap; existing retired-card404 cleanup, UTCwindows/labels and stale-response guards were inspected, acceptedtestsnotrepeated. No restatement-onlycommits; native sanitized outcomes and completecoordinatorreviews retained. These are bounded findings, not proof of completecoding or fullfeatureacceptance.

IMPLEMENTED / TESTED / technically REVIEWED. Not deployed, independently production accepted or commercially ready. Separate reviewedpin alignment and all livewriter/drain/freshpostdrainrecovery/independentacceptance/cutover/ops/hosted/provider/physical/legal/fullscope gates remain. Single actual-backup authorization exhausted. OriginalGoal01a125a6-7124-70f1-a0f7-8b6f83d9a191 and accounting preserved; freshmetrics in durable completion receipt, granularinput/cache/outputunmeasured. No production operation, hostedconfiguration, protectedbranch, actualpushnotification, key or backup access.
