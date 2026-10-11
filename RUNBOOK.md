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

The launcher validates the exact loopback origin, database name/port/user, generated secret, and disabled integrations before touching data. `npm start` remains the production command and **still rejects** these local/demo settings; the preview launcher never changes the production guard. Do not copy `var/preview.env`, `var/preview-access.json`, or the preview volume into a real deployment. Stop the preview with Ctrl-C. Its PostgreSQL container and volume persist for a later restart, so balances can be checked after a process restart. In a second terminal, `npm run preview:browser-check` repeats the compiled Chrome journey against fresh synthetic customer data and refuses a non-preview configuration. To inspect one worker pass on the preview database, run `npm run preview:worker -- --once`; replay only a reviewed failed or blocked synthetic job with `npm run preview:worker -- --replay <job-uuid>`. For an isolated preview backup drill, run `npm run preview:backup` and `npm run preview:restore-check`; both use only the preview Compose project. Preview backups exclusively create the exact destination after validation and refuse competing files, directories or symlinks; two publishers cannot both claim the same path. Failed dump, validation or publication removes the temporary archive. They do not replace production backup planning.

The synthetic A5 [`demo/counter-sign.html`](demo/counter-sign.html) has a decoded QR for this Mac-local preview. Regenerate it after changing the synthetic programme slug with `node demo/generate-counter-sign.mjs`. The merchant dashboard also downloads a self-contained A5 HTML sign with that merchant's name, location, current reward, and QR from its configured `PUBLIC_BASE_URL`; print it from a browser. A localhost download is visibly marked **LOKALE TESTVORSCHAU** and is not usable by a customer's phone. For an approved HTTPS device test, generate a new sign only after its exact origin and Access policy work; verify the printed QR and URL do not point to localhost.

### Staff-approved transfer from a paper card

1. The owner confirms the existing paper rule and approves a one-time transfer procedure for that merchant. Staff inspect the physical card and count only stamps valid under that rule. Customer statements or card photos alone do not establish a balance.
2. The guest joins or reopens their digital card. Staff compare the card and any earlier transfer record before proceeding. An approver records the verified count, date, staff member, and a non-recovery card reference in a restricted transfer register; mark the paper card as transferred so it cannot be presented again. Do not record the private card URL.
3. An authorized cashier looks up the digital card, enters the **approved count** as an explicit award, checks the card and count in the confirmation dialog, and confirms once. Respect the role limit (cashier 10, manager 100, owner 1000 per award) and the on-screen maximum; escalate an over-limit or ambiguous card instead of splitting an award to evade a limit. Scanning alone never credits stamps.
4. Reopen the guest card and compare the persisted balance with the approved transfer. If the request outcome is unclear, inspect the transaction before retrying. Escalate a confirmed mistake to an owner/manager for the linked correction API; the cashier screen does not expose corrections. Keep the paper/transfer record under an operator-approved retention rule.

The current award ledger records actor, count, and time but has **no migration-specific reason or one-time transfer enforcement**; the customer activity labels such an award as a visit. Treat this as a controlled synthetic procedure until the operator reviews those limits and the real-customer policy. No real paper card or customer data was used here.

### Cashier quick guide for the synthetic demonstration

1. Select the correct merchant location, open **Kasse**, and scan the customer's complete QR. If camera access fails, use the displayed scan code as the manual fallback. Compare the returned card and balance before continuing.
2. For a stamp programme, the award starts at **one**. For purchase points, enter the purchase amount shown by the checkout and check the calculated points. Confirm the displayed action explicitly. Wait for **bestätigt**; a pending or failed action is not a confirmed balance. Check the transaction before retrying an uncertain request.
3. Show the eligible reward choices, select the customer's choice, and confirm redemption while online. Ask the customer to reopen/reload the private card and compare the persisted balance. Scanning alone never awards or redeems.

French staff reminder for this same local workflow: choisir le bon établissement, scanner le QR ou saisir le code, vérifier la carte et le solde, confirmer **un** tampon ou le montant d'achat, attendre la confirmation, puis choisir et confirmer la récompense en ligne. Faire rouvrir la carte pour vérifier le solde. This short reminder does not make the German merchant UI fully translated.

An owner can review the last 50 invite, acceptance and revocation events under **Team → Zugriffsverlauf** and download the full tenant-scoped history in the merchant JSON export. The database rejects updates and deletes of these new audit rows. No earlier staff events were backfilled, invitation links are never logged in the audit, and the operator still needs an approved retention schedule.

### Offline award simulation (local browser only)

