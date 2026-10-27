@AGENTS.md

# Loynara

German-first loyalty cards for small shops (barbers, pizzerias, cafés): the customer carries a card in the browser or a Wallet, the cashier confirms each stamp or point at the counter (QR or NFC), the owner reads a dashboard. Live in production. Stamps and rewards are money-like value, and many merchants' customer data sits on one database, so changes are small, tested and boring on purpose.

Next.js 16 (App Router), TypeScript, Drizzle on Postgres 18, Better Auth, Vitest, Playwright; deployed on Railway. The marketing site is a separate build in `marketing-site/`.

## Read before changing anything

- `CONTRIBUTING.md`: what "done" means, pull-request rules, safety rules, when to stop and ask. It wins over this file.
- `.claude/skills/loynara-engineering-bar/SKILL.md`: repository facts that bite (configuration gate, migrations, tenancy, idempotency, protected properties) and the review checklist.
- `ARCHITECTURE.md` for data flow and security boundaries, `RUNBOOK.md` for local startup and operations, `DESIGN.md` plus `.claude/skills/loynara-design-bar/SKILL.md` for any screen.

## Checks, in this order

    npx next typegen
    npm run typecheck
    npm run lint
    npm test            # starts the local test database through Docker (port 54329); the full suite takes about 5 minutes

One area only: `npx vitest run src/lib/loyalty` once `npm test` has prepared the database. A schema change needs `npm run db:generate` and the committed migration; CI fails on a stale snapshot. `.github/workflows/ci.yml` is the authority on what CI runs.

## Branches and pull requests

- `railway-rc` is the development branch and deploys to production. Never commit to `main`, never push to it.
- One ticket per pull request, under about 300 changed lines, branch named after the ticket (`eng/ENG-085-...`, `ticket/LOY-123`).
- Commit messages read like a normal developer's: a short imperative summary, a body only when the why is not obvious. No trailers of any kind (no `Co-Authored-By`, no "Generated with") and no tool or vendor names anywhere in the message. `scripts/git-hooks/commit-msg` rejects them; never bypass it with `--no-verify`.
- The pull request description says what changed, why, how it was checked, the risk class (L0 docs and copy; L1 ordinary; L2 billing, auth, ledger, NFC, Wallet, email sending, migrations, configuration gate) and what a person does at deploy.
- No receipts, evidence ledgers or status reports in the repository. The tests, the pull request and the ticket are the record.

## Never

- Touch production: no production credentials, databases or services, no Railway variables or deploys. A person does those; `.claude/settings.json` refuses the commands.
- Run migrations against anything but a local or throwaway database. Migrations are additive and forward-only; a destructive one needs a decision recorded on the ticket first.
- Switch on an external provider (wallets, email, payments, push) outside a local test double.
- Put secrets in code, tests, fixtures, logs or pull-request text.
- Use `git stash`: the stash stack is shared by every worktree of this repository. Set work aside with a WIP commit instead.

## Working here

- One worktree per ticket under `~/Developer/`; paths under `~/Desktop` are iCloud-synced and stall.
- The smallest change that fully works: a platform feature first, then an existing helper in `src/lib`, then an installed dependency, then new code. A new abstraction for one caller is wrong; deleting beats adding. For a change under the pull-request limit, skip brainstorming documents and plan files: write the failing test, make it pass, run the checks.
- Product copy and UI strings are German (du). Answer the founder in English.
- Stop and write the question on the ticket when the work needs a product, pricing, legal or scope decision, a real device or an external account. A clear question is a good result; guessing is not.
