# Stage-A URI and logging evidence

Inspection date: **30 September 2026**. Runtime web/worker source: reviewed `e94fd5c1fa20da5b4fbdcb086ad01034947bcea0`; backup/ops source: reviewed `90ad26a0f3553c89f17ce5d07e8246591240b852`. This is bounded Gate-1 operational evidence, not a new application security review or Gate-7 approval. No customer credential values are included.

## Actual Cloudflare configuration

Authenticated dashboard inspection of the existing `getloynara.com` zone/account found:

| Feature | Observed configuration / availability |
| --- | --- |
| Zone plan | **Free**, active |
| Logpush | **NO enabled destination found**. Zone and account screens show paid-plan/contact-sales onboarding; raw HTTP request Logpush is **NOT AVAILABLE** on this plan. |
| Logpull retention | **NOT AVAILABLE** on Free; no retention setting was enabled. This is not a statement about all Cloudflare internal retention. |
| Log Explorer | **NO subscription/dataset enabled**; dashboard displays purchase onboarding. No purchase was made. |
| Instant Logs | **NOT AVAILABLE** on Free under the documented Business/Enterprise eligibility. |
| Workers routes | **None configured** in this zone; overview reports no connected Workers. No custom Worker recording these application URLs was found. |
| Custom logging/export destination | **None found** in the inspected Logpush/Explorer/Workers configuration. |
| Web Analytics | Account shows onboarding/add-site, not a configured site. No tracking setup was added. |
| Security Events / security analytics | Standard sampled security telemetry remains available. The inspected 24-hour Security Events view had no matching events. Its absence is not URI-redaction evidence. No security rule was added to manufacture events. |
| Customer Metadata Boundary | **NOT AVAILABLE** on the current Free subscription; no EU customer-log boundary was configured. |

The previously failing sampled-log query was not retried for this checkpoint. No logging product, retention option, paid service, Worker or tracking pipeline was enabled.

## Provider boundary and official documentation

Cloudflare terminates/proxies application HTTPS and can process the HTTP URI and forwarded bodies/headers. Its HTTP request dataset defines `ClientRequestURI` as path plus query; `ClientRequestPath` excludes the query. This establishes a processing boundary, not proof that a particular dataset is enabled. [HTTP request dataset](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/).