While online, look up the card to obtain a staff/location/card/browser lease valid for 30 minutes. After a disconnect, explicitly choose **Offline-Vergabe vormerken** in the award review. Up to 20 events stay in that browser's localStorage; the card balance and rewards do not change. Reconnect and choose **Ausstehende Vergaben synchronisieren**. Server acceptance posts one idempotent ledger award; rejection shows a reason for staff review and never credits the card. Expired leases, revoked staff, changed rules and closed cards are rejected. Redemption stays online. Do not clear browser data, switch device/browser or sign out before all pending events are reviewed; browser storage is not a durable server backup. The simulated disconnect/reload/retry/revocation tests passed locally, but a physical cashier-device outage and recovery are **NOT RUN**.

### A. Immediate Mac camera smoke test — hardware camera only

1. Run `npm run preview`; read only the synthetic `var/preview-access.json` locally. On the Mac, open its seeded customer card at `http://localhost:3001/card/<cardToken>` and show the QR on a phone by transferring **only a screenshot of the QR** locally (for example, AirDrop). Do not transfer the bearer card URL or recovery token.
2. On the Mac, sign in as the seeded cashier at `http://localhost:3001/login`, open `/cashier`, select the camera action, and grant camera permission. Hold the phone's QR in front of the Mac camera. Confirm that the identified synthetic card and balance match the phone QR; do **not** award or redeem automatically.
3. Deny permission once, retry, switch back to manual entry, leave/reopen the scanner, and confirm that the camera is released and can restart. Record the browser, Mac camera model, result, and any permission error. This test does **not** establish phone enrollment, phone camera operation, or phone-to-phone scanning.

### B. Full device journey — **NOT RUN; protected HTTPS is active**

1. Use the approved `https://preview.getloynara.com` instance and allowlist below. `BETTER_AUTH_URL` and `PUBLIC_BASE_URL` already match that origin; its newly generated enrollment sign was checked against it, without localhost.
2. From an authorized customer phone, enroll without email, open the card, save/reopen its bearer link securely, and verify the QR and starting balance. From a separate authorized cashier device, sign in and scan the QR using its camera; verify the selected customer before any transaction.
3. Explicitly award one stamp, reload the customer card and check persisted balance/activity. In this synthetic test, explicitly award the remaining amount to the configured reward threshold, select the reward and confirm redemption online. Reopen the customer card and compare balance/activity; check the owner's dashboard and customer timeline. Restart web/worker processes and reopen again. Repeat permission denial/retry, camera restart and manual fallback. Physical iPhone and Android checks remain **NOT RUN** until performed.

Record each actual run using this compact form; leave unperformed fields **NOT RUN**. The automated demo timings are not checkout-speed measurements.

| Field | Actual result to record |
| --- | --- |
| Run | Revision, date, tester, approved origin (no bearer URLs) |
| Customer phone | Model, OS version, browser/version; Access sign-in; join/save/reopen/complete QR |
| Cashier phone | Model, OS version, browser/version; app sign-in and selected location |
| Camera | Permission grant/denial/retry/restart; failed attempts and observed reason |
| Scan time | Stopwatch: camera ready → correct membership displayed; include failures separately |
| Checkout time | Customer begins reopening card → confirmed transaction and refreshed customer balance; exclude enrollment, report Access-login time separately |
| Ledger/customer | Before → one award → threshold → redemption → reopened persisted balance/activity |
| Owner | Dashboard counts and individual activity reflect the same confirmed transactions |
| Google/Apple | Actual installation, Wallet QR scan, displayed balance after award and redemption, elapsed update times |
| Outcome | PASS / FAIL / NOT RUN, observed defect and any repeat test |

**Active controlled HTTPS destination:** `https://preview.getloynara.com` through the Cloudflare Access-protected `loynara-device-test` Tunnel. The strict localhost `npm run preview` launcher stays separate. The owner activated Zero Trust Free; this task created only the approved Access app/policy, named tunnel and preview CNAME route, at €0 additional spending.

## Separate HTTPS device-test instance

`npm run device-test:prepare` creates a **new, empty synthetic** PostgreSQL volume on `127.0.0.1:54331`, fresh ignored mode-0600 `var/device-test.env` secrets, applies auth/app migrations, and compiles into `.next-device-test`. It performs a one-pass worker check with external providers off. This build is **not runnable for device testing** until an approved HTTPS origin is supplied; no web port, tunnel, DNS record, or public address is started by preparation. The existing `npm run preview` database/build on port 3001 stays separate.

