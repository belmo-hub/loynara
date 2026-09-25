# LoopLocal

Local, German-first merchant loyalty SaaS built with Next.js, TypeScript, PostgreSQL, Drizzle and Better Auth. The synthetic demo covers merchant onboarding, public QR enrollment, a browser card, cashier awards/redemptions and owner activity. Wallet adapters and local Mailpit tests are present; real wallet/device operation, public deployment, external sending and live billing are not enabled.

## Run locally

Requires Node.js 26, npm and Docker Compose. The optional Playwright test uses locally installed Google Chrome. From this directory:

```sh
npm ci
cp .env.example .env
# Replace BETTER_AUTH_SECRET in .env with: openssl rand -hex 32
# Set PUBLIC_REGISTRATION_ENABLED=true in .env for this local synthetic demo.
cp .env .env.local
npm run local
```

Open [http://localhost:3000](http://localhost:3000). Synthetic demo access details are written to the ignored `var/demo-access.json`; the local Mailpit inbox is at [http://localhost:8026](http://localhost:8026). Both env files must match. `npm run local` starts local services, migrates, seeds and starts the app and worker. See [RUNBOOK.md](RUNBOOK.md) for diagnostics, backup/restore, worker replay and production preparation.

## What has been checked

With `npm run local` still running, a second terminal can run `npm test` and `npm run test:e2e`. See [TEST_EVIDENCE.md](TEST_EVIDENCE.md) for observed results and [screenshots/](screenshots/) for actual browser captures. [FEATURE_STATUS.md](FEATURE_STATUS.md) distinguishes local tests, provider fixtures and unfinished features. [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md) lists work before public use; [ARCHITECTURE.md](ARCHITECTURE.md) explains data flow and security boundaries. [WALLET.md](WALLET.md) covers issuer prerequisites, and [SOURCES.md](SOURCES.md) records official references.

No public service was deployed, no external email or charge was sent, and new external expenditure in this run was €0.
