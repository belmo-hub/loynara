# Wallet: architecture, lifecycle and launch readiness

The browser card at `/card/[token]` is the membership card. Apple Wallet and Google Wallet passes are **display copies**: the
membership row and the append-only ledger are the only source of truth for balance, reward eligibility, identity,
referral state and card lifecycle. No provider value is ever read back. Checkout always reads and changes PostgreSQL.

Production state at the time of writing: Wallet is **disabled** in production. Nothing in this branch enables it.

## Readiness at a glance

| Layer | State | Evidence |
| --- | --- | --- |
| Software (this branch) | Implemented and tested locally | `src/lib/wallet/*.test.ts`, `routes.integration.test.ts`, `scripts/config-check.test.ts`, migration rehearsal |
| Production image | Signs and chain-verifies a pass as the `node` user | `Dockerfile` installs `openssl` + `zip`; `scripts/wallet-runtime-check.ts` run inside the built image |
| Apple provider account | **NOT READY** | Needs Apple-issued Pass Type ID certificate, WWDR intermediate, team ID, public HTTPS web-service routing |
| Google provider account | **NOT READY** | Needs issuer account, service account, public HTTPS logo; Demo Mode until Google grants publishing |
| Real device acceptance | **NOT RUN** | Procedures below; required before enabling for customers |

## Model

`wallet_passes` (migration 0020): one row per issued pass **per card credential generation**.

- Apple serial = `wallet_passes.id` (random UUID). Google object id = `<issuer>.loynara_<wallet_passes.id>`.
- `credential_hash` = SHA-256 of the scan code at issuance. A row that no longer matches the card is never refreshed with
  live data; it is revoked (defence in depth on top of explicit revocation).
- At most one **unrevoked** row per card and provider (partial unique index). Re-adding the same card returns the same
  serial/object, so Wallet replaces rather than duplicates the pass.
- Revocation keeps history: `revoked_at`, `revoke_reason` (`reissued`, `closed`, `superseded`), status
  `revocation_pending` → `revoked` once the provider was told.
- Apple web-service token = HMAC(`APPLE_WALLET_AUTH_SECRET`, pass type + serial). It proves possession of one pass and is
  never the card link or scan code. What it unlocks is decided server-side from the row.

## Lifecycle

| Event | Loynara (authoritative) | Wallet copy |
| --- | --- | --- |
| Award, redemption, correction, referral bonus | Ledger + balance in one transaction | One coalesced `wallet.refresh` queued in the same transaction, only if the card has an unrevoked pass |
| Programme name/rules, reward create/edit/reorder/archive, merchant name/colour/logo | Saved | Coalesced refresh for every card of the programme (merchant: tenant) that holds a pass |
| Staff reissue | New card link + scan code; balance, history, locator unchanged | Every pass revoked: Apple devices pushed and served a **voided** pass (no QR, no balance, no locator); Google object replaced with `INACTIVE` and no barcode. New link → new serial/object |
| E-mail recovery | New card link only (scan code unchanged) | Pass stays valid: it never contained the link |
| Closure | Credentials retired, contact erased, ledger kept | Every pass revoked as above (reason `closed`); Apple registrations kept 7 days to deliver the void, then pruned by the worker |

Refresh rules (`src/lib/wallet/enqueue.ts`, `refresh.ts`, `scripts/worker.ts`):

- Coalescing: at most one **pending** refresh per card; the worker reads current state, so one job covers every earlier change.
- Provider failure never touches loyalty. Wallet jobs retry after 1, 4, 16, 60 minutes (5 attempts), then `failed`.
- A provider that is not configured blocks the job (`blocked`, operator replay: `npm run worker -- --replay <id>`).
- A later successful refresh of the same card marks older `failed`/`blocked` refreshes `suppressed`, so open failures
  always mean "a Wallet copy is behind now".
- Apple: a strictly increasing `updated_at` is the update tag; APNs push is empty (`apns-push-type: background`).

## HTTP surface

| Route | Purpose | Protection |
| --- | --- | --- |
| `GET /api/wallet/status` | Which buttons the card page may show: `{apple: available\|unavailable, google: available\|test_only\|unavailable}` | No reasons, names, dates, versions or paths |
| `POST /api/wallet/apple` | Body `{token}` → two-minute download URL | Same-origin; peer 30 / card 10 per 15 min |
| `GET /api/wallet/apple/download/[ticket]` | Signed `.pkpass` | HMAC ticket (pass id + expiry + nonce), 2 uses, re-checks current credential; peer 60 / 15 min |
| `POST /api/wallet/google` | Body `{token}` → creates/aligns object, returns Save link referencing it **by id only** | Same-origin; peer 30 / card 10 per 15 min |
| `/api/apple/v1/devices/.../registrations/...` | Register / unregister / list updated serials | Pass token (HMAC per serial); peer 600 + device 60 (register) or 120 (list) per 15 min |
| `GET /api/apple/v1/passes/[type]/[serial]` | Latest pass: live, or voided after reissue/closure | Pass token; peer 600 + serial 60 per 15 min |
| `POST /api/apple/v1/log` | Accepted and discarded | Peer 30 per 15 min |
| `GET /api/merchant/program/wallet` | Owner readiness in product terms | Owner session |

