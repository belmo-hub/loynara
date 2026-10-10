# Loynara Build Autopilot V1

Status: PREPARED, NOT AUTHORIZED FOR UNATTENDED CODING. Recurring task is verified PAUSED (loynara-build-autopilot-v1-approval-pending). Production remains unchanged.

## Intent and smallest design

Reduce time to the first legally authorized, fully functional paying merchant by completing one concrete launch engineering blocker per native scheduled run. Use existing ChatGPT sign-in, native scheduled chat follow-ups, one Python standard-library admission helper and isolated Git worktrees. No agent framework, API-key billing, daemon, launchd/cron replacement or uncontrolled loop.

The founder's mission supplies the implementation and manual-rehearsal authorization. Further approval is required for account/credential setup and recurring activation. This packet preserves the existing launch scope rather than treating every issue as a first-pilot requirement.

## Verified capabilities on 10 October 2026

- Desktop app 26.1007.21159, build 20052; bundled CLI 0.162.0-alpha.17.2.
- CLI confirms ChatGPT sign-in. Account usage tool permits ordinary usage: Pro Lite, 2% of the weekly window used at discovery, zero extra credits. Incremental per-run token/dollar charges are not exposed here. No paid API dependency was introduced.
- Native scheduled tasks and existing-chat scheduled follow-ups are available through the automation tool. Scheduled is the inbox for supported run reporting; existing-chat follow-ups return here. Delivery of an actual unattended notification is still untested.
- Local files require the Mac to stay powered on, awake and the app running. Sleep suspends local execution; this is not an always-on cloud runner. Missed-run catch-up and automatic wake behavior were not established; do not rely on either. No power settings changed.
- Codex Cloud list succeeded with zero tasks. The web Cloud environment selector showed only Create environment, with no selectable environment. No usable cloud environment was identified for this account; none created. A ChatGPT project named Loynara is not evidence of a configured coding environment.
- This chat uses workspace-write and automatic approval review. Saved CLI defaults are danger-full-access and approval_policy=never. Native schedules use saved/default permissions, so this chat's successful sandbox probe cannot certify scheduled-run settings.
- Existing native YouTrack MCP endpoint works; current identity is admin. Project fields, milestones, scope decisions and issue dependencies were read. No new connection, credential or issue was created; no YouTrack writes occurred.

## Bounded trial and permissions

Proposed times: 08:00 and 18:00 Europe/Berlin, beginning at the next slot after explicit activation, ending with the 18:00 slot on 15 October 2026; its reporting deadline is 18:45. At most ten coding admissions. This finite initial window matches the recorded launch target; extending it requires a new explicit decision. Activation after some slots does not create catch-up runs.

One issue and one mutating agent at a time. Global ownership is persisted in /Users/youssefbelmokhtar/Desktop/Loynara/var/autopilot-v1/state.json under a POSIX file lock. Claims survive crashes and never expire into automatic reassignment. A founder reconciles an interrupted owner before resetting state; inspect process/worktree/commit first. Approaches are reserved before work and limited to two per issue across runs. Review-ready, blocked and no-change slices are excluded until reviewed; do not manually delete history to retry.

45-minute per-run policy including reporting, no new implementation after minute 30, maximum ten admissions, frozen-ref checks on admission. The helper clamps deadlines to activation/trial expiry, rereads the activation receipt at scheduled checkpoints, validates that review handoff names an existing Git commit and matching JSON evidence file, and rejects unauthorized operation names. Evidence-file presence/consistency is not independent acceptance of its contents. **These are admission/accounting controls, not a process-killing watchdog, OS sandbox, semantic command filter or MCP permission layer.** The native automation tool does not expose a hard wall-clock/token budget here. A live agent must honor checks before each tool, and long commands need their own timeout. If a hard kill is required, native V1 cannot yet certify it; do not silently add a second runner.

Allowed: restricted issue reads; local edits/tests with synthetic data; local commits on isolated codex/ branches; local evidence/reporting. No production operations, provider sends, physical provisioning, billing, purchases, policy changes, protected merges, external messages or legal submissions. Preview mutation also requires separate approval. V1 has no YouTrack write authorization. Push and external PR creation are excluded from the initial profile; local commits are reviewable without them.

Before activation, validate the proposed permission profile in the actual scheduled context: workspace-write, approvals never (denials stop rather than escalate), command networking off unless an exact disposable loopback grant is verified, unneeded apps and production MCPs disabled, only read-only YouTrack tools exposed, and no hosted credentials in environment or accessible test inputs. Verify legitimate worktree edits/tests/commits are allowed while canonical release writes are denied. Project config alone is editable and is not an immutable policy. Native managed requirements or equivalent verified controls must provide the boundary; a prompt/receipt is insufficient. The proposed TOML is a review artifact, not installed configuration.

