# Loynara Launch Ledger

The canonical, append-only record of how Loynara was built, verified, deployed and (not yet) launched.
It is the intended source for the later detailed build-and-launch dossier.

**Current checkpoint:** [CHECKPOINT-001](checkpoints/CHECKPOINT-001.md) — *Owner dashboard release promoted* (covers 2026-09-25 through 2026-10-02 00:33 CEST).

## What this ledger is and is not

- It **records** what happened, what is true now, what was decided, what is accepted as risk, and what is still open.
- It **does not replace** the frozen release gates ([V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md)) or the Gate-1 evidence notes in
  [PRODUCTION_RELEASE_TEST.md](../../PRODUCTION_RELEASE_TEST.md). Those older documents are **preserved unchanged**; where this ledger
  knows something newer, it says so explicitly and links back. It never silently rewrites history.
- It is **documentation only**. It contains no application code and no secrets.
- It was authored from preserved sources (Git, tracked docs, agent handoff records, agent session logs, owner statements). Checkpoint 001
  has **not yet been independently cross-checked** by a second agent ([O-054](OPEN-ITEMS.md#o-054)).

## File map

| File | Purpose |
|---|---|
| [STATE.md](STATE.md) | One-page current verified snapshot. Rewritten at every checkpoint. |
| [TIMELINE.md](TIMELINE.md) | Append-only dated events (`TL-###`), including failed and superseded ones. |
| [DECISIONS.md](DECISIONS.md) | Decisions (`D-###`): why, alternatives, evidence, status, reversibility, pivot triggers. |
| [RELEASES.md](RELEASES.md) | Releases and checkpoints (`REL-###`), branches, SHAs, deployments, rollback lineage. |
| [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md) | Third-party services: purpose, plan, data flow, risk, exit plan, open action. |
| [RISKS-AND-EXCEPTIONS.md](RISKS-AND-EXCEPTIONS.md) | Risks (`R-###`) and accepted exceptions (`X-###`) with reopen triggers. |
| [TEST-EVIDENCE.md](TEST-EVIDENCE.md) | Test matrix (`T-###`): result, status, environment, date, evidence, limitation. |
| [OPEN-ITEMS.md](OPEN-ITEMS.md) | Open work (`O-###`) grouped by launch stage. |
| [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) | Evidence register (`E-###`) with hashes and locations, plus the preservation plan. |
| [checkpoints/](checkpoints/CHECKPOINT-001.md) | One file per checkpoint (what was true at that moment, what was reconciled). |

## Stable IDs

| Prefix | Meaning | Defined in |
|---|---|---|
| `D-###` | Decision | [DECISIONS.md](DECISIONS.md) |
| `R-###` | Risk | [RISKS-AND-EXCEPTIONS.md](RISKS-AND-EXCEPTIONS.md) |
| `X-###` | Accepted exception (a risk the owner consciously accepted) | [RISKS-AND-EXCEPTIONS.md](RISKS-AND-EXCEPTIONS.md) |
| `E-###` | Evidence item | [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) |
| `REL-###` | Release or checkpoint | [RELEASES.md](RELEASES.md) |
| `T-###` | Test or verification | [TEST-EVIDENCE.md](TEST-EVIDENCE.md) |
| `O-###` | Open item | [OPEN-ITEMS.md](OPEN-ITEMS.md) |
| `TL-###` | Timeline event | [TIMELINE.md](TIMELINE.md) |

IDs are never reused or renumbered. A superseded entry keeps its ID and gains a `Superseded by` note.

## Conventions

- **Time.** UTC is canonical (`Z`). Berlin local time is CEST = UTC+2 in this period and is shown in parentheses where a source used it.
  Git commit times are converted to UTC. Where a time is not known it is written `unknown`, never estimated.
- **Agents and models.** *Actual* model is taken from the agent's own session log where one exists (Codex `turn_context`, Claude
  transcript metadata). Codex handoff records say "not independently verified"; the session logs do record the model, so this ledger
  uses the log value and says so. *Requested* model is taken from the task text or handoff where stated, otherwise `not recorded`.
- **IDs of external objects** (Railway deployment, audit event, image digest) are recorded because they are identifiers, not credentials.
  Token **values**, ping URLs, passwords, private keys and personal e-mail addresses are **never** recorded.

## Status vocabulary

Every fact in this ledger carries one of these statuses. They are deliberately strict.

| Status | Meaning | Must not be used when |
|---|---|---|
| **VERIFIED** | Confirmed by Tier 1 or Tier 2 evidence in the **real environment the claim is about** (for example production). | The only evidence is an owner statement, a local test, a fixture, or inference. |
| **IMPLEMENTED** | Code or configuration exists in the repository (committed). | It was only designed, planned or discussed; or when it is actually running somewhere (then see DEPLOYED). |
| **TESTED** | Exercised by automated or scripted tests in a **non-production** setting: local PostgreSQL, fixtures, mocks, emulation, disposable databases. | It is claimed as proof of production behaviour. |
| **DEPLOYED** | Running in a named real environment, identified by deployment ID and source SHA. | It was only implemented or tested locally. |
| **PLANNED** | Decided, designed or scheduled, but not built or executed. | Anything was actually built (then IMPLEMENTED). |
| **REJECTED** | Considered and deliberately not pursued. Kept for history. | — |
| **SUPERSEDED** | Valid or attempted at the time, then replaced by a later approach. Kept for history. | — |
| **ACCEPTED-RISK** | A known gap or anomaly that the owner consciously accepted with containment and reopen triggers (an `X-###` entry). | The gap was never reviewed by the owner. |
| **OWNER-REPORTED** | Asserted by the owner; no agent or machine independently observed it (Tier 3). | An agent or system actually observed it (then VERIFIED, with the tier named). |
| **UNKNOWN** | Not established by any preserved evidence. Do not infer. | — |

Additional labels used only where stated:

- **TEST-EVIDENCE `Result` column:** `PASS`, `FAIL`, `PARTIAL`, `NOT RUN`. `NOT RUN` means the test has not been executed; its status
  is then PLANNED (or IMPLEMENTED when the code exists but the real-world test has not happened).
- **OPEN-ITEMS `State` column:** `OPEN`, `IN-PROGRESS`, `BLOCKED`, `DEFERRED`, `DONE`. These are workflow states, not evidence statuses.

Rules that follow from the vocabulary:

1. Do not write DEPLOYED for something that only exists locally or on a branch.
2. Do not write VERIFIED for an owner-reported result, even a credible one.
3. Do not write IMPLEMENTED for something that was merely designed.
4. Failed and superseded approaches are **kept**, with their status, not deleted.
5. A statement from a handoff record is Tier 2, not Tier 1, even when it is probably right.

## Evidence tiers

| Tier | Meaning | Examples |
|---|---|---|
| **TIER 1** | Authoritative machine or project evidence | Git objects, Railway API/audit readbacks, database read-only readbacks, checksummed logs |
| **TIER 2** | Agent handoff or preserved report | `FINAL_HANDOFF_RECORD` files, Gate-1 report bundles, Claude/Codex session reports |
| **TIER 3** | Owner-reported result | Physical device observations, purchases, account states reported in chat |
| **TIER 4** | Inference or unresolved | Anything reasoned rather than observed; marked UNKNOWN where it matters |

Each `E-###` entry in [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) names its tier.

## Deployed SHA versus documentation branch head

Documentation commits (including this ledger) never change what runs in production.

- The **deployed SHA** is the commit Railway built for a named deployment. For the owner-dashboard release it is
  `5c580be9b1887327cc456e672d2f25f29fc25830` ([REL-012](RELEASES.md#rel-012)).
- The **documentation branch head** is whatever commit the branch `docs/launch-ledger-checkpoint-001` points to. It is descended from the
  deployed SHA, differs from it **only** by files under `docs/launch-ledger/`, and is **not deployed code** ([REL-013](RELEASES.md#rel-013)).
- Railway auto-deploy is disabled for all services ([D-011](DECISIONS.md#d-011)), so pushing a documentation commit deploys nothing.
- A ledger commit never embeds its own SHA (it cannot). Read the head with `git rev-parse docs/launch-ledger-checkpoint-001`.

## What must never be stored here

Secrets and anything that would act as a credential or identify private people: API/project/tunnel tokens, passwords or password hashes,
private keys and age identities, Healthchecks ping URLs, S3 credentials, webhook-signing secrets, cookies, session tokens, account IDs
that grant access, personal e-mail addresses, customer data, raw logs containing any of these. Record **names, IDs and hashes** instead.

## Update protocol

1. Add new events to [TIMELINE.md](TIMELINE.md) in date order; never edit past events except to add `Superseded by`.
2. Add or change decisions in [DECISIONS.md](DECISIONS.md) with a new ID; do not overwrite old reasoning.
3. Add every new piece of evidence to [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) with a SHA-256 where a file exists.
4. Update [STATE.md](STATE.md) last, and write `checkpoints/CHECKPOINT-###.md` for the new milestone.
5. Put the ledger commit on a documentation branch from the exact released SHA; do not commit it to `railway-rc` ([REL-013](RELEASES.md#rel-013)).
6. Run the link and ID checks described in [CHECKPOINT-001](checkpoints/CHECKPOINT-001.md#validation-performed) before committing.

## Preservation

Most Oct 2026 evidence lives **outside Git** (ignored `var/`, agent session stores, `/tmp`, owner mailbox, provider consoles). The
[preservation plan](EVIDENCE-INDEX.md#preservation-plan) says what to archive, hash, push or discard. Nothing has been archived yet
([O-050](OPEN-ITEMS.md#o-050)).
