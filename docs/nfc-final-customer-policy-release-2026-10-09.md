# Final NFC customer policy reconciliation — 9 October 2026

**HOLD for preview cutover.** The integrated software is prepared locally; hosted preview remains the older accepted Google Demo runtime. Actual controlled-inbox recovery, intended phone profiles/Access authorization and rollback custody must pass before requesting explicit founder authorization for the exact frozen SHA. This is not production readiness or physical acceptance.

## Source and reconciliation

Final branch: `codex/nfc-final-customer-policy-v1`. Freeze the merge commit carrying this document; its full SHA/build fingerprint and verification status are recorded in the primary workspace's `var/nfc-integrated-physical-preview-20261009/final-policy-release-manifest.json`.

Verified common ancestor is `8c1271f1b9842a0b158856fac081eca782ff19d0`. Merge parents are `2b4fef7362a73909db58addab5eea9c740b9af0b` (documentation child of integrated `9c344082e4c7d026636b51c0b97ef2efa42c2566`) and parallel optional recovery `89f1837a249dc369a33aecccffd477ef7029cf77`. Neither candidate is an ancestor of the other. Both descend from accepted NFC `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec`, Google Demo `621364a575c5f325b9cac01cc0a421b634a36940`, and production baseline `792e218a17287009067ce0993c33eda3bfc3f4b7`.

Conflicts were reviewed by file. Retained the parallel implementation's optional recovery UI, strong fragment-generation handling, email transport isolation, membership continuity and explicit shared-device behavior. The obsolete mandatory-first-award helper/config/test paths were intentionally removed under the founder's new instruction. Existing cashier ledger/idempotency, Apple PassFast/direct Google and migration files are preserved; provider product code is unchanged relative to the optional-recovery parent. Added session activity renewal and explicit private-link reauthentication. Historical mandatory-policy and physical/provider review documents remain evidence, not current instructions.

## Exact customer contract

A first-time NFC customer opens the enrollment link, accepts terms, and creates the card. **No email or email verification is required for the first or later authorized stamp.** For a fresh tap, those are three application actions (create-card link, terms checkbox, create button); OS NFC launch and any normal Cloudflare authentication are separate. One cashier approval books one award. Wallet installation/opening is optional and never a prerequisite.

Recovery is offered after enrollment. Customers may select “Später” and continue earning; clear guidance explains that losing both the private link and remembered browser credentials without a verified address prevents proof of ownership. K-number alone cannot recover a card. Recovery setup adds entering an address, sending the link, opening the inbox link and explicitly confirming it. Verification does not grant marketing consent. Marketing remains a separate explicit preference and is off during acceptance.

Enrollment is already persistent before verification: cookies, card and pending cashier request survive delayed mail, leaving/returning to the browser or verifying in another browser. Missing mail leaves the contact unverified and recovery unavailable; it does not block earning or recreate enrollment. Request another link when transport is working; verification challenges expire after 30 minutes and recovery challenges after 20 minutes, with replay/expiry validation. Declining setup does not silently change this policy. Hosted email unavailability is surfaced with private-link guidance.

## Exact session contract

Signed v2 credentials expire at the earlier of **last eligible activity + 90 days** or **original authenticated issuance + 365 days**, rejecting the exact boundary. HTTP-only, Secure on HTTPS, SameSite=Lax and program-scoped signing/cookies remain. Cookie Max-Age is bounded by both deadlines. Duplicate ambiguous cookies fail closed. Closure or credential rotation revokes access through the existing database validation; account switches retain shared-device selection and each NFC visit requires explicit selection there.

Only a customer-origin POST for a foreground fresh NFC navigation (or explicit shared-device selection), authenticated with a valid signed customer credential, can renew activity. The server must accept a fresh dynamic counter and create a new staff-confirmed pending request for a membership with an existing unreversed staff award in the same merchant. Renewal preserves the oldest matching issuance anchor and shared flag across the two cookie scopes. It does not itself award a stamp and need not await a cashier cookie response. The customer's own POST response sets the renewed credentials before cashier approval; route and real browser tests prove this.

NFC GET, card GET/automatic binding/refresh, reload/back navigation, passive polling, replay, reused pending request, background visits and unqualified/no-prior-award requests do not renew. Binding repairs missing cookie scopes only with the original deadlines; it never mints a fresh automatic lifetime. In-flight renewal rechecks expiry after the transaction.

Regular qualifying visits less than 90 days apart keep the customer recognized after day 90, **until day 365 from the original authentication**. At day 365, automatic recognition/renewal stops regardless of activity. At either expiry, a saved private card link requires an explicit “Mit meinem privaten Kartenlink anmelden” action to start a new authenticated session family; another stored card requires a separate account switch. Independently verified email recovery restores the original membership and rotated private credential, followed by that explicit customer-browser action. Temporary binding failure keeps the recovered link available and offers a visible retry/switch path.

The 365-day cap limits the signed session family; it is not a maximum lifetime or revocation rule for an independently retained private card bearer. Explicit private-link authentication or verified recovery creates a new family. Previously issued copies retain their own signed deadlines until existing global token revocation/closure; renewal is not per-device revocation.

