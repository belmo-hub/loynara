# Apple Wallet production readiness

This engineering branch starts from canonical production `21bf48cb5fdc4139a4b931f282b197c8eb97ec83` (schema 0020, journal 21). It preserves the previously released localized reward presentation and adds asynchronous Apple issuance, fenced worker renewal/monitoring and explicit location-scoped eligibility. Production activation stays OFF. The completed real Loynara → PassFast → iPhone acceptance remains the device evidence; engineering verification uses synthetic data and mocked providers only. See [pilot operations](operations/apple-wallet-pilot.md) for activation, credential, cap and rollback procedures.

## Display contract

Published V2 template `0d283e79-17ba-48ca-9b2d-438487644190` belongs to app `fe0f1e68-4655-41d2-b805-813281911f79`. The retained, sanitized published readback is an offline fixture. All eleven required data fields retain their types: balance/rewardCost are numbers and the other fields are strings. rewardReady is localized customer text (`Prämie bereit` / `Récompense disponible`) or an empty string, including retirement. QR uses scanCode with cardLocator as alternate text. No loyalty/provider balance is imported into the ledger.

V2 contains static German labels, colors and Loynara branding. A merchant's database logo/color is not dynamically substituted into this template. Each merchant template must be reviewed and published for its actual branding and language; retain the eleven-field contract and barcode bindings. The existing V2 may be assigned to one approved tenant/location scope. Do not silently reuse that template for multiple tenants.

## Operator-controlled template selection

Managed Wallet requires server-only `PASSFAST_TENANT_TEMPLATES`, an explicit JSON array:

```json
[{"tenantId":"<actual database tenant UUID>","locationId":"<actual database location UUID>","templateId":"<approved published merchant template UUID>"}]
```

Resolve actual identities through authorized operator records. Entries accept only these three UUID fields. Duplicate tenant/location scopes, shared templates, malformed/empty mappings and credential fields are rejected; maximum 500 entries / 64 KiB. There is no global/default template fallback in any environment. Missing mappings are safe with providers OFF; global enablement alone grants no customer access. Apple-only requires `PASSFAST_WALLET_TYPES=apple` with both native providers OFF.

The current card bearer resolves its database tenant, programme and location for UI, issuance, polling, archive retrieval and worker synchronization. Browser-supplied identities cannot choose a scope or pass. Public GET status reports unavailable defaults; protected same-origin POST status reports only the authenticated card's scope. Unapproved locations cannot create a projection or contact PassFast. Owner readiness resolves the programme's location.

A new managed projection stores a scope fingerprint in its existing provider ID, retaining the same original serial/external generation identity. Tenant, location, App and template are frozen; API-key rotation does not change the binding. Remapped and legacy untagged projections fail closed before provider access. No migration or automatic adoption/backfill is included. Check for any legacy projections before activation and separately review their ownership recovery. Provider metadata must match the expected App/template/external ID/serial/platform before update or void. Retain original mappings through retirement; removing them blocks cleanup too.

All tenants use the platform's existing server credential and app. Merchants cannot read or supply those credentials. PassFast keys have full-account permissions; this is application-level tenant isolation, not provider-enforced credential scoping. A compromised server key or provider-account administrator retains account-wide access. Operator mapping approval remains a trust boundary: code checks uniqueness and returned identity, but cannot independently infer which merchant owns a branded template. Published app ownership, field contract, branding and language must be verified before adding each mapping. No merchant credential self-service is introduced.

## Timeout and recovery

Successful local award/correction updates took roughly 12–13 seconds, beyond the old 10-second limit. Each request now has a fixed 45-second limit across headers and streaming body. Redirects remain rejected; reconciliation uses no-store. JSON is capped at 64 KiB and PKPass at 5 MiB. A stalled or oversized stream is canceled, with only generic errors exposed.

Customer issue/status POSTs have a 15-second wall-clock budget covering body upload, pool acquisition, rate limits and transactions; managed issuance returns 202 promptly without a provider call. The worker prepares the original identity through the existing transactional outbox. Card-scoped status issues a fresh 120-second, two-use ticket only after completion. Customer polling runs every five seconds during active work, uses bounded retry backoff, cancels on unmount, and stops after five minutes. Exhausted failures are not revived by customer replay.

Download GET retrieves the existing archive only: no generation, reconciliation or update. Its 65-second total budget includes bounded database work and one provider GET of at most 45 seconds. Eligibility/current credential are checked again before bytes are released. General published 125-second Cloudflare and 300-second Railway limits exceed these HTTP bounds; confirm the actual deployed ingress settings separately before activation.

The worker retains a shared 240-second provider-operation budget, bounded individual HTTP requests, five claims and 60/240/960/3600-second backoff. Its supervised Wallet subprocess has a 270-second total lifetime including claim/startup/database/network/reaping/outcome overhead. A five-minute lease renews every 30 seconds only while the current attempt remains unexpired after acquiring its row lock. Completion and suppression are atomic under the same ownership fence. Independent bounded monitoring has a dedicated pool. Shutdown stops claims and reaps the child; forced parent death disconnects IPC and exits the child. A failed renewal stops local work rather than leaving another provider writer active.

Stable serials, durable `creating` state and metadata reconciliation recover unknown remote success. A canceled request can still complete remotely, so a retry reconciles the same identity instead of generating a replacement. Provider failure leaves the committed loyalty ledger untouched. Review actual monitor/restart/drain compatibility before activation; lease length alone is not the safety argument.

## Minimal release procedure (requires separate release authorization)

1. Review the clean engineering SHA and verification evidence; obtain separate release approval.
2. Deploy that exact application artifact to web, then worker, retaining rollback artifacts and a single worker process. Keep PassFast, native Apple/Google and NFC OFF and all unrelated variables unchanged. No migration or mapping is required for this OFF release.
3. Verify source identities, health, owner/cashier authentication, ordinary loyalty, customer card/returning join, queue handover, no Wallet buttons and zero provider calls. Confirm schema remains 0020 and journal 21.
4. Stop/roll back on any failed gate. Retain pending jobs and original identities; OFF also pauses provider voids. Cleanup and later activation require separate explicit approval and the [operator procedure](operations/apple-wallet-pilot.md).

Outstanding owner decisions are the one tenant/location/template/App, approved merchant branding/language, supervised cohort/cap and quota thresholds, account-wide credential risk, live monitoring/drain checks, support/cleanup ownership and separate activation approval. Technical readiness does not authorize commercial/legal onboarding.

## Prior released baseline verification — 2026-10-08

- Complete repository test command on exclusive localhost PostgreSQL: 117 files passed, 1,061 tests passed, one optional Mailpit smoke test skipped (`MAILPIT_SMOKE` not enabled).
- Focused mocked provider/worker tests cover lost-create/void responses, same-identity recovery, independent platform failure, five bounded worker attempts/backoff, reward presentation, tenant bindings and input spoofing, strict provider identities, shared operation budget, stalled body cancellation and the five-second pending-row lock limit.
- Offline published V2 contract tests pass. A mocked 12.5-second update succeeds with the new transport timeout.
- `next typegen`, `npm run typecheck`, `npm run lint`, `git diff --check`: pass.
- `npm run build`: passes with all Wallet flags OFF, synthetic auth configuration and the disposable localhost database; no provider access or deployment.
- Fresh scoped read-only code review: no outstanding findings. No production configuration, customer data, NFC, billing or concurrent branch changes.

Current engineering verification and browser limitations: [Apple pilot engineering verification](apple-pilot-engineering-verification.md).
