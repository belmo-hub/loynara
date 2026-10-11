# LOY-163 / LOY-155 — retention contract and location report scope

2026-10-11 / LOY-ENG-20261011-093. Base `3b4b794026e08d9c2bb24a6e69bd22603bbc2454` → test/local integration `5275022f328495e6b32c282d95a024e64335c16a`. Final evidence receipt SHA is recorded after local integration.

The primary bounded requirement matrix found existing implementations rather than a documented missing metric:

| Required outcome | Existing implementation | Evidence limit |
| --- | --- | --- |
| Owner overview, visits, returning cards | Overview/PeriodMetrics, analytics page and getMerchantAnalytics; distinct qualifying unreversed staff requests, participating/repeat cards, UTC30/90 windows, countingRule | Source observed; complete independent acceptance unverified |
| Inactivity intervals and segmentation | getRetentionSummary/retentionPredicate, recent/drifting/never and reward states; last qualifying unreversed checkout; existing14/30/60/90 controls and customer filters | Source observed; no new threshold or cohort policy |
| Truthful current/window/zero/error display | Analytics explicitly separates current retention from its selected reporting window; existing zero/error states and noncausal explanations | No new UI/browser acceptance claim |

No explicitly specified absent metric with an approved definition was established. The customer session90-day expiry was not reused as inactivity policy. The coordinator-authorized fallback was used once; no third engineering investigation.

Only `src/lib/location-http-scope.integration.test.ts` was added. Actual BetterAuth sign-in cookies and authenticated GET route handlers use the owned PostgreSQL test database. Legitimate fixtures create two merchants, two sibling locations, and manager/cashier assignments through invitations. New tests verify that a manager cannot widen customer list/detail/retention scope through sibling/foreign location IDs or a forged owner-selection cookie. Owners retain authorized visibility across both own locations; foreign detail is denied. Cashier reports return403, anonymous reports401. No ledger, outbox or balance/closure effect occurs. This adds report-path evidence beyond existing location-selection and financial mutation coverage; it does not repeat those accepted journeys as new evidence.

Validation: initial16focusedPASS3.29s; final16PASS3.46s; integrated16PASS3.26s. Type generation, typecheck, changed-test zero-warning lint, production build and diff check pass. Initial typecheck failed on two fixture contracts: widened locale and an extra email property not accepted by invite acceptance. Literal typing and the actual supported signature were corrected without changing assertions. One read-only independent sensitive static review found no material issue; reviewer did not rerun tests. Owner foreign denial covers detail only, while manager foreign denial covers allthree report paths. No production defect or genuine RED was established.

No application source changed, so the full suite was not repeated. Historical092 appsource `6fc9cf097defb0ba40a3c1ffbc505538f093ec24` has174files1616PASS/0FAIL/1existingoptionalMailpitSKIP159.20s; this is not presented as a new093run. No UI behavior changed or new browser verification is claimed. Expired/revoked role cases and production/operator acceptance remain outside this new evidence.

YouTrack155 now InReview/LocalImplementation/AutomatedTestsVerified, comment7-155/readback09:10:44UTC.163 receives bounded source-matrix comment7-156/readback09:11:06UTC and remains Backlog/Missing/unresolved.163164155156 full criteria remain OPEN. No fake coding child or Done transition. Existing154 founder queue now references related156 scope acceptance;164 independent metric reconciliation has an exact queued reviewer action. Both are notified through the verified tracker comments. No new Gmail receipt claim.

Mac/one existing isolated engineer, assignedSolMedium contract/Highengineering/Mediumreview; effective switch unavailable and executor retained. Effective model, input/cache/output/browser/reviewer usage unmeasured. NativeGoal ACTIVE12,055,304 cumulative reportedtokens/63,552seconds/remainingnull, no reset.43GiBfree/13registered retained trees; no new tree, dependencies, browser database or cleanup. Exact affected test path has no concurrent overlap; Desktop status remainsUNKNOWN from earlier bounded stalls.

IMPLEMENTED tests / TESTED / LOCAL INTEGRATED; no production fix, PUSHED, DEPLOYED, INDEPENDENTLY ACCEPTED or COMMERCIALLY READY. FrozenNFC32b27ec3, e1aae658/9848e759 ancestry, migration0024, branches, archives and existing policy holds preserved. Remote push185186 remains parked. No hosted/provider/customer/tag/legal action.

Next live candidates:165 reporting/export completeness,135 consent/unsubscribe correctness within the133 hold,151 approved technical support/onboarding handoff. Their gaps are not presumed. [Sanitized evidence JSON and log hashes](LOY-163-155-scope-verification-2026-10-11-evidence.json).
