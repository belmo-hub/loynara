# Launch blockers — 2026-09-25

The repository is a local, synthetic-data build. **It has not been publicly deployed or used with real merchants or customers.** External expenditure during this run: **€0**. The draft €49/location/month (excluding any applicable VAT) is proposed merchant pricing, not an incurred charge or an approved tax position.

## Before any public browser-card pilot

1. **Operator identity and permission:** establish the business operator, the right to conduct this activity, invoicing/tax position, customer support contact and merchant contract. Code cannot approve business-operation or self-employment permission.
2. **Legal/data review:** replace the conspicuously draft privacy and participation pages with reviewed operator-specific terms, lawful-basis/consent wording, processors, retention periods, and cross-border details if Morocco is used. Implement and verify deletion/pseudonymisation and customer contact verification/recovery workflows with appropriate ledger retention.
3. **Production infrastructure:** provide a separate PostgreSQL deployment, HTTPS domain/reverse proxy, private secret storage, isolated preview environment, supervised web and worker services, access controls, encrypted offsite backups and restoration drills. Run migrations and a production-specific security review before traffic. The local Docker database, Mailpit and demo credentials are forbidden for production startup.
4. **Public abuse/security controls:** add distributed rate limits for sign-up, enrollment, QR/card lookups and contact actions; review recovery-token sharing, credential reset and session policy, logs, error handling and upload behavior. Redact bearer card-token and Apple device-library-ID URL paths from reverse-proxy/access logs. The demo form currently has only a per-email limit and a honeypot. Test role boundaries through HTTP/browser sessions as well as domain tests.
5. **Operational verification:** complete a clean install/start, browser regression, backup/restore check, worker failure/replay drill and dependency/security review on the exact release. Review screen-reader/keyboard and real checkout hardware behavior. Browser emulation is not physical-device verification.

The current `npm audit --omit=dev --json` reports **4 moderate** transitive findings and no high/critical findings. The path runs through `better-auth` → `drizzle-kit` → `@esbuild-kit/core-utils`/`esbuild@0.18.20`, including [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). The development server is bound to `127.0.0.1` to reduce exposure while using this local build. No automatic dependency override or unverified fix was applied; recheck upstream releases and the exact resolved tree before public deployment.

The browser-card journey can be piloted with wallet and live billing disabled after these gates and an explicit deployment destination approval. No wallet provider is required for the browser card.

## Additional gates for optional integrations

| Integration | Exact external prerequisite and remaining verification |
| --- | --- |
| Apple Wallet | Apple Developer Pass Type ID, matching pass certificate/private key and WWDR chain, stable web-service secret, public HTTPS URL, APNs reachability, Apple device. Install, register, award, push, fetch, redeem and QR scan on device. Test certificate expiry/rotation. |
| Google Wallet | Wallet issuer and authorized service account, enabled API, public HTTPS logo, designated demo test accounts then publishing approval, Android device. Save, update, scan and proximity behavior must be checked. Google controls nearby presentation. |
| External email | Approved sender/domain, customer email verification, consent and unsubscribe flow, suppression/quotas, delivery and bounce/complaint webhooks, reviewed campaign; explicit permission for a specific promotional send. Local Mailpit is a sink, not proof of deliverability. |
| Billing | Select payment provider per jurisdiction, obtain test account/keys, implement hosted checkout/portal, signed idempotent webhooks, tax/invoice treatment and cancellation/grace behavior. `manual_pending` is a draft state, not a subscription entitlement or live payment. |
| Morocco | Separate legal, data transfer, language and payment review. MAD configuration and French enrollment copy do not establish Moroccan launch readiness. |

## Product work still open

Multi-location creation/management, full French UI, printed counter sign, spend-based points calculation/rounding, offline earning, referrals, scheduled campaigns/reminders, a rule-based Insights adviser, and broader retention/deletion administration are unfinished. Exports are JSON endpoints; verify the end-user download flow. Do not advertise these as available.

Further spending is **not incurred or authorized here**. A future public release will likely need hosting/domain and may require paid provider or developer accounts; exact amount depends on chosen services and should be confirmed before purchase. See [RUNBOOK.md](RUNBOOK.md) and [WALLET.md](WALLET.md) for setup boundaries.
