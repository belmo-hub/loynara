# Implementation handoff prompt: founder console phase 1

Copy everything below the line into the implementing agent.

---

You are implementing phase 1 (foundation) of the Loynara founder console in this repository.

**Read first, in this order:**

1. `AGENTS.md` (this Next.js version has breaking changes; read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code).
2. The spec: `docs/superpowers/specs/2026-10-15-founder-console-design.md` (revised 2026-10-16). Phase 1 is §9 row 1.
3. The plan you must follow: `docs/superpowers/plans/2026-10-16-founder-console-phase-1.md`. Its "Global Constraints" apply to every task.

**How to work:**

- Create the branch `feature/founder-console-phase-1` from the branch `docs/founder-console-plan` (it contains these documents).
- Do the plan's tasks **in order, one at a time**, test first: write the failing test, run it and see it fail, implement, run it and see it pass, then commit. One commit per task, using the commit subject given in the task.
- Use your own disposable Postgres for tests so you do not disturb other work: for example `docker run -d --name loynara-console-pg -e POSTGRES_USER=looplocal -e POSTGRES_PASSWORD=looplocal_local_only -e POSTGRES_DB=postgres -p 54440:5432 --tmpfs /var/lib/postgresql/data postgres:16`, then `TEST_PG_CONTAINER=loynara-console-pg TEST_PG_PORT=54440 npm test -- <files>`. The test database name must stay `looplocal_test` (the script creates it).
- Before the final commit run `npm run typecheck`, `npm run lint` and the whole `npm test` with the same variables; all must pass.

**Hard rules:**

- **Never touch production:** no deploys, no production database, no `production:*` scripts, no Cloudflare changes, no real secrets in any file. Use only `--target local` for the operator commands.
- **No AI tool or vendor names, and no attribution or co-author lines,** in commit messages, code comments, docs or the PR description.
- Do not change files outside the plan's file lists, except the lockfile for `jose`.
- Do not weaken existing security checks or tests. The whole existing test suite must stay green; merchant sign-in must behave exactly as before.
- **When the plan does not fit the code** (for example, the installed Better Auth two-factor plugin has different names or endpoints than the plan expects), do not invent a workaround on security-relevant code. Choose the option closest to the plan only if it keeps every listed test meaningful, and write the deviation and the reason into the PR description under "Deviations". If no such option exists, stop that task and write the question under "Open questions".

**When you are done:**

- Push the branch and open a pull request against `railway-rc` titled `Founder console phase 1: secure foundation`.
- PR description sections: **Summary** (one line per task), **Deviations** (each with its reason), **Test results** (the commands you ran and their final lines), **Recovery drill** (the result from Task 10), **Open questions**.
- Do not merge.
