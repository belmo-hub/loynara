# Assignment 128 — Merchant onboarding account-refresh recovery

2026-10-12 Europe/Berlin. LOY-326, coding child of LOY-145; independent LOY-146 remains open.

## Requirement, implementation and source

Existing LOY-145 negative/retry/isolation and setup-recovery criteria require truthful recovery from an ordinary server failure without inconsistent or duplicate business state. Selection confirmed a new path beyond accepted LOY-313 lost/unreadable creation acknowledgments: creation returns a genuine committed 201, but the following GET /api/me fails. The silent refresh ignored that failure; navigation bounced back to step one and discarded the wizard form.

Base LOCAL/GitHub: 5b5d7af0076fd7e87898d426df4bc2a4870451e0. Implementation/test commit: 519e1569195c20a01c8b55c3877dfc0ab0ca3463. This is a new proposed application candidate, not a silent replacement of the immutable reviewed release 153928b10db55cbd0b40351116ee54515a6b107c. Release-preflight source pin remains unchanged pending the coordinator's technical review/alignment.

OwnerProvider.refresh now reports whether an account was loaded successfully while preserving existing silent-refresh state and redirects. ProgramSetup refuses navigation after a failed account refresh and shows conservative recovery feedback, retaining the completed form. Explicit retry uses existing serialized onboarding to recover the original merchant without duplicate setup rows. Other refresh callers may ignore the boolean result. No backend permissions, public-registration policy, billing economics, schema, migrations or dependencies changed.

## Evidence and independent review

Real unchanged-source Chrome RED: two failures at 375/1280 pixels because the wizard reset and its completed form disappeared. A diagnostic follow-up recorded actual committed creation, the injected account-refresh 500, and the reset first-step heading; no production source was changed to manufacture RED.

Focused GREEN: two new real-browser tests, eight total new/existing onboarding browser compatibility tests (10.4 seconds), 38 focused PostgreSQL/validation/ownership/partial/revoked/concurrent-retry/handoff tests (2.57 seconds). Explicit retry returns identical tenant/location/programme IDs; all nine synthetic setup table snapshots remain unchanged and each has one row. Dashboard and reload persist the saved setup; mobile width does not overflow. The new HTTP failure is synthetic; creation, authentication and database effects use actual local application routes.

Type generation, full typecheck, zero-warning changed-file lint, production build and whitespace checks PASS. Final configured regression: 184 files, 1690 PASS, zero FAIL, 1 existing optional Mailpit SKIP, 204.03 seconds.

Traceable verification amendment: the initial full run failed four files with ten failed tests and fifteen skips because the executor omitted TEST_PG_PORT and TEST_PG_CONTAINER and supplied an explicit transactional-email OFF flag inherited by positive mocked-provider fixtures. All four files reproduced the same ten failures/four-file failure and fourteen skips on unchanged base 5b5d7af. Correcting only the run environment to the existing owned disposable goal-047 container and port 55433, with the transactional flag absent and default external email disabled, gave 59/59 passes before the full rerun. No assertions, skips or production safeguards were weakened. Vite config/native-loader and Node module.register deprecation warnings remain tooling warnings; changed-file lint is zero-warning.

One existing independent read-only reviewer found no material issue in the correction, compatibility of ignored return values or the synthetic recovery tests. The reviewer did not run tests or access production data. Narrow technical review does not independently accept all LOY-145 functionality.

## Environment, actions and scope

One engineer in the existing isolated staff-http-permissions worktree. Installed local PostgreSQL and Chrome only; no dependency installation, new worktree, model upgrade or overlapping coding worker. Synthetic loopback host ownership was verified at /private/tmp/loynara-goal-133-pg, including the actual Node PostgreSQL test DSN; existing backup container was already running and labelled disposable goal-047. Local test-only billing/provider mocks do not activate real billing or Mailgun.

The local application stopped; only the newly created looplocal_browser_onboarding_128 database was dropped after zero active connections. Existing PostgreSQL cluster, Docker containers, worktrees and private recovery identity were preserved. Free disk space after tests: 35 GiB. A shell-quoting error in the first cleanup attempt performed no database mutation; the corrected owned-target query and cleanup succeeded.

Actual external actions: truthful LOY-326 creation and development/review transitions. Final integrated push and coding-child Done readback are recorded with exact SHAs in the durable completion receipt and coordinator report. Parent LOY-145 / independent LOY-146 remain open. No hosted configuration, deployment, provider, production database, real merchant or production-backup operation occurred. Task 128 did not reuse the exhausted one-backup recovery authority.

IMPLEMENTED / TESTED / technically REVIEWED. Local integration and standing-authorized remote push are separate verified receipts. NOT DEPLOYED / NOT independently product ACCEPTED / NOT commercially ready. The October 13 production sequence still requires writer/stop-drain confirmation, a fresh post-drain recovery point, independent recovery acceptance and separate cutover authorization; migrations 0021–0024 and hosted merchant/customer/cashier acceptance are not executed.

## Accounting, continuity and next dependencies

Original Goal identity 01a125a6-7124-70f1-a0f7-8b6f83d9a191 preserved. A fresh native read during task 128 reported ACTIVE, 17,254,855 cumulative tokens / 96,640 seconds, remaining token budget null. No replacement or resume command was issued. Earlier BLOCKED / 16,624,937-token / 92,240-second observations remain historical records. Input, cached subset, output and usage since the fresh observation are unmeasured. Requested Sol medium selection / high correction / medium existing review; effective setter unavailable, existing executor retained.

Fallback LOY-53 was unused because the primary requirement supplied a genuine reproducible gap. The next work package is selected only after one completion report and the complete strategic response. Do not reopen LOY-133/139, founder programme/location policy or physical TAG-02 gates.

Sanitized reproducible tests: e2e/onboarding-account-refresh.spec.ts. Durable receipts: primary var/native-goal-20261010/assignment-128-evidence.json and its RED/GREEN/base-comparison/full-regression/static/review records. No private keys, real customer contact details, production rows or provider credentials are recorded.
