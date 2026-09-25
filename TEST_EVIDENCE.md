# Test evidence

Run date: **2026-09-25**. This file records observed local results. It does not establish production, provider, or physical-device readiness.

## Separate HTTPS device-test preparation after `4714eb5`

`npm run device-test:prepare` exited 0 on a fresh separate Compose volume, applied auth/app migrations, compiled into ignored `.next-device-test`, and started the worker for **one pass with 0 due jobs**. This is a build-only artifact with no approved origin; Better Auth emitted expected missing-base-URL warnings, and the runtime launcher always rebuilds after the origin is supplied. `var/device-test.env` is ignored and mode **0600**; the database binds only `127.0.0.1:54331` and contained **0 users, 0 tenants, 0 memberships**. Port 3002 had no listener, while the existing port-3001 preview health returned HTTP 200. `npm run device-test:start` and the device-test worker command exited 1 before startup because the approved HTTPS origin and Access team/AUD are absent. Configuration tests reject localhost, mismatched URLs, PostgreSQL URL overrides, missing Access values and enabled external integrations. The Cloudflare YAML template parsed with Ruby and was checked against official syntax; `cloudflared` is not installed, so live ingress validation was **NOT RUN**.

The current app regression gate after local preparation and the merchant-link origin fix: `npm test` **19 files / 83 tests passed**, `npm run typecheck` and `npm run lint` exited 0, `npm run test:e2e` **7/7 passed**, and the separate device-test build completed. `/api/me` now returns the configured public origin even for a private loopback request; merchant enrollment and staff invitation links use it rather than the browser's loopback origin. No approved HTTPS address, Access policy, tunnel, DNS record, physical device action, provider call, or Wallet pass test was performed. Spending incurred: **€0**.

## Current synthetic release candidate

The clean starting commit was tagged `checkpoint/pre-demo-rc-20260925` before changes. The checks below exercise this candidate; the older operations and browser notes further down are historical baseline evidence.

| Check | Observed result |
| --- | --- |
| `npm ci --no-audit` | Exit 0, 481 packages from the lockfile. Audit was run separately. |
| `npm test` | **16/16 files, 74/74 unit/integration tests passed** on the separate local `looplocal_test` database after isolating the Apple device fixtures. Covers rate limits, bounded QR input, closure/worker concurrency, transaction locking/idempotency, auth, Wallet fixtures and configuration guards. |
| `npm run typecheck`, `npm run lint`, `npm run build` | All exit 0 on the combined candidate; Next 16.3.6 compiled and generated 31 static pages plus dynamic routes. A prior lint run found a CommonJS import style error in the new preview browser script; converting it to `.mjs` resolved it before this final pass. |
| `npm run test:e2e` | **7/7 Chrome/Playwright browser tests passed** against the local development app: separate tenant/owner/cashier/revocation HTTP sessions, transaction retry and simultaneous redemption, export downloads, join→manual lookup→award→redeem→reopen, mobile 360/390 layout and enlarged-text scrolling, and 3 scanner-emulation tests. |
| `npm run preview` | Applied auth/app migrations to isolated `looplocal_preview` PostgreSQL on `127.0.0.1:54330`, seeded synthetic data, ran `next build` with typecheck, started a worker, then started **compiled** Next with `next start --hostname 127.0.0.1 --port 3001`. Repeated after the final security fixes. This bypasses only the local preview launcher, not the production guard. `var/preview.env` and `var/preview-access.json` are ignored and mode 0600. |
| `GET http://localhost:3001/api/health` | HTTP 200; database reachable. Apple and Google status both `enabled:false, ready:false`. Worker process held a connection to preview PostgreSQL. |
| `npm run preview:browser-check` | Chrome/Playwright against compiled localhost:3001: fresh contact-free synthetic join, card reopen and QR, seeded cashier login, manual scan-code lookup, default award 1, award to threshold 8, explicit redemption, reopened card balance 0 and deduction activity. It checks exact preview origin/configuration and prints no bearer token. No physical camera was used. |
| Compiled preview restart | Web/worker stopped and `npm run preview` restarted. The seeded bearer card API returned HTTP 200 with balance **3** and one activity entry both before and after the final restart; an earlier Chrome check reopened a newly transacted card at balance 0 with redemption activity. No token was printed. |
| `npm run preview:worker -- --once` | Exit 0 with 0 due jobs. A deliberate synthetic failed-job replay separately moved `failed:1 → pending:0 → failed:1`; the invalid drill job was then removed. External providers stayed off. |
| `npm run preview:backup` and `npm run preview:restore-check` | Exit 0 after the final browser run; isolated restore found **1 tenant, 9 memberships, 20 ledger entries** and required database objects including the append-only trigger. |
| `npm start` using local demo/preview files | Expected exit 1 before Next starts: local database/URLs, public merchant registration and local demo/preview credentials were rejected. The production guard was not weakened. |
| `npm audit --json`, `npm audit --omit=dev --json`, `npm ls esbuild @esbuild-kit/esm-loader @esbuild-kit/core-utils --all` | Re-run after the final build: both audits reported **4 moderate, 0 high/critical**; `drizzle-kit@0.31.11` directly pulls `@esbuild-kit/esm-loader@2.6.5` → `core-utils@3.3.2` → `esbuild@0.18.20`. No override or downgrade was applied. See [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md). |

