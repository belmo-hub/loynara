# Returning-customer NFC evidence — 2026-10-09

Recommendation: **BLOCKED for launch acceptance**. The local first-to-return journey is verified and prepared for a focused physical check. Initial enrollment still creates no independently verified recovery factor; loss of both browser credentials and the private card link cannot establish ownership. Actual iPhone/Android NFC browser-context continuity and public production routing also remain unobserved. No production acceptance is claimed.

## A. Baseline and preservation

- Original checkout: `pilot/logout`, `5b8607928b92ccdd3267c9a711ae7d35e1b6139d`; untracked `docs/superpowers/` preserved. Its later logout controls already exist in the NFC candidate's newer cashier implementation. A redundant cherry-pick was cancelled, preserving the candidate files.
- Recorded production `792e218a17287009067ce0993c33eda3bfc3f4b7` is an ancestor of NFC `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec`. The local NFC branch still points to that SHA. A successful remote `ls-remote` lookup returned no matching published branch; no claim about an absent remote tip's movement is made.
- Google `621364a575c5f325b9cac01cc0a421b634a36940` is a direct descendant of NFC, with exactly two later commits (`bc641bd`, `621364a`) and 38 changed files. Integration was a fast-forward from the verified NFC candidate, preserving both implementations.
- Dedicated branch: `codex/nfc-returning-customer-v1`, managed worktree `/Users/youssefbelmokhtar/.codex/worktrees/nfc-returning-customer-v1/Loynara`. Final commit is recorded in the completion response and YouTrack comments; `git log -1` identifies this report's commit.
- Crypto, cashier confirmation/locking, staff authentication, push delivery, loyalty booking, Wallet enqueue/refresh/issuance, and migration SQL remain unchanged against Google baseline. Only the NFC cookie helpers and preview's K-number field changed within `secure-tap.ts`.
- No migration added. Existing schema through 0021 ran only on disposable loopback PostgreSQL. No deploy, production access/mutation, tag operations, provider activation or live provider calls. TAG-01 and TAG-02–05 untouched.
- Earlier NFC acceptance evidence: `docs/nfc-cashier-phone-release-review.md`; LOY-272 remains completed. Apple PassFast acceptance LOY-271 remains completed. Google's physical Android Demo save/+1/replay/−1/closure PASS is the user's supplied evidence for SHA `621364a`, issuer `3388000000023201754`; this session independently verified ancestry and synthetic adapter contracts, without repeating physical acceptance.

## B. Targeted implementation map

Paths refer to this branch; line references identify the function entry or critical operation. Status distinguishes inspected code/tests from physical/provider acceptance.

