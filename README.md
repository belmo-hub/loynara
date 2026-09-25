# LoopLocal

Local, German-first merchant loyalty SaaS built with Next.js, TypeScript, PostgreSQL, Drizzle and Better Auth. The synthetic demo covers programme/reward setup, QR enrollment, browser card and guarded checkout, pseudonymous activity and audiences, merchant campaigns and automations captured by Mailpit, referrals, multiple locations, analytics, bounded offline award queuing, local fixture billing and rule-based advice. [PARITY_MATRIX.md](PARITY_MATRIX.md) records the evidence and unfinished work for each module. Offline earning has only local browser simulation; real Wallet/device operation, public deployment, external sending and live billing are not enabled.

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

For the **compiled, loopback-only synthetic preview**, run `npm run preview` after `npm ci` and open [http://localhost:3001](http://localhost:3001). It uses a separate local PostgreSQL volume and ignored `var/preview-access.json`; merchant self-registration, external delivery, billing and Wallet providers are off. Synthetic customer enrollment remains available. Run `npm run preview:browser-check` in a second terminal to repeat the compiled browser journey. See the [LOCAL PREVIEW instructions and device checklists](RUNBOOK.md#compiled-local-preview-synthetic-data-only). Its `localhost` enrollment links work only on this Mac.

## What has been checked

With `npm run local` still running, a second terminal can run `npm test` and `npm run test:e2e`. See [TEST_EVIDENCE.md](TEST_EVIDENCE.md) for observed results, [screenshots/](screenshots/) for actual browser captures, and [demo/](demo/) for the synthetic print sign, product sheet and compiled-preview recording. [FEATURE_STATUS.md](FEATURE_STATUS.md) distinguishes local tests, provider fixtures and unfinished features. [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md) lists work before public use; [ARCHITECTURE.md](ARCHITECTURE.md) explains data flow and security boundaries. [WALLET.md](WALLET.md) covers issuer prerequisites, and [SOURCES.md](SOURCES.md) records official references.

No public service was deployed, no external email or charge was sent, and new external expenditure in this run was €0.
