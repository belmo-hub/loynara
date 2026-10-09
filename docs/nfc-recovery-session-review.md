# Recovery and session continuity continuation — 2026-10-09

**Decision: BLOCKED for focused physical acceptance sign-off pending the founder’s session-policy decision and an authorized reviewed preview with usable recovery delivery.** Local code is prepared for a focused physical test; this is not launch or production acceptance. Transaction-based renewal has not been authorized or implemented. This report continues, rather than replaces, `docs/nfc-returning-customer-review.md`.

## Baseline and exact changes

Continued `codex/nfc-returning-customer-v1` at `8c1271f1b9842a0b158856fac081eca782ff19d0` in its existing isolated managed worktree. Both NFC `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec` and Google `621364a575c5f325b9cac01cc0a421b634a36940` remain ancestors. The primary `pilot/logout` checkout and its untracked work were preserved. Final SHA is this document’s commit (`git log -1`) and recorded in YouTrack and the completion response.

| Change | Source reference | Reason |
|---|---|---|
| Offer existing verified-email setup on the NFC pending/success screen, after enrollment and pending initiation | `src/components/tap-client.tsx:101,118`; `src/components/card-contact.tsx:9,60` | Customers previously had to discover the card page to establish recovery. Reuses the existing contact API; earning is unaffected. |
| Optional setup/defer/resume, explicit complete-loss warning, mobile layout; no marketing controls in the NFC setup panel | `card-contact.tsx:61–72`; `src/app/globals.css` `.card-contact-local .button` | Keeps first award simple and contact verification separate from marketing consent. Full-card marketing/preferences remain available separately. |
| Correct enrollment guidance | `src/components/join-client.tsx` contact note; `src/app/api/enroll/route.ts:13` | Initial enrollment remains minimum necessary; verified recovery is offered afterwards when the existing transport is available. |
| Capture/scrub fragments under strict effects and later same-tab links; guard asynchronous responses by capture generation | `src/app/verify-email/page.tsx:12–39`; `src/app/recover/confirm/page.tsx:12–54` | Real delivered-link browser testing uncovered lost fragments. Review uncovered stale responses replacing a newer challenge. GET still cannot consume proof or rotate a card. |
| Preserve issuance and shared-device flags when automatic binding repairs cookies | `src/app/api/card/[token]/tap-session/route.ts:32–48`; `src/lib/customer-session.ts:17–37` | Refresh previously restarted 90 days. Both valid matching cookies now produce no Set-Cookie; repair reconciles the oldest valid same-card issuance and retains any shared flag. Server signing validates the supplied original timestamp. |
| Signed-session issuance removed from card GET; legacy-owner migration preserved | `src/app/api/card/[token]/route.ts:14`; same-origin binding POST unchanged | GET cannot inspect tap-path cookies and must not issue a fresh envelope when the subsequent bind fails. Fresh private-link recognition still uses existing POST binding. |
| Configurable loopback-only Mailpit capture origin; default remains port 8026 | `src/lib/email.ts:73`; `src/lib/email-isolated-transport.test.ts` | Runs actual existing transport on isolated port 18149 without interfering with another inbox or contacting external recipients. Malformed/external/HTTPS origins are rejected; existing production transport gates are unchanged. |
| Focused regressions | `src/lib/customer-session.test.ts`; `src/app/api/enroll/returning-card.integration.test.ts`; `e2e/nfc-recovery-contact.spec.ts`; `e2e/email-link-fragment.spec.ts` | Day-table, refresh repair/shared flag, real worker delivery and complete recovery, later links and delayed-response races. |

No migration, session database, NFC cryptography, hardware/key change, cashier locking/award rewrite, staff-auth change, Wallet adapter rewrite, provider activation or production email configuration. Apple PassFast and direct Google Demo implementations/previous physical acceptance remain preserved.

## Recovery experience and protections

Enrollment creates the existing single membership and immediately initiates the cashier request. A mobile “Karte sichern” panel then offers optional email verification. “Später” keeps earning available and explains that losing both browser access and the private link without a verified recovery address cannot establish ownership. The panel can be reopened; the full card retains the existing setup/removal controls. When delivery is unavailable the panel reports that fact and the private-link requirement; it never pretends recovery is available.

The existing backend was reused unchanged: `src/lib/contact-verification.ts:44` creates a 30-minute verification challenge; `src/lib/card-recovery.ts:22,48,60` uses a 20-minute recovery challenge, verified contacts only, explicit card selection, locked one-time consumption and original-member token rotation. Known/unknown requests have the same generic response. Destination and peer limits restrict attempts; a new recovery challenge invalidates its predecessor. A K-number alone or a merchant-selected arbitrary membership cannot establish ownership. Recovery never enrolls another membership. Expiry, removed contact, closure, tampering and concurrent challenge use are rejected.

