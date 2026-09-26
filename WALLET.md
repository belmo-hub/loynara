# Wallet integration status and setup

The browser card at `/card/[token]` is the default membership card. Apple and Google buttons are offered only when their server-side configuration reports ready. Wallet balances are display copies; checkout always reads and changes the PostgreSQL membership balance.

## Current verification

| Area | State | Evidence |
| --- | --- | --- |
| Apple pass JSON, generated icons, manifest, detached CMS signature, `.pkpass` ZIP | Fixture verified | `src/lib/wallet/wallet.test.ts` creates a temporary self-signed test certificate, checks SHA-1 file hashes, and verifies the detached signature with OpenSSL. The fixture is not an Apple-issued certificate. |
| Apple device register/list/unregister and authentication | Local database test | `src/lib/wallet/apple-service.integration.test.ts`. |
| Google class/object mapping, RSA Save JWT, REST create/patch flow | Fixture verified | `src/lib/wallet/wallet.test.ts` signs with a temporary test key and uses a test HTTP responder. No Google endpoint is contacted. |
| Merchant-specific Google PNG logo lookup | Local fixture verified, route disabled | A saved merchant PNG resolves to a versioned per-program URL and the class uses it in preference to the global fallback. `src/lib/merchant-brand.integration.test.ts` checks the gated route returns the saved PNG only when explicitly enabled. No public asset was published or fetched by Google. |
| Transactional update queue | Local database test | Ledger transactions enqueue `wallet.refresh`; the worker retries transient provider failures and keeps blocked jobs for controlled replay. `src/lib/wallet/refresh.integration.test.ts` verifies disabled-provider behavior. |
| Real Apple Wallet install, APNs push, pass fetch, lock-screen relevance | **NOT RUN** | Requires Apple Developer pass certificate, production HTTPS, and physical Apple device. |
| Real Google Save, object update, nearby notification, publishing | **NOT RUN** | Requires issuer/service account, public HTTPS logo, account approval, and physical Android device. |

## Physical-provider handoff