| Path | Source / behavior already present | Relevant evidence | Baseline → final status |
|---|---|---|---|
| A: NFC parse, verify, binding, replay | `src/app/api/tap/[ref]/route.ts:12` restricts `e,c` fields; `src/lib/secure-tap-crypto.ts:38` verifies SDM; `src/lib/secure-tap.ts:142` locks active tag and binds UID/program/tenant/location; `processSecureTap:177` enforces counter and dedup | NFC cashier/lifecycle/status and counter-replay tests; original first-to-return browser test | IMPLEMENTED → IMPLEMENTED |
| B: enrollment, membership, K-number | `src/lib/product.ts:149` transaction inserts random card/scan credentials and retains schema-assigned locator; `src/app/api/enroll/route.ts:8` checks remembered card; `src/components/join-client.tsx:87` uses browser Web Locks and rechecks before enrollment | returning-card integration; Chrome first enrollment creates one row; repeated requests with session return CARD_EXISTS | IMPLEMENTED → IMPLEMENTED; stale recovery handling repaired |
| C: customer session | `secure-tap.ts:19`, `returning-card.ts:8` previously stored raw bearer tokens with browser-only one-year Max-Age; no server issuance/expiry bound. Staff Better Auth is separate: `src/lib/auth.ts:13`, seven days | `customer-session.test.ts`; actual persistent Chrome process restart, expired signed cookie and cleared-cookie browser cases | PARTIAL → IMPLEMENTED for bounded remembered credentials; recovery factor remains BLOCKED |
| D: existing membership selection | `secure-tap.ts:159`/`processSecureTap:177` scope current token to verified active program/tenant/open membership; `returning-card.ts:39` resolves program-specific active card; previous card read/bind could silently replace another card | two merchants in one browser; forged/reissued/closed/corrupt cookies; actual legacy cookie paths and account switching | PARTIAL → IMPLEMENTED within existing location-specific program model |
| E: pending initiation | `src/components/tap-client.tsx:80` automatically POSTs after verified preview; `secure-tap.ts:177` resumes pending request for original membership. GET previews never initiate requests or award | browser pending continuity/reload/rapid taps; API GET creates no pending; shared POST without identity selection 409 | IMPLEMENTED → IMPLEMENTED, shared-account safety repaired |
| F: staff and notifications | `secure-tap.ts:255` authorized tenant/location pending retrieval; `confirmTapRequest:268` explicit staff approval; `src/lib/staff-push.ts:121,136,186` durable push/dispatch with session/staff checks; `src/lib/staff.ts:74` revocation | NFC cashier tests, staff-push integration/adversarial tests, real browser owner/cashier concurrency; earlier physical notification evidence retained | IMPLEMENTED → IMPLEMENTED |
| G: authoritative award | `secure-tap.ts:268` request/member locks, post-lock expiry check, fixed quantity 1; `src/lib/loyalty.ts:39,49,110` transactional ledger/balance/idempotency and Wallet enqueue | exactly two delta +1 entries for two purchases; simultaneous owner/cashier approvals; existing expiry/closure/replay tests | IMPLEMENTED → IMPLEMENTED |
| H: associated Wallet | `src/lib/wallet/issue.ts:24` membership/pass association; `enqueue.ts:16` transactionally coalesces refresh for existing pass; `refresh.ts:25` reads ledger-backed current membership and dispatches original provider identity; `scripts/worker.ts:148` leases/retries; `src/lib/outbox.ts:82` completion ownership | new NFC→Google existing object failure/retry test; PassFast 44-case contract suite; outbox/routing tests | IMPLEMENTED for code/contracts; no new physical-provider claim |
| I: recovery, shared devices, isolation | `src/lib/card-recovery.ts:22,48,60` verified email challenge, explicit membership choice, locked token rotation; `card-reissue.ts:43` staff ownership evidence; `card-lifecycle.ts:20` closure; `contact-verification.ts:44` verified contact setup; `card-contact.tsx:59` transport-gated UI | recovery integration validates original membership/ledger/scan identity and multi-tenant inbox choices; private-link browser recovery, explicit shared switching, closed/reissued credentials | PARTIAL → PARTIAL / BLOCKED: initial enrollment has no verified recovery factor |
| J: focused tests | `e2e/nfc-returning-customer.spec.ts`, `customer-session.test.ts`, returning-card integration and hybrid Wallet bridge; existing accepted tests retained | counts and commands below | IMPLEMENTED locally; physical/public routing still BLOCKED |

The exact first NFC enrollment → cashier approval → second NFC tap → original membership approval **already passed before editing** (one actual browser test). Missing pieces were server-side expiry, stale-session recovery handling and safe shared identity selection, rather than the NFC/stamp pipeline itself.

## C. Minimal changes and session policy

1. Added `src/lib/customer-session.ts`: signed program-bound envelope using the existing authentication secret and random 256-bit card bearer. The database validates current open membership on each protected operation. Browser cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS; HTTP is permitted only for loopback tests. Paths remain `/api/tap` for NFC and broaden to `/api` for returning-card checks/binding.
2. Fixed **90-day** browser AND server expiry. Taps, polling and ordinary card reads do not slide expiry. Presenting the valid private card link to the same-origin binding POST renews it. Closure/card reissue/recovery token rotation revokes old devices through existing database checks; changing the signing secret invalidates all signed sessions. This is global card-credential revocation, not a new per-device session database.
3. Candidate raw cookies lack issuance dates. A fixed compatibility deadline of **2027-01-07 00:00 UTC** bounds legacy recognition. Fresh verified tap GETs validate the active membership then upgrade these cookies; card reads/binding also migrate them. The old `/api/enroll` cookie is explicitly deleted to avoid same-name overlap. Duplicate cookie names become a stale identity, never a new enrollment invitation.
4. Added route aliases `/api/enroll/card/[token]` (existing card read) and `/api/tap/card/[token]/session` (existing bind). They expose old path-scoped credentials before replacement. Legacy ownership is preserved, even when only the old returning cookie remains. Original read API does not plant identity; older path-incompatible bind clients must explicitly confirm an uninspectable identity.
5. Stale enrollment credentials retain a recovery marker. Enrollment requires recovery or a deliberate additional-card choice; repeated valid enrollment returns CARD_EXISTS. No automatic replacement membership.
6. Opening another card does not silently switch the stored identity. Explicit account switch marks that program's device session shared; each subsequent tap displays the K-number and requires confirmation. The selection header must equal the freshly server-resolved K-number, preventing a second tab changing the account between display and POST. This header confirms choice; it does not authenticate ownership. Continuation through the private card link preserves the original NFC tap.
7. Updated cookie-dependent test fixtures and added only missing journey/session/shared-device/Wallet bridge coverage. No Wallet adapter or provider configuration changes.

