# Assignment 064 — worktree preservation and push-visibility hold

Observed 2026-10-11T02:02:29.394535+00:00; read-only scope `/Users/youssefbelmokhtar/.codex/worktrees`. LOY-185 remains an external release-verification gate. Starting/source candidate `2c7f5a74c94ab1d8813609f410288c06d9daedd8`; engineer branch `codex/worktree-preservation-064`. Result is the commit containing this record, with exact hash retained in the durable native-Goal checkpoint. Requested Sol Medium; existing executor retained because no verified model setter is available. No new dependencies or worktrees.

## Verified inventory

44 registered Codex worktrees; allocated size 19,724,500,992 bytes (18.37 GiB). 73 common Git registrations total; 29 external paths excluded from filesystem inspection and cleanup. Seven additional marker-only parents remain, with no allocated size reported. Free space snapshot: 31 GiB. No deletion or archive creation occurred.

**SAFE TO REMOVE without new approval: 0.** **31 conditional candidates**, 11,930,525,696 bytes (11.11 GiB gross), require explicit named founder approval: all are attached to the active Goal and idle less than 24 hours. **KEEP 10**: two active checkouts, six with uncommitted work, two with running cwd processes. **REQUIRES INVESTIGATION 3**: separate open chats, including one unintegrated branch. Removing the conditional 31 would leave 13; the ten-worktree target requires resolving the three separate-chat cases without sacrificing WIP or process users.

The full sanitized [manifest](2026-10-11-worktree-preservation-064.json) preserves exact paths, branches/SHAs, allocated/cache sizes, porcelain status excluding node_modules/.next, local commits not on remote-tracking refs, upstream, railway-rc ancestry, integration ancestry, logs/HEAD mtime, cwd processes, open-task ownership and ignored-file counts/sizes. Remote-tracking data is an offline snapshot: no fetch. All 44 HEADs are kept by exact named branches; 42 are ancestors of the integration candidate. None is merged into railway-rc. Local-only committed history must stay on its branch even without an upstream. No branch/stash will be deleted. Native list_artifacts verified 36 current-Goal attachments; native list_threads verified separate open owner chats. SQLite immutable metadata associates paths but does not prove an idle chat completed. All allocations are estimates: APFS shared blocks and preserved archives can reduce actual df reclamation.

## Proposed conditional batch

| Worktree | GiB allocated | Ignored noncache data to preserve before removal |
| --- | ---: | --- |
| `analytics-snapshot-consistency` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `campaign-schedule-lifecycle` | 0.030 | No non-generated noncache data observed; recheck before removal |
| `configured-regression-current` | 0.029 | No non-generated noncache data observed; recheck before removal |
| `full-configured-integration` | 0.029 | No non-generated noncache data observed; recheck before removal |
| `launch-build-triage` | 0.201 | No non-generated noncache data observed; recheck before removal |
| `launch-integration-classification` | 0.029 | No non-generated noncache data observed; recheck before removal |
| `launch-ledger-record` | 0.029 | No non-generated noncache data observed; recheck before removal |
| `launch-remaining-checkpoint` | 0.651 | No non-generated noncache data observed; recheck before removal |
| `location-activity-reporting` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `location-entitlement-enforcement` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `loy119-nfc-referrals` | 0.200 | No non-generated noncache data observed; recheck before removal |
| `loy125-preview-ordering` | 0.289 | var/ (1 files, 319 bytes) |
| `loy127-audience-validation` | 0.200 | var/ (1 files, 303 bytes) |
| `loy127-draft-save-race` | 0.289 | var/ (1 files, 324 bytes) |
| `loy133-goal-reminders` | 0.244 | No non-generated noncache data observed; recheck before removal |
| `loy139-webhook-normalization` | 0.244 | No non-generated noncache data observed; recheck before removal |
| `loy145-setup-validation` | 0.329 | var/ (2 files, 374 bytes) |
| `loy153-invite-serialization` | 0.200 | No non-generated noncache data observed; recheck before removal |
| `loy157-revocation-ordering` | 0.200 | No non-generated noncache data observed; recheck before removal |
| `loy165-reporting-evidence` | 0.029 | No non-generated noncache data observed; recheck before removal |
| `loy43-customer-export` | 0.200 | No non-generated noncache data observed; recheck before removal |
| `loy49-earning-snapshot` | 0.030 | No non-generated noncache data observed; recheck before removal |
| `loy49-redemption-catalogue` | 0.201 | var/ (1 files, 318 bytes) |
| `owner-business-export-snapshot` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `privacy-failure-atomicity` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `push-delivery-reliability` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `push-retry-exhaustion` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `recovery-mailpit-capture` | 0.029 | No non-generated noncache data observed; recheck before removal |
| `staff-reissue-authorization` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `webhook-suppression-idempotency` | 0.822 | No non-generated noncache data observed; recheck before removal |
| `webhook-transaction-retry` | 0.030 | No non-generated noncache data observed; recheck before removal |

## Retained and investigation cases

