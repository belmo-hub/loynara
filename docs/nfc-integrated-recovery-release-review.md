# Integrated NFC returning-customer recovery release review

Status: local implementation candidate; software-only production release **HOLD**. This review adds focused evidence to the completed NFC release audit rather than repeating it. No production readiness is claimed.

## Source relationship and scope

Verified ancestor chain: production `792e218a17287009067ce0993c33eda3bfc3f4b7` → accepted NFC `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec` → accepted Google Wallet Demo `621364a575c5f325b9cac01cc0a421b634a36940` (two commits) → returning-customer `8c1271f1b9842a0b158856fac081eca782ff19d0` (one commit) → this focused change on `codex/nfc-integrated-recovery-release-v1`. No merge, cherry-pick or replacement of either accepted implementation was needed.

The owner selected verified email before the first award and authorized reuse of existing contact challenges, inbox recovery and the shared ledger transaction. All new tests use synthetic loopback resources. No production deployment/migration, new production secret, TAG-02 provisioning, TAG-01 change, NFC/Wallet production activation or external provider request occurred.

## Implemented contract

- `VERIFIED_RECOVERY_BEFORE_FIRST_AWARD` is default off, preserving accepted behavior for an NFC-off software deployment. Production startup requires it true whenever NFC is true; an enabled policy requires approved existing Mailgun EU transactional configuration. Promotional email remains a separate opt-in/authorization.
- A zero-award membership must have its own tenant-scoped verified contact before a pending NFC request is created. New enrollment preserves the original tap continuation and guides the customer to the existing verification flow. Explicit staff confirmation is still the only award action.
- The shared ledger transaction checks eligibility under the membership lock, covering cashier/QR and offline synchronization. Idempotent repeats remain repeats. Email removal before confirmation blocks the first award. Previously awarded cards retain history/eligibility; balance zero after redemption or reversal does not turn them into new cards.
- Referral posting is the only other positive award insert. A positive first bonus for an unverified referrer now goes to the existing owner-review state with reason `recovery_email_required`, no bonus credited, while the verified guest’s checkout proceeds. Both snapshotted bonuses and the qualifying entry remain recorded for review; verification does not silently auto-credit a held referral. Existing owner review/rejection applies; no new approval or retry mechanism was added.
- Existing signed, host-only HttpOnly/Secure/SameSite cookies, 90-day credential lifetime, fixed legacy upgrade deadline, explicit shared-device switching, tenant/program checks and stale-credential recovery are retained from `8c1271f`.
- Inbox recovery rotates the private credential for the selected original membership without changing its K-number, scan code, balance, ledger or Wallet identity. Verification never creates marketing consent.
- Verification/recovery fragments are read once before removal from browser history, including repeated local Strict Mode effect initialization. A card focus/follow-up refresh that sees verification complete resumes the saved tap only after card binding succeeds.
- Existing Wallet outbox/projection code is unchanged. The Google bridge regression enables the new policy and verifies that one NFC confirmation updates the existing object once, preserving membership/pass identity through an adapter failure/retry.

## Focused verification

Evidence lives locally under `var/recovery-*` in this worktree; raw local browser output can contain synthetic credentials and is not a production evidence archive.

The affected 15-file regression set passed **162 tests**, with **one optional delivery test skipped**. It covers recovery/configuration, signed sessions/returning enrollment, verified contact/inbox recovery, real offline synchronization, NFC lifecycle/cashier/status, staff notification, referral behavior and the accepted Google/Apple routing bridge. It is not a repeated full release audit.

New core cases were observed failing before enforcement, and referral bypass was observed failing before the additional ledger guard. The local browser harness initially collided with an unrelated IPv6 server on port 3049; our harness moved to isolated port 3059 without stopping the other server. A compiled local attempt correctly had Mailpit unavailable because compiled production code disables local transport; it is not delivery acceptance. The synthetic full-email browser flow therefore uses Next development mode/Mailpit, with separate TypeScript, lint and build checks. This limitation does not substitute for actual approved production email transport or physical acceptance.

The focused Chrome/Mailpit browser case passed (47 seconds), including an explicit focus/follow-up refresh after verification, one cashier award, same-card return, cookie loss and verified-inbox credential recovery. This is synthetic development-mode browser evidence, not compiled production delivery or physical phone acceptance. TypeScript passed; lint had zero errors and three unchanged warnings (two service-worker catches and one existing lifecycle-test import). The final optimized Next build passed. The independent reviewer found no remaining actionable defects and confirmed both earlier findings resolved; the reviewer inspected source/tests and did not execute them.

A narrow classification run reproduced the unchanged failure at `src/lib/retention.integration.test.ts:120` (a freshly checked-out card remains in the drifting result). Retention source/test files are unchanged relative to the returning source. This remains an open release concern; no waiver or all-green full-suite claim is made.

## Migration and rollout implications

No schema, migration SQL/journal, migrator or rollback change. Production still needs only the existing `0021_staff_push_subscriptions` transition from schema `0020`/journal 21 to schema `0021`/journal 22. The seven frozen fingerprints in the rollout plan remain exact.

Software deployment stays off: NFC, Wallet providers, billing, email providers and first-award policy off. After focused launch gates and separate deployment authorization, the existing bounded backup/restore → migration → exact web/worker sequence applies to the integrated SHA.

Before later NFC activation, separately authorize/configure/accept transactional recovery email on web and worker, then enable the recovery policy on both at the integrated SHA while web NFC is off. The web’s later NFC/VAPID/key patch preserves that policy/transport. The worker does not need an NFC master. Production recovery delivery may require separately authorized transport configuration; the policy itself reuses the existing signing secret. No production secrets were created here.

Old `792e218` images cannot enforce the new policy or support new signed returning/Google Direct behavior. After policy activation, prefer the enforcing integrated images after scoped disablement. Old-image recovery requires paused new-card award paths and explicit queue/provider reconciliation, while preserving contacts, recovery/security records, ledger and Wallet rows. Do not use rollback as permission to bypass first-award verification.

## Acceptance still outstanding

1. Only changed-journey preview physical/context acceptance at TAG-01’s unchanged preview origin: first enrollment/verified inbox, pending/no premature award, explicit confirmation/+1, next physical tap with the original membership/K-number, browser continuity and recovery when cookies/private link are lost. No tag rewrite or full physical audit repetition.
2. Evidence-backed disposition of the recorded retention failure; actual candidate/public customer-route and Access separation acceptance. Generic public HEAD shells returning 200 are insufficient.
3. Separately approved production transactional email delivery/confirmation/recovery and future production rollout authorization, fresh backup/restore and base/schema agreement.
4. Future separately authorized TAG-02 custody/originality/current-key/personalization/registration and production real customer-phone → locked cashier-phone acceptance. Android NFC/locked notification, two actual cashier devices, phone-camera QR and actual device delivery latency remain gaps in the claimed cohort.
5. Technical tenant allowlist before broader merchant NFC activation. The existing sole-synthetic freeze is not that allowlist.

Completed TAG-01 preview physical acceptance and accepted Google Demo Android saving/+1/replay/−1/closure are retained. Google Wallet publishing/production activation and NFC hardware provisioning remain separate authorized workstreams. Production physical acceptance is not complete.