**Owner approval received 26 September:** public brand Loynara; exact FQDN `preview.getloynara.com`; existing owner account and zone `getloynara.com`; initial tester is its UI-verified account email; whole-hostname self-hosted Access app and exact-email Allow policy without bypass; named tunnel `loynara-device-test`; only route to `http://127.0.0.1:3002`; origin JWT validation; **€0 additional spending**. The owner explicitly approved **30-minute sessions** after the dashboard omitted one hour. Wallet/provider routes remain excluded. The three origin fields in ignored mode-0600 `var/device-test.env` are `https://preview.getloynara.com`; secrets are preserved and actual Access team/AUD populated.

**Activation completed by the owner:** Zero Trust Free is active. Saved resources are one `Loynara device test` Access app, one exact-email Allow policy, and tunnel `loynara-device-test`; both app/policy sessions are 30 minutes. The app and policy existed before the only published route. Tunnel Protect with Access requires the actual team and app AUD. `cloudflared 2026.9.1` was installed via Homebrew at no charge and runs without a macOS service. Its token is in ignored mode-0600 `var/cloudflared-device-test.token`; never print or commit it. No additional paid plan or service was selected.

After approval, set both app URLs to the **same exact approved HTTPS origin**, set the approved origin and Access team/AUD values in the restricted env file, then run `npm run device-test:start`. It rechecks all guards, seeds only synthetic accounts, rebuilds, starts a worker, and serves compiled Next on **127.0.0.1:3002**. It refuses localhost/placeholder origins, absent Access metadata, enabled marketing/billing/merchant registration, unapproved Wallet providers, or another database. A separate explicit Google Demo gate is described in [WALLET.md](WALLET.md); default remains off. Stop web/worker with Ctrl-C; `npm run device-test:stop` then stops only this instance's PostgreSQL container, preserving its isolated volume. Shutdown remains possible after a Wallet credential is removed. These commands do not publish a route. Production `npm start` and the old loopback preview retain their separate guards.

Configure a Cloudflare **self-hosted Access application and exact-email Allow policy before** adding a Tunnel published route. Use [`config/cloudflared-device-test.yaml.example`](config/cloudflared-device-test.yaml.example) as a reviewed template: origin `http://127.0.0.1:3002`, required Access JWT validation at `cloudflared` via team name and app AUD, and a final 404 catch-all. Keep `cloudflared` at `info` logging or stricter; debug logs full URLs/headers. Inspect existing Cloudflare edge log exports because request-URI fields can retain card tokens and QR queries. Keep this synthetic preview on absent/`local` ingress mode and `TRUST_PROXY_CLIENT_IP=false`. Production instead requires the separately reviewed `TRUSTED_INGRESS=cloudflare_tunnel` policy and private-origin checks in `PRODUCTION_DEPLOYMENT.md`; the old generic trust switch is rejected. On the approved route, check Host, `X-Forwarded-Proto=https`, and Cloudflare peer headers, then test an authorized named tester and a fresh unauthorized browser session. Confirm enrollment links and auth redirects use the approved origin, never localhost. Only after these checks, run `node demo/generate-counter-sign.mjs --device-test` to create a new ignored HTML/A5 PDF sign for this synthetic programme. Never use a quick tunnel or expose a LAN listener.

For a physical journey, record actual phone model, OS/browser, Access login, contact-free join, securely saved/reopened card, camera scan on a separate cashier device, confirmed one-stamp award, reward redemption, and card reload after each transaction. Browser emulation and the Mac-camera smoke test remain separate evidence. The protected browser route does **not** authorize Google asset access or Apple callbacks; those require a later minimal provider-specific routing approval. No Google or Apple provider test has run.

### Active phone-test handoff

The app/worker and tunnel are running on this Mac. Keep it awake and online. Restart from this repository using two terminals:

```sh
# Terminal 1: compiled app and worker, isolated database
npm run device-test:start
```

```sh
# Terminal 2: existing named tunnel; token stays out of command-line arguments
cloudflared tunnel --no-autoupdate --loglevel fatal --metrics 127.0.0.1:0 --pidfile var/cloudflared-device-test.pid run --token-file var/cloudflared-device-test.token
```

Stop both foreground commands with Ctrl-C, then run `npm run device-test:stop` to stop only the device database and retain its volume. The reduced tunnel log level avoids request-error URLs; no debug/live log stream or external log export is enabled. No startup service was installed.

For an authenticated health check, `cloudflared access login --quiet https://preview.getloynara.com` opens the approved identity flow without printing its JWT; then `cloudflared access curl https://preview.getloynara.com/api/health --silent --show-error --fail` returns healthy JSON. Unauthenticated health requests redirect to Access, which is expected.

