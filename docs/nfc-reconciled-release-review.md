# NFC recovery and remembered-device release reconciliation

Date: 2026-10-09. Scope: reconcile the two supplied recovery branches and selected session policy only. No general audit, hosted preview mutation, production access/deployment/migration, tag/key operation or live Wallet/email provider request occurred.

## Baseline and selective integration

- Supplied integrated `9c344082e4c7d026636b51c0b97ef2efa42c2566` and parallel `89f1837a249dc369a33aecccffd477ef7029cf77` are siblings, both directly from `8c1271f1b9842a0b158856fac081eca782ff19d0`.
- Their exact file-level comparison is 36 files, 474 insertions / 423 deletions. Principal conflict: integrated mandatory first-award verification/config guards versus parallel optional post-enrollment recovery.
- Integrated branch had advanced to `2b4fef7362a73909db58addab5eea9c740b9af0b`, a documentation-only rollout-plan child. This was preserved as the candidate parent. Dedicated attached worktree/branch: `codex/nfc-reconciled-release-v1`. Final full SHA is recorded in the completion report and LOY-29/30/34/76 comments; freeze it before any separately authorized cutover.
- Primary checkout `pilot/logout` and its untracked preview packets were untouched. Existing integrated and parallel worktrees were not reset, overwritten or merged.
- Verified ancestry: production `792e218a17287009067ce0993c33eda3bfc3f4b7` → NFC `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec` → direct Google Demo `621364a575c5f325b9cac01cc0a421b634a36940` → returning `8c1271f` → integrated `9c34408` → documentation `2b4fef7` → this reconciliation.
- No migration, schema journal, production migrator or 0021 rollback artifact changed relative to accepted NFC. No new session store/dependency.

Selected from `89f1837`: optional mobile recovery-only panel/defer/loss warning; safe same-tab email-fragment handling; signed-cookie read/bind separation; isolated loopback capture configuration and tests; Wallet test updates for signed sessions. Existing integrated enrollment continuation, mandatory-mode hooks, ledger/referral guards and recovery tests remain. Entire parallel backend was not copied. Original production Wallet adapters are unchanged.

## First-stamp onboarding

Selected release default/configuration is `VERIFIED_RECOVERY_BEFORE_FIRST_AWARD=false`. First enrollment creates the existing membership/session and resumes the pending cashier workflow immediately. Email verification is optional and does not block a qualifying first stamp. Wallet installation is optional. NFC pending/success view offers recovery setup, with a mobile email form and “Später” / resume opportunity.

If setup is declined or unavailable, the UI explicitly instructs the customer to preserve the private card link. Loss of both browser credentials and that link without a verified recovery factor cannot establish ownership; a K-number is insufficient. Recovery failure never creates a replacement membership. Recovery email does not grant marketing consent; promotional controls stay separate and are hidden from the NFC recovery-only panel.

Legacy mandatory mode remains an explicit opt-in with its existing guards/tests and approved-transport requirement. It is not the selected release policy. The obsolete production rule requiring it whenever NFC is enabled was removed; production flags/secrets themselves were not modified.

## Session policy and customer/cashier separation

HMAC-signed v2 credentials carry immutable `issued`, authenticated `lastActivity`, `shared` and a random rotation nonce. Server read/issue validation independently rejects inactivity of **90 days or more** and root age of **365 days or more**. Cookie Max-Age is the smaller remaining limit, host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. Plain HTTP is allowed only for loopback test hosts.

Selected meaningful event: a current authenticated customer performs a same-origin POST with a fresh cryptographically verified NFC counter and the server commits a **new pending cashier request**. That response rotates both cookie envelopes in that customer browser, preserving the earliest signed root and shared protection. A newly committed automatic award in the existing optional automatic mode uses the same event flag. The flag is server-internal and is stripped from JSON.

This is a verified visit initiation, not proof of payment: a later-cancelled pending visit still counts as activity. Cashier approval remains mandatory in the accepted staff-confirmed mode and controls the award. Cashier HTTP responses cannot write customer cookies, and no polling bridge is used. GETs, previews, card reads, passive/status polling, page refresh, counter replay, pending-request resume, failed/missing identity and unselected shared-device requests cannot advance activity. Card binding repairs missing/inconsistent envelopes using the earliest root, newest already-authenticated activity and conservative shared flag; it does not renew deadlines.

Regular meaningful visits on days 1/30/60/85/95 retain the original root and avoid the old day-90 cliff. Inactivity still expires 90 days after the final qualifying event. Even activity on day 350 cannot pass day 365; browser tests verify a 15-day remaining cookie near that cap. Sensitive recovery/reissue remains independently verified through existing ownership mechanisms.

