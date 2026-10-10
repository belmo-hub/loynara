# Loynara bounded Autopilot bootstrap — 10 October 2026

The founder directive in the bootstrap chat supersedes the old activation-approval hold. It authorizes local setup and a conditional six-hour window; it does not authorize deployment, external sends, billing, production credentials or protected merges. The product remains the complete agreed launch scope.

## Reused evidence and design

Reuse `autopilot-control.py` for historical admission/review records, `autopilot-select.py` for lane-independent discovery, existing `var/autopilot-v1/state.json`, the 272-record inventory and dependencies, and the current campaign candidate. The untouched frozen NFC ref is `32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388`. Campaign candidate `e1aae6583dbb84a7e183eab9f949ba864972b02d` descends from frozen NFC through `654fef25c50e6f8e50be256ae6d783437040d5fc`, which includes LOY-164 rehearsal work. This is ancestry evidence, not integration acceptance.

Canonical references: `V1_RELEASE_GATES.md` calls itself the authoritative release checklist; `FEATURE_STATUS.md`, `TEST_EVIDENCE.md`, `LAUNCH_BLOCKERS.md`, `PRODUCTION_RELEASE_TEST.md`, `docs/merchant-completion-handoff.md`, the NFC release reviews, and current YouTrack launch requirements. Their historical snapshots do not override the latest founder directive. No product scope was rewritten.

The minimal added control layer is `scripts/autopilot-runner.py`: atomic durable state, the existing single-instance lock, clean worker environment, deny-by-default permission profile, actual sandbox probes, timed CLI invocation, stop marker, exact JSONL usage accounting and fail-closed interrupted-run handling. There is no API billing dependency. Engineering workers have no YouTrack, browser, deployment or provider credentials; shared Git metadata is read-only. Commits are supervised after independent review.

## Validation and implementation steps

1. Reuse existing issue state without resetting LOY-164/LOY-139.
2. Refresh issue metadata incrementally, retaining all workstreams/stages/lanes and unknown maturity.
3. Test local file access, credential denial, network denial, locking, timeout/stop, usage accounting and crash refusal.
4. Execute one Sol Medium task with a concise prompt and independently verify it.
5. Reconcile the task, save a review outbox and obtain a completed reply in the verified Chrome conversation.
6. Test `start`; activate a background process only if the required transport and isolation checks actually pass.

## Current integration limitation

This is a supervised control layer, not a completed unattended selector/executor loop. `start` and `resume` deliberately refuse before launching a process when the deterministic tracker transport is unavailable. No launchd job or recurrence has been installed. The available native YouTrack connector is an admin OAuth connection scoped to Codex tools; configuration contains only an MCP URL, with no standalone restricted token. No token was exported, broad account credential copied, new identity created or new login requested. A Python runner cannot use this chat's in-memory MCP tool transport after the chat ends. A standalone restricted read integration and its issue visibility/server privilege tests remain required; then wire incremental retrieval into the loop, verify the loop in its actual background context and prove bounded expiry before activation. A token file or a boolean receipt alone cannot pass that gate.

Chrome works in the current Codex tool session. No persistent standalone Python Chrome adapter has been established. Until it is, retain uniquely identified review messages locally; never mark delivered from local file creation, never resend uncertain submissions, and continue only preapproved tasks when coordination is unavailable. Automated ChatGPT replies are advisory and cannot authorize sensitive actions.

## Controls

From the isolated worktree, use `python3 scripts/autopilot-runner.py status`, `start`, `stop`, or `resume`. `start`/`resume` currently return a concrete BLOCKED reason. `stop` records a stop request checked by a running invocation watchdog, and does not signal an unverified stale PID. `cycle` is an explicitly supervised local invocation; it keeps its claim until independent verification and the existing controller's review handoff.

The CLI exposes aggregate usage at turn completion, so targets are checked between invocations, not absolute mid-turn caps. Input includes cached input; uncached=input-cached; total=input+output. Missing usage is unavailable, never zero. A process timeout can interrupt a turn; unknown usage blocks further automatic launch.

Keep the Mac powered and awake. Closing the lid or sleeping can suspend local processes. No system energy/security settings were changed. Background survival and six-hour expiry are not certified by passing short controlled watchdog tests.
