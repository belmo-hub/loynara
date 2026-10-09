# NFC cashier-phone release candidate review — 9 October 2026

## Scope and integration

Production base: `792e218a17287009067ce0993c33eda3bfc3f4b7` (schema 0020, 21 journal entries).
Source: `a93fb82f3acd46045c94a89b34c140c88e4e1b9a` on `product/nfc-cashier-phone-v1`, originally based on `b6f55c45f9f63873df3787be6f16819c58c2f5eb`.
Isolated integration branch: `codex/nfc-cashier-phone-release-v1`. Non-fast-forward merge from the exact production base; no textual conflicts. The existing production worker was retained with the NFC push handler added, followed by focused blocker fixes.

All work and accounts were synthetic/local. No deploy, push, production migration/configuration mutation, tag provisioning/rewriting, production secret generation, Wallet activation, billing or campaign activation occurred. TAG-01 and TAG-02 were untouched.

Local commit ledger:

- `2d11abd401722f03954623ad72be0c573f045d4b`: integration merge, parents exact production and source candidate.
- `a8086a9e6fad76fbebe54a419c89abb33374964a`: confirmation expiry after membership lock.
- `cb4035292ea48fa9ec7ca0835ed7a731e3aa81bb`: recoverable, renewed and fenced push leases.
- `d2f9f7491d84168c4b4e76285e1bf604483c2af7`: protected customer status and transient retry handling, regression/browser tests.
- `7b15b32c10e3a5144f84c9cd05ddb23a16e9df23`: populated migration/rollback preservation rehearsal.

The final documentation commit follows these verified product commits; resolve the branch tip with `git rev-parse codex/nfc-cashier-phone-release-v1`.

## Findings and fixes

1. **P1: shared fresh-tap limits exhausted by customer polling.** Two waiting customers on one peer consumed the 120/15-minute crypto bucket before five-minute expiry; a rejected polling promise silently ended updates. Fixed with a separate card-authorized read-only status route. It binds request/tag/tenant/location/program/open-card cookie, returns no scan credential and cannot stamp, move a counter or enqueue a push. Customer retries transient failures and respects bounded Retry-After. Canonical `statusRef` handles two tags attaching to the same pending request without relaxing authorization.
2. **P1: crash after claiming a push loses the wake-up.** Both claim paths previously leased for five minutes, equal to request lifetime. Push claims now last 30 seconds, renew before each recipient, stop after loss of ownership and fence completion. Delivery rechecks the request before each send and caps provider TTL to remaining lifetime. Wallet claims retain five-minute duration and existing supervision.
3. **P1: expiry while waiting for the membership lock.** A real PostgreSQL lock reproduction awarded after expiry because the check preceded the membership lock. Confirmation now rechecks expiry immediately before the shared award operation, after acquiring that lock.

Each defect was reproduced before its product fix and verified afterward. Independent final review found no remaining practical P0/P1.

## Security and feature preservation

AES SDM verification/UID binding, monotonic counter protection and replay handling remain server-side. Pending requests and membership locks serialize confirmation; deterministic tap idempotency keys keep one ledger entry even with two cashiers. Notifications remain generic wake-ups: payload contains only version, kind and locale. A notification performs no booking and opens the authenticated cashier; explicit confirmation is required.

Subscriptions are resolved from authenticated user/session/location, use endpoint uniqueness and composite tenant/location FK, and cascade on session/user deletion. Active role and live session are revalidated for delivery. Revoked/expired logins cannot receive ordinary new sends; provider-accepted notifications may arrive after revocation but contain no customer data and cannot authorize any action. Endpoint validation permits only known HTTPS browser-push hosts and provider-specific paths, rejects hostile hosts/ports/credentials, and is repeated before sending. The sender does not follow redirects. 404/410 removes subscriptions; transient outages/429 retry without deleting phones; successful devices are not rung again on ordinary retries. Crash after a provider acceptance but before persisting success can repeat a generic notification; stamp correctness remains independent.