Card bearer tokens no longer appear in any Wallet URL. Apple web-service errors are bare status codes; customer issuance
errors are `WALLET_UNAVAILABLE` (503) or `WALLET_PROVIDER_ERROR` (502) without provider detail.

Operators keep full diagnostics: `npm run diagnose` and the production guard print the precise configuration reason.

## Pass content

Merchant first, Loynara nowhere on the pass. German, French when the merchant locale is `fr`.

- Apple store card: merchant logo (PNG ≤ 500 KB, ≤ 2048 px; otherwise the merchant name as logo text), brand colour with
  automatic light/dark text, header `STEMPEL 7 / 10`, primary `NÄCHSTE PRÄMIE` / `PRÄMIE BEREIT` + reward, status
  `Noch 3 Stempel` / `An der Kasse einlösen` (the only field with a change message, so one lock-screen notice per
  update), `KARTE K-XXXXXX`, location; QR with the K-number as alt text; back: programme, last booking time, note that
  bookings happen at the counter; `sharingProhibited`; merchant coordinates only if the merchant saved them.
- Google loyalty object: class per programme (merchant name, programme, colour, logo, `ONE_USER_ALL_DEVICES`); object per
  pass with `7 / 10`, the K-number as account id, QR with alt text, reward text module. Google lays the card out itself.

## Configuration (names only)

