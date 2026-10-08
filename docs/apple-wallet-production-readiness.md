# Apple Wallet production readiness

This branch starts from production `b6f55c45f9f63873df3787be6f16819c58c2f5eb` and incorporates only the reward presentation fix from `2c16775abc1c562da5cf9e6b2dfdf827681483c1`, plus the timeout and tenant-binding safeguards described here. Production activation stays OFF. The completed real Loynara → PassFast → iPhone acceptance remains the device evidence; this branch makes no real provider requests.

## Display contract

Published V2 template `0d283e79-17ba-48ca-9b2d-438487644190` belongs to app `fe0f1e68-4655-41d2-b805-813281911f79`. The retained, sanitized published readback is an offline fixture. All eleven required data fields retain their types: balance/rewardCost are numbers and the other fields are strings. rewardReady is localized customer text (`Prämie bereit` / `Récompense disponible`) or an empty string, including retirement. QR uses scanCode with cardLocator as alternate text. No loyalty/provider balance is imported into the ledger.

V2 contains static German labels, colors and Loynara branding. A merchant's database logo/color is not dynamically substituted into this template. Each merchant template must be reviewed and published for its actual branding and language; retain the eleven-field contract and barcode bindings. The existing V2 may be assigned to one approved tenant. Do not silently reuse that template for multiple tenants.

## Operator-controlled template selection

Production requires server-only `PASSFAST_TENANT_TEMPLATES`, a JSON array:

```json
[{"tenantId":"<actual database tenant UUID>","templateId":"<approved published merchant template UUID>"}]
```

Resolve actual tenant identities through authorized operator records. Never guess them. Entries accept only those two UUID fields; duplicate tenants, shared templates, malformed/empty mappings and credential fields are rejected. Maximum 500 entries / 64 KiB. A request cannot choose an app, key, tenant, template or serial: the current card identifies its database tenant and durable projection. Unmapped tenants cannot create a projection or contact PassFast. Owner readiness is tenant-aware. The global public capability endpoint reports deployment capability; an unmapped card can still see a button but issuance fails closed.

`PASSFAST_TEMPLATE_ID` remains available only as a nonproduction compatibility fallback when the allowlist variable is absent. No production fallback exists. The mapping is configuration, not a new database table: **no migrations required**.

Provider serial lookup must return the expected app_id, template_id, external_id equal to the original serial, serial_number and wallet_type. Missing/foreign metadata fails before update/void. Existing template mappings must remain stable while passes exist: changing an entry fails closed on its existing passes instead of generating/rebinding an identity. Retire passes under the old mapping before separately planning a template rotation. Removing a mapping prevents pending cleanup too; keep it until retirement completes.

All tenants use the platform's existing server credential and app. Merchants cannot read or supply those credentials. PassFast keys have full-account permissions; this is application-level tenant isolation, not provider-enforced credential scoping. A compromised server key or provider-account administrator retains account-wide access. Operator mapping approval remains a trust boundary: code checks uniqueness and returned identity, but cannot independently infer which merchant owns a branded template. Published app ownership, field contract, branding and language must be verified before adding each mapping. No merchant credential self-service is introduced.

## Timeout and recovery

Successful local award/correction updates took roughly 12–13 seconds, beyond the old 10-second limit. Each request now has a fixed 45-second limit across headers and streaming body. Redirects remain rejected; reconciliation uses no-store. JSON is capped at 64 KiB and PKPass at 5 MiB. A stalled or oversized stream is canceled, with only generic errors exposed.

A shared 240-second provider-operation deadline covers both platforms in one refresh, and synchronization plus download in one Apple request. Each request uses the smaller of 45 seconds and the remaining budget. This stays below the existing five-minute worker lease; lock waits are capped at five seconds and SQL statements at ten seconds in synchronization transactions, including the independently committed pending → creating update. The deadline prevents a late DB/pool wait from starting new provider requests. General database/pool availability is still required; this does not promise an end-to-end HTTP duration under database outage.

There are no immediate transport retries. The unchanged durable worker retains five maximum claims, fenced outcomes and the existing 60/240/960/3600-second backoff. The pass lock serializes callers. Stable serial/external identity and get_or_create remain intact; lost generation responses reconcile before another generation attempt. Closure/reissue never generates a replacement for a retired credential. Provider failure leaves the committed loyalty ledger untouched.

## Minimal release procedure (requires separate release authorization)

1. Review this branch and its verification results, then merge the reviewed commit. Build/release web and worker together with `PASSFAST_ENABLED=false`, direct Apple/Google flags OFF and production Wallet approval unchanged. Do not enable Wallet as part of the code release. No migration is needed.
2. Before any later activation, have the operator verify each selected published template's app, contract, platform support, branding and locale. Install an explicit unique tenant allowlist in both web and worker. Use `PASSFAST_WALLET_TYPES=apple` for an Apple-only release; prior iPhone acceptance does not establish physical Google acceptance.
3. Confirm both processes pass the existing production configuration/runtime checks, worker lease remains five minutes, and the hosting request duration permits the bounded Apple synchronization/download path (up to the 240-second provider budget plus DB overhead). No infrastructure setting is changed by this branch.
4. Obtain separate approval for activation and any real customer issuance. Then activate the approved tenant pilot only. Observe queue attempts/delays and generic provider failures; retain stable mappings through cleanup. Do not repeat standalone or physical iPhone tests solely for this code release.
5. If necessary, turn PassFast OFF to stop new issuance/provider processing; retain pending jobs, ledger data and stable identities. Roll back code only with the compatible configuration. Disabling processing also pauses pending revocation; operator cleanup needs a separately approved, enabled path. Never mass-regenerate passes to recover a timeout.

Remaining activation prerequisites are operator-approved merchant templates/mappings, shared full-account credential risk acceptance, host request-duration confirmation, and separate activation authorization. They do not require schema changes or another broad audit.

## Verification — 2026-10-08

- Complete repository test command on exclusive localhost PostgreSQL: 117 files passed, 1,061 tests passed, one optional Mailpit smoke test skipped (`MAILPIT_SMOKE` not enabled).
- Focused mocked provider/worker tests cover lost-create/void responses, same-identity recovery, independent platform failure, five bounded worker attempts/backoff, reward presentation, tenant bindings and input spoofing, strict provider identities, shared operation budget, stalled body cancellation and the five-second pending-row lock limit.
- Offline published V2 contract tests pass. A mocked 12.5-second update succeeds with the new transport timeout.
- `next typegen`, `npm run typecheck`, `npm run lint`, `git diff --check`: pass.
- `npm run build`: passes with all Wallet flags OFF, synthetic auth configuration and the disposable localhost database; no provider access or deployment.
- Fresh scoped read-only code review: no outstanding findings. No production configuration, customer data, NFC, billing or concurrent branch changes.