An actual browser uses the delivered fragment link, explicitly verifies the address, clears its cookies, requests recovery, and selects the original card. A second device with no existing browser credentials also supplies the delivered proof and explicitly selects among two merchant cards for the same inbox. Rotation preserves original membership ID, K-number, scan identity, balance, rewards/history and associated Wallet row/object. The old card link and remembered credentials become invalid through existing database validation. Marketing consent remains absent. Original-browser/shared-device controls remain covered by accepted NFC browser tests.

**Delivery evidence:** the real outbox worker sent synthetic `.test` verification, recovery and security-notice messages through the existing Mailpit HTTP adapter into a dedicated `axllent/mailpit:v1.27` inbox on loopback port 18149, with no relay configured. The browser obtained the actual captured message bodies and used their links; this was not mocked delivery. All external sender and Wallet flags were OFF. This proves isolated capture and browser redemption, not external inbox delivery acceptance, preview-device email delivery or production sender acceptance. Controlled-response tests separately exercise frontend races and do not count as delivery evidence.

**Founder trade-off:** optional verified contact is preserved. It permits fast earning and informed refusal, but customers who decline must retain their private link; complete factor loss remains unrecoverable without another independently checked existing recovery method. Mandatory verification before earning would reduce that loss risk while adding friction and making first award dependent on email availability. No mandatory enrollment requirement was silently introduced.

## Session lifetime: actual policy and pending proposal

Current policy remains fixed **90 days from server issuance**, with server and browser expiry. It has no sliding activity renewal. A valid independent private-card link via same-origin binding or successful verified-contact recovery can restore expired access under the existing policy; ordinary NFC taps, status polling and valid-session page refreshes do not extend it. Cookie repair preserves the original deadline, even when only the original tap-path cookie remains. Card GET no longer bootstraps signed credentials, so a throttled/failed binding POST cannot leave a freshly issued broad credential behind. Matching signed cookies are reused; reconciliation signs the same bounded issuance/shared policy. Fresh independent binding signs a new envelope. Closure/reissue/recovery revoke old credentials globally through the existing membership token checks; this is not per-device revocation or a new session store. Legacy raw cookies still have the unchanged fixed 2027-01-07 UTC cutoff.

| Return day after issuance | Original fixed credential |
|---|---|
| 1 | Recognized |
| 30 | Recognized |
| 60 | Recognized |
| 85 | Recognized |
| 95 | Expired; recovery required |

A customer with qualifying transactions on days 1, 30, 60 and 85 still loses automatic NFC recognition on day 95 solely because the original credential expires. Ledger activity does not affect credential validation. The exact day table and a day-60 GET → bind → day-95 expiry regression pass. Shared flag preservation and the unchanged merchant-specific scope are tested.

A founder decision was requested before any materially different policy. Two precise options:

1. **Retain fixed 90 days:** no transaction renewal, explicit recovery after expiry. The least security-policy change; regular purchasers still encounter expiry.
2. **Approve 90-day inactivity / 365-day absolute lifetime:** a signed envelope would retain the original authentication timestamp and bounded renewal timestamp, using the existing signing secret and membership revocation checks. Only a fresh, foreground verified NFC POST could rotate it, supported by a previously committed qualifying award; the eligible award timestamp would determine the activity deadline. Polling, GETs, resumed/replayed URL requests and refreshes could not renew it. Absolute expiry would force independent proof even for active customers. Legacy/v1 upgrade would preserve original issuance, shared flags and scope. No new session database is proposed; older envelopes remain valid only until their own deadlines, so rotation must not be described as per-device revocation.

Option 2 increases the potential authenticated lifetime from 90 to 365 days and requires explicit founder authorization. **No answer received; it is a proposal, not implemented or accepted.** Renewal/hard-expiry acceptance for that proposed policy is therefore pending, not represented by the fixed-policy tests.

## Verification

Environment: Node 26.3.0, Next 16.3.6, lockfile dependencies; disposable PostgreSQL 18 at loopback 54429, browser database `looplocal`, Vitest database `looplocal_test`; real Chrome at a 375px viewport for recovery. Synthetic tags, contacts, staff and passes only. Next’s installed route-handler/cookie documentation was consulted.

- Final focused suite: **14 files / 142 passed / 1 skipped**. The legacy optional Mailpit smoke expects port 8026 and was not enabled; the new actual worker/capture/browser journey at 18149 passed separately. Includes all 44 existing PassFast integration tests plus the existing NFC→Google original-object retry bridge.
- Final real Chrome: **7 passed**, 2.0 minutes. Four accepted NFC scenarios (whole-browser process restart, two merchants/shared switching, server expiry/private-link recovery, legacy cookie paths), one actual delivered-email recovery journey, and two controlled-response fragment-race regressions.
- TypeScript and targeted ESLint passed. Local Next webpack production build passed (compilation and prerendering); no production start or deploy was executed.
- A combined-browser diagnostic run hit `recovery_request_peer` after repeated test runs (13 hits against the unchanged 12/hour bucket). Only the isolated fixture’s hashed peer reset list was extended to include recovery buckets; production limits were not changed. The final seven-case run passed.

