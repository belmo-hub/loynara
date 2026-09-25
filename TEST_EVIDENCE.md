# Test evidence

Run date: **2026-09-25**. This file records observed local results. It does not establish production, provider, or physical-device readiness.

## Operations and local email

| Check | Observed result |
| --- | --- |
| `npm run test -- src/lib/email.integration.test.ts` | 6/6 passed after the final email change. Includes verified-contact and tenant-owner gates, bearer-card-token preference access, withdrawal or owner revocation before send, and real worker suppression without contacting Mailpit. |
| `npm run typecheck` and `npm run lint` | Exit 0 after the email worker/API changes. |
| `npm run diagnose` | Exit 0 against local PostgreSQL and Mailpit; wallet integrations reported disabled. |
| `npm run db:seed` twice | Both exited 0. The synthetic demo retained one owner, one cashier, one membership, and one ledger entry, so seeding did not award twice. |
| `npm run backup` then `npm run restore-check` | Both exited 0. The initial isolated restore checked 1 tenant, 1 membership and 1 ledger entry. A fresh backup after the final migration restored 2 tenants, 6 memberships and 10 ledger entries, required tables, and the append-only ledger trigger; each temporary database was removed. |
| `npm start` with local `.env` | Exited 1 before Next startup, rejecting local database/URLs, enabled public registration, and the demo credential file. This is the expected production guard result. |

An explicitly requested **local-only Mailpit smoke test** used an opted-in, simulated verified `smoke-…@example.test` contact in `looplocal_test`. The owner queued a message and the real worker completed it. The first run grew Mailpit's inbox from **0 to 1**; after the final email change, a repeated run grew it from **1 to 2**. The outbox status was `complete`; the captured subject was `[LOCAL TEST] Local Mailpit smoke …`; Mailpit showed the synthetic `.test` recipient. The temporary PostgreSQL fixture was cleared afterward (`tenants=0, members=0, jobs=0`). Two synthetic messages remain in the local Mailpit inbox. No external relay was configured or used. This does not verify an external provider, real recipient delivery, unsubscribe flow, or live campaign.

## Application test/build gate

| Command | Observed result |
| --- | --- |
| `npm test` | **11 test files, 58/58 tests passed** after the pricing and security changes. Uses the dedicated `looplocal_test` database. |
| `npm run typecheck` | Exit 0 after the pricing, Playwright and security changes. |
| `npm run lint` | Exit 0 after the pricing, Playwright and security changes. |
| `npm run build` | Exit 0 after the pricing and security changes; Next.js compiled 31 static pages plus dynamic routes. This did not deploy the application. |
| `npm run diagnose` | Exit 0; local database and Mailpit reachable, Apple/Google Wallet disabled. |
| `npm ci --no-audit` | Clean lockfile reinstall exited 0 and installed 481 packages; dependency audit was run separately. |
| `npm run local` after clean install | Applied migrations, reused synthetic seed, diagnostics passed, and Next.js became ready on loopback. This was a local start, not a public deployment. |
| `npm run test:e2e` | **1/1 Playwright test passed in 4.0 s** against the local app with installed Chrome. It used fresh synthetic membership and cashier data. |
| `npm audit --omit=dev --json` | 4 moderate transitive findings, 0 high/critical; see [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md). |
| `gitleaks git --staged --redact` | Exit 0; scanned about 1.05 MB of staged source/artifacts and found no leaks. Local `.env` and `var/` files are ignored. |

The local suite covers persisted onboarding and shared-config draft subscription pricing; a concurrent same-account onboarding race; bounded JSON request bodies; contact-free enrollment and separate consent; programme version/type lock; idempotent award; competing redemption; cross-tenant and revoked staff denial; cashier limits; linked corrections; staff invitation/revocation; queued-marketing suppression after withdrawal; provider-disabled wallet jobs preserving the committed balance; Apple signed-pass fixture and web-service registration; Google JWT/create/patch test responder; prospect import/sending eligibility; and production/local configuration guards. Wallet fixture tests do **not** contact Apple or Google.

## Browser checks

The application was opened in the in-app browser with synthetic data. A merchant signed up and onboarded; a customer joined from the public QR without email or marketing opt-in; the browser card showed the account; the cashier manually looked it up, awarded 5 stamps, then redeemed an 8-stamp reward; the card balance/activity and owner dashboard reflected the transactions. The owner changed the reward cost from 8 to 7, and created, accepted and revoked a staff invitation. A cashier could not access owner staff administration; after revocation, the cashier view displayed a blocked state and removed transaction controls. The latest homepage displayed the configured draft €49 price and actual synthetic card/cashier screenshots. A synthetic `example.test` demo request submitted through the form returned the stored-request confirmation; no email was sent.

The actual seeded customer QR SVG returned HTTP 200 and was decoded. Its payload was exactly the random `scanCode`; the bearer card recovery token and email were absent. This checks the rendered QR, not only the source variable used to generate it.

Persistence was checked across an application restart: a synthetic customer's prior +1 stamp and balance **1** remained visible in a fresh browser tab after stopping the dev server and restarting with `npm run local` following the clean install.

Onboarding, dashboard, cashier and customer card screens were inspected manually at desktop width 1280 px and phone width 390 px. Actual captures are under [`screenshots/`](screenshots/): `onboarding-desktop.jpg`, `dashboard-desktop.jpg`, `cashier-desktop.jpg`, `card-desktop.jpg`, and their `*-mobile-viewport.jpg` counterparts. The automated [`e2e/local-journey.spec.ts`](e2e/local-journey.spec.ts) created a fresh synthetic guest without email, checked the rendered QR, signed in a cashier, performed manual lookup, confirmed redemption was disabled before earning, awarded the reward cost, reloaded the card to confirm balance/activity, redeemed, and reloaded again to confirm zero balance and both activity entries. Camera scanning, physical iPhone/Android behavior, real Wallet installation, APNs and provider Save/update calls were **NOT RUN**. Browser emulation is not physical-device verification.

[SOURCES.md](SOURCES.md) lists official documentation consulted. Documentation links and fixture tests are not provider acceptance evidence.