Existing signed v1 credentials keep their original issue date as last activity and original deadlines; there is no automatic issue-date reset. Untimestamped raw legacy credentials are compatibility-only until the fixed `2027-01-07T00:00:00Z` deadline and are never automatically converted into a new 90/365-day lifetime. Afterwards explicit private-link proof or recovery is needed. The migration window is fixed, not 90 days after each deployment.

## Verification and evidence boundaries

- Complete unit run: **145 files passed, 1,244 tests passed, one optional test skipped** (1,245 total). This is an observed isolated run, not a guarantee that intermittent LOY-164 is resolved.
- Focused policy/provider regression run: 85 tests passed. The new route coverage exercises exactly 90/365 days, timestamp validation, own-response renewal, replay/passive/no-history refusal, shared scope disagreement, original ID/K-number and Wallet-row preservation.
- **Eight local Chromium browser tests passed**: first no-email enrollment/authorized award; restart/return/one later award; optional recovery setup/decline; delivered local email verification and cleared/new-browser recovery; merchant/shared-device isolation; expired/legacy private-link authentication; stale email fragments; own-browser renewal/refresh invariance. Review defects were reproduced before fixes, including binding503→authenticate409→switch503→retry200 and failed binding after credential rotation.
- Recovery/verification replay and expired challenge coverage is preserved. The local worker delivered into an isolated unrelayed Mailpit inbox; the browser consumed actual captured message links. This is not external inbox or hosted HTTPS delivery.
- Typecheck passed. Final lint/build results are recorded in the release manifest. Three pre-existing lint warnings remain; no added warning is retained.
- Browser suite took approximately 2.3 minutes; the first/return case took 23.3 seconds and recovery case 38.0 seconds including synthetic fixture setup. These are automation durations, not measured physical customer onboarding time. Human/phone onboarding elapsed time is still unmeasured.

Local PostgreSQL 18 and Node 26.3.0 use disposable loopback databases; providers are disabled and Wallet tests use stored synthetic associations/mocked adapters. No production data, production credentials or provider quota are used. Existing Wallet IDs/object associations survive returning/recovery; queued updates remain linked and are not a claim of live provider delivery. The original hosted K-PKRVXT still has no Wallet row, and the closed historical Google Demo member must remain closed.

LOY-164: earlier equivalent parent/candidate runs preserved the same line-120 retention failure (4 pass/1 fail); later equivalent integrated/parent runs passed 5/5. Current complete run passed it, and five additional sequential runs each passed 5/5 under the same local environment. **Classification: pre-existing intermittent/flaky, sensitive to runtime/environment timing; precise trigger unproven.** Cross-runtime JS/Postgres `now` handling is a hypothesis, not an established root cause. No retention refactor or waiver. Preserve all failures as well as passes; do not call the broad suite permanently all-green.

## Preview and release prerequisites

Read-only preview snapshot at 19:31:28 UTC associates clean source `621364a` and running build `7-wXdWlfeBkkiXMPR-_3B`. Anonymous Cloudflare Access redirect is intact; full policy/session configuration and intended Safari/Android Chrome profiles remain unverified. Saved isolated owner/cashier sessions are authorized; a saved old customer credential is invalid. TAG-01 origin and merchant/program binding are unchanged, counter floor19, original member K-PKRVXT balance7/ledger sum7.

Preview schema0021/journal22 already matches the final migration requirements; **no additional migration**. Production's previously audited0020→0021 transition is unchanged and is not performed. The existing rollout plan is reconciled to optional onboarding and session renewal; its old mandatory activation/rollback instructions are superseded without rerunning the audit. Technical tenant allowlist remains required before broader NFC activation.

Email is the principal failed preview prerequisite: no approved non-production hosted transport/inbox custody. Local Mailpit cannot serve as the compiled HTTPS transport. Also verify restricted Access/phone identities, an authorized active synthetic Wallet fixture with provider sending off, and the retained healthy old web rollback target (disk build mismatch prevents assuming cold restart). Then obtain explicit founder authorization for the exact manifest SHA/configuration.

See `docs/nfc-final-customer-policy-preview-deployment-2026-10-09.md` for precise cutover prerequisites, rollback procedure and minimum manual Safari/Android Chrome/inbox recovery checklist. No cutover is executed. Previous iPhone/Android Brave physical, cashier notifications, concurrency, QR, Apple PassFast and Google Demo evidence is retained. New policy/session code has no physical Safari or Android Chrome acceptance. Preview acceptance never substitutes for production acceptance.

## Tracking and decision

Append sanitized reconciliation evidence to LOY-29, LOY-30, LOY-34, LOY-76 and LOY-164 after freezing the SHA; receipts belong in the release evidence folder. Keep earlier mandatory-policy and physical comments as history and explicitly supersede their policy, not their observed evidence.

LOY-70 and LOY-260 remain blocked by their production software/custody/backup/deployment and TAG-02/physical gates. Production email, NFC/hardware provisioning, Wallet activation and Google publishing remain separately authorized workstreams. No new production secrets, deployments/migrations, hardware changes or hosted-preview changes occurred.

**Recommendation: HOLD preview cutover.** Complete the failed mail/Access/phone/rollback prerequisites first, then request explicit founder authorization for this exact SHA. Software preparation is not evidence of production readiness.
