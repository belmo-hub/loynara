# Official source register

Accessed **2026-09-25**. These links document implementation choices and prerequisites; they are not evidence that a provider integration was tested in this installation. Package versions are fixed by the repository lockfile, not by documentation examples that use `@latest` or prerelease tags.

## Application and data

| Source | Relevant guidance |
| --- | --- |
| [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) | App Router setup, TypeScript/Tailwind defaults, Node.js minimum 20.9, supported browsers. |
| [React `useEffect`](https://react.dev/reference/react/useEffect) | Browser hardware integration belongs in client components with effect cleanup. |
| [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) | `pg` and `postgres.js` connection options. Current examples include `@rc`; use a compatible pinned release rather than blindly copying a prerelease install command. |
| [Drizzle migrations](https://orm.drizzle.team/docs/migrations) | Generate and apply versioned SQL migrations. |
| [Drizzle transactions](https://orm.drizzle.team/docs/transactions) | Group balance, ledger, redemption, and outbox writes atomically. |
| [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next) | Route-handler mounting and server-side session checks. Cookie presence in proxy is only an optimistic redirect check. |
| [Better Auth session management](https://better-auth.com/docs/concepts/session-management) | Database-backed sessions and revocation APIs. Session cookie caching can delay recognition of revocation; evaluate configuration against immediate staff revocation needs. |
| [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) | PostgreSQL adapter and schema mapping. Check the installed version's actual import path because the [installation page](https://better-auth.com/docs/installation) and adapter page currently show different import packages. |

## Checkout scanning

| Source | Relevant guidance |
| --- | --- |
| [MDN `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Camera permission and secure context required; localhost is suitable for local testing. |
| [MDN `BarcodeDetector`](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) | Limited browser availability; do not rely on it as the only scanner. |
| [ZXing browser repository](https://github.com/zxing-js/browser) | `BrowserQRCodeReader` supports webcam scanning and stop controls. This is the library maintainer's own documentation, not a browser standard. |

## Wallet passes

| Source | Relevant guidance |
| --- | --- |
| [Apple pass source](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass) and [pass object](https://developer.apple.com/documentation/walletpasses/pass) | `pass.json`, image assets, store-card fields, serial number, barcodes, and web service metadata. |
| [Apple pass build and signing](https://developer.apple.com/documentation/walletpasses/building-a-pass) | Pass Type ID, certificate, manifest, detached signature, and `.pkpass` packaging. Issuer credentials are required. |
| [Apple pass updates](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes) and [registration endpoint](https://developer.apple.com/documentation/walletpasses/register-a-pass-for-update-notifications) | Device registration/unregistration, pass authentication, push token storage, APNs change notification, and subsequent pass fetch. Production web service requires HTTPS; pass update push works only in APNs production environment. |
| [Apple lock-screen relevance](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen) | Up to 10 relevant locations. Device testing is required; relevance is conditional, not guaranteed appearance. |
| [Google issuer onboarding](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding) and [server credentials](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/auth/rest) | Issuer account, Google Cloud service account, and server-side secret. Creating accounts/accepting terms remains operator work. |
| [Google loyalty class/object creation](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/create) and [Save to Wallet JWT](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/jwt) | Shared class and per-member object, server-signed Save link. Object creation alone does not add a pass to a user's Wallet. |
| [Google class/object updates](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates) | Patch or update after ledger commit; whole-object update can clear omitted fields. |
| [Google Wallet FAQ](https://developers.google.com/wallet/retail/loyalty-cards/resources/faq) | Logo images must be reliably available over HTTPS to render in Wallet; a private Access-gated app origin is not by itself a suitable image host. |
| [Google push and nearby notifications](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications) | Constrained issuer messages and supported field changes; at most three notifying messages per 24 hours. Nearby behavior uses merchant locations and is controlled by Google and user settings. |
| [Google publishing access](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/request-publishing-access) and [prelaunch testing](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/prelaunch-testing) | New issuers are in Demo Mode for designated test accounts; public issuance needs approval and real Android device tests. |

## Controlled HTTPS preview research

| Source | Relevant guidance |
| --- | --- |
| [Cloudflare private web application](https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/private-web-app/) | Tunnel plus Access can protect a self-hosted browser application; requires a Cloudflare account and an active owner-controlled domain. |
| [Cloudflare self-hosted Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) | Set an allow policy before adding a tunnel route; otherwise the hostname can be openly reachable. The connector can validate Access JWTs. |
| [Cloudflare origin Access validation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/) | `cloudflared` can require Access JWT validation before forwarding to a loopback origin. |
| [Cloudflare Zero Trust pricing](https://www.cloudflare.com/plans/) | Published $0 tier for teams under 50 users or proof-of-concept tests; a usable owner domain is a separate prerequisite and may cost money. Verify plan terms again before owner approval. |

## Email and billing

| Source | Relevant guidance |
| --- | --- |
| [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/) and [SMTP](https://mailpit.axllent.org/docs/configuration/smtp/) | Local capture on SMTP 1025 with UI on 8025; this is a test sink and must not be configured to relay external mail in local demo mode. |
| [Mailpit API v1](https://mailpit.axllent.org/docs/api-v1/) and [HTTP sending](https://mailpit.axllent.org/docs/usage/sending-messages/) | The local test worker uses `POST /api/v1/send` with a synthetic `.test` recipient. Local capture is not external delivery. |
| [Nodemailer SMTP transport](https://nodemailer.com/smtp) | A provider-neutral SMTP adapter via `createTransport`. |
| [Stripe Checkout Session](https://docs.stripe.com/api/checkout/sessions/create) and [customer portal session](https://docs.stripe.com/api/customer_portal/sessions/create) | Hosted subscription checkout and portal, when the operator enables a Stripe account and test keys. |
| [Stripe webhooks](https://docs.stripe.com/webhooks) and [signature verification](https://docs.stripe.com/webhooks/signature) | Verify the raw body and signature, process asynchronously, deduplicate event IDs, and tolerate out-of-order events. |

## Limits of this review

This is a documentation review only. No Apple Developer certificate, Google issuer, Stripe account, live SMTP provider, physical device, or provider webhook was accessed or tested. Public claims by Fidelix were not used to infer implementation behavior.

## Package compatibility check

Read-only `npm view` checks against the public npm registry on **2026-09-25** returned `next` 16.3.6, `react`/`react-dom` 19.3.0, `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11, `better-auth` 1.7.6, `@zxing/browser` 0.2.1, `stripe` 22.6.2, and `nodemailer` 10.0.10 as current `latest` dist-tags. The locally selected Next 16.3.6, React 19.2.8, Better Auth 1.7.6, and Drizzle 0.45.3 versions satisfy the checked Next and Better Auth peer dependency ranges. The installed Better Auth 1.7.6 package resolves `better-auth/adapters/drizzle` and `better-auth/next-js`. Dist-tags and peer ranges are not a substitute for the repository's install, typecheck, and build tests.

The current candidate's resolved `npm ls` chain is direct dev dependency `drizzle-kit@0.31.11` → `@esbuild-kit/esm-loader@2.6.5` → `@esbuild-kit/core-utils@3.3.2` → `esbuild@0.18.20`. Both full and `--omit=dev` npm audits still reported four moderate findings. The [esbuild maintainer advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99) identifies the affected development-server behavior and patched release; the [Drizzle upstream issue](https://github.com/drizzle-team/drizzle-orm/issues/5304) tracks the deprecated transitive dependency. Neither source establishes that a downgrade suggested by npm is compatible with this repository's migrations, so no blind override was applied.
