# Contributing

Short rules for everyone who changes this repository, people and automated helpers alike.

## What "done" means

A change is done when all of these are true:

- CI is green (typecheck, lint, tests).
- The pull request description says what changed, why, and how it was checked.
- Behaviour changes come with a test that fails without the change and passes with it.
- If the change touches screens, someone has looked at it on a real phone (or says plainly that nobody has).

## Pull requests

- One ticket per pull request, about 300 changed lines or fewer. If it is bigger, split it.
- Branch from the current development branch, never commit to `main`, and never push to it.
- Reference the ticket (for example `LOY-123`) in the branch name and the description.
- Write commit messages like a normal developer would: a short imperative summary ("Fix duplicate stamp on retry"), and a body only if the why is not obvious.
- Do not add trailers or notes about how a change was produced.

## What not to add

- No receipts, evidence ledgers or status reports in the repository. The tests, the pull request and the ticket are the record.
- No "independently accept ..." follow-up tickets. When a person should try something on a real device, that is a checkbox on the feature ticket.
- No documents that only restate what the code or the tests already show.

## Safety

- Never touch production credentials, production databases or production services.
- Never put secrets, tokens or keys in code, tests, logs or pull request text. Use the existing environment configuration.
- Never run migrations against anything except a local or throwaway database.
- Migrations are additive. A destructive migration needs an explicit decision recorded on the ticket first.
- Do not switch on external providers (wallets, email, payments, push) outside a local test double.

## When to stop and ask

Stop, write down the question on the ticket, and leave the branch as it is when:

- the ticket needs a product, pricing, legal or scope decision that is not written down;
- the work needs a real device, real hardware or an external account;
- the change would need more than one pull request of context to review;
- the tests fail for a reason you cannot explain.

A clear question on the ticket is a good result. Guessing is not.

## Running the checks locally

    npm ci
    npm ci --prefix marketing-site
    npx next typegen
    npm run typecheck
    npm run lint
    npm test            # starts the local test database through Docker, then runs the suite

See `.github/workflows/ci.yml` for exactly what CI runs.

## Running one ticket in isolation

`scripts/ticket-run.sh LOY-123` creates a separate working copy and its own throwaway database, runs the command you configure in `AGENT_CMD` with a turn and time cap, and cleans up. Read the header of the script for the environment variables.

## The automated ticket loop

Tickets tagged `agent-ready` can be picked up by a scheduled loop (`scripts/ticket-cycle.py`). It runs each ticket through `scripts/ticket-run.sh`, pushes only a `ticket/LOY-<number>` branch, opens a pull request, comments the link on the ticket and moves it to review. It never merges. Everything about it follows the rules above, and a person reviews every pull request.

- `scripts/ticket-cycle.py check` verifies access and configuration without changing anything.
- `scripts/ticket-cycle.py once LOY-123` runs one ticket now, for a supervised trial.
- `scripts/ticket-cycle.py pause` and `resume` stop and restart all cycles; `status` shows what is going on.
- `scripts/ticket-loop-install.sh install` schedules it on macOS; see `scripts/ticket-loop.config.example` for the settings.
- Tag a ticket `needs-founder`, `needs-hardware`, `needs-legal` or `needs-decision` and the loop will never pick it.
