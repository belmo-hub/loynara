# Direct Google Wallet and managed Apple Wallet

Apple uses the existing PassFast integration. New Google issuance uses `GOOGLE_DIRECT` exclusively. The managed PassFast Google issuer `3388000000023094673` is explicitly refused by the Direct configuration. Historical managed projections retain their existing maintenance path; they are never an issuance fallback.

## Verified demo account

On 9 October 2026, the founder's existing Google Console account showed Merchant ID `BCR2DN6D5KMPL2BI` and separate Wallet Issuer ID `3388000000023201754`. The issuer is in Demo Mode. Its business-profile prerequisite is complete; public publishing access has not been requested. One Android Wallet account was explicitly approved and added as a tester; the phone's owner consented to saving and removing the synthetic pass.

The approved dedicated Cloud project is `loynara-wallet-demo-20261009` (number `620448097758`), with billing inactive. The founder personally accepted the relevant terms and enabled the Wallet API. Service account `loynara-wallet-demo@loynara-wallet-demo-20261009.iam.gserviceaccount.com` has Wallet Developer access in the issuer, with no additional Cloud project role. One approved signing key is stored outside Git with owner-only permissions. OAuth and the issuer's loyalty-class list both returned HTTP 200 before class creation. These observations establish demo API access, not public issuance approval.

## Configuration

Defaults remain disabled. Enable only in a separately authorized environment:

```dotenv
GOOGLE_WALLET_PROVIDER=GOOGLE_DIRECT
GOOGLE_WALLET_ENABLED=true
GOOGLE_WALLET_ISSUER_ID=3388000000023201754
GOOGLE_WALLET_PUBLISHING_STATUS=demo
GOOGLE_WALLET_SERVICE_ACCOUNT_FILE=/absolute/outside-checkout/credential.json
GOOGLE_WALLET_PROGRAM_LOGO_URL=https://approved-public-origin/program-logo.png
GOOGLE_WALLET_LOCATION_CLASSES=[{"tenantId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","locationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","programId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","classId":"3388000000023201754.approved_program","issuanceEnabled":true,"testAccountsApproved":true}]
```

Bindings require all six fields, unique tenant/location/program scopes, unique classes, valid UUIDs and the owned issuer prefix. A location's existence is insufficient: its class and issuance permission must be approved. Demo account approval is a recorded operator decision, never inferred from a browser login. Customer requests resolve tenant, location and programme from the card in PostgreSQL, not caller-supplied IDs. Unmapped scopes receive no Google button or issuance.

`issuanceEnabled=false` pauses new customer issuance while preserving updates and withdrawal of existing passes under the unchanged approved binding. Removing the binding, disabling the provider, withdrawing demo account approval or changing the class blocks maintenance too. Complete withdrawal while the binding and credentials remain valid; then disable the provider. Remapping cannot transfer existing projections into another class. Blocked outbox work remains available for operator reconciliation.

Keep PassFast Apple flags, location mappings, provider history and credentials unchanged. No Google database migration is introduced: `wallet_passes` and the existing `wallet.refresh` outbox suffice. This branch starts at NFC candidate `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec`, which contains migration 0021. Reported production remains `792e218a17287009067ce0993c33eda3bfc3f4b7`, schema 0020 / 21 entries. A future combined rollout must separately approve and rehearse its complete schema transition.

## Credential custody

Use an absolute regular file outside the application checkout, owned by the runtime UID, readable only by its owner (0600). Symlinks, repository-contained files and group/world-readable files are refused. The containing secret directory should be 0700. Mount future production credentials securely with the correct UID and mode; do not reuse this demo key. Never commit credentials, paste them into tickets, expose them to the browser or log JWTs/OAuth tokens/save links.

Where the platform cannot mount a file (Railway), deliver the key as `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`: the key file's JSON, base64-encoded on one line (`base64 -i key.json | tr -d '\n' | pbcopy`, pasted straight into the dashboard). Set `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE=/tmp/loynara-google-wallet/service-account.json` beside it, on web and worker only. Once the configuration gate passes, the web start guard and the worker write the key there before anything reads it: a 0600 file in a 0700 directory owned by the runtime user, outside the application, replaced atomically on every start and gone with the container. The gate refuses the value without enabled, published and production-approved Google, a demo/test/preview service account, placeholder text or anything that is not a 2048-bit-or-larger RSA service-account key. Nothing is logged. Without the value, nothing changes.

