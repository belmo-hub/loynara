# Data lifecycle and resilience implementation plan

Baseline: `680266d7d627bd781a8633f419e49275e6c27294`, branch `feature/data-lifecycle-resilience`, 15 October 2026. Scope: LOY-43, LOY-209, LOY-195, LOY-193, LOY-197, LOY-201.

## Constraints and design

Work only in the isolated checkout and synthetic databases. PostgreSQL tests use `loynara-lifecycle-pg` on loopback port 54347, web port 3037, and no production environment files. No production changes, production reads for tests, deployments, migrations, or push to `railway-rc`. New structures must be additive; rollback instructions must distinguish schema rollback from irreversible data loss. The owner approved a one-worktree count exception; no existing checkout is removed.

Keep the transactional ledger, bounded outbox and provider adapters. Extend their operational checks rather than introduce another queue or monitoring vendor. Provider budgets count attempted operations atomically in PostgreSQL before transport, so multiple web/worker processes share one ceiling. Quota/database refusal stops the optional provider operation, without undoing an already committed loyalty transaction. A budget counts uncertain attempts conservatively; it is not a guarantee about provider invoices.

The owner approved all five choices in [the retention policy](RETENTION_POLICY_PROPOSAL.md), also published as YouTrack article LOY-A-6, on 15 October 2026. Implement the approved policy using synthetic data only. Production activation, accounting classification, provider requests and schedules remain separate operator steps.

## Tasks and verification

- [x] Backup/restore: remove machine-specific drill dependencies; create and own an ephemeral loopback PostgreSQL cluster and temporary age identity; run existing production scripts through strictly local storage transport. Verify complete table fingerprints, migration history, ledger balances, reversal/redemption links, append-only and tenant constraints; reject corrupt ciphertext, wrong key and nonempty target. Restore atomically. Suppress raw external-tool diagnostics. Commit evidence with synthetic-only boundary and tools/commands/results.
- [x] Monitoring: add bounded aggregate event counters without customer identifiers; record request errors and rate-limit refusals; include stale processing leases and failed/uncertain email deliveries in the operations decision. Existing worker and backup heartbeats remain independent. Health and ops database probes have finite connection/query deadlines. Tests cover threshold boundaries, no leaks, unavailable monitor/database, and real database aggregation.
- [x] Provider limits: add a shared monthly attempt budget for email, Wallet and staff push; reserve before each relevant outbound call; reject malformed limits and exhausted ceilings. Preserve provider retry/idempotency behavior and mandatory server-side authorization. Tests cover concurrent reservations, zero/invalid limits, separate services, month rollover, and refusal before transport. Document operational caps separately from provider prices and platform spend limits.
- [x] Operations docs: write a concise incident/rollback guide using a selected Railway deployment ID or exact commit SHA; never describe restart/latest redeploy as historical rollback. Document backup custody, restore isolation, disabled outbound integrations, schema compatibility, communication ownership and production steps. Add breach-response timing, controller/processor roles and a private evidence template.
- [x] Verification/review: run the full repository suite, typecheck, changed-file lint and a production build with synthetic configuration. Record failures by name; no success claim from old evidence. Review the whole branch, commit by area, push only this branch and open a PR targeting `railway-rc`; do not merge. Tickets distinguish local evidence, approved policy and remaining operator production steps.

## Review focus

1. Restored data must never be used by a live worker or real email/push/Wallet transport during the drill.
2. A database outage cannot make an optional-provider budget fail open or make a loyalty write look successful.
3. A provider refusal must not consume a customer reward twice or replay an uncertain email automatically.
4. Aggregated monitoring cannot store request URLs, exception names/messages, contact data or credentials, and must remain bounded during error storms.
5. Rollback of application code must not run down migrations or re-enable erased subjects.

## Progress

- Worktree created from the requested baseline; existing worktrees preserved. Dependencies installed after checking 57 GiB free. Baseline suite started on the dedicated synthetic container.
- Owner approved decisions 1–5 on 15 October 2026; the existing authorized worktree is reused.

- Prior resilience-only baseline: 207 files, 2,009 tests passed, one optional Mailpit smoke skipped; typecheck/build passed. Full lint passed with 232 pre-existing warnings; changed-file lint passed with no diagnostics.
- Prior resilience-only encrypted drill: 13/13, isolated target guards: 8/8, backup privacy/timeout checks passed. See [validation](VALIDATION.md).
- Local code review findings were fixed and regression tested. The separately requested security audit, production legal-role/accounting classification and all production actions remain open.

## Approved lifecycle implementation

- [x] Add fresh one-use email proof and complete per-card personal exports from a consistent snapshot; redact credentials and unrelated subjects, including referral peers. Preserve an explicitly labelled activity download and document assisted identity checks.
- [x] Add narrowly privileged database erasure procedures, closed-subject checks, explicit legal holds and atomic complete-graph deletion. Ordinary append-only updates/deletes remain forbidden. Runtime roles cannot invoke maintenance functions or impersonate their owner.
- [x] Close merchant service atomically after recent owner authentication and exact tenant confirmation; close cards, revoke roles/sessions/tags/invites and suppress sends. Shared users and devices survive when another relationship needs them. Require an operator-recorded statutory classification before tenant purge.
- [x] Add bounded five-minute pruning/inactivity work with a job lock, deadline alerts and complete synthetic boundary/concurrency tests. Zero balances close after 24 months of actual customer activity; nonzero balances enter monthly review.
- [x] Persist encrypted erasure intent independently before purging; fail closed on storage failure. Reconcile prepared/completed intents into isolated restores before signoff, and prove erased subjects remain absent while surviving ledgers reconcile.
- [x] Run the complete suite, typecheck/build/lint and the expanded encrypted restore drill; record evidence and review changes. Final candidate: 222 files, 2,140 passing tests, one existing optional Mailpit smoke skipped; build/typecheck/lint passed; encrypted restore 20/20 passed.
- [x] Commit by area, push only the feature branch and update PR #22 and the six tickets. PR targets `railway-rc`; no merge or production activation.
