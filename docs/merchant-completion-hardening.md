# Merchant completion — independent hardening review

Candidate branch `product/merchant-completion`. Reviewed 2026-10-04 (start 15:15Z, end ≈19:30Z, with a pause for a usage limit).
Reviewer: Claude (Sonnet 5.5). No push, no deployment, no production access, no real e-mail, Wallet or NFC hardware.
Everything ran on the isolated stack (Postgres `loynara-product-pg` on 54391, Mailpit, dev/compiled Next on 3000/3020).

## 1. Starting and final state

| | SHA |
|---|---|
| Start | `b7b9298e687051557ca14185b5614f7fae7fe30e` |
| Base | `70ecc72349f213f45ead25e6889ab55222fb95aa` (`feature/nfc-v1`), which contains pilot RC `65f32fdbf58b2775bdd6b3ad5e2a0783508a93ae` (both verified ancestors) |
| Official release | `railway-rc` = `5c580be9b1887327cc456e672d2f25f29fc25830` (untouched) |
| Final code | `3f0a450fc6e93b67dc6fb7e82e4fd4041ac7e7af`; the branch head is one documentation-only commit above it (`git log -1`) |

## 2. Card locator (replaces sequential card numbers)

Owner decision applied: short manual lookup yes, predictable `K-0001` no. Migration 0019 was not deployed, so it was rewritten
in place (`0019_card_locators.sql`; the sequential `next_card_number` counter and trigger are gone).

* **Shape.** `K-XXXXXX`: six symbols from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols; no I, L, O, 0, 1). About 29.7 bits.
* **Generation.** In the database (`card_locator_candidate()`), from `gen_random_uuid()` bytes with rejection sampling, so all 31 symbols
  are equally likely (tested over 20 000 draws, every symbol within 6σ). No secret, name, time or counter is encoded.
* **Uniqueness and collisions.** `UNIQUE(tenant_id, card_locator)`. The insert trigger takes a per-tenant advisory lock until commit,
  draws, checks, redraws up to 100 times, then fails loudly. The unique constraint is the last guard. Tested with a scripted generator:
  forced collisions retry, two tenants may share a value, exhaustion errors instead of duplicating, 25 concurrent enrolments are distinct.
* **Immutable.** `BEFORE UPDATE OF card_locator` rejects any change; explicit values on insert are rejected; a `CHECK` enforces the alphabet
  and length even if triggers are bypassed (tested by disabling the trigger). Closed cards keep their locator and it is never reissued.
* **Backfill.** Existing cards (closed included) get random locators in `created_at` order, indexed lookup during the backfill
  (the unique constraint is added before the nullable column is filled, then `NOT NULL` + `CHECK`).
* **Lookup.** Tenant-scoped index; the staff member's tenant is taken from their own role, never from the input.
  Input is normalised (`k-7qx2ma`, `K 7QX2MA`, `7QX2MA`); look-alikes (0 O 1 I L), wrong length, SQL-looking text are `INVALID_CODE`
  before any query. Misses at another location or tenant are indistinguishable `NOT_FOUND`.
* **Locator, not authentication.** A typed locator first returns a **preview** only: locator, programme name, month of issue.
  No balance, rewards, internal id or offline lease. The cashier then opens the card (`confirm=1`), sees a "per Kartennummer geöffnet,
  ohne Scan" warning before any redemption. A scanned QR (`sc_…`) opens directly. Every step still needs an active staff role at that location.
* **Brute force.** Not made impossible, only bounded: existing per-user (120/15 min) and per-peer (300/15 min) lookup limits. For a tenant with
  5 000 cards the chance that one blind guess hits a card is about 5.6e-6; a determined, authenticated cashier at the maximum rate would
  expect roughly one hit every two weeks, and a hit reveals the programme name and issue month, then (after "Karte öffnen") a balance the
  cashier can already see by scanning. No CAPTCHA or new infrastructure was added, as instructed.
