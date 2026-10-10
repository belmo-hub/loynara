# Campaign engineering and task-discovery reset — 10 October 2026

Full-launch scope is unchanged. This is a local engineering assessment, not live delivery acceptance. Engine ancestry: `654fef25c50e6f8e50be256ae6d783437040d5fc`, a verified descendant of frozen `32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388`. The frozen ref and its checkout remain untouched.

## Why discovery failed

The prior discovery queried Codex-owned launch issues and then followed the static first-paying-pilot shortlist in `launch-queue.md`. Sixteen of twenty campaign-workstream issues use the Claude execution-lane label. The shortlist offered LOY-164 and a conditional LOY-187 fallback, without scanning the remaining feature children for independent engineering slices. The recorded LOY-164 blocker was correctly preserved; the unsupported global conclusion was the error. A lane label, Backlog stage, blocked acceptance gate or parent milestone is not proof that all engineering is blocked.

Fresh bounded inventory: 272 issue records and full descriptions, paginated across all stages/workstreams; 40 issues with hard predecessors, 261 dependency edges. No statuses were changed. Durable current inventory, dependencies and provisional classifications are under `var/autopilot-v1/reports/campaign-cycle-20261010/` in the canonical checkout. Non-campaign classifications are issue-evidence triage, not a fresh source audit or an assertion that all features are implemented. Unknown engineering maturity remains explicitly unverified.

## Existing campaign hierarchy

LOY-5 → LOY-17 → feature/action pairs LOY-125/126 (audience), 127/128 (composer), 129/130 (scheduled delivery), 131/132 (channel decision), 133/134 (retention), 135/136 (consent), 137/138 (sender), 139/140 (reliability), 141/142 (reporting). Analytics: LOY-167/168. Full-system campaign gate: LOY-263/264.

Hard acceptance chain: LOY-136 depends on 138; 140 depends on 136; 130 depends on 140; 134 depends on 130. LOY-5 and LOY-264 require the nine campaign gates plus the channel decision where recorded. These dependencies remain open. Independent implementation work in feature children can proceed with isolated transport tests; none of this accepts the dependent live gates.

## Capability evidence

Paths below refer to the verified engine base; tests are existing coverage, with current cycle execution results recorded separately.

| Capability | Classification | File and test evidence; remaining work |
|---|---|---|
| Creation/editing | IMPLEMENTED, not ACCEPTED | `src/lib/campaigns.ts` create/edit draft; `src/app/api/merchant/campaigns/route.ts`; `campaigns.integration.test.ts` persistent drafts, ownership, editing and schedule revisions; `campaign-production-safety.integration.test.ts` draft-only safety. |
| Audience segmentation | IMPLEMENTED, not ACCEPTED | `src/lib/segments.ts`, `segments.integration.test.ts`: all/new/inactive/recent/frequent/near-reward; tenant/location isolation and unreversed checkouts. Referral-specific campaign audience is missing. |
| Consent/suppression | IMPLEMENTED, not ACCEPTED | `campaigns.ts` classify/send recheck; `automations.ts` eligibleContact; separate `consent_events` channel=email, purpose=marketing, verified contact and suppression. Campaign and automation tests cover withdrawal/revocation; enrollment or recovery email alone never authorizes marketing. |
| Templates/preview | IMPLEMENTED/PARTIAL | `src/components/owner/campaigns-view.tsx`: win-back/near-reward/quiet-time/announcement templates, message review and audience preview; `campaigns-view.test.ts`, campaign preview integration tests. Referral-specific template is missing. |
| Scheduling | IMPLEMENTED, not ACCEPTED | `campaigns.ts` schedule/pause/cancel with revision fences; `promotion-policy.ts` quiet-hours/timezone/DST; `quiet-hours*.test.ts`; worker handles dispatch and deferral. |
| Actual delivery | EXTERNAL BLOCKER for live acceptance | `transactional-email.ts`, `campaigns.ts`, `scripts/worker.ts` provide EU adapter, durable recipient jobs and provider events; fake-provider integration and isolated Mailpit capture exist. Disabled live sending, approved identity/DNS/receipt are not completed by local tests. No real send in this cycle. |
| Retry/idempotency | PARTIAL before this cycle | `transactional-email.ts` reserves before I/O and blocks uncertain/accepted replay; outbox retry budget exists. Explicit HTTP 429 was mapped to ambiguous, permanently blocking a safely retryable rejection. This cycle repairs only that demonstrated gap. |
| Unsubscribe/frequency | IMPLEMENTED, not ACCEPTED | `unsubscribe.ts`, `unsubscribe.integration.test.ts`, `promotion-policy.ts`, campaign/automation tests: signed withdrawal, send-time recheck, tenant/member cooldown, location quotas and quiet hours. |
| Retention triggers | PARTIAL | `automations.ts` and `/merchant/automations/page.tsx` implement first_checkout and inactive only; `automations.integration.test.ts` covers single execution, stale rule, cooldown, contact-free checkout and inactive scans. Reward reminder and referral campaign automation are missing. First-checkout post-visit automation exists; any requirement for repeat visits needs explicit scope evidence before changing behavior. |
| Delivery/outcome reporting | PARTIAL, not ACCEPTED | `campaigns.ts` getCampaign: accepted/suppressed/failed counts, signed provider delivered/failure states and attempts; `campaign-production-safety.integration.test.ts` counts unique legitimate unreversed return checkouts. Return-after-send is explicitly observational, not causal attribution. Full provider/merchant acceptance remains open. |