Apple: `APPLE_WALLET_ENABLED`, `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_SIGNING_CERT_PATH`, `APPLE_SIGNING_KEY_PATH`,
`APPLE_WWDR_CERT_PATH`, `APPLE_WALLET_AUTH_SECRET`, `APPLE_WALLET_WEB_SERVICE_URL`.
Google: `GOOGLE_WALLET_ENABLED`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE`,
`GOOGLE_WALLET_PROGRAM_LOGO_URL`, `GOOGLE_WALLET_PUBLISHING_STATUS`, optional `GOOGLE_WALLET_ASSET_ENABLED`,
`GOOGLE_WALLET_ASSET_ORIGIN`.
Production gate: `WALLET_PRODUCTION_APPROVED`.

Production refuses to start (`scripts/config-check.ts`) unless, for each enabled provider: `WALLET_PRODUCTION_APPROVED=true`;
flags are exactly `true`/`false`; no device-test Wallet approvals are present; credential files are absolute paths outside
public/fixture/preview/device-test/test locations; the pass type ID is a registered reverse-DNS ID and the team ID has 10
characters; the auth secret has ≥ 32 varied characters, is no placeholder and is not reused; the web-service URL is exactly
`<PRODUCTION_APPROVED_ORIGIN>/api/apple`; Google is `published` (Demo Mode is not production), its issuer ID is numeric
and its logo/asset origins are public HTTPS. Messages name settings, never values. Changing `APPLE_WALLET_AUTH_SECRET`
after issuance invalidates every installed pass's web-service token; keep it stable.

## Runtime image

`openssl` and `zip` are required at runtime and are not in `node:26-bookworm-slim`. The runtime stage installs them.
Verify any built image (no credentials, no network, no database):

    docker run --rm --entrypoint npx <image> tsx scripts/wallet-runtime-check.ts

Note: the image's OpenSSL 3.0 refuses a signer certificate repeated as its own chain file; production uses Apple's
distinct WWDR intermediate, and all fixtures mirror that.

## Physical device acceptance (prepare only; requires approved credentials, a synthetic card and a named tester)

Record for each step: time, device/OS, expected vs observed, screenshot without QR detail. A step that was not run is
**NOT RUN**, never "passed".

### Apple / iPhone

1. Open an approved synthetic Loynara card on the iPhone in Safari. Expect "In Wallet speichern" with one Apple button.
2. Tap "Zu Apple Wallet hinzufügen". Expect the system Add Pass sheet within a few seconds.
3. Add. Expect the merchant logo or name, brand colour with readable text, `STEMPEL 0 / n`, next reward, K-number.
4. Confirm the device registered (operator: `apple_registrations` row for the serial; no customer data needed).
5. Book one test stamp at the counter. Expect a lock-screen notice ("Noch … Stempel") and `1 / n` on the pass. Note delay.
6. Book up to the reward. Expect `PRÄMIE BEREIT` and "An der Kasse einlösen".
7. Redeem, then correct a test booking as approved. Expect each state on the pass after each refresh.
8. Scan the pass QR at the counter. Expect the same card to open.
9. Staff reissue for the card. Expect the installed pass to turn void (no QR) after the push; old card link dead.
10. Try to re-add from the OLD link: refused. Add from the NEW link: a separate pass with the new QR; balance unchanged.
11. Close the card. Expect the new pass to turn void; customer page shows the closure text.
12. Remove the pass on the iPhone. Expect the unregister call (registration row gone).

### Google / Android

1. Same synthetic card on the Android tester account in Chrome. Expect one Google button and, in Demo Mode, the test note.
2. Tap "Zu Google Wallet hinzufügen". Expect Google's save screen; save.
3. Expect merchant name/logo, programme, `0 / n`, K-number, reward module.
4.–8. As Apple 5–8 (Google may take minutes to display updates; record the delay, up to 24 h is documented by Google).
9. Staff reissue. Expect the saved object to move to inactive/expired passes without barcode.
10. Old link refused; new link saves a new object with the new QR.
11. Close the card. Expect the new object inactive.

Only after both lists pass on real devices may anyone propose enabling Wallet for customers, and that remains a separate
production approval.

Before public launch, the text buttons on the card page must be replaced by Apple's official "Add to Apple Wallet" badge and
Google's "Add to Google Wallet" button in German (provider artwork under their usage terms; not downloaded in this branch).

## PassFast decision

There is no PassFast adapter in this repository; the historical PassFast proof was a separate proof of concept. Recommendation:
**native Apple now** (option A). The native adapter is implemented, owns serials, tokens, revocation and voiding, keeps
customer data in Loynara's own processing, and has no per-pass vendor pricing or lock-in. A PassFast bridge would add a
data processor (DPA diligence), hand over serial/update control, and still need the same Apple certificate and device
acceptance. Reconsider only if Apple certificate/APNs operation cannot be staffed; that would be a new reviewed adapter,
not a configuration switch.

### Separate device-test Google Demo gate

The default device-test configuration still disables both providers. After a **separate specific approval** for the issuer, designated Google account, synthetic programme and narrow public logo route, set the following in the existing restricted `var/device-test.env` locally. Existing files are not automatically altered by preparation. Do not paste credential contents in chat.

| Setting | Required value after approval |
| --- | --- |
| `DEVICE_TEST_APPROVED_WALLET_PROVIDER` | `google-demo` |
| `DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID` | Exact approved numeric issuer; must match `GOOGLE_WALLET_ISSUER_ID` |
| `DEVICE_TEST_GOOGLE_TESTER_EMAIL` | Designated tester also configured in Google Console; this declaration does not register that account |
| `DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL` | Exact queryless `https://<separately-approved-asset-host>/api/wallet/assets/google-logo/<approved-program-uuid>.png` |
| `GOOGLE_WALLET_PROGRAM_LOGO_URL`, `GOOGLE_WALLET_ASSET_ORIGIN` | Same exact approved URL and its separate origin, respectively |
| `GOOGLE_WALLET_ENABLED`, `GOOGLE_WALLET_ASSET_ENABLED`, `GOOGLE_WALLET_PUBLISHING_STATUS` | `true`, `true`, `demo` |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` | Absolute regular owner-only file outside this repository; no symlink; valid RSA service-account JSON |

The browser origin and Access checks remain mandatory. Approval covers only the selected programme PNG path and its optional sole `?v=<16 lowercase hexadecimal characters>` content-version query. The adapter now checks the **actual selected logo and programme before any OAuth/provider request**; another programme, origin, path or query is rejected. The approved asset ingress must deny every other path and retain the browser hostname's Access protection. Environment declarations record approval; they cannot prove owner permission, issuer authorization, Google tester registration or a working external route.

Before provider enablement, save the synthetic merchant's PNG through the existing brand editor and check the exact asset locally. The seed has no uploaded logo. Google's current guidance recommends at least 660×660 with the required safe margin; use its supplied localized Add-to-Wallet artwork. Once the narrow route is separately approved and live, verify Google can fetch the merchant logo, then perform Save → Wallet QR scan → award → observed displayed update → redeem → observed displayed update. Record elapsed provider display times separately from the committed ledger time. Real provider and hardware results remain **NOT RUN**. Apple stays disabled in this launcher until its own certificate/callback/device setup is supplied and specifically reviewed.