Mobile screenshots were captured from the actual browser at **360×800** and **390×844** before and after the card edit: [`screenshots/card-before-360-viewport.jpg`](screenshots/card-before-360-viewport.jpg), [`screenshots/card-after-360-viewport.png`](screenshots/card-after-360-viewport.png), [`screenshots/card-before-390-viewport.jpg`](screenshots/card-before-390-viewport.jpg), and [`screenshots/card-after-390-viewport.png`](screenshots/card-after-390-viewport.png). The final screenshots are from the compiled preview. At 360 px, a complete 188×188 QR sits at y=253–441, the merchant name at y=109–152, and the balance panel ends at y=675, without horizontal overflow. The baseline capture put the QR below the 800 px viewport. Direct Chrome full-page captures were 1843 px before and 1381 px after for a fresh card; the earlier apparently enormous empty page was an in-app capture artifact, not a real large spacer. Activity and rules remain below checkout essentials and normal page scrolling works with enlarged text in browser emulation. The compiled-preview mobile cashier screenshot is [`screenshots/cashier-after-390-viewport.png`](screenshots/cashier-after-390-viewport.png); the camera button begins at y=336. These screenshots are browser evidence, not phone tests.

Final review fixes were regression-tested before the release gate: the preview database URL now requires the exact canonical loopback value, and local/production guards reject PostgreSQL URL overrides that could redirect a checked target; the QR endpoint rejects oversized or malformed content and has a shared peer limit; card closure and the email worker serialize against the same membership lock; closure removes local Apple registrations and orphan device tokens while preserving a device still registered to a live card. The configuration and QR tests were observed failing before their fixes and passing afterward. The app and browser suites above passed after these changes.

The printable local enrollment sign, its generated QR and one-page German product sheet were rendered in Chrome at A5/A4 respectively; each fits one print page in the delivered PDFs. The sign's QR decoded to the compiled-preview synthetic join URL; it is useful on the Mac only until an approved HTTPS destination exists. The actual application journey was also recorded in a silent **64.92-second** compiled-preview browser video at [`demo/looplocal-demo-synthetic.mp4`](demo/looplocal-demo-synthetic.mp4). Frames at 8 s and 62 s were inspected: the complete QR is present and the final activity shows +8 and −8 with balance 0. Its cashier uses **manual lookup**; it does not represent a hardware camera scan. The recording and screenshots precede the final URL/QR guard and closure race fixes; the full compiled browser check was rerun afterward.

**Verification boundaries:** browser scanner emulation, fake-camera stream and release-candidate browser flows are distinct from actual Mac camera use, physical iPhone/Android use, Google test-account issuance, Apple-issued certificate signing and public deployment. All of those physical/provider/public checks are **NOT RUN**.

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
