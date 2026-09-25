# LoopLocal runbook

## Local startup

Prerequisites: Node.js 26, npm, Docker with Compose, and free local ports 3000, 54329, 1026, and 8026. From this repository:

1. Run `npm ci`.
2. Copy `.env.example` to `.env`. Replace `BETTER_AUTH_SECRET` with a unique value of at least 32 random characters (`openssl rand -hex 32` can generate one). For the local merchant demo only, set `PUBLIC_REGISTRATION_ENABLED=true`.
3. Copy `.env` to `.env.local`. Keep both files identical: command line scripts read `.env`, while Next.js reads `.env.local`.
4. Run **`npm run local`**. This starts PostgreSQL and Mailpit, applies the auth and Drizzle migrations, creates or reuses synthetic demo data, checks the environment, runs the outbox worker, and starts Next.js.

Open `http://localhost:3000`. Demo owner/cashier credentials, the program slug, and a customer card token are in `var/demo-access.json` (mode 0600, ignored by Git). Treat the card token as a bearer recovery link. The seeded merchant, staff, membership, and ledger activity are synthetic. Repeat startup does not award stamps again. Local seed is explicitly refused for a remote database, a different database name, a nonlocal app URL, or `NODE_ENV=production`.

`npm run test` uses the separate `looplocal_test` database. Its fixtures are cleared between tests; the development database is untouched. `npm run diagnose` reports database/schema, Mailpit, outbox, and wallet configuration status without exposing secret values or sending a message. `http://localhost:3000/api/health` checks database reachability. Mailpit's local inbox is at `http://localhost:8026`.

## Worker and failed jobs

`npm run local` runs a worker alongside the web app. For a single pass use `npm run worker -- --once`. Each worker claims due jobs through PostgreSQL row locking with a five minute recovery lease. Transient provider errors retry up to five attempts with bounded backoff. Missing provider setup leaves an issued pass update **blocked**; it is not reported as delivered. A loyalty award or redemption is already committed before its wallet update job is processed.

`npm run diagnose` shows counts by outbox state. After fixing configuration, replay one reviewed blocked/failed job with `npm run worker -- --replay <job-uuid>`, then run the worker. Do not reset job state directly in SQL. No external email sending is enabled by these operations.

## Compiled LOCAL PREVIEW (synthetic data only)

Run **`npm ci`**, then **`npm run preview`** from this repository. This launcher creates ignored `var/preview.env` (mode 0600, generated auth secret) on first use, starts a separate `looplocal-preview` Docker Compose project and PostgreSQL volume bound to `127.0.0.1:54330`, applies auth and app migrations, seeds only synthetic `var/preview-access.json`, runs `next build`, starts a local worker, then starts the **compiled** Next application with `next start --hostname 127.0.0.1 --port 3001`. Open `http://localhost:3001` and check `http://localhost:3001/api/health`. Registration, external mail, live billing, both Wallet providers, and proxy-IP trust are off. The preview has no Mailpit dependency. The fixed preview URL in `PUBLIC_BASE_URL` means its enrollment links are **Mac-local** and must not be handed to a customer's phone.

The launcher validates the exact loopback origin, database name/port/user, generated secret, and disabled integrations before touching data. `npm start` remains the production command and **still rejects** these local/demo settings; the preview launcher never changes the production guard. Do not copy `var/preview.env`, `var/preview-access.json`, or the preview volume into a real deployment. Stop the preview with Ctrl-C. Its PostgreSQL container and volume persist for a later restart, so balances can be checked after a process restart. In a second terminal, `npm run preview:browser-check` repeats the compiled Chrome journey against fresh synthetic customer data and refuses a non-preview configuration. To inspect one worker pass on the preview database, run `npm run preview:worker -- --once`; replay only a reviewed failed or blocked synthetic job with `npm run preview:worker -- --replay <job-uuid>`. For an isolated preview backup drill, run `npm run preview:backup` and `npm run preview:restore-check`; both use only the preview Compose project. They do not replace production backup planning.

The synthetic A5 [`demo/counter-sign.html`](demo/counter-sign.html) has a decoded QR for this Mac-local preview. Regenerate it after changing the synthetic programme slug with `node demo/generate-counter-sign.mjs`. For an approved HTTPS device test, pass the exact approved HTTPS `/join/<slug>` URL as the argument, verify it resolves through the approved Access policy, and reprint the sign. The checked one-page PDF is a local-preview snapshot and must also be regenerated for any approved HTTPS URL.

