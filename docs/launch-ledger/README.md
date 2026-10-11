# LOYNARA — COMPLETE BUILD & LAUNCH RECORD

Canonical evidence source: `docs/launch-ledger/`. Direct founder instruction, 2026-10-10: maintain this record alongside engineering and compile the comprehensive final build-and-launch brief from it at project completion. The brief must remain reconstructable if all ChatGPT conversations are lost. This requirement does not change launch scope or authorize production actions.

## Structure

- [TIMELINE](TIMELINE.md): chronological, exact-commit index of task evidence.
- [DECISIONS](DECISIONS.md): decisions, source, authority and unresolved policy.
- [RELEASES](RELEASES.md): local candidates versus verified deployments and acceptance.
- [EXTERNAL-SERVICES](EXTERNAL-SERVICES.md): actions actually performed and external gates.
- [RISKS-AND-EXCEPTIONS](RISKS-AND-EXCEPTIONS.md): limitations and traceable amendments.
- [TEST-EVIDENCE](TEST-EVIDENCE.md): reproducible test references and scope.
- [OPEN-ITEMS](OPEN-ITEMS.md): incomplete launch work and dependencies.

These eight indexes were absent at verified base cd38bdcdcb72135e236fd533ad5c921712347246. They are added without changing the 16 existing task records. The timeline covers those available records; earlier development history must be sourced from preserved Git/document evidence, not invented. This index is not a repeated readiness audit.

## Incremental task record

After each substantial task, add one compact dated entry and update only affected indexes. Record: issue ID/objective/implementation; agent/model/date/execution context; starting/resulting exact SHAs; actual changes/components; tests/outcomes/evidence; architecture/product decisions and their authorization; external actions actually performed; failures/limitations/risks/blockers; measurable token usage and unmeasured categories; next steps/dependencies. An entry may identify its resulting commit by containment; a later index records its exact hash. Do not amend history merely to insert a self-referential SHA.

Use explicit statuses independently: **IMPLEMENTED** means code exists at a SHA; **TESTED** means the cited checks actually ran; **DEPLOYED** needs environment/time/release evidence; **ACCEPTED** needs the applicable independent/founder acceptance evidence. **PLANNED** is not implemented; **REJECTED** records an abandoned proposal; **SUPERSEDED** links replacement evidence; **ACCEPTED-RISK** requires named authorized acceptance and rationale. Passing tests never implies DEPLOYED or ACCEPTED. Unknown evidence remains unknown. Automated advice cannot grant founder authorization.

Preserve chronology and historical decisions. Correct inaccuracies through a dated amendment naming the original record/claim, supporting evidence, correction and effect; retain the original. Record no passwords, bearer/recovery tokens or private credentials. Use sanitized outcomes and reproducible configuration references. Keep changes in isolated Git work; never modify protected release refs or production systems for documentation.

## Conversation rotation and final brief

Every strategic handoff includes this canonical location, latest entries and exact SHAs, unresolved decisions and relevant evidence references. Transfer compact essentials, never the complete ledger. Verify them locally; preserve previous coordinator URLs and authorization boundaries. The ledger supplies continuity even without conversation memory.

At project end, compile **LOYNARA — COMPLETE BUILD & LAUNCH RECORD** from these records: complete development chronology, sourced technical architecture, final requirement-to-implementation/test status, actual production verification, authorization/decision history, external service actions, lessons learned and remaining roadmap. Link evidence and label gaps. Do not call the final brief complete until the entire required scope and evidence inventory have been reconciled.


[LOY-286 operations heartbeat acknowledgment](LOY-286-operations-heartbeat-ack-2026-10-11.md): bounded193 coding delta; exact receipts appended to entry.


[LOY-287 secret-safe operations diagnostics](LOY-287-secret-safe-ops-diagnostics-2026-10-11.md): actual CLI controlled exception leakage correction; completion receipts in entry.