## Ranked independent engineering slices

Five real candidates were identified, not five completed tasks. Mailgun documents `failed` events with `severity`, whereas the current webhook schema accepts only `temporary_fail`/`permanent_fail`; normalizing real failure events is an independent reporting/suppression gap. Estimates are planning estimates, not measured token promises. All are Must Launch; each can be developed using synthetic recipients without activating a sender.

| Rank | Existing issue / slice | Value, dependencies, effort and risk | Expected uncached Codex input |
|---|---|---|---|
| 1 | LOY-139: confirmed 429 retry | Restore delivery after explicit throttling; existing queue/consent framework; ~60 min, moderate duplicate-send risk requiring replay tests. Deterministic fake HTTP/DB tests. | ~16k |
| 2 | LOY-133: reward reminder trigger | Required retention value; reuse rules/quiet-hours/consent; ~180 min, moderate ledger/eligibility risk. Synthetic reward crossing tests. | ~30k |
| 3 | LOY-139: failed-webhook normalization | Normalize documented failed/severity events, preserve authenticated recipient matching and suppression; ~60 min, moderate correctness risk. Signed synthetic webhook tests. | ~12k |
| 4 | LOY-133: referral audience/template | Required referral campaign actions; reuse tenant referral events and composer; ~150 min, moderate consent/isolation risk. Synthetic referral eligibility tests. | ~26k |
| 5 | LOY-138: sanitized readiness diagnostics | Show why sending remains disabled without exposing secrets; existing config gates; ~60 min, low/moderate information-disclosure risk. Pure config tests; DNS/receipt remain external. | ~12k |

## Selection policy

`scripts/autopilot-select.py` consumes a complete snapshot plus source-backed slice evidence and existing state. It does not invoke models, change YouTrack or launch processes. It includes all launch stages, types and lanes; traversed hard dependencies must be complete. It distinguishes issue acceptance prerequisites from a slice's engineering prerequisites, rejects speculative gaps/required authorizations, preserves history and reports the single-run admission blocker. Unknown/unassessed scope means discovery incomplete, never “no engineering remains.”

Use `docs/autopilot/campaign-slices.json` as current bounded evidence, not an eternal queue. Revalidate source ancestry and history before a future run. After a reviewed result, record the slice key/outcome in state; do not repeat a completed slice or clear a legacy blocker. No recursive audit or automatic next-task execution. The controller remains the only admission owner; this selector is discovery only. Its added --slice/--slice-evidence contract persists outcomes/approaches by issue:slice, retaining the issue summary and unreconciled legacy blockers. The current legacy claim is annotated at evidence-backed review completion.

## Outstanding approvals and acceptance

LOY-138 requires an explicitly approved sender and separately verified SPF/DKIM/DMARC. Provider/processor commercial and privacy review remain separate. Actual opted-in synthetic recipient delivery, receipt, webhook evidence and merchant acceptance need a separately authorized session. LOY-132 preserves the founder decision on additional channels. Marketing consent wording/records and account-recovery authorization are separate. No statuses, launch requirements, enabled flags or founder decisions are changed by this assessment. Unattended scheduling stays HOLD.

## Completed local engineering and verification

LOY-139 `explicit-rate-limit-retry`: only an explicit promotional HTTP 429 rejection can reuse its persisted reservation after backoff. Accepted, uncertain, transport/5xx and recovery/verification attempts retain the non-replay guard. Campaigns and automations recheck consent/suppression before every send; five rejected attempts terminate. Valid reset headers within one hour are honored; malformed, past or excessive deadlines use a finite 60-second fallback. The nullable `email_deliveries.retry_at` migration is additive and was applied only to disposable databases. No external sender was activated.

Final campaign verification: 89 tests across nine files, including 23 new rate-limit cases. Migration rehearsals: 13 tests, including populated 0021→0022 preservation, exact historical rollback rehearsals and fresh-schema equality. Controller/selector: 14 + 7 Python tests. Targeted lint and `git diff --check` pass.

A broader pre-final run did **not** pass: 124 files passed / 22 failed, 1,077 tests passed / 14 failed / one skipped. Six migration failures were caused by this task's new migration and were corrected and verified with the 13-test migration run. Remaining observed failures include missing installed `web-push` imports, seven billing tests under the explicitly disabled fixture environment and a combined-worker assertion. They were not investigated as launch acceptance, nor are all asserted to be baseline defects. Full TypeScript checking remains blocked by unchanged LayoutProps generation, missing `jsqr`/`web-push` and a staff-push unknown-error diagnostic; no changed-source diagnostic remains. Do not claim a globally green release or accepted delivery gate.

Executor was one existing-auth Codex CLI session, `01a1239e-1087-7ea2-a302-90f08736e153`, resumed once with actual `gpt-6.1-sol` / Medium for red and implementation turns. Execution used a sanitized environment, deny-by-default local filesystem profile, no network, no production credentials, a bounded process watchdog and the shared single-run claim. App orchestration used its existing High setting and is accounted separately.

CLI measured usage: input 1,968,619 (cached 1,872,896; uncached 95,723), output 22,214; total 1,990,833. These exceed the planning estimate and must guide future routing. Deterministic metadata processing and short source-specific sessions are required; cached input still consumes tokens. No unattended scheduler is installed or resumed by this branch.
