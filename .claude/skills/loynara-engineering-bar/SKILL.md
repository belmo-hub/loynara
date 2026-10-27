---
name: loynara-engineering-bar
description: Loynara's engineering conventions and review checklist for the belmo-hub/loynara repository (Next.js 16, Drizzle, Postgres 18, Railway). Use when implementing a ticket, reviewing a pull request, writing a migration, touching the production configuration gate, or deciding whether to add code at all.
---

# Loynara engineering bar

Maintainers: the CTO session owns this bar; the Reviewer proposes checklist changes from recurring findings; the Engineer proposes repository facts that bit.

The system moves other people's money-like value (stamps, rewards) and holds customer data for many merchants on one database. The bar is therefore boring on purpose: small reviewed changes, tests that prove behaviour, and the fewest lines that do the job.

## 1. Write less code (the ponytail principle)

Before writing anything, in this order: does the platform already do it (browser input types, HTML form validation, CSS, Postgres constraints, Next.js built-ins)? Does the repository already have a helper (search `src/lib`, `scripts/`)? Does an existing dependency do it? Only then a new function, and never a new abstraction for one caller. Delete before you add; a pull request that removes more than it adds is a good sign. If the ponytail plugin is installed, run its review and audit on the diff; if not, apply the same question by hand to every added file.

## 2. Repository facts that bite

- **Framework:** the Next.js in this repo differs from training data. Read `AGENTS.md` at the root and the docs under `node_modules/next/dist/docs/` before touching routes, server actions or config.
- **Worktrees:** never under `~/Desktop` (iCloud stalls and corrupts); one worktree per ticket under `~/Developer/`, branch `eng/<ENG-id>-<slug>` from `railway-rc`.
- **Configuration gate:** `scripts/config-check.ts` and the shared `productionConfigIssues` refuse to start a service with a half-set feature group (NFC trio, PassFast set, Google Wallet set, VAPID pair). A new feature flag joins a group or forms one; its checks name settings, never values; absent means off and unchanged.
- **Migrations:** Drizzle, forward-only, no down files. 0025 added NOT VALID CHECK constraints and append-only triggers on `redemptions` and `reward_versions`; the ledger is append-only. Every migration runs in one transaction with a 15 s lock timeout, so write it to fail safe, and the PR carries a rollback note (what the old code tolerates, what data becomes permanent).
- **Tenancy:** every query is scoped by tenant and location; a cross-tenant read is a security bug, not a style issue. Test C9 (the other shop cannot see the card) is the model.
- **Idempotency:** award and redeem carry idempotency keys; a replay returns `duplicate: true`, a reused key with different payload returns `KEY_REUSED`. New write paths follow the same pattern.
- **Protected properties:** cashier-confirmed stamping, NFC with QR fallback, optional Wallet, recovery keeps membership, no cross-merchant disclosure, no mandatory customer email. A ticket that weakens one goes back to the CTO.
- **Secrets:** never in tests, fixtures, logs or the public repository; integration tests get synthetic values; production variables are read by the founder, not by code you write for a check.
- **Tests:** integration tests spawn the app with an env object (see `src/lib/*.integration.test.ts`); CI runs tests, typecheck and lint, production build, backup safety. Run the changed test files and the typecheck once locally; the full suite is CI's job.
- **Commits and PR text:** no AI tool or vendor names, no attribution or co-author lines (founder's hard rule). Title with the ENG id. Description: what changed, why, how verified, risk class, what the founder does at deploy (variables, order, exact commit).

## 3. Risk classes

L0 docs and copy; L1 ordinary feature or fix; L2 anything touching billing, auth, ledger, NFC, Wallet, email sending, migrations or the configuration gate. L2 says so in the PR and waits for the CTO's security review after the Reviewer's verdict.

## 4. Reviewer's checklist (also the author's self-check)

1. Only what the ticket asks; nothing smuggled in.
2. Tests prove the new behaviour and that the old behaviour survives; a deliberate break is caught.
3. No protected property weakened; tenancy and idempotency intact.
4. Migration has a rollback note; append-only guarantees kept.
5. Errors handled or surfaced, never swallowed; nothing logged that should not be.
6. No secret or customer data in code, tests, fixtures or PR text.
7. Configuration changes refuse half-set groups and keep "absent means unchanged".
8. PR description tells the founder exactly what to do at deploy.
9. Commit and PR text clean of AI names and attribution lines.
10. Could this be less code? Name what could be deleted.

Verdict words: APPROVE, APPROVE WITH NITS, REJECT with file and line, what breaks, what makes it pass.

Pair with the `superpowers` process skills (test-driven development, systematic debugging, verification before completion), `code-review`, `security-review`, and the PR review agents.