The service worker has no fetch handler or authenticated content cache. Notification click targets the same-origin cashier. PWA install metadata, visibility polling, wake lock, K-numbers, one-action confirmation and fast jsQR fallback remain present. Camera is opt-in and is unnecessary for NFC.

Production Wallet implementation/routes, card client, async issuance, PassFast tenant binding, eligibility, worker subprocess supervision/monitoring and shared loyalty ledger/reissue code are byte-identical to the base. The only shared outbox changes are the push-specific lease case and fractional-minute renewal support; integer Wallet renewal remains five minutes. Existing production environment example and migration SQL 0000–0020 are unchanged. Apple/PassFast, Google Wallet, billing and campaign activation were not changed.

## Migration 0021

Additive staff_push_subscriptions table with endpoint uniqueness, tenant/location index, tenant/location composite FK, user/session cascading FKs, HTTPS/failure-count checks. Authorization and session-user pairing are enforced in the API/delivery layer; the schema does not independently make session/user a composite FK. Expired sessions are excluded at delivery; logout deletion removes subscriptions.

The exact populated 0020 rehearsal proves journal 21 → 22, schema equality with fresh installation, full historical/Wallet/device-registration/non-push outbox row preservation, invalid location/session rejection, logout cascades, rollback to exact schema/journal 0020/21 and reapplication to 0021/22. Rollback guards the final timestamp/count and intentionally deletes subscriptions and push jobs only. Stop web and worker and execute its script in one transaction with the matching old image. No production migration was run.

## Verification

Final verification of the integrated product code:

- Full Vitest suite: **138 files passed; 1,196 tests passed, one opt-in Mailpit test skipped** (105.57 seconds). Includes tap/replay, staff/location, concurrency, expiry/cooldown, hostile endpoints, subscription/logout/revocation, push crash/retry, combined NFC/Wallet worker and populated migration upgrade/rollback checks. Evidence: `var/rc-full-suite-final.log`.
- Typecheck: `npm run typecheck` passed, including the final browser-helper change.
- Lint: `npm run lint` passed with zero errors and two existing unused `_error` warnings in `public/cashier-sw.js`.
- Production build: `npm run build` passed; includes the protected read-only status route. Evidence: `var/rc-build.log`.
- Compiled-server Chromium browser checks: **28 distinct cases passed across scoped runs**. Six unaffected cases (combined NFC/QR layout, fast counter and four status/retry scenarios) passed in the initial run; the remaining 22 passed together in the paced final run (3.6 minutes), covering real local NFC flow, K-number matching, one-action confirmation, two cashiers, decline/expiry/replay, tenant isolation, notifications capability/polling, QR fallback and Wallet regression including 75 viewport/platform combinations. Evidence: `var/rc-browser-final.log` and `var/rc-browser-compiled-paced.log`.

The compiled browser run initially hit Better Auth's production signup limit (three requests in ten seconds) while creating synthetic fixtures. An opt-in test-only eleven-second fixture gap respects that limit; application limits are unchanged. The failed initial run is retained as diagnostic evidence, and only its six independently passing cases count toward the 28-case result. Development-server checks also passed after correcting local-only capability fixtures.

Local evidence is retained under ignored `var/rc-*.log`; no credentials are in committed evidence.

The normal npm test wrapper uses the shared Compose port. This review ran its underlying full Vitest suite with explicit TEST_PG_PORT=54429 and DATABASE_URL pointed exclusively at the new loopback container/database. Browser tests used a separate database in that container, localhost:3049, synthetic NFC credentials, synthetic camera streams, providers OFF and a non-delivering VAPID-shaped fixture for capability/UI. No push permission was requested and no real endpoint subscribed. One existing Mailpit smoke test remains opt-in.

Initial broad test attempts exposed a missing custom-port fixture setting and rejected low-diversity synthetic key; both were corrected without product changes. A separate intermediate database-test collision invalidated that attempt; independent status regressions moved to another loopback container before final full verification. No failed intermediate attempt is counted as final success.

## Polling and operational limits