On both phones, use **Cloudflare** at the Access gate with the approved owner account. App credentials are a separate sign-in: open `var/device-test-access.json` privately on this Mac, using `cashierEmail`/`cashierPassword` on the cashier phone and `ownerEmail`/`ownerPassword` for the owner dashboard. Transfer credentials only using a private mechanism; do not paste them into chat. No password appears in the sign or documentation.

1. **Customer phone:** open `https://preview.getloynara.com/join/demo-kaffeekarte-ojtamcc`, accept the synthetic programme rules and create a fresh card. Expect **0/8** stamps.
2. Save its private card link/bookmark, leave and reopen it, then show the complete QR. Losing the link has no verified email/Wallet recovery in this test.
3. **Cashier phone:** sign in at `https://preview.getloynara.com/login`, open `/cashier`, choose **Kamera öffnen**, allow the camera and scan the customer QR. Confirm the correct card; scanning must not change balance.
4. Explicitly award **1**, then reload the customer card and confirm **1**. Award the remaining **7** to reach **8**, select **Gratiskaffee**, and confirm redemption. Reopen the card: expect **0** and the recorded activity.
5. **Owner:** refresh `/merchant` and the customer timeline to confirm the same operations. Also try camera permission denial/retry and record both device models, OS/browser, scan failures, camera-ready-to-identification time and total checkout time. These physical results remain **NOT RUN** until reported from hardware.

The printable enrollment sign is `var/device-test-counter-sign.pdf` (one A5 page), with editable HTML alongside it. Its rendered QR was decoded to the exact enrollment URL above. The isolated seed includes one sample card with three stamps and one browser-check card at zero; enrollment on the phone creates its own new card. Wallet, live billing, marketing mail and unrestricted merchant registration remain disabled. Some existing app labels still say LoopLocal; this pass did not perform a broad rebrand.

## Full-platform Kassel demonstration

Run `npm run local`, then `node scripts/record-full-platform-demo.mjs --verify` for the guarded synthetic rehearsal or `node scripts/record-full-platform-demo.mjs` to record. The script creates a fresh synthetic merchant and staff through app sessions, uses real database-backed actions and local Mailpit, and refuses remote origins/databases or enabled external providers. Its simulated camera feeds a generated QR through the actual decoder; it does not use physical camera hardware. Stop the local app/worker with Ctrl-C. If Colima was stopped, `colima start` starts the existing local Docker runtime first.

Current outputs: [`full-platform-kassel-synthetic.mp4`](demo/full-platform-kassel-synthetic.mp4), [`recorded evidence`](demo/full-platform-kassel-evidence.json), and the one-page [`German product sheet`](demo/full-platform-product-sheet-de.pdf) with editable HTML alongside it. The new recording supersedes the narrow card demo for merchant presentations. The sheet's €69 standard / €49 founding / €99 assisted setup prices are proposals; existing stored €49 plan drafts in the app were not repriced. French merchant-flow work remains the next independent product slice **after** protected HTTPS, actual two-phone checkout, one real Wallet provider path, and this updated demo.

## Local marketing mail test

Contact-free enrollment remains available. On the private browser card, a synthetic `.test` address can request a one-time verification message through `POST /api/card/<card-token>/contact`; the customer opens the link captured in Mailpit and then explicitly enables email marketing through `POST /api/card/<card-token>/contact/marketing`. The card also supports withdrawal. No raw email address appears in merchant customer lists or campaign outbox payloads. The checkout scan code is not a preference credential.

Owners can create and schedule a draft at `/merchant/campaigns` after checking a database-backed audience and eligible/excluded counts. `/merchant/automations` configures first-checkout or inactivity rules. The worker rechecks audience, verified contact, consent, owner authorization, cooldown and local quotas at dispatch/delivery; it records sent, suppressed and failed attempts. All such messages are clearly marked `[LOCAL TEST]` and sent only to `.test` addresses through fixed loopback Mailpit at `127.0.0.1:8026`. Run one local pass with `./node_modules/.bin/tsx scripts/worker.ts --once`. `node scripts/run-integrated-campaign-demo.mjs` exercises synthetic join, checkout, audience change, one-time verification, opt-in and scheduled Mailpit capture, and records a local browser video. It refuses a nonlocal origin, database or mail transport. No external provider, bounce/complaint webhook, real unsubscribe link or real-recipient send is verified. The outbox is at least once: a crash after Mailpit capture but before commit can duplicate a local message on retry; an external sender needs its own idempotency design before activation.