| Provider | Exact account/credential requirement | Required environment variables | Test device/account | Public endpoint | Next verification action |
| --- | --- | --- | --- | --- | --- |
| Apple | Apple Developer team with registered Pass Type ID; **Apple-issued** matching Pass Type ID signing certificate/private key and WWDR chain. A self-signed fixture only proves archive construction, not Apple trust. | `APPLE_WALLET_ENABLED`, `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_SIGNING_CERT_PATH`, `APPLE_SIGNING_KEY_PATH`, `APPLE_WWDR_CERT_PATH`, `APPLE_WALLET_AUTH_SECRET`, `APPLE_WALLET_WEB_SERVICE_URL` | Physical iPhone with Wallet; designated test operator. | Public HTTPS base `APPLE_WALLET_WEB_SERVICE_URL=https://<approved-host>/api/apple` for device registration, update listing and pass fetch; APNs outbound reachability. | With approved credentials and permission, inspect `/api/wallet/status`, download/install a pass, register device, award/redeem, confirm APNs and updated pass/QR on the iPhone. |
| Google | Google Wallet issuer in Console; enabled Google Wallet API; issuer-authorized Developer service account with securely stored JSON key. New issuers start in **Demo Mode**; test-account issuance is separate from public publishing approval. | `GOOGLE_WALLET_ENABLED`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE`, `GOOGLE_WALLET_PROGRAM_LOGO_URL`, `GOOGLE_WALLET_PUBLISHING_STATUS=demo` (until approved) | Designated Google Wallet tester account on a physical Android device. | Public HTTPS logo URL fetchable by Google; application endpoint under an approved HTTPS origin for a device journey. | With approved credentials and tester, perform actual Save, scan, award/redeem and object-update checks. Request publishing access only after the issuer's separate approval prerequisites; never relabel a Demo Mode test as public issuance. |

No issuer credentials, designated provider testers, or permission to call live providers were supplied, so both rows remain **NOT RUN** for real provider/device operation. Store certificate/key and service-account files outside Git and `public/` with restricted local permissions; never paste private keys in chat or logs. The browser-card preview needs neither provider.

An Access-gated browser preview does not automatically make Apple device callbacks reachable or a Google logo fetchable. Those provider-facing URLs need their own reviewed public HTTPS routing and token-path log policy before real provider tests. Do not open them merely to make a fixture test pass.

For the first approved Android test, keep Google in **Demo Mode** and authorize the designated Android Google account as an issuer tester. The current adapter has no inbound Google callback, but it still lacks a provider-fetchable HTTPS PNG logo; the Access-protected browser origin alone cannot supply that asset. The current custom Save button also needs Google's supplied artwork before public use. [Google logo guidance](https://developers.google.com/wallet/retail/loyalty-cards/resources/faq) and [brand guidance](https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines) are separate from fixture success. Mark the device test passed only after a pass actually installs and its displayed balance updates after both an award and redemption; a generated Save URL or REST-created object is insufficient. Google notes that display updates may take up to 24 hours in [prelaunch testing](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/prelaunch-testing).

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

## Apple configuration

Set `APPLE_WALLET_ENABLED=true` only after placing credentials outside the repository and configuring:

- `APPLE_PASS_TYPE_ID`: the registered Pass Type ID, such as `pass.example.loyalty`.
- `APPLE_TEAM_ID`: the team that owns that ID.
- `APPLE_SIGNING_CERT_PATH`, `APPLE_SIGNING_KEY_PATH`, `APPLE_WWDR_CERT_PATH`: absolute paths to PEM files. The first two must match. Never place these files in `public/`, Git, or a client environment variable.
- `APPLE_WALLET_AUTH_SECRET`: at least 32 random characters. Keep it stable after issuance; changing it invalidates pass web-service tokens.
- `APPLE_WALLET_WEB_SERVICE_URL`: the public HTTPS **base** URL ending in `/api/apple`, without `/v1`. Wallet appends `/v1/devices/...` or `/v1/passes/...`.

The customer endpoint `/api/wallet/apple/[cardToken]` signs and downloads one pass. The Apple web-service handlers live under `/api/apple/v1`. They accept a pass-specific `ApplePass` token for registration and pass downloads and a device library identifier for change listing. The worker sends empty APNs change notifications using the pass certificate and HTTP/2. Invalid push tokens are removed. Apple controls notification delivery and lock-screen relevance; neither is guaranteed.

`GET /api/wallet/status` shows the OpenSSL and zip versions, certificate expiry, and missing configuration. Readiness is false if either executable is unavailable. Local checks validate the PEM files and key match, but cannot prove that Apple recognizes the certificate, pass ID, or APNs topic. A real device test remains mandatory before enabling this for customers.

Apple readiness checks are cached for five minutes per server process so public status requests do not repeatedly run synchronous certificate/tool checks. Restart the web and worker processes after credential rotation; recheck status and certificate expiry before serving passes. Treat the device library identifier in Apple registration URLs as a secret and redact it from access logs.

## Google configuration

Set `GOOGLE_WALLET_ENABLED=true` only after configuring:

- `GOOGLE_WALLET_ISSUER_ID`: numeric issuer ID from the Google Wallet Business Console.
- `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE`: absolute path to a service-account JSON key. Authorize that account as a Developer for the issuer and enable the Google Wallet API.
- `GOOGLE_WALLET_PROGRAM_LOGO_URL`: a fallback public HTTPS PNG URL. The adapter now selects a merchant's stored PNG through a versioned per-program URL when `GOOGLE_WALLET_ASSET_ENABLED=true` and `GOOGLE_WALLET_ASSET_ORIGIN` is an exact HTTPS origin. The image handler exists but is **disabled by default**, including in the protected preview and device-test launchers. The owner-uploaded logo can also be JPEG or WebP for the local preview; Google selection currently requires PNG. The operator must approve the exact provider-facing hostname, minimal route, proxy logging and asset exposure before enabling it. Browser Access protection remains in place. Local class/route tests do not prove Google can fetch the image; no asset was published in this pass.
- `GOOGLE_WALLET_PUBLISHING_STATUS`: `demo` until Google grants publishing access; set `published` only after approval. This is an operator-declared status, not an API verification.

The customer endpoint `/api/wallet/google/[cardToken]` creates a deterministic class per program and object per member, then returns a server-signed Save URL. An object being created does **not** prove that a customer saved it. Demo-mode issuers are limited to designated testers. After committed loyalty transactions, the worker patches only the barcode and balance fields of existing objects; it does not send marketing messages.

## Location relevance and privacy

Onboarding may save a merchant location's optional latitude and longitude. Both coordinates are required together. Apple and Google pass payloads include them only when supplied. The application does not store customer locations. Provider proximity behavior depends on device settings and provider policy; no notification radius or appearance is promised.

## Operator checks before live rollout

1. Run `npm run diagnose` and inspect `/api/wallet/status`; resolve any missing values or certificate-expiry warning.
2. Use one Apple test device to install, register, award, receive an APNs change indication, list updates, and fetch a newly signed pass. Verify the displayed balance and QR scan. Repeat after redemption.
3. Use one designated Google demo tester on Android to save the pass, scan the QR, award, and confirm the updated displayed balance. Only then request publishing access and re-test with an approved account.
4. Inspect blocked/retry jobs via the worker diagnostics. Replay after repairing credentials or provider availability. A provider failure must not reverse a committed award or redemption.

Official provider references are recorded in [SOURCES.md](SOURCES.md). Tests in this repository make no claim of live provider or physical-device verification.