Cashier polling is 30 GET/minute per visible device, pauses while hidden, and has no application peer bucket, so several cashiers behind one network do not exhaust a shared app limiter. Each read currently loads merchant context and performs several database queries; production/proxy limits and real capacity have not been load-tested. Confirmation is 120 attempts/15 minutes/user; devices sharing a login share that allowance. Customer status allows 180 reads/15 minutes/request (approximately 76 for a full five-minute wait), with a separate 3000/minute peer cap. Fresh physical verification retains 120/15 minutes/peer and 600/15 minutes/tag.

Push fan-out is sequential with five-second per-send timeout; large cohorts during provider outages can delay other queue work. Measure the supervised cohort and monitor queue age, retries, expiry suppression, failed jobs, subscription failures and heartbeat freshness before broader rollout. Web/worker restart recovery is covered locally; physical provider delivery and production load are not.

The historical stopped-worker note from 29 September is superseded by the saved exact-baseline acceptance report at `/Users/youssefbelmokhtar/Desktop/Loynara/var/apple-synthetic-production-acceptance-20261008/final-acceptance-report.json`, recorded 9 October 01:09:18 Berlin: worker on 792e218a, one running instance, no recorded heartbeat/log errors. This is the latest located saved evidence, not a live health assertion. No production status or secrets were changed/accessed for this review.

## Real-device and production readiness

- iPhone/iPad: iOS/iPadOS 16.4+; install cashier to Home Screen, launch there, authenticate, grant notifications from an explicit action, permit OS/Focus delivery. [Official WebKit requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- Android Chrome: HTTPS, active service worker, Push API subscription, browser/OS notification permission; installation optional. [Google subscription guidance](https://web.dev/articles/push-notifications-subscribing-a-user), [Android Chrome notification settings](https://support.google.com/chrome/answer/3220216?co=GENIE.Platform%3DAndroid&hl=en).
- Future web/worker configuration needs matching valid VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, approved HTTPS origin and reachable browser-push providers. No production keys were generated or installed.
- Future production NFC needs approved verification-master custody, distinct offline administration-master custody/backups, NFC_ENABLED and NFC_KEY_PROVIDER=derived_v1 with NFC_VERIFY_MASTER_KEY, approved staff_confirmed programme/cooldown and a separately authorized TAG-02 registration/provisioning. Keep admin master off server; keep TAG-01 preview binding unchanged. Feature remains OFF in production.
- Preserve PassFast tenant/template mapping, Wallet-disabled approvals and existing worker heartbeat configuration. Readiness does not authorize any of these future configuration changes.

No physical iPhone or Android test is claimed passed. No real push provider acceptance or locked-screen delivery was tested.

## Smallest physical acceptance session (separate approval required)

Approve one supervised session of this exact RC on an isolated reviewed HTTPS test origin using one already configured real tag (TAG-01 preview/reference binding unchanged), one approved synthetic membership, customer iPhone, cashier iPhone and cashier Android if available. Verify origin/tag/key binding and test VAPID availability before starting; this session does not provision TAG-02 or alter keys.

1. Install/open cashier PWA on iPhone, authenticate each cashier to the intended location, enable notifications and verify subscription registration. Record app SHA, phone/browser versions, tag reference and synthetic membership reference without credentials.
2. Lock cashier phone. Customer taps once; match customer K-number to cashier request after generic locked-screen notification. Opening notification must revalidate session and location.
3. Cashier confirms once; prove one balance increment and one ledger entry. Repeat confirmation and race the other cashier: still one award.
4. Let a second request expire; prove both server rejection and no ledger change. Exercise cancellation, revoked/logged-out session and incorrect location.
5. Disable/deny push and prove visible-page NFC polling still works. Exercise QR fallback when NFC fails, keeping camera inactive during NFC flow.
6. Repeat locked-screen delivery/open/confirm on Android if available. Save timestamped evidence and note Focus/network failures separately.

Exact next step: obtain approval for the isolated physical session and its existing-tag/origin/synthetic-member/test-VAPID binding; then run this checklist. No production rollout is authorized.