* **Tests.** `card-locator.test.ts` (parsing), `card-locator.integration.test.ts` (14 tests: shape, randomness, generator bias, concurrency,
  collisions, exhaustion, closed cards, DB guards, index, preview/open, tenant/location/revoked isolation, malformed input,
  700 sequential/legacy guesses resolve nothing, merchant search).

## 3. Correction invariants

The UI calls only `POST /api/transactions/reverse` (asserted by a browser test that records every POST: exactly one call with
`locationId, entryId, reason, idempotencyKey`). `corrections.integration.test.ts` (6 tests) verifies:

* compensating entry: `kind=reversal`, `source=staff_correction`, `reversalOfId`, actor, reason; the original row is byte-identical afterwards,
  and `UPDATE`/`DELETE` on the ledger are rejected by the append-only trigger;
* balance equals the ledger sum; member detail, visit count and analytics (`qualifyingCheckouts`, issued units, **redemptions**) reconcile;
* redemption reversal restores the balance, keeps the `redemptions` row as a record, and withdraws it from counts;
* a reversed award that qualified a referral takes the referral to `reversed`, and every balance still equals its ledger;
* same idempotency key is a safe retry; a second correction with another key is `ALREADY_REVERSED`; a key cannot be recycled for another
  entry; a correction cannot itself be corrected; six concurrent corrections book exactly one;
* reason required (empty, blanks, `<10`, `>240` rejected); cashier, revoked staff, manager of another location, user without a role,
  other tenant's owner are refused; wrong location is `NOT_FOUND`.

**Fix made.** Authorisation now happens before any data lookup in the correction and reissue routes: a cashier posting an unknown id used to
get 404 and now gets 403 (`merchant-counter-recovery.spec.ts`).

## 4. Reissue

Owner/manager only (manager only at their own location), reason required, explicit entitlement confirmation, verification method recorded.

**Final merchant wording** (dialog legend + paragraph + checkbox, verbatim as approved):

> **Berechtigung geprüft**
>
> Stelle die Karte nur neu aus, wenn du geprüft hast, dass die Person zu dieser Karte gehört. Der bisherige Kartenlink und QR-Code werden
> sofort ungültig. Guthaben, Kartennummer und Verlauf bleiben erhalten.

Followed by "Wie hast du geprüft?" with exactly three choices: *Vorhandener Kartenlink* (`card_link`), *Hinterlegter Kontakt*
(`stored_contact`), *Andere nachvollziehbare Prüfung* (`other_check`), and a hint that "Loynara prüft die Person nicht selbst". No
identity document is requested. The submit button stays disabled until reason (≥10), method and the checkbox are all set; the API
requires `entitlementConfirmed: true`, a known method and a key.

Invariants, each in `card-reissue.integration.test.ts` (8 tests):

* same membership, same locator, same balance, ledger rows identical, no second membership, no new spendable balance;
* not a visit and not a purchase: analytics unchanged; a pending referral stays `pending` and still qualifies once on the next real checkout;
* old link, old QR, old scan code stop working; new ones work;
* **revocation of obsolete bindings (a gap found in review, fixed):** the Apple pass web-service token depended only on the membership id, so
  a pass left on a lost phone would still authenticate and, after the refresh, receive the new QR code. The token is now bound to the
  current scan code (`applePassToken(membershipId, scanCode, config)`), and reissue deletes the card's Apple registrations (devices that hold
  other cards keep them). An NFC cookie holding the old card token no longer resolves. Google Wallet objects live in the customer's Google
  account and cannot be revoked from here (launch ledger O-026);
* audit: `card_security_events` row with actor, time, reason, method, retry key; the table is now **append-only** (trigger) and the method is
  `CHECK`-constrained; the owner export carries these rows and no tokens;
* retry: same key + same actor returns the current link (`duplicate: true`) and rotates once, also under 6 simultaneous requests; different
  keys are separate decisions (last wins, all earlier links dead); a key cannot be replayed by another actor, for another card, or after a later reissue.

*Compatibility note.* Apple pass tokens change with this build. No pass has been issued in production (Wallet is disabled), so nothing installed is broken;
any fixture/preview passes must be re-added.