No new customer authentication secret is placed in NFC URLs, localStorage or frontend logs. The session envelope never goes to page scripts. Existing private bearer card links remain an ownership credential; opening one must be intentional. NFC continuation stores only the existing secure merchant tap path in sessionStorage. Staff sessions remain unchanged. A shared phone that has never switched accounts cannot identify a different physical person automatically; cashier K-number matching and the explicit switch path remain necessary.

## D. Verification and boundaries of evidence

Local Node 26.3.0, Next 16.3.6, installed lockfile dependencies; disposable PostgreSQL 18 on loopback 54429. Browser DB `looplocal`, test DB `looplocal_test`. All NFC tags/keys, staff, memberships and Wallet transports were synthetic. All real provider enable flags were OFF in the browser server.

- Before edits: five focused files / **29 passed**; one real browser first-to-return test passed.
- New red regressions established missing server expiry, silent switching, duplicate/path-cookie migration and legacy-owner loss; corrected runs passed.
- Final focused integration/unit suite: **10 files, 113 passed, 1 optional Mailpit test skipped**. Covers customer sessions, returning-card checks, NFC cashier/lifecycle/status, staff push, verified-email recovery, PassFast and Google bridge, trusted ingress.
- Actual Chrome: **4 passed**, 1.4 minutes. One closes and relaunches the whole browser against the same on-disk profile. Others cover two merchants, shared selection race/continuation, signed server expiry, cleared credentials and actual legacy browser-cookie paths.
- TypeScript and targeted ESLint passed; Next webpack production build passed locally. No application production start/deploy occurred.
- Full suite: **142 files passed / 1 failed; 1223 tests passed / 1 failed / 1 skipped (1225 total)**, in `var/returning-full-suite-final.log`. The unchanged retention test at `src/lib/retention.integration.test.ts:120` repeatedly expects a just-checked-out card to leave the drifting set but receives its ID. It is outside this journey; no retention changes were made and no all-green full-suite claim is made. A cookie-path-dependent PassFast test fixture was corrected and its complete 44-case suite subsequently passed.
- Independent read-only reviewer found cookie overlap, shared selection race, continuation loss and legacy path invisibility. All findings have regression evidence and the final review reports no remaining actionable finding; review itself did not rerun tests.

Latest Chrome continuity evidence, read from the disposable browser DB without credentials:

```json
{"membership_id":"ed7df8af-d7ef-46ab-aa22-2e081f898bd0","k_number":"K-RRE9DH","balance":2,"membership_count":1,"request_memberships":1,"award_deltas":[1,1]}
```

| Required case | Evidence / outcome |
|---|---|
| T01 | Chrome first enrollment plus database count=1; repeated session-held POSTs rejected, existing Web Locks prevent ordinary parallel-tab enrollment. No claim of global person deduplication for independent anonymous enrollments. |
| T02–T05 | First and returning tap retain original ID/K; full browser restart; original pending membership; each approved purchase +1. |
| T06 | Reload, reuse of old URL, rapid fresh taps while pending, simultaneous staff approvals: one pending logical purchase and one award. Later fresh qualifying purchase remains possible. |
| T07–T09 | Server-expired signed cookies show recovery and reject silent enrollment; cleared/new-browser sessions offer recovery; original private link resumes original card. K-number alone is rejected. Existing verified-email challenge tests pass; live delivery optional test skipped. Complete credential/factor loss BLOCKED. |
| T10 | One real browser retains A and B; each verified merchant tap resolves only its own card. Existing tag/program/location mismatch tests retained. Programs are location-specific; this task introduces no cross-location card portability. |
| T11 | Actual shared-account switch requires explicit confirmation; fresh K-number check blocks a second-tab race; legacy old-owner identity preserved. No pending/stamp before choice. |
| T12 | Closure and reissue make old cookies stale; existing NFC lifecycle/authorization tests prevent closed/revoked awards. |
| T13 | All browser provider flags OFF; entire enrollment/return/approval journey still passes. |
| T14 | NFC Google bridge issues one original associated object, confirms original membership once, preserves committed ledger on provider failure, retries same object without duplicate pass/stamp; existing PassFast/outbox contracts pass. |
| T15 | Accepted pending retrieval, expiry after lock, concurrency, push retry and staff/session revocation retained; polling remains available when push unavailable. Earlier physical evidence not reopened. |
| T16 | Local public customer routes work without Access or customer sign-in. `src/proxy.ts:3` imposes no Access dependency on these routes. Read-only preview HEAD on 2026-10-09 redirected 302 to Cloudflare Access, confirming preview protection. Public production routing was not accessed/changed and remains unverified. |