Plan rotation and revocation through Google IAM. Create and authorize the replacement with explicit approval, switch the secret file, restart the affected processes, verify access, then revoke the superseded key. Custody failures stop the Direct path. Retire the demo credential after acceptance when the authorized operator approves that account action.

## Projection and recovery

The loyalty ledger is authoritative. Google receives its latest projection and never awards stamps. Each credential generation has a stable object ID containing the pass UUID and SHA-256 of issuer/tenant/location/program/class. Duplicate customer requests reuse that projection. Stamp changes PATCH the same object. Closure/reissue makes the old object INACTIVE and clears its barcode, balance and locator; a new credential generation receives a different object.

The pass QR contains the existing opaque scan locator. It identifies the customer card and grants no cashier authorization. The Save JWT references only the existing object and class IDs; it contains no card bearer token, scan code or signing key. Saving still requires an eligible Google account in Demo Mode.

Membership issuance locks and Google pass write locks serialize local lifecycle decisions and provider writes. Workers reread the ledger after obtaining the lock. Pending issuance immediately queues durable recovery, including uncertain provider-create responses. Retries reuse the same object ID and reconcile the current balance, rather than replaying a stale delta. Existing lease supervision bounds worker processes; Direct operations have a 60-second budget and each fetch a maximum 15-second timeout. The customer request shares a 65-second deadline across its upload, pool acquisition, SQL and provider work; its connection has a 10-second SQL timeout and 5-second lock timeout.

Failed or blocked refresh jobs remain visible to operators. Replay after fixing the exact credential/binding/provider cause; a later successful refresh suppresses obsolete failures for the same membership. Provider OFF preserves ledger and provider records but stops synchronization, including withdrawal. Turning a provider off alone does not deactivate a saved pass.

## Classes, assets and publishing

Allocate one approved class per merchant/location/program binding under the Loynara issuer. Do not mix independently branded programmes in a shared class. An owned issuer does not establish merchant trademark permission or universal Google publishing approval. Obtain merchant branding and programme-rule consent and verify each class's fields/review state. Published mode requires an existing APPROVED class; the application cannot silently create a missing production class. Demo Mode may create the one explicitly approved synthetic class.

Google must fetch the logo without customer authentication. The isolated demo guard permits one exact approved programme PNG on a separate HTTPS origin, optionally carrying its content revision. Never expose the customer application, auth pages, card URLs, credentials or arbitrary programme assets to solve logo fetching. Any temporary public logo routing requires owner approval and should return 404 for unrelated paths.

The real demo API returns the legacy `approved` review alias and adds read-only `kind` metadata to images. The client accepts documented review aliases, ignores that metadata when comparing branding, and includes `UNDER_REVIEW` whenever branding actually changes. Google's class auto-approval is separate from the issuer's public publishing access. See the [class review field contract](https://developers.google.com/wallet/reference/rest/v1/loyaltyclass) and [documented review aliases](https://developers.google.com/wallet/reference/rest/v1/ReviewStatus).

The German and French Add to Google Wallet SVGs are unmodified official assets downloaded on 9 October 2026 from https://developers.google.com/static/wallet/download-assets/add-to-wallet-svg.zip. They are displayed at 199 × 55 with eight pixels of surrounding space. See [Google loyalty branding guidance](https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines) for asset and logo requirements; public merchant branding requires its own verification.

Remaining publishing work: truthful business-profile verification, demo class/pass evidence, approved merchant logos and required pass information, founder-authorized publishing request, Google's issuer approval, class approval, separate production credentials and access, quotas/monitoring, Android compatibility evidence and a separately authorized deployment/schema/activation. Never fabricate legal/business details or submit a publishing request from demo acceptance alone.

## Acceptance record

Automated checks cover hybrid routing, OFF/scope denial, frozen identity, duplicate issuance, +1/replay/correction/redemption/closure, concurrency, uncertain-create recovery after a fresh worker, HTTP deadlines, restricted credentials and Apple/NFC regressions. Review found and corrected the body deadline and maintenance-while-issuance-paused edges.

Real-device save, appearance, same-pass updates and void require the owner's observations. Record provider HTTP response times separately from handset update times. An API 200 does not prove a saved pass changed on Android. The existing NFC card and previously accepted Apple pass are excluded from the synthetic Google lifecycle test. Track issuer, installation, lifecycle and production activation evidence in LOY-108, LOY-110, LOY-112 and LOY-114, leaving production gates open.