## Local billing fixture (synthetic only)

The owner screen at `/merchant/billing` shows each saved location price, active unclosed cards against a 10,000-card/location limit, a draft subtotal, fixture state and labelled fixture invoice records. New locations create a separate plan without an automatic charge. The local fixture uses a provider interface, an owner handoff page and signed idempotent webhook handling; it simulates a 30-day period, end-of-period cancellation and seven-day failure grace. These values are test behavior, not approved commercial or tax terms. Fixture records are not valid invoices, and no hosted provider or payment portal is connected.

For an isolated local exercise only, generate a fresh ignored secret with `umask 077` and `openssl rand -hex 32 > var/billing-fixture.secret`, read it into `BILLING_FIXTURE_SECRET` locally, and start `BILLING_FIXTURE_MODE=true npm run local` with the secret exported. Run `BILLING_FIXTURE_BROWSER=true npm run test:e2e` while that loopback server is active. Stop with Ctrl-C and remove the temporary secret. Never copy the fixture switch or secret into the compiled preview, HTTPS device test or production; their configuration guards reject it. The normal local app leaves the fixture off, while plan/usage viewing still works. `LIVE_BILLING_ENABLED` remains false.

## Local backup and restore check

Stage-A production backup amendment: Railway Hobby's authenticated account does not offer native scheduled database backups. The owner deferred that native layer to Pro before commercial go-live. Stage A instead requires an automated encrypted PostgreSQL logical dump to private EU R2, technical retention, backup-age alerting and a real isolated restore with reconciliation; an uploaded file alone is insufficient. See [the Gate-1 release test](PRODUCTION_RELEASE_TEST.md). This does not change the local-only commands below.

Run `npm run backup` to write a restricted custom-format PostgreSQL dump under ignored `var/backups/`. Run `npm run restore-check` to restore the newest dump into a new temporary database, verify the main tables and append-only ledger trigger, report row counts, and remove the temporary database. Both commands refuse a nonlocal or production target. A local backup refuses an existing destination, including one created while the dump is being validated; it does not replace another archive or move into a newly created directory. Failed dump, validation or publication leaves no temporary archive. To use a specific file, run `npm run backup -- path/to/file.dump` and `npm run restore-check -- path/to/file.dump`.

These commands verify a local restoration only. Before live operation, arrange encrypted offsite backups, access limits, retention, periodic restoration drills, and a documented recovery owner. Never point the local scripts at a production database.

## Deployment preparation

The application has **not** been publicly deployed. `npm start` executes `scripts/production-guard.ts` before `next start`. The guard rejects local/demo database credentials and URLs, non-HTTPS app URLs, short or placeholder auth secrets, public registration, unapproved external email or billing flags, and the local demo credential file. Keep public registration, external delivery, live billing, and wallet features disabled until operator setup and approvals are complete.

A future production deployment needs a separately provisioned PostgreSQL database; HTTPS termination at a reverse proxy that forwards the original host and protocol; a private application port; a separately supervised worker process; secret storage outside the repository; migrations performed before traffic; health monitoring; and a tested backup/restore path. Do not copy `.env`, `.env.local`, `var/`, or demo accounts into the deployment. The auth schema in `drizzle/auth.sql` must be applied once on a clean database before `npm run db:migrate`. Rotate the auth secret only with a session invalidation plan. Provider credentials and real wallet/device checks are separate launch gates.

The legal pages are drafts, and merchant registration plus payment operation require the operator's legal and business review. `FEATURE_STATUS.md` and `LAUNCH_BLOCKERS.md` record the current launch status.

### Trusted-ingress review follow-up (29 September 2026)

Before any production restart/deploy, web, worker, `production:ops-check`, `diagnose`, and production migrations must all receive `TRUSTED_INGRESS=cloudflare_tunnel`; each uses the production configuration guard. This requirement does not assert that a non-HTTP job receives visitor metadata. Keep the private-origin checks in `PRODUCTION_DEPLOYMENT.md` as a deployment gate. No Railway settings were changed by this local fix.

Native IPv6 outer limits now group by /64; IPv4 and mapped IPv4 preserve address-specific keys. Public ingress failures return generic non-cacheable 503 and emit the constant `invalid_ingress` event at most once per minute per process. Health can remain green, so check the event/functional monitoring if public flows fail. Mailgun keeps retryable 503 and signature checks. The compiled synthetic preview's shared Better Auth no-trusted-IP/localhost bucket is intentional and is not production isolation evidence.