### A. Immediate Mac camera smoke test — hardware camera only

1. Run `npm run preview`; read only the synthetic `var/preview-access.json` locally. On the Mac, open its seeded customer card at `http://localhost:3001/card/<cardToken>` and show the QR on a phone by transferring **only a screenshot of the QR** locally (for example, AirDrop). Do not transfer the bearer card URL or recovery token.
2. On the Mac, sign in as the seeded cashier at `http://localhost:3001/login`, open `/cashier`, select the camera action, and grant camera permission. Hold the phone's QR in front of the Mac camera. Confirm that the identified synthetic card and balance match the phone QR; do **not** award or redeem automatically.
3. Deny permission once, retry, switch back to manual entry, leave/reopen the scanner, and confirm that the camera is released and can restart. Record the browser, Mac camera model, result, and any permission error. This test does **not** establish phone enrollment, phone camera operation, or phone-to-phone scanning.

### B. Full device journey — **NOT RUN; needs approved HTTPS destination**

1. Obtain approval for the exact HTTPS hostname, access allowlist, proxy policy, and synthetic-only database. Configure `BETTER_AUTH_URL` and `PUBLIC_BASE_URL` to that **same approved HTTPS origin**. Confirm a newly generated enrollment link uses it, never `localhost`.
2. From an authorized customer phone, enroll without email, open the card, save/reopen its bearer link securely, and verify the QR and starting balance. From a separate authorized cashier device, sign in and scan the QR using its camera; verify the selected customer before any transaction.
3. Explicitly award one stamp, reload the customer card and check persisted balance/activity; explicitly redeem the configured reward, reload and check the deducted balance/activity. Restart web/worker processes and reopen the card to confirm persistence. Repeat permission denial/recovery and manual fallback. Record device, OS/browser, camera behavior, URLs without bearer tokens, and exact results. Physical iPhone and Android checks remain **NOT RUN** until performed.

**Recommended controlled HTTPS destination, not activated:** `https://looplocal-preview.<owner-approved-domain>` through a Cloudflare Access-protected Tunnel to the separate device-test instance described below. The strict localhost `npm run preview` launcher is not an exposure switch. No account, domain, tunnel, DNS record or plan was created here.

## Separate HTTPS device-test instance — local preparation only

`npm run device-test:prepare` creates a **new, empty synthetic** PostgreSQL volume on `127.0.0.1:54331`, fresh ignored mode-0600 `var/device-test.env` secrets, applies auth/app migrations, and compiles into `.next-device-test`. It performs a one-pass worker check with external providers off. This build is **not runnable for device testing** until an approved HTTPS origin is supplied; no web port, tunnel, DNS record, or public address is started by preparation. The existing `npm run preview` database/build on port 3001 stays separate.