At inactivity/absolute expiry or complete credential loss, automatic private-card-page binding returns `DEVICE_CONFIRMATION_REQUIRED`. A deliberate confirmation with the original private bearer link, or successful single-use verified-email recovery, may establish a fresh root. Refresh alone cannot do so. Rebinding an unknown/stale identity retains conservative shared selection.

v1 keeps its signed original issuance timestamp and fixed 90-day inactivity until a qualifying fresh visit upgrades it. Raw candidate cookies retain their existing 2027-01-07 cutoff for passive format migration, with a fixed conservative root of 2026-10-09; a fresh authenticated verified visit can upgrade to the bounded v2 policy. No raw cookie is accepted after the cutoff. Cookie nonce rotation does not individually revoke older signed envelopes without a session store: they remain bounded by their signed deadlines/root and current membership credential. Closure or card credential rotation still invalidates every old device through server membership checks.

## Verified email recovery

Existing contact verification (30-minute challenge) and recovery (20-minute single-use challenge), destination/peer/token limits, generic responses, explicit account selection and card-token rotation are reused. The recovered membership ID, K-number, scan identity, balance, rewards/activity and existing Wallet association stay intact; old private card links stop working.

Modern confirmation uses `/api/tap/recover/confirm`, an alias of the same existing handler, so the actual browser sends both `/api/tap` and `/api` customer scopes. This preserves tap-only shared protection. The old `/api/recover/confirm` endpoint remains compatible but conservatively marks recovered bindings shared because it cannot inspect the narrow scope. Successful explicit verified recovery alone issues fresh cookies; list, failed/foreign selection and consumed/replayed challenges do not. New/cleared devices still require delivered inbox proof; K-number/email text alone never authorizes rotation.

Actual delivery evidence uses the existing transactional outbox worker and approved isolated Mailpit v1.27 HTTP capture on 127.0.0.1:18149, PostgreSQL 18 loopback 54429 and synthetic `.test` recipients. It verifies captured messages, follows real verification/recovery links and exercises new-device/two-merchant recovery in Chromium. This is real isolated transport acceptance, not an actual external inbox, production sender, physical-phone or provider-delivery claim. Production email and external providers stayed disabled.

## Focused source evidence

| Path | Reconciled behavior / preserved contract | Evidence |
|---|---|---|
| `src/components/join-client.tsx:131`; `src/components/card-contact.tsx:73`; `src/components/tap-client.tsx:126` | Optional setup, warning/private-link guidance, first request before verification, separate consent | Real recovery browser, first-enrollment browser, recovery-first-award opt-in tests |
| `src/lib/customer-session.ts:19,28,36,58` | Independently enforced bounds, nonce/signature, HTTPS cookie attributes | customer-session / customer-session-renewal tests; browser cap/expiry case |
| `src/app/api/card/[token]/route.ts:16`; `tap-session/route.ts:27` | Reads never bootstrap signed identity; repair cannot extend life; explicit expired/new-device binding | returning-card integration + browser cleared/expired and legacy cases |
| `src/app/api/tap/[ref]/route.ts:19,50`; `src/lib/secure-tap.ts:221` | Effective shared/root selection; only fresh committed creation renews; crypto/counter/ledger unchanged | route session-renewal, replay/cashier/lifecycle tests; real customer/cashier browser case |
| `src/app/api/recover/confirm/route.ts:20`; `src/app/api/tap/recover/confirm/route.ts:2` | Existing verified proof, explicit selection, same membership rotation, both cookie scopes | Recovery integration includes tap-only shared regression; real Mailpit browser |
| `src/app/recover/confirm/page.tsx:35`; `src/app/verify-email/page.tsx` | Safe email-fragment changes and stale response suppression | two browser race cases |
| `src/lib/email.ts:74` | Explicit isolated loopback capture only | isolated transport guard unit tests + actual worker/capture browser |
| Existing `loyalty.ts`, `referrals.ts`, `staff-push.ts`, Wallet adapters | Preserved transaction, isolation, staff revocation/concurrency, delivery retry, membership/pass identity | focused NFC/push/PassFast/direct Google/hybrid/replay/enqueue tests |

## Verification

Local environment: Node 26.3.0, installed lockfile unchanged, Next 16.3.6 bundled cookie/route-handler guides read; isolated PostgreSQL 18, synthetic derived NFC fixture, Chromium persistent profiles, Mailpit capture. No physical tag access or live provider quota.