Reproduction (synthetic values only; local guarded DB and server required):

```sh
BETTER_AUTH_SECRET=synthetic-returning-customer-secret-at-least-32 \
TEST_PG_CONTAINER=loynara-returning-test-pg TEST_PG_PORT=54429 npm test
DATABASE_URL=postgresql://looplocal:looplocal_local_only@127.0.0.1:54429/looplocal \
BETTER_AUTH_SECRET=synthetic-returning-customer-secret-at-least-32 \
E2E_NFC_VERIFY_MASTER=7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a \
E2E_AUTH_SETUP_GAP_MS=11000 npx playwright test --config=playwright.returning.config.ts e2e/nfc-returning-customer.spec.ts
npm run typecheck
npm run build -- --webpack
```

Ignored evidence logs remain in this worktree's `var/`: `returning-baseline.log`, `returning-browser-baseline.log`, red regression logs, `returning-focused-final.log`, `returning-browser-final.log`, `returning-full-suite-final.log`, `returning-typecheck.log`, `returning-lint.log`, `returning-build-final.log`. Earlier failed harness/fixture runs are diagnostics and do not count as acceptance. No secret-bearing provider or preview credentials are copied into this report.

## E. YouTrack

Reused existing feature **LOY-29**, its independent acceptance **LOY-30**, and recovery gate **LOY-34**; no duplicate issue created. Applied links: LOY-30 relates to LOY-76; LOY-260 and LOY-70 depend on LOY-30; LOY-30 depends on LOY-34. Evidence/blocker comments are recorded in the final completion response. No acceptance status advanced. LOY-271/272 remain completed. Google production publishing remains in LOY-108/110/112/114 and separate from the accepted Demo evidence.

## F–G. Remaining gates and focused next test

1. **Recovery launch blocker:** enrollment (`src/app/api/enroll/route.ts:13`, `join-client.tsx:130`) explicitly disables email and creates no verified factor. Existing contact UI requires an available transactional transport; this session did not enable or accept that provider. After all cookies AND the private link are lost, no independent identity proof exists. Never guess, accept K-number alone or claim automatic recovery. Smallest compatible remedy: accept/configure the existing verified-contact recovery transport separately, surface existing contact verification from the first-visit/card flow, verify successful setup and recovery delivery end-to-end; keep earning and Wallet optional. Customers declining that factor must retain their private link and understand that complete loss cannot be recovered automatically. This avoids introducing another identity system.
2. **Physical preview:** no tag changes needed in source. Unchanged TAG-01 can test this branch only after an authorized preview operator serves the reviewed build at its existing NFC origin and confirms the original tag/program binding and staff sessions. Current hosted preview SHA/binding was not inspected behind Access. Cookie availability is host/browser-context dependent: NDEF must open the same browser profile and origin; local Chrome restart evidence cannot prove iPhone Safari or Android NFC intent behavior.
3. **Focused requested physical check only:** on iPhone Safari and Android Chrome, first TAG-01 tap → enrollment → note ID/K → explicit cashier +1 → close/reopen browser → second TAG-01 tap → automatic original card pending → explicit cashier +1. Check no re-enrollment/Wallet opening, original ID/K/pass identity, pending/success and no extra reload award. Observe associated Wallet refresh only if already authorized and provider available; do not issue new passes or repeat full provider acceptance. Preserve previous physical cashier notifications/concurrency and Apple/Google lifecycle evidence.
4. **Provider distinction:** ledger correctness and durable queued synchronization are verified locally; adapter delivery/retry is synthetic. New observed physical Wallet refresh is not claimed. Apple acceptance remains accepted; Google Demo physical acceptance remains accepted as supplied. Google production publishing/activation still separate.
5. **Production rollout:** public routing/Access separation, approved integration/deploy, existing 0021 migration and rollout controls, TAG-02 custody/provisioning/physical production acceptance (LOY-70/260) all require separate authorization. Nothing here executes or completes them.
6. **Verification limitation:** unchanged retention assertion keeps the broad suite from all-green; report it separately for its owning workstream. This task made no unrelated repair.

**BLOCKED** for complete launch acceptance on the recovery-factor requirement and outstanding physical/public/production gates. The returning-customer code and synthetic/browser evidence are ready for the focused preview procedure once those prerequisites are handled; this is not launch readiness.
