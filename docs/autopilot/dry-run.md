# Supervised rehearsal — 10 October 2026

Result: partial verification; recurring task remains PAUSED. No external issue changes, production changes, account connections or credentials were created. Full launch acceptance remains open.

## Selected existing issue

LOY-164: retention/analytics acceptance. Read-only selection found no hard predecessor for a narrow local fixture correction; it feeds LOY-2 and LOY-266. This is a test-only slice, not completion of the acceptance gate. One approach was reserved under run 76a799c6-cf95-405a-bea8-79734b609037. The shared ownership record excludes another run, and the final outcome is blocked pending verification/review.

Frozen base: 32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388. Local branch: codex/loynara-build-autopilot-v1. Exact resulting commit and observed command evidence are recorded in the private ignored canonical var/autopilot-v1/reports directory. No push, PR or merge.

## Implementation and evidence

The original five retention tests passed. Advancing the fixture's application Date.now by 60 seconds reproduced the drifting-card clear assertion failure (four pass, one fail). Querying PostgreSQL's clock for fixture timestamps fixed that demonstrated mismatch. The skew remains in the test as a regression check, and the spy restores in finally. This supports the fixture-clock correction; it does not prove that every historical intermittent failure had this cause. Product runtime code is unchanged.

A fresh disposable PostgreSQL cluster on loopback port 55481 used only synthetic data and local migrations. Existing node_modules were reused. No environment files or hosted database credentials were copied.

| Check | Observed result |
|---|---|
| Retention baseline | 5/5 pass |
| Deliberate clock-skew reproduction | 4 pass / 1 expected failure |
| Final retention and merchant-analytics integration tests | 2 files, 9/9 pass |
| Admission/control helper suite | 12/12 pass after deadline fix |
| Typecheck | Initial attempt stalled without diagnostics; one bounded 90-second retry timed out. UNVERIFIED, no further attempt. |
| Focused ESLint | Bounded 30-second attempt timed out without diagnostics. UNVERIFIED. |
| Full suite / application build | Not run for this test-fixture/helper/document change. No claim of full product verification. |
| Whitespace and proposed TOML syntax | Verified separately before the local commit. |

The helper suite exercised real file locking with four concurrent claim processes (one winner), persistent ownership and two-approach limits, malformed issue IDs, absent/broad/expired activation, revocation, trial end, maximum admissions, actual Git commit/report consistency, blocked/reviewed exclusion and denial of prohibited operation names. A reviewer found an overdue review handoff gap: its regression failed first, then passed after adding a deadline check. The helper does not execute commands, sandbox the agent or authenticate the truth of report contents.

## Connectivity, reporting and boundaries

Existing native YouTrack MCP successfully read current user, fields, milestones, dependencies and issue descriptions. It authenticates as admin; restricted non-admin access is not yet verified. Many relevant records have admin-only visibility. No token/OAuth connection was created. Proposed comment payload only: external writes/status readback are NOT TESTED and NOT AUTHORIZED. No issue was created or marked PASS/DONE.

Reports preserve passed, failed, timed-out and skipped checks. Account weekly usage was 2% at discovery and 5% at final observation, with ordinary usage allowed and zero extra credits. This is shared-account consumption, not a measured charge for this rehearsal; per-run token/dollar cost is unavailable.

The current workspace-write sandbox denied a harmless write outside its roots. The helper refused all prohibited operation names. Neither test proves that a future unattended run cannot reach production: saved defaults are full access, broad production MCPs remain configured, and project config is editable. Actual scheduled-context restrictions, legitimate local operations, non-admin issue visibility, external status-write readback (if later authorized) and notification delivery remain unverified. No hard native watchdog was exposed; the 45-minute limit is cooperative with checkpoint admission and bounded commands.

Native creation reported PAUSED but initially persisted ACTIVE; an immediate native update corrected it. No 08:00/18:00 slot occurred in that interval. Final saved status was re-read as PAUSED. Trial proposal: 08:00 and 18:00 Europe/Berlin through 15 October 2026, at most ten coding admissions, one issue per run, final reporting by 18:45. Verify timezone interpretation in the actual scheduling context before activation.

## Next action and activation

No next concrete unblocked engineering gap has been proved. LOY-187 is only a conditional candidate after checking existing evidence. Founder/legal/tax, production/provider and physical acceptance blockers in launch-queue.md remain the critical path; no scope decision was silently deferred.

HOLD activation. First obtain action-specific approval for restricted LOY-only YouTrack authorization and a tested scheduled permission profile. Keep the task paused while these checks and compiler/lint investigation remain open. Then request separate explicit approval for the finite recurring trial. Activation never authorizes production, payments, merchant emails, legal submissions, policy changes or protected merges.
