# Lifecycle/resilience validation — 15 October 2026

Candidate: `feature/data-lifecycle-resilience`, based on `680266d7d627bd781a8633f419e49275e6c27294`. This record covers the final approved-policy implementation and accompanying commits. Every test used synthetic data, owned isolated databases or local protocol/storage fixtures. Production was neither read nor changed.

| Check | Result |
| --- | --- |
| `TEST_PG_CONTAINER=loynara-lifecycle-pg TEST_PG_PORT=54347 npm test` | **222 files passed; 2,140 tests passed; one existing optional Mailpit smoke skipped; 306.54 seconds** |
| `npm run typecheck` after fresh route generation/build | PASS |
| `npm run build` | PASS, optimized production build with synthetic local configuration |
| `npm run lint` | PASS, zero errors; 231 existing warnings |
| ESLint with zero warnings permitted over all 97 changed/new TypeScript files relative to baseline | PASS, no diagnostics |
| Real encrypted PostgreSQL backup/restore drill | **20/20 PASS**, 57.153 seconds; exact hashes and artifact evidence in [restore evidence](RESTORE_DRILL_EVIDENCE.md) |
| Independent encrypted manifest/custody/child cleanup tests | 24/24 PASS |
| Isolated restore-target guards | 9/9 PASS |
| Backup transport/privacy/timeout checks | PASS |
| Shell syntax, Python parsing and `git diff --check` | PASS |

The complete application run includes the 120-case offline release preflight and 17 migration upgrade cases. New coverage exercises one-use export proof, all retained per-card categories, more than 50,000 records without truncation, consistent snapshots and shared-address/referral isolation. Real loopback PostgreSQL protocol peers verify interrupted exports destroy half-open connections; capacity remains reserved until the producer actually stops.

Deletion tests cover full ledger/reversal/redemption/purchase graph consistency, surviving tenants, shared users/devices, recent owner authentication, stopped enrollment/sends, archive-before-commit failure/rollback, legal holds and narrow runtime/maintenance/restore privileges. Inactivity tests cover actual-use boundaries, monthly nonzero review, bounded cleanup, per-card commits and deadline refusal. The pruning job rejects different connected database identities before any mutation, drains bounded batches, and withholds a success result on an unfinished backlog or failed archive. Expired recovery challenges are removed despite an unrelated financial hold.

Recovery tests use real age encryption and PostgreSQL dump/restore, with only the object transport replaced by private local storage. Closure-only recovery invalidates old credentials while preserving the restricted ledger; prepared/completed purge replay removes erased subjects. Current holds are applied before replay, routine expiry is reconciled before PASS, and surviving records retain their fingerprints. Corruption, wrong keys, occupied targets, incomplete manifests, failed archival and uncertain completion refuse unsafe success. Timeout regression tests prove detached tool children are reaped.

The connected-database mismatch fixture was subsequently made portable across local and CI containers by reading only the identity of the standard `postgres` database on the same already-attested disposable cluster. It does not require an extra locally created database. All 23 targeted scheduler/identity tests and typecheck passed after that fixture-only correction. The complete 222-file suite was then rerun successfully in 306.54 seconds on commit `13f1b75`; application behavior and migration hashes are unchanged. Subsequent handover edits are documentation only.

The single skipped case is the existing opt-in `MAILPIT_SMOKE` recovery-message capture, which requires a separately running local inbox. Email delivery/proof adapters otherwise use synthetic transports. The owned integration PostgreSQL uses loopback port 54347; independent recovery rehearsals owned separate temporary clusters and cleaned them up. No real backup or provider request was used. CI uses the verified service-container runner; its two existing Docker Compose publication exclusions remain, while the full local run above includes those suites. Hosted results must be matched to the actual PR head, not an earlier run.

The owner approved all five [retention choices](RETENTION_POLICY_PROPOSAL.md), policy version `2026-10-15`. Local review findings were fixed and regression tested. The separately requested security audit remains a release gate. Actual legal roles/contact roster, statutory accounting classification, independent custody/IAM/expiry, alert delivery, contracted prices and production acceptance require the authorized operator. The [production steps](PRODUCTION_STEPS.md) specify the additive migrations, distinct roles, protected archives and separately authorized activation. No deployment, production migration/environment/schedule change, merge or push to `railway-rc` occurred.