Raw HTTP Logpush and Logpull are Enterprise features; the paid Workers trace exception does not make the zone HTTP dataset available on Free. Instant Logs requires Business/Enterprise. Log Explorer is a paid add-on without a free version. [Logpush](https://developers.cloudflare.com/logs/logpush/), [Logpull](https://developers.cloudflare.com/logs/logpull/), [Instant Logs](https://developers.cloudflare.com/logs/instant-logs/), [Log Explorer FAQ](https://developers.cloudflare.com/log-explorer/faq/).

The Logpull documentation says its HTTP-log retention is disabled by default and describes explicit activation. That statement is specific to Logpull; it does **not** prove Cloudflare stores no traffic metadata internally. Free security analytics has up to seven days of history and Security Events up to 24 hours. [Logpull retention](https://developers.cloudflare.com/logs/logpull/enabling-log-retention/), [Security Analytics](https://developers.cloudflare.com/waf/analytics/security-analytics/), [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/).

Cloudflare documents Customer Logs, including request URLs, separately from its operational metadata. Customer Metadata Boundary requires the Enterprise Data Localization Suite. No account-specific assurance about internal locations or retention was obtained here. Gate 7 must review Cloudflare's processor role, applicable [customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), international processing, security telemetry, retention/access and customer disclosures. [Metadata Boundary](https://developers.cloudflare.com/data-localization/metadata-boundary/), [FAQ](https://developers.cloudflare.com/data-localization/metadata-boundary/faq/).

## Current route/value classification

**RC real-customer use: NO for every row.** A bounded count-only production query after synthetic-owner cleanup returned tenants 0, locations 0, memberships 0 and ledger entries 0. Earlier real-inbox/device tests used synthetic cards on the separate device-test system; they do not establish general customer use on this RC. Wallet providers and physical NFC remain inactive/unverified.

“Our logs” means the observed application stdout/Railway service logs and connector logs, not business tables. Actual card/contact/session/provider state is deliberately stored in the database under its existing architecture. “NO observed” is bounded canary evidence, not an eternal logging guarantee.

| Value / route family | Lifetime | Authorization power | Expiry / invalidation | Replay impact | Cloudflare sees value in HTTP URI? | Our logs persist it? |
| --- | --- | --- | --- | --- | --- | --- |
| Browser `card_…` in `/card/[token]`, `/api/card/[token]`, Wallet issuance endpoints | Persistent bearer | Customer card access and existing card-authorized recovery/contact/preferences/export/closure/referral actions; not unauthenticated staff ledger award/redemption | No fixed TTL; recovery rotation or card closure invalidates it | Reusable access until invalidated | **YES**, path | **NO observed** |
| Recovery challenge in `/recover/confirm#token=…` | One-time | Inbox ownership proof, recoverable-card selection and explicit credential rotation | 20 minutes; consumed atomically on completion | Used/expired challenge rejected; safe GET does not rotate | **NO**, fragment is not sent in HTTP; token subsequently enters POST body, which proxy processes | **NO observed** |
| Recovery-contact verification challenge | One-time | Verify only the requested recovery method | 30 minutes; replaced/consumed/expired challenge rejected | Cannot verify repeatedly or silently opt into marketing | **NO** for fragment; explicit POST body is processed by proxy | **NO observed** |
| Opaque authenticated unsubscribe token in `/unsubscribe#token=…` | Persistent, purpose-scoped | Withdraw email marketing for scoped contact/membership; no card/balance/recovery access | No fixed expiry while key/contact valid; key retirement needs an old-link policy | Idempotent opt-out; repeated request stays generic | **NO** for fragment; explicit POST body is processed by proxy | **NO observed** |
| `sc_…` QR/scan code, including `/api/qr?value=…` | Persistent pseudonymous identifier | Staff-authenticated lookup/checkout identifier; not the browser-card bearer | Closure retires scan code | Staff and tenant authorization still required | **YES** when included in query | **NO observed** |
| NFC public tag reference and dynamic `e`/`c` | Counter-bound authenticated message, not AES key | Conditional secure-tap proof with existing membership binding and approved fixed-stamp controls | No wall-clock TTL implied; consumed/stale counter and revoked tag rejected | Captured unused valid reads have the documented pre-read risk; counter/cooldown are not proof of purchase | **YES**, path/query | **NO observed** |
| Apple device ID, pass type, serial/update cursor | Persistent pseudonymous identifiers | Device ID can identify its registered serial/update list; pass fetch/register/unregister additionally use `ApplePass` header authorization | Registration/pass lifecycle; no invented TTL | Repeated update lookups are possible; authenticated mutations remain controlled | **YES** for path identifiers; auth token is a header, push token a body | **NO observed** |
| Google Save JWT and object identifiers | Signed save capability / persistent object identifiers | Save supplied loyalty object; not a browser-card credential or Google API access token | Current Save JWT has `iat`, no explicit `exp`; object lifecycle applies | Repeated Save behavior is provider-controlled | Google Save JWT goes to **Google's** save URL, not normally a Loynara/Cloudflare URI. Local Wallet-save route's card bearer is covered above. | **NO observed** in local Wallet probes; provider not activated |
| Google merchant-logo programme ID | Public asset identifier | Read public branded logo only | Asset/programme lifecycle | Public asset can be fetched again | **YES** | No secret to redact; no canary observed |
| Auth sign-in/session | Password in POST; session in secure HttpOnly cookie | Merchant session according to existing roles/tenant checks | Better Auth session seven days; revocation/lifecycle applies | Valid session cookie can authorize until expiry/revocation | **NO** credential in normal auth URI; proxy processes body/cookie headers | **NO observed**; session IP storage is a separate Gate-7 TODO |

Sources inspected: `src/lib/product.ts`, `card-recovery.ts`, `contact-verification.ts`, `contact-token.ts`, `unsubscribe.ts`, `secure-tap.ts`, `wallet/{data,apple-service,google}.ts`, `auth.ts`, relevant card/recovery/unsubscribe/QR/Wallet/auth handlers and fragment-removing client pages. Apple optional client diagnostics endpoint discards supplied diagnostics rather than persisting them.

### Separate pre-commercial hardening item

The **long-lived browser-card bearer in URL paths** is a real security/privacy hardening item even when our application logs omit it. Reverse proxies, browser history and shared links can process it. Before commercial use, review a fragment bootstrap → one POST body exchange → secure HttpOnly session/cookie → cleared bootstrap URL design, including recovery/closure and Wallet issuance behavior. **Not implemented or approved by this infrastructure checkpoint.** Do not equate this bearer with opt-out-only unsubscribe, one-time recovery proof, scan identifiers or encrypted public NFC data.

## Controlled logging evidence

At **2026-09-30 13:00:41 UTC**, bounded synthetic probes covered private-card path, recovery POST token, unsubscribe POST token, QR query, NFC dynamic query, Apple issuance/callback authorization and auth query. No real card/scan/key/session was used. The probes returned the expected 404/400/200 or disabled-Wallet 503 states; no email or award was requested.

The synthetic marker was absent from inspected deployment logs: **web 37 entries, worker 56, cloudflared 7** (250-entry request bound, actual result counts smaller). Web application stdout is captured by Railway; no separate URL/request-file logger was found. Unexpected HTTP errors log class only; ingress failures emit the reviewed bounded constant event. Connector warn-level startup/connection logs contained no marker. The web has no public Railway HTTP origin, so there is no public Railway HTTP-edge request path in this architecture. These are observed controlled-layer results; Cloudflare's standard security telemetry and inherent provider processing remain the boundary above.

Local ignored evidence: `var/gate1-evidence/log-canaries-20260930.json`. No real secret was searched for or copied into evidence. No optional raw HTTP logging/custom export was enabled. Under the owner's clarified acceptance model, **Gate-1 logging evidence is acceptable**, with Gate-7 processor review and the separate URL-bearer hardening item outstanding. Gate 7 is not PASS.
