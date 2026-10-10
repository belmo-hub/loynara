# Full-launch discovery queue — 10 October 2026

This supersedes the two-issue first-paying-pilot shortlist. Preserve the agreed full launch; do not infer that no engineering remains from two exclusions.

Read fresh compact metadata across Backlog, Ready, In Progress, Blocked, QA/Acceptance and Done, including milestones, epics, features, children and acceptance gates in every launch workstream. Page to completion, fetch relevant issue/dependency evidence, and use `scripts/autopilot-select.py` with a complete snapshot. Execution-lane labels do not override the human's authorized safe engineering scope.

Issue and slice are different: an entire issue may be blocked, an external acceptance step may be blocked, or independent local engineering may be available. Record source/test evidence and engineering predecessors per slice. Never erase a blocked/review-ready history entry to make work selectable; use a distinct evidenced slice and review legacy outcomes. Never change statuses to bypass discovery.

Current full inventory and provisional classifications are recorded in the canonical checkout at `var/autopilot-v1/reports/campaign-cycle-20261010/`. They cover all 272 issues and 261 hard dependency edges. Unknown maturity is a pending assessment, not proof of implementation or missing code. Existing completed evidence LOY-271/272 is preserved.

Campaigns are first priority for this reset: see `campaign-readiness.md` and `campaign-slices.json`. Five concrete local candidates were found. Execute only one under the shared controller's active claim. Campaign feature children are not excluded merely because the sender/receipt gate is blocked. LOY-164 and LOY-187 remain excluded without new relevant evidence.

For all other workstreams retain the distinctions: missing engineering; implemented but untested; physical acceptance; external provider; founder scope decision; legal/commercial gate; completed with evidence. No scope requirement is silently reduced or deferred. LOY-5, LOY-9/10, the full-system acceptance gates, legal/commercial approvals, physical NFC/Wallet gates and any recorded scope decisions remain open unless separately accepted.

Stop a coding cycle when its chosen slice is done or genuinely blocked. Claim “no eligible engineering work” globally only after complete discovery and evidence-backed slice assessment; otherwise report the unassessed scope precisely. Do not turn this rule into an unlimited audit or an automatic next run. Scheduling remains HOLD.