## YouTrack integration decision

Use native MCP for reads. Current JetBrains documentation supports OAuth with compatible client registration or bearer permanent tokens. The existing connection's credential method and effective authorization scope have not been inspected or inferred from its URL. Do not display auth files, headers, tokens or cookies.

Use an existing restricted non-admin identity if possible; request founder approval before a new account, OAuth authorization or token. Grant only LOY issue/comment reads and visibility to the relevant existing milestones/queue. Current fetched issues expose admin-only permitted-user visibility, so a restricted identity's access must be tested rather than assumed. Avoid paid seats. Limit returned tools using the documented tools query plus the client enabled_tools allowlist; this reduces exposure but does not replace server account permissions.

For future writes, the smallest option is the already available native add_issue_comment under a restricted LOY identity with Read Issue, Read Comment and Create Comment only. Update Issue is unnecessary for comment-only V1. If REST is needed, use the same identity with a YouTrack (not Administration) token; fixed HTTPS host and only POST /api/issues/{existing-LOY-ID}/comments. Store credentials in the OS credential store or a 0600 file outside Git; load headers in memory, never in command arguments/logs. Never POST /api/issues, accept arbitrary URLs, follow credential-bearing redirects, or retry an unknown write blindly. Use a run-ID marker and read existing comments before writing; on ambiguous outcome, read back rather than duplicate. REST is evaluated, not implemented or connected, because native MCP already provides the capability.

Automatic field updates remain outside V1. If separately authorized later, only Stage In Progress/In Review/Blocked and evidence/maturity fields supported by the actual schema may change, after rereading issue and checking exact evidence. Local tests can support Automated Tests Verified/Ready for Review, never legal/physical/production acceptance. Preserve existing stronger evidence and completed feature records. Never mark full acceptance gates Done from a local slice.

## Run procedure

The exact durable scheduled prompt is in scheduled-prompt.txt. Read current issues and hard dependencies, preserve agreed scope, select one demonstrated unresolved local defect or specifically missing local deliverable, inspect existing worktrees/PRs, claim before mutation, implement/test/review/record, release to review or blocked, then stop. Generic stale backlog metadata alone is not permission to re-audit a complete subsystem. If no concrete gap remains, report the next founder/physical/external blocker.

The shared state defaults are intentional. Scheduled runs must not supply --rehearsal, override --state-dir, forge activation receipts, change budgets or alter the frozen SHA to bypass a refusal. A branch/lock only covers this autopilot; other chats/tools must honor it too, and canonical release protection needs the verified runtime permissions above.

Manual controls from this worktree:

    python3 scripts/autopilot-control.py preflight
    python3 scripts/autopilot-control.py status

Rehearsal --rehearsal is for this supervised setup only. A scheduled claim refuses without a private activation receipt. Create that receipt only after actual founder approval and actual permission testing; it must record approval explicit-founder-autopilot-v1, an aware expires_at no later than this trial, sandbox_mode workspace-write, the tested non-admin youtrack_identity, and capability_restrictions_verified true. It contains no credential. It attests to checks; it cannot enforce them. Preserve founder approval evidence separately in this chat.

## Reporting contract

Every admitted run records issue ID, exact base/full commit SHA, branch/worktree, observed command/exit/result evidence, completed/pending work, risks, action-specific founder needs, next eligible task or why none, and usage before/after. Cost is unknown unless a tool reports it. Logs must exclude URLs with bearer/query challenges, private card links, cookies, inbox contents, customer data and raw credentials. Record all relevant failures and skipped checks. A comment payload is only a proposal until the external write is specifically authorized and read back.

## Scheduler state verification

The native create call returned PAUSED while writing ACTIVE to the task TOML. An immediate native update corrected it to PAUSED; saved state was re-read. No scheduled slot occurred during the interval. This discrepancy must be included in future setup tests: verify persisted state after every scheduling mutation, not just the tool success response. Readback after the final prompt update remains required. No raw automation file was edited.

## Activation decision

HOLD. Finish restricted YouTrack authorization and verify a scheduled permission profile, legitimate local operations, forbidden boundaries and notification/readback behavior. Then request explicit activation for the finite times/permissions above. No production or commercial approval is bundled into activation. This packet and paused task are reviewable preparation, not an unattended launch promise.

Sources: [Scheduled tasks](https://learn.chatgpt.com/docs/automations), [Agent approvals/security](https://learn.chatgpt.com/docs/agent-approvals-security), [Configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [YouTrack remote MCP](https://www.jetbrains.com/help/youtrack/cloud/model-context-protocol-server.html), [Permanent-token scope](https://www.jetbrains.com/help/youtrack/devportal/Manage-Permanent-Token.html).