The owner must approve the exact FQDN, existing Cloudflare account and zone, named tester identities, a one-hour self-hosted Access app with an **Allow → Emails** policy for those testers only, Cloudflare processing of synthetic traffic, creation of the Access app/tunnel/DNS route, and the exact additional cost. Cloudflare advertises a $0 Free tier for small teams, but [new organization setup asks for payment details](https://developers.cloudflare.com/cloudflare-one/setup/); do not assume an account, domain, or €0 incremental cost. No account or route was created here. Leave `BETTER_AUTH_URL`, `PUBLIC_BASE_URL`, `DEVICE_TEST_APPROVED_ORIGIN`, `DEVICE_TEST_ACCESS_TEAM`, and `DEVICE_TEST_ACCESS_AUD` unset in `var/device-test.env` until approval; never send passwords or provider keys in chat.

After approval, set both app URLs to the **same exact approved HTTPS origin**, set the approved origin and Access team/AUD values in the restricted env file, then run `npm run device-test:start`. It rechecks all guards, seeds only synthetic accounts, rebuilds, starts a worker, and serves compiled Next on **127.0.0.1:3002**. It refuses localhost/placeholder origins, absent Access metadata, enabled marketing/billing/merchant registration/Wallet, or another database. Stop web/worker with Ctrl-C; `npm run device-test:stop` then stops only this instance's PostgreSQL container, preserving its isolated volume. These commands do not publish a route. Production `npm start` and the old loopback preview retain their separate guards.

Configure a Cloudflare **self-hosted Access application and exact-email Allow policy before** adding a Tunnel published route. Use [`config/cloudflared-device-test.yaml.example`](config/cloudflared-device-test.yaml.example) as a reviewed template: origin `http://127.0.0.1:3002`, required Access JWT validation at `cloudflared` via team name and app AUD, and a final 404 catch-all. Keep `cloudflared` at `info` logging or stricter; debug logs full URLs/headers. Inspect existing Cloudflare edge log exports because request-URI fields can retain card tokens and QR queries. Do not enable `TRUST_PROXY_CLIENT_IP` until the trusted proxy overwrites/validates the peer header. On the approved route, check Host, `X-Forwarded-Proto=https`, and Cloudflare peer headers, then test an authorized named tester and a fresh unauthorized browser session. Confirm enrollment links and auth redirects use the approved origin, never localhost. Only after these checks, run `node demo/generate-counter-sign.mjs --device-test` to create a new ignored HTML/A5 PDF sign for this synthetic programme. Never use a quick tunnel or expose a LAN listener.

For a physical journey, record actual phone model, OS/browser, Access login, contact-free join, securely saved/reopened card, camera scan on a separate cashier device, confirmed one-stamp award, reward redemption, and card reload after each transaction. Browser emulation and the Mac-camera smoke test remain separate evidence. The protected browser route does **not** authorize Google asset access or Apple callbacks; those require a later minimal provider-specific routing approval. No Google or Apple provider test has run.

## Local marketing mail test

`POST /api/merchant/email/test` is owner-only and accepts a membership ID, subject, and plain-text body. It queues only a **verified synthetic `.test` recipient** whose latest email-marketing consent is granted. No recipient address is copied into the outbox payload. The worker checks the owner's active role, verification, and the latest consent again while locking the membership; a prior withdrawal or owner revocation marks the job `suppressed` without contacting Mailpit. The customer can view consent with `GET /api/card/<card-token>/marketing` and withdraw with a same-origin `POST` to that path. The checkout scan code is not a preference credential.

For an eligible job, the worker can send a clearly marked `[LOCAL TEST]` message to the fixed loopback Mailpit API at `127.0.0.1:8026`. This is a local capture, never an external provider delivery. The test is disabled in production, when external mail is enabled, or for any non-`.test` recipient. An email ownership verification flow, signed unsubscribe links, campaign authoring, quotas, external transport, bounces, and live sending are **not implemented**. Do not treat this local path as a production campaign tool.
The outbox is at least once: a process crash after Mailpit captures a message but before the database records completion can duplicate a local test message on retry. An external sender needs its own idempotency and suppression design before activation.

## Local backup and restore check

Run `npm run backup` to write a restricted custom-format PostgreSQL dump under ignored `var/backups/`. Run `npm run restore-check` to restore the newest dump into a new temporary database, verify the main tables and append-only ledger trigger, report row counts, and remove the temporary database. Both commands refuse a nonlocal or production target. To use a specific file, run `npm run backup -- path/to/file.dump` and `npm run restore-check -- path/to/file.dump`.

These commands verify a local restoration only. Before live operation, arrange encrypted offsite backups, access limits, retention, periodic restoration drills, and a documented recovery owner. Never point the local scripts at a production database.

## Deployment preparation

The application has **not** been publicly deployed. `npm start` executes `scripts/production-guard.ts` before `next start`. The guard rejects local/demo database credentials and URLs, non-HTTPS app URLs, short or placeholder auth secrets, public registration, unapproved external email or billing flags, and the local demo credential file. Keep public registration, external delivery, live billing, and wallet features disabled until operator setup and approvals are complete.

A future production deployment needs a separately provisioned PostgreSQL database; HTTPS termination at a reverse proxy that forwards the original host and protocol; a private application port; a separately supervised worker process; secret storage outside the repository; migrations performed before traffic; health monitoring; and a tested backup/restore path. Do not copy `.env`, `.env.local`, `var/`, or demo accounts into the deployment. The auth schema in `drizzle/auth.sql` must be applied once on a clean database before `npm run db:migrate`. Rotate the auth secret only with a session invalidation plan. Provider credentials and real wallet/device checks are separate launch gates.

The legal pages are drafts, and merchant registration plus payment operation require the operator's legal and business review. `FEATURE_STATUS.md` and `LAUNCH_BLOCKERS.md` record the current launch status.