## 5. Invite-gated staff sign-up

Public registration stays **off**. Account creation is admitted only when **all** hold: `STAFF_INVITE_SIGNUP_ENABLED=true`, a pending,
unexpired, unrevoked, unconsumed invitation, the exact invited address (case-insensitive), and the invitation's secret token in `x-loynara-invite`.
Verified (`invite-signup.integration.test.ts`, 8 tests + browser journey with registration closed):

* default off; only the literal `true` enables; malformed tokens / non-string emails never match; only a SHA-256 hash of the token is stored
  and the raw token appears in no table;
* wrong address, wrong token, revoked, expired, already accepted: all `403`; a second sign-up for the same address fails (`email` unique);
* exactly the invited role and location are assigned; audit shows `invite_accepted`;
* four simultaneous acceptances: one succeeds, three get `INVITE_USED`;
* an existing account can accept only if its address matches and it has no other active role (`INVITE_EMAIL_MISMATCH`, `ALREADY_ASSIGNED`);
* revoked/expired invitations cannot be accepted by an account that already exists.

Token handling: the invite link still carries the token in the URL path (same class as card links, visible to Cloudflare). New: the invite page
sends `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; the site-wide `Referrer-Policy: no-referrer` and the no-URL-logging
Next configuration already apply. **Known limitation:** accounts created this way have an unverified e-mail address; the invitation token is
the proof of control, delivered by the owner out of band.

## 6. Quiet hours

One rule, `quietHoursDeferral(now, timeZone)`, 21:00–09:00 location time, used by both campaign and automation delivery.

* **Unit tests (11):** exact boundaries (20:59:59 open, 21:00:00 quiet, 08:59:59 quiet, 09:00:00 open), midnight and year/month rollover,
  spring-forward (Berlin 2027-03-28) and fall-back (Berlin 2026-10-25), a zone with different transition dates (New York 2027-03-14),
  per-zone behaviour (Casablanca vs Berlin at the same instant).
* **Integration (9):** deferred sends are not sent and not marked final; no `campaign_attempts` row; wake-up re-checks everything: cancellation,
  withdrawn consent and provider/unsubscribe suppression each end `suppressed` with nothing sent; deferral does not start the customer
  cooldown (only a delivered message does); the location timezone decides.
* **Retry budget, on the real queue (`src/lib/outbox.ts`, extracted from the worker unchanged):** eight consecutive deferrals leave `attempts`
  at 0 and the job is not claimable before its time; five genuine failures still hit the limit; a deferral from a lost lease is ignored.

## 7. Readiness

Every step derives from saved or booked data (`readiness.integration.test.ts`, 7 tests; `readiness-card.test.ts`, 3).

* **Fix made:** an NFC-tap award used to satisfy "Erste Gutschrift an der Kasse bestätigt". NFC has its own step, so only cashier-confirmed
  awards (`staff_online`, `staff_offline`) count. Seed data, referral bonuses, NFC taps, legacy rows, reissue, recovery events and reversed
  awards are tested not to satisfy it, and a reversed first award reopens the step.
* **Fix made:** the card's lead label "Als Nächstes" collided with the overview's separate "Als Nächstes" suggestions card and, worse, would have
  broken the pilot configuration's assertion that "Als Nächstes" is absent when campaigns are withheld. It is now "Nächster Schritt".
* Groups kept: *Einrichtung*, *Im Betrieb geprüft*, *Außerhalb von Loynara*. Legal texts, operator credential reset and (without a key provider)
  NFC are `external`, never green, never required, and stay `external` even when every application step has evidence.
* Visibility: owner and the location's manager only (manager sees no link to owner-only pages); cashiers get `403` and never request it
  (a cashier opening `/merchant` is redirected to `/cashier`; asserted in the browser).

## 8. The red logout test

`logout.spec.ts:133` failed on this candidate and on the unchanged baseline in every dev-server run.

* **Diagnosis (deterministic):** the test fills the login form right after the redirect, before React hydrates. Hydration reset the controlled
  inputs to `""` and the browser's `required` check then swallowed the submit silently (trace: no `POST /api/auth/sign-in`; page dump:
  both inputs length 0, `required`, invalid).
* **Classification:** a genuine, narrow product defect (anything typed or auto-filled before the page is interactive is lost without a message),
  not only a harness race.
* **Fix:** `src/app/login/login-form.tsx` reads the two fields from the submitted form (`FormData`) instead of controlled state. Same Better
  Auth call; no security behaviour changed. The test was not edited. Result: 8/8 on three consecutive runs and in every later full run.
  The sign-out, Back-button, protected-API and account-switch assertions in that file are unchanged and pass.

## 9. Migrations (0018 → 0019)

`scripts/migration-upgrade.test.ts` (4 tests), on throwaway databases:

* Journal contiguous 0000–0019, strictly increasing timestamps, 0018 before 0019, files match the journal.
* **Fresh:** all 20 migrations on an empty database; expected triggers and indexes present; no data.
* **Upgrade:** schema as released (through 0017) filled with synthetic history for two tenants: owners, cashier, a **revoked** manager, a pending invite, a
  **closed card** with award + redemption, an award + **reversal**, a **referral**, consent, contact, card security event, staff audit, a live and a revoked
  NFC tag with a tap, and 400 extra cards. After 0018+0019: row counts and an md5 fingerprint of every historical column of **20 tables are identical**
  (ledger untouched), every balance still equals its ledger, 404 cards all have valid, tenant-unique locators (closed one included), the ledger
  and other append-only triggers still reject edits, and the upgraded **schema equals a fresh install** (columns, constraints, indexes, triggers, functions).
  0018 effects are asserted (a revoked chip's UID can be registered again, a live one cannot, `cancelled` taps allowed). Re-running the migrator is a no-op.
* **Old image on the new schema:** an insert without a locator (the previous code path) still works; additionally the unchanged baseline
  `70ecc72` ran its pilot browser spec against the migrated database.
* **Rollback (tested, not just described):** `docs/rollback/0019-card-locators-down.sql` returns a migrated database to a schema identical to a
  pristine 0018, history unchanged, and 0019 re-applies afterwards. It *loses* locators and the staff-reissue audit columns by design: export first.
  The normal rollback is the previous **image** alone, which works on the 0019 schema.
* Lock note: 0019 takes brief table locks (add column, constraint); production data is currently empty (ledger baseline) so impact is nil.
  The earlier rollback drill (O-010) does **not** cover this migration; one rehearsal on a restored copy is still required.

## 10. Regression

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint | clean |
| Unit + integration (fresh DB each time) | **86 files, 603 passed, 1 skipped** |
| `next build` | passes |
| Browser suite, real Chrome, isolated stack, final source | **62 passed, 0 failed, 3 skipped** (2 NFC browser tests that need device setup, 1 billing test that skips by design); dev server restarted 0 times |
| Pilot configuration spec (`E2E_PILOT_PRODUCTION=1`, `PRODUCTION_ENVIRONMENT=loynara-production`, tunnel ingress, NFC provider configured) | 5/5 |

**Honest notes on the browser suite** (it took several full runs, so the history matters):
1. A first sharded run failed on sign-up rate limits and my own renamed labels; fixed.
2. Some runs saw "Test ended" timeouts. Cause found in the dev-server log: *"Server is approaching the used memory threshold, restarting…"* after
   ~25 minutes; a larger heap (`NODE_OPTIONS=--max-old-space-size=8192`) removed it (0 restarts since).
3. `local-journey.spec.ts` fails on a **cold** dev server (it passed 10/10 on the compiled server and 8/8 warm; the trace shows
   `[Fast Refresh] rebuilding` during the run, which can reset the cashier screen's in-memory card). The unchanged baseline `70ecc72` fails
   identically at the same line on a cold dev server. So it is a pre-existing dev-hot-reload property of that spec, not a defect of this
   candidate. The final run therefore used a **disclosed warm-up pass**: start the dev server, request the routes, run `http-boundaries` +
   `local-journey` once, then the suite. I did not alter the spec to hide it; recommended follow-up: warm up in the suite's setup or run it
   against a compiled server.
4. In production-like pilot mode `pilot-nfc-policy` fails ("NFC-Anfragen" panel) **unless** an NFC key provider is configured; baseline
   identical. A header comment in the spec now states the requirement. With the provider configured: 5/5.
5. Running the whole suite against `next start` is not possible: production mode enables Better Auth's own limiter (a few sign-ups per
   10 s), which this suite's account setup trips. That is the limiter working.

## 11. Visual QA

Real Chrome, compiled build, 1440×900, 1280×800, 768×1024, 390×844, 320×568; 14 screens × 5 sizes = **70 captures, no horizontal overflow, no page errors**
(`.review/visual.mjs`): new-account readiness, active overview, customer detail/history, correction dialog, reissue dialog (empty and partly filled),
empty search result, staff invitation, cashier empty / preview / open / invalid-number / unknown-number, customer card. Images inspected at
320 and 390 for the preview, both dialogs and the readiness list. Findings fixed: the colliding "Als Nächstes" label (above), earlier: card-number
contrast, invite-card overflow, raw English lookup error, duplicated "Korrektur" label. Not covered: WebKit/Safari, a physical iPhone,
screen reader, forced-colors, 200 % zoom, reduced motion. The invite sign-up page was checked at 390 and 320 (no overflow).

## 12. Physical verification state (records)

* **Two-phone production dry run.** The brief states the previous RC's customer → cashier → owner physical flow passed, and that the extra empty
  card was created by hand. **I could not verify either from the records available to me**: the launch ledger checkpoint 001 (2026-10-02)
  still lists T-042/O-007 as NOT RUN, and no later record or session transcript mentions a pass or the manual card. I have therefore *not* listed
  the dry run as unfinished, nor as done; the ledger needs an `OWNER-REPORTED` entry from the owner. This candidate only needs the targeted
  regression below.
* **Physical NFC acceptance: NOT RUN** (tags, reader, key custody still open: O-030…O-036).
* Wallet (Apple/Google) and real e-mail delivery: NOT RUN.

## 13. Targeted physical regression after deployment (and only this)

Prerequisite: the hardened RC deployed on the production origin with a synthetic merchant, operator-provisioned owner; invite sign-up **off** unless step 7 is separately approved.

1. Customer iPhone joins via the shop link; the card shows a legible **Kartennummer K-XXXXXX** under the QR. Screenshot (token redacted).
2. Cashier phone (second OS if available): scan the QR → card opens directly (no preview). Award one stamp.
3. Same cashier phone: type the locator in lower case without hyphen, then pasted as `K-…`; confirm the **preview shows only locator, programme and month**,
   "Karte öffnen" shows the "per Kartennummer geöffnet" warning, award succeeds, owner overview and customer card show it.
4. Type `K-0O1ILA` and a well-formed unknown locator: the two German messages appear; nothing is booked.
5. Owner phone: customers → the card → *Korrigieren* the last award with a reason; balances on cashier and customer card match; the original stays visible with the reason.
6. Owner phone: *Karte neu ausstellen*: the approved wording is shown verbatim; the button is disabled until checkbox + method + reason; after issuing, the
   customer scans the new QR; the old link and old QR (kept on another device) are rejected; balance and number unchanged.
7. *Only if invite sign-up is approved:* the owner invites a cashier on the same origin; the invitee, on their own phone, creates the account from the link and
   reaches the counter; the same link then no longer offers account creation; revoke → access ends.
8. Camera permission denied on the cashier phone: the typed locator path still works.

Evidence: timestamps, redacted screenshots, ledger row ids. No cleanup without a new approval.

## 14. Remaining external dependencies (unchanged by this work)

Legal identity and privacy/terms texts (O-001/O-002/O-013), pricing/VAT/billing route (O-011/O-012), support channel and monitoring arrangements (O-009),
physical NFC and key custody (O-030…O-036), Apple/Google Wallet accounts and diligence (O-020…O-026), production e-mail approval (O-006), Railway Pro /
native backup restore test (O-017), a migration rehearsal on a restored production-shaped copy (new, for 0019), and the owner's `OWNER-REPORTED` entry for the dry run.

## 15. Production configuration and approvals that would later be needed (none applied)

* **Nothing is required to deploy with defaults.** `STAFF_INVITE_SIGNUP_ENABLED` absent = off; no new variable is mandatory.
* Running migration `0019_card_locators` through the existing migrate service needs its own explicit approval, a fresh backup first, and the rollback note above.
* **Invite sign-up (owner-approved for the pilot; superseded text, see section 17):** set `STAFF_INVITE_SIGNUP_ENABLED=true` on the **web** service only,
  with `PUBLIC_REGISTRATION_ENABLED=false`. The production guard now accepts exactly that combination and refuses public registration on.
* Do not set any NFC, Wallet or e-mail flag as part of this release.

## 16. Verdict

**GO for integration into one exact application RC** (final config patch: section 17), on the conditions in sections 14 and 15: no production action is implied, the migration rehearsal on a restored copy and the
targeted physical regression remain required, and physical NFC stays a separate gate. Residual, documented risks: locator is a bounded locator not a secret; reissue entitlement is a
merchant attestation; Google Wallet objects are not revocable from Loynara; invite-created accounts have unverified e-mail; the browser suite needs a warmed dev server.

## 17. Final production-config patch (invite sign-up deployable)

Owner approved invite-gated staff sign-up for the pilot. Previous head `bee812d5d31453803aee4dde616a1db259249e24`.

| Production configuration | Before | After |
|---|---|---|
| registration `false`/unset, invite unset/`false` | pass | pass |
| registration `false`/unset, invite `true` | **refused** ("not approved") | **pass** |
| registration `true` (invite anything) | refused | refused (unchanged message) |
| invite set to anything but exactly `true`/`false` (`TRUE`, `1`, empty…) | `TRUE`/`1` silently meant off | **refused**: must be exactly true or false |
| invite `true` with registration set to an ambiguous value (`TRUE`, `1`, empty…) | not checked | **refused**: must be exactly false or unset |
| every other production guard (ingress, origin, secrets, database, SMTP, NFC, billing…) | enforced | unchanged and still enforced with the flag on |
| preview / development / test processes | unchecked | unchanged (unchecked) |

Default is still off; nothing sets the flag in any environment. The flag has exactly one reader (`src/lib/invite-signup.ts`) and no other variable can relax the
token, exact-address or pending/unexpired/unrevoked/unused rules; source tripwires in `scripts/config-check.test.ts` pin that, plus the rule that the sign-up
hook can return early only through the invite check. The startup script `scripts/production-guard.ts` is also run as a real process in tests.

**Proposed ledger correction (for a later update of the canonical ledger; not applied):**

> **OWNER-REPORTED (Tier 3; not independently rediscovered from repository evidence), recorded from the owner's statement of 2026-10-05.**
> 1. The supervised customer → cashier → owner dry run on the verified pilot RC (T-042 / O-007) **passed**. The customer balance synchronised 0 → 2 → 0
>    across the three views. Exact devices, operating systems, scan counts and timings were not reported and stay NOT REPORTED (Android, T-084, remains
>    NOT RUN unless the owner states otherwise).
> 2. The extra empty synthetic card seen afterwards was **created manually by the owner**. The anomaly is resolved and is **not an application defect**.
> 3. Scope: this covers the pilot RC only. It does not cover the merchant-completion candidate (locator lookup, corrections, reissue, invite sign-up), which needs
>    the targeted regression in `docs/merchant-completion-hardening.md` section 13. Physical NFC (O-030…O-037) is unchanged: NOT RUN. Any cleanup of the synthetic
>    production data still requires its own new explicit owner approval (X-006 / D-017 are not reusable).
