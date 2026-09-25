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