| Worktree | Class | GiB | Preservation reason |
| --- | --- | ---: | --- |
| `autopilot-bounded-runner` | KEEP | 0.029 | uncommitted tracked or untracked work; preserve exact status; archive and verify ignored noncache data before any approved removal |
| `campaign-rate-limit-cycle` | REQUIRES INVESTIGATION | 0.029 | separate open Codex task; completion/removal needs founder decision; archive and verify ignored noncache data before any approved removal |
| `google-wallet-direct-v1` | KEEP | 0.999 | running process cwd |
| `loy133-catalogue-race` | KEEP | 0.029 | uncommitted tracked or untracked work; preserve exact status |
| `loy133-dispatch-authorization` | KEEP | 0.651 | uncommitted tracked or untracked work; preserve exact status |
| `loy133-reward-reminder` | KEEP | 0.029 | uncommitted tracked or untracked work; preserve exact status; archive and verify ignored noncache data before any approved removal |
| `loynara-build-autopilot-v1` | REQUIRES INVESTIGATION | 0.029 | separate open Codex task; completion/removal needs founder decision |
| `loynara-engineering-integration` | KEEP | 0.652 | active engineering/canonical integration checkout |
| `mailgun-event-day-dedup` | KEEP | 0.651 | uncommitted tracked or untracked work; preserve exact status |
| `nfc-cashier-phone-release-v1` | KEEP | 1.719 | running process cwd; archive and verify ignored noncache data before any approved removal |
| `nfc-reconciled-release-v1` | REQUIRES INVESTIGATION | 0.918 | committed branch not ancestor of current integration; open task and ignored configuration/data; archive and verify ignored noncache data before any approved removal |
| `passfast-e2e-local` | KEEP | 0.108 | uncommitted tracked or untracked work; preserve exact status |
| `staff-http-permissions` | KEEP | 1.415 | active engineering/canonical integration checkout; archive and verify ignored noncache data before any approved removal |

The process users are PID6163 at google-wallet-direct-v1 and PID73607 at nfc-cashier-phone-release-v1. Neither was terminated. Sensitive `.env` at nfc-reconciled-release-v1 (630 bytes) and all nonempty `var/` data are identified by metadata only; contents were not read or copied into the ledger. Noncache ignored data across all44 totals28,196,414 bytes, including generated files. Any subsequently approved removal must recheck status/processes, preserve and verify ignored files with paths/count/size (and hashes where appropriate), use git worktree remove without force, and keep branches. No archive or deletion is authorized by this record.

Shared cache links may point at Desktop/Loynara/node_modules; the target is outside cleanup scope and must remain untouched. passfast-e2e-local has a pre-existing broken node_modules symlink to the previously removed passfast-reward-presentation-v1 checkout; this WIP is retained and the link was not repaired. Active engineer/integration cache roots do not depend on the proposed candidates. Generated next-env.d.ts and tsconfig.tsbuildinfo are regeneration artifacts; noncache .env/.env.local and var files require preservation.

Marker-only parents: `apple-pilot-engineering`, `apple-wallet-production-readiness`, `nfc-physical-preview-exact`, `nfc-recovery-release`, `nfc-returning-customer-v1`, `passfast-reward-presentation-v1`, `passfast-wallet-production`. No marker folder was removed during064.

## GitHub visibility amendment

Assignment062 requested existing Supabase-account sign-in. Founder subsequently reported no Supabase account; do not create one. Read-only repository GitHub Apps settings exposes the installed Supabase Configure link for installation145405138. Following that existing link reaches `https://github.com/settings/installations/145405138`, where GitHub displays **Confirm access**, signed in as @belmo-hub, with **Verify via email**. The verification button was not activated. No mail request, credential, code, signup, terms, permission or installation configuration change occurred. Repository-selection/scope controls are not readable before owner reauthentication.

Traceable amendment: the next specific human step is for the existing GitHub owner to reauthenticate personally on that existing Configure page and leave installation scope readable, without changing access or configuration. This supersedes the earlier proposed Supabase-account sign-in route only; its historical findings remain preserved. Read-only installation scope may still be insufficient to prove project-specific triggers. Exact integration push remains **UNVERIFIABLE**; no push during064. LOY-185/186 remain open. Prior Railway/Cloudflare/GitHub trigger observations in062 are dated evidence, not fresh production acceptance.

## Verification and status

Inventory used read-only Git with GIT_OPTIONAL_LOCKS=0, logs/HEAD mtime, du and lsof cwd. An initial stripped porcelain formatting was corrected through status-only rereads; no index mtime is used as idle evidence. The manifest is validated for count, allocation totals, branch preservation and classification, and git diff --check is required before committing. This is documentation/evidence only; no source, dependency, build, database or global suite rerun is needed. Assignment063 global result1534PASS/0FAIL/1existingoptionalMailpitSKIP is historical source verification and is not a new064 test result.

Status: INVENTORIED / DOCUMENTED; cleanup **PLANNED, NOT PERFORMED**; source unchanged. Local documentation integration is recorded in the checkpoint after commit. Not PUSHED, DEPLOYED, independently ACCEPTED or COMMERCIALLY READY. External actions actually performed: read-only GitHub Configure navigation and one genuine LOY-185 blocker/evidence comment, whose returned ID/readback will be retained. No Gmail-delivery claim.

Native Goal same identity ACTIVE: last measured7,508,057 tokens /38,244seconds; no reset. Historic2.5M window preserved as prior accounting, founder authorized available subscription continuation. Task/input/cached subset/output/browser/reviewer usage breakdowns are unmeasured; no billed API/credit/model-control experiment. Coordinator064 listed stale base2b813dd; verified current2c7f5a74 preserved, not reset.

Next: ask founder for explicit named31-candidate cleanup approval against this concrete manifest; owner GitHub reauthentication is a ticket-specific push hold. After coordinator review, pursue independently authorized LOY-33 recovery-feedback work while these requests remain pending. Never archive the current Goal merely to clear its worktree attachments.