- Initial focused set: **21 files, 172 pass / 1 optional legacy Mailpit smoke skip**. Includes both selected optional and legacy mandatory policy, recovery, request renewal, expiry, replay, cashier concurrency/revocation, notifications, PassFast and Google direct/hybrid/retry contracts.
- Final additions: tap-only shared recovery regressions reproduce the finding before the fix and pass afterward. Final suite: **21 files, 174 passed / 1 optional legacy smoke skip** (`var/reconciled-final-focused.log`, exit 0).
- Browser set: **8 pass**, including first→restart→return with same ID/K-number, distinct logical purchases and no replay award; two merchants/shared switch; cleared/expired private-link recovery; legacy paths; real isolated delivery across devices/two merchants; two email-fragment races; independent inactivity/absolute boundaries and customer/cashier cookie separation. Final recovery-alias subset rerun after the scope fix: **3 passed**, including actual capture delivery, tap-only shared protection and both fragment races (`var/reconciled-final-browser.log`, exit 0).
- Final typecheck and optimized build passed (exit 0; `var/reconciled-final-typecheck.log`, `var/reconciled-final-build.log`). Lint passed with zero errors / three pre-existing warnings (`var/reconciled-final-lint.log`). `git diff --check` passes.
- Assertions reconcile the same original membership ID and K-number, balance 0→1→2 with exactly two +1 entries for distinct purchases, no extra membership, unchanged rewards/history and existing Apple synthetic pass association. Adapter tests target existing Apple/Google object identity and queue idempotency; they do not claim physical Wallet refresh.

Final real browser recovery fixture readback: original membership `6fee8863-1878-4b38-98de-079ac1f1b984`, `K-3C83FJ`, balance 2, exactly two +1 award rows/sum 2, one unchanged active synthetic Apple pass association. Browser assertions prove the same ID/K-number before and after recovery and zero extra card creation. Readback: `var/reconciled-sanitized-continuity.log`.

Logs are retained under ignored `var/reconciled-*` in this candidate worktree. No all-green full-suite claim.

## Retention disposition

`src/lib/retention.integration.test.ts:120` is unchanged. Original equivalent Google-parent `621364a` and untouched returning `8c1271f` runs both gave 4 pass / 1 fail at the same assertion: **confirmed pre-existing under those conditions**. Later integrated candidate/direct-parent 5/5 results show environment/timing sensitivity; cross-clock cutoff remains a hypothesis, not a proven root cause. Existing LOY-164 owns the unresolved Must Launch analytics/owner-overview acceptance; no unrelated repair or waiver. Local customer-journey success does not close that independent launch gate.

## Readiness and remaining gates

Local candidate: **READY FOR FOCUSED PHYSICAL ACCEPTANCE**. No remaining code-level defect was found by the independent focused reviewer after the mixed-cookie and recovery-scope fixes. Physical preview: NOT ACCEPTED. Production: HOLD / NOT READY.

Hosted preview was not inspected or mutated here. Last saved preflight states it served the earlier Google Demo build, not this reconciled candidate, and anonymous HTTPS was Access-gated. Prior 9c34408 deployment/manual packets are historical and must be revised to the final reconciled SHA and optional policy before a separately authorized cutover. Public customer routes need real intended iPhone Safari / Android Chrome NFC browser-context acceptance while preview protection remains intact; changing Access policy is outside this task.

Only focused TAG-01 acceptance remains: authorized exact-SHA preview cutover at the unchanged tag origin; first enrollment/first cashier-approved stamp before verification; optional verified recovery setup/decline warning; restart/return to original ID/K-number and +1; loss of credentials/private link followed by controlled actual-inbox proof and original-card recovery; shared/two-merchant selection; wallet association continuity with sending paused where needed. Record device/browser, SHA, timestamps and sanitized ledger/queue evidence. Do not repeat completed notification/concurrency/Apple PassFast/Google Android Demo physical acceptance or reprogram TAG-01. Long session boundaries are locally accelerated server tests, not a claim of 365 days of physical observation.

Preview cutover and real controlled inbox transport/profile authorization remain absent. Production separately requires accepted LOY-30/34/76, LOY-164 disposition, appropriate rollout/backup/migration/custody/TAG-02/VAPID gates, technical tenant allowlisting before broad activation, production recovery transport approval and separate Google publishing/activation. LOY-70/260 stay open; LOY-271/272 and accepted Wallet evidence are not reopened.

Updated release plan: `docs/superpowers/plans/2026-10-09-nfc-production-tag-02-rollout.md`. Plan remains on hold and authorizes no deployment.
