# LOY-133 — catalogue reward reminders

10 October 2026, Europe/Berlin. Status: **IMPLEMENTED and locally TESTED; not DEPLOYED or ACCEPTED**. This bounded slice covers reward reminders within FEATURE-G-RETENTION-AUTOMATIONS. It does not complete LOY-133/134 or the campaign launch gate.

Base: `9848e759d999930cd3ee8bc38540e9d3b1997eea`. Isolated branch: `codex/loy133-goal-reminders`. Result is the commit containing this entry; its exact SHA is recorded after commit in the authorized YouTrack evidence comment and `var/native-goal-20261010/state.json` in the canonical local checkout. Frozen `codex/nfc-final-customer-policy-v1` remains `32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388`; both that SHA and campaign `e1aae658` are verified ancestors of the base. Accepted NFC/Wallet and session policy are preserved.

## Requirement, implementation and tests

| Requirement | Implementation | Verified evidence |
|---|---|---|
| Reward reminder rule with owner controls | `automations.ts`, merchant automation route/page, existing rule editor; new rules default OFF | Owner/tenant authorization and forged scan/delivery tests; existing route tests |
| Current catalogue eligibility | `reward-readiness.ts`: current balance, active programme/reward, latest effective version, scoped tenant/programme joins | Exact cost boundary, stale/future versions, tenant isolation, redemption and correction |
| Consent-safe bounded queue and dispatch | Existing consent, verified contact, suppression, cooldown, daily/location limits and quiet-hour logic reused; readiness checked during queue and again under membership lock before dispatch | 20 reward reminder tests; existing campaign, unsubscribe, quiet-hour/DST and configuration negative-path suites |
| Logical idempotency and retries | Existing revision/scan fences, unique run key and atomic delivery reservation reused | Concurrent scan/delivery replay; 429 success, withdrawal and redemption before retry; existing five-attempt worker tests |
| Compatible schema | `0023_reward_ready_automation.sql` expands two CHECK constraints only | Populated 0022 upgrade preserves rules, retry reservations, ledger/history; fresh/upgraded schemas match; journal rerun idempotent |

The scan inherits the existing bounded 500-card automation limit and 20-message daily cap. A larger reward-ready audience is explicitly blocked, not silently truncated. Recurring reminders remain subject to the owner-selected 7–365-day cooldown, including while a reward stays available. UI copy discloses that behavior. Capacity beyond this bound and live merchant acceptance remain unverified; this is not a reduced launch scope approval.

## Actual verification

All execution used disposable loopback PostgreSQL databases and synthetic `.test` contacts, with sanitized process environments. Fake Mailgun HTTP calls never reached a provider. No production credentials were copied.

- Unchanged base: 44 focused automation/rate-limit/migration tests passed.
- New tests first failed on base rejection of `reward_ready` (14 failures).
- Final focused run: **174 tests in 13 files passed**, including 20 reward reminders, 14 migration rehearsals, configuration rejection, quiet-hour/DST, campaign/retry, consent/unsubscribe and route compatibility.
- Targeted ESLint and `git diff --check` passed.
- Broader candidate run before the final test-fixture correction: 126 files passed / 22 failed; 1,151 tests passed / 11 failed / one skipped. All 21 unrelated failing files and eight failed tests reproduced on unchanged base source with a separate base-schema database. They comprise 19 missing `web-push` import suites, seven disabled billing-fixture tests and a combined-worker assertion dependent on push loading. Exact names are saved in the local native-goal failure records. The remaining three failures were new retry fixtures missing mandatory promotional limits; corrected **only in synthetic test config**, then all 20 reward tests and final 174 focused tests passed. The broader suite was not rerun, so no globally green claim.
- Final typecheck after local build type generation has **five identical base/candidate diagnostics**, all inherited: missing `jsqr`; missing `web-push` in two integration tests and production staff-push; staff-push unknown-error typing. Initial base/candidate checks also lacked two generated `LayoutProps` names. No changed-source diagnostic remains.
- Default Turbopack builds reject the shared dependency symlink in both snapshots. Documented webpack checks fail identically on missing `jsqr`/`web-push`. Build and browser acceptance remain open. Tests were not weakened to hide these failures.

## Migration and rollback boundary

0023 is additive to the verified 0022 retry migration: 24 contiguous entries after local migration. Metadata ancestry matches 0022 and changes only `automation_rules`. Existing rule values and OFF defaults remain unchanged.

Old application code does not understand `reward_ready`; do not assume that rolling application code back safely stops all new jobs. Before any separately authorized rollback, stop relevant workers and explicitly reconcile/disable new rules and pending jobs. Restoring old constraints fails if a `reward_ready` row exists. The rehearsal proves rejection and transactional preservation, not a production downgrade procedure. No production migration, deployment or rollback is authorized by this entry.

## History, reviews and open actions

The prior LOY-133 attempt was interrupted at a token target with an uncommitted draft. Its original worktree was preserved. The native attachment tool identified another chat as its owner, so the draft was carried into this chat's new worktree after verifying the old worker processes had exited.

ChatGPT checkpoint `LOY-GOAL-20261010-001` selected continuation of that draft. New fixture cleanup initially omitted the global suppression table; cleanup was corrected. Two retry fixture setup approaches failed before HTTP; checkpoint `LOY-GOAL-20261010-002` reviewed the exact missing-limit diagnosis and selected a test-only correction. Production sending gates were unchanged. The final commit requires the next independent ChatGPT checkpoint; automated advice cannot grant founder authorization.

Founder queue: LOY-138 sender/SPF/DKIM/DMARC review and separately authorized synthetic receipt; LOY-134 actual reward-reminder receipt/provider evidence and independent merchant acceptance after sender/consent prerequisites; existing LOY-114 publishing, LOY-76 physical and LOY-235 operator/legal gates. No external send, hosted mutation, deployment, protected merge, tag write or gate closure occurred.

Usage: native Goal checkpoint before the final correction reported 221,173 cumulative tokens. App input/cached/output breakdown and ChatGPT usage are unmeasured. Requested routing is Sol Medium; actual app routing is not exposed by these tools, and no model switch occurred. Prior interrupted CLI usage remains separately preserved: input 285,432, cached subset 238,464, output 3,755. Native six-hour/2.5M checkpoint budget is cumulative and has not been reset; hard token-budget configuration is unavailable for this existing goal.

Next candidates for review: LOY-139 authenticated real `failed`/`severity` webhook normalization; LOY-133 referral audience/template; inherited dependency/build repair after confirming manifest and accepted-source compatibility. All other canonical workstreams remain in scope, including merchant management and UX. Unknown is not complete.