Latest synthetic browser readback (IDs and pass identity only; no credentials):

```json
{
  "membership_id": "2bdc7612-e2ba-4e76-9fe1-02f6a028cd65",
  "k_number": "K-JNJD6B",
  "balance": 2,
  "memberships": 1,
  "request_memberships": 1,
  "award_deltas": [
    1,
    1
  ],
  "existing_passes": [
    {
      "id": "84cbd341-afa8-497c-ba79-9df1c984124b",
      "provider": "apple",
      "provider_object_id": "passfast:synthetic_recovery_84cbd341-afa8-497c-ba79-9df1c984124b",
      "revoked_at": null
    }
  ]
}
```

The delivered-email browser scenario checks original-ID/K continuity, unchanged rewards/activity/scan identity, two merchant choices, old-link invalidation, wrong-card/K-only/challenge-replay refusal, destination throttling, no duplicate enrollment, absent marketing consent, exactly two +1 awards across two purchases with concurrent cashier approvals, and unchanged associated pass identity. The PassFast reissue fixture now exercises read → binding POST rather than expecting read-time cookie issuance; provider implementation is unchanged. Existing Google bridge/PassFast contract tests verify original-provider dispatch, ledger-first correctness and idempotent retry; no new physical Wallet refresh or provider delivery is claimed.

Red evidence established missing NFC recovery panel, lost initial/later fragments, stale async responses and refresh/cookie-repair lifetime extension before their corresponding green runs. Independent read-only review’s two findings were fixed with regressions; final targeted review found no remaining actionable defect. Its optional delayed-rotation race case is guarded in source but has no separate browser regression.

Logs in ignored `var/`: `recovery-browser-final.log`, `recovery-focused-final.log`, `recovery-typecheck-final.log`, `recovery-lint-final.log`, `recovery-build-final.log`; dedicated red/green diagnostic logs; retention comparison logs below. No broad new audit or repeated physical provider acceptance.

## Retention failure classification

**CONFIRMED PRE-EXISTING under equivalent conditions.** The same focused `src/lib/retention.integration.test.ts` was run sequentially at Google parent `621364a575c5f325b9cac01cc0a421b634a36940` and untouched returning commit `8c1271f1b9842a0b158856fac081eca782ff19d0`, with the same installed dependencies, Node, local PostgreSQL/container/database and synthetic environment. Both yielded **4 passed / 1 failed** at line 120: expected an empty drifting set after checkout, received the membership ID. Relevant retention source/test files have no diff between the commits. This establishes pre-existence, not its root cause or environmental independence. No retention fix/refactor was made.

Command for each checkout: `BETTER_AUTH_SECRET=synthetic-returning-customer-secret-at-least-32 BETTER_AUTH_URL=http://localhost:3049 PUBLIC_BASE_URL=http://localhost:3049 TEST_PG_CONTAINER=loynara-returning-test-pg TEST_PG_PORT=54429 npm test src/lib/retention.integration.test.ts`. Logs: `var/recovery-retention-parent.log`, `var/recovery-retention-8c1271f.log`. Existing owning acceptance issue LOY-164 / feature LOY-163 received the comparison evidence. The previous broad-suite failure is not reclassified as a new regression or claimed fixed. A new full-suite rerun was not required to isolate this assertion.

## YouTrack and remaining focused physical requirements

Existing LOY-29/30/34/76 reused; final-SHA evidence comments recorded in the completion response. LOY-164 received the actual pre-existing failure classification. No duplicate issue, closed acceptance reopened or physical/production gate advanced. Existing links from LOY-30 to LOY-34/76 and production LOY-70/260 dependencies remain intact.

Before physical sign-off: founder session-policy decision; an authorized operator serves the reviewed build at unchanged TAG-01 origin/binding with protected preview and a separately approved non-production recovery delivery path usable from the phones. No preview deployment was performed here. Mailpit’s guarded loopback-only local mode is not an external HTTPS preview sender and must not be advertised as one. Production sender activation/secrets remain separate.

Focused iPhone Safari / Android Chrome check only: first TAG-01 tap → enroll → note ID/K → optional contact setup and actual delivered verification → cashier +1 → close/reopen same browser → returning tap resolves original card → cashier +1. Then clear cookies/use another device → delivered recovery proof → explicitly select original merchant card → fresh tap/approval preserves original ID/K/pass and adds one stamp. Check declined setup warning, two merchant choices/shared-device selection, no refresh/replay award, actual NFC browser/profile/origin cookie continuity and visible expiry/failure. Do not repeat accepted cashier notification/concurrency or full Apple/Google Wallet campaigns; do not reprogram/provision any tag.

Apple physical acceptance and Google Android Demo save/+1/replay/−1/closure acceptance remain accepted as prior evidence. Google production publishing, production routing/Access separation, approved rollout/migration/flags and TAG-02 production acceptance remain separate gates. No production/provider/tag operations authorized or performed.
