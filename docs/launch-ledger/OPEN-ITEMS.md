# OPEN ITEMS

Open work, grouped by launch stage. IDs (`O-###`) are stable. `State` uses the workflow states `OPEN`, `IN-PROGRESS`, `BLOCKED`, `DEFERRED`, `DONE`
(see the [README](README.md#status-vocabulary)). **No effort or date estimates are recorded in this ledger**; estimates in earlier draft reports are Tier 4
and not part of the record.

**Classes.** `HARD BLOCKER` (the stated launch level cannot happen without it), `SHOULD (pilot)`, `SHOULD (public)`, `POST-LAUNCH`, `OPTIONAL`,
`DECISION` (an owner decision, not work). **Owner** is the proposed actor, not an assignment already accepted.

Selection rule for the next workstream: *Next workstream will be selected after pilot-hygiene planning and owner launch inputs; Wallet/NFC remain
parallel/non-critical for the first pilot unless the scope decision changes* ([D-024](DECISIONS.md#d-024)).

---

## 1. First merchant pilot (browser/QR; Wallet and NFC off)

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-001"></a>O-001 | Owner launch inputs: operator legal identity and form, right to operate, support/contact channel, pilot merchant and pilot terms (free or founding). The ledger does not conclude what is legally sufficient. | HARD BLOCKER | — | Youssef (+ adviser) | OPEN | Supply the facts; record any "lighter arrangement" an adviser accepts as a decision | If an adviser accepts a lighter private-pilot arrangement, record it as a new decision rather than editing the gate |
| <a id="o-002"></a>O-002 | Operator-specific privacy and participation text replacing the draft `/datenschutz` (the join page links to it) | HARD BLOCKER | [O-001](OPEN-ITEMS.md#o-001) | Youssef + adviser | BLOCKED | Approved text, then replace the draft | — |
| <a id="o-003"></a>O-003 | Pilot-hygiene slice: logout control; neutral wording replacing "synthetisch/Synthetic" on merchant surfaces; guard or hide NFC "Automatisch" in production; manager "Programm bearbeiten" link; referral 400 console error; rerun an authenticated synthetic walkthrough afterwards ([X-007](RISKS-AND-EXCEPTIONS.md#x-007), [X-009](RISKS-AND-EXCEPTIONS.md#x-009)) | SHOULD (pilot) | Promotion done | Codex/Claude (to be assigned) | OPEN | Pilot-hygiene planning | If scope grows beyond hygiene, split it |
| <a id="o-004"></a>O-004 | Decide the credential lifecycle for the pilot: accept operator-set credentials with out-of-band handoff, or add password change/reset ([R-010](RISKS-AND-EXCEPTIONS.md#r-010)) | DECISION | — | Youssef | OPEN | Decide; if "add", scope it into [O-003](OPEN-ITEMS.md#o-003) | — |
| <a id="o-005"></a>O-005 | Repeatable, guarded operator provisioning procedure for owner and staff identities (identity-only start state; no secrets in logs); staff cannot self-register while registration is disabled | SHOULD (pilot) | [O-004](OPEN-ITEMS.md#o-004) | Codex | OPEN | Write the procedure/tool and runbook entry | Replace by [O-043](OPEN-ITEMS.md#o-043) if invite-gated sign-up is built first |
| <a id="o-006"></a>O-006 | Customer recovery on production: approve the transactional e-mail flag and run the release-origin recovery test, **or** document a manual re-issue process ([R-013](RISKS-AND-EXCEPTIONS.md#r-013), [T-083](TEST-EVIDENCE.md#t-083)) | SHOULD (pilot) | [O-002](OPEN-ITEMS.md#o-002) | Youssef (approval) + Codex | OPEN | Choose path | If neither is acceptable, state that guests must save the private card URL |
| <a id="o-007"></a>O-007 | Supervised two-phone production dry run (iPhone and Android customer, cashier phone) with a synthetic merchant, then cleanup by the proven procedure ([T-042](TEST-EVIDENCE.md#t-042), [T-084](TEST-EVIDENCE.md#t-084)) | SHOULD (pilot) | [O-003](OPEN-ITEMS.md#o-003), [O-005](OPEN-ITEMS.md#o-005), [O-006](OPEN-ITEMS.md#o-006) | Youssef (devices) + agents | OPEN | Plan after [O-003](OPEN-ITEMS.md#o-003) | Fail → fix before a real merchant |
| <a id="o-008"></a>O-008 | Confirm offline custody of the backup age identity ([R-008](RISKS-AND-EXCEPTIONS.md#r-008)) | SHOULD (pilot) | — | Youssef | OPEN | Confirm and record (without the key) where it is held | — |
| <a id="o-009"></a>O-009 | Pilot operating arrangements: support channel, daily ledger-vs-balance reconciliation, incident contact, a second alert channel, a populated-data restore reconciliation in pilot week 1 ([X-004](RISKS-AND-EXCEPTIONS.md#x-004)) | SHOULD (pilot) | [O-001](OPEN-ITEMS.md#o-001) | Youssef + Codex | OPEN | Define | — |

## 2. Public / sellable launch

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-011"></a>O-011 | Real manual-invoice route: migration beyond the fixture-only billing schema, auditable activation/cancellation, invoice process (Gate 7) | HARD BLOCKER | [O-012](OPEN-ITEMS.md#o-012), [O-013](OPEN-ITEMS.md#o-013), [D-025](DECISIONS.md#d-025) | Codex + Youssef | BLOCKED | Decide route first | If the adviser rejects manual invoicing, choose a hosted provider ([O-063](OPEN-ITEMS.md#o-063)) |
| <a id="o-012"></a>O-012 | Pricing and offer approval; VAT/invoice position (€69/€49/€99 are unapproved proposals) | HARD BLOCKER | — | Youssef + adviser | OPEN | Approve or change | — |
| <a id="o-013"></a>O-013 | Legal document set: Impressum, Datenschutz, merchant terms, DPA where applicable, consent/retention/deletion, processor list | HARD BLOCKER | [O-001](OPEN-ITEMS.md#o-001) | Adviser + Youssef | BLOCKED | — | — |
| <a id="o-014"></a>O-014 | Public root site: replace placeholders, add legal pages (de/en/ar), decide contact destination/form, handle the build guard, publish apex/`www` without disturbing MX/TXT, new Pages project, decide the audit copy's fate ([R-016](RISKS-AND-EXCEPTIONS.md#r-016)) | HARD BLOCKER | [O-012](OPEN-ITEMS.md#o-012), [O-013](OPEN-ITEMS.md#o-013) | Codex + Youssef | BLOCKED | — | Do not reuse the audit project |
| <a id="o-015"></a>O-015 | Re-record the demo video and fix stale demo scripts after the dashboard (Gate 8 requires the demo to stay accurate) | SHOULD (public) | [O-014](OPEN-ITEMS.md#o-014) | Codex | OPEN | After dashboard stabilizes | — |
| <a id="o-016"></a>O-016 | Golden-path run (account → … → invoice/entitlement) on production-equivalent services | HARD BLOCKER (full V1) | [O-011](OPEN-ITEMS.md#o-011), [O-014](OPEN-ITEMS.md#o-014) | Agents + Youssef | OPEN | Define scope per [O-018](OPEN-ITEMS.md#o-018) | — |
| <a id="o-017"></a>O-017 | Railway Pro upgrade, native backup and **native restore test**, populated restore, before the first **paying** merchant ([X-002](RISKS-AND-EXCEPTIONS.md#x-002), [X-004](RISKS-AND-EXCEPTIONS.md#x-004), [R-017](RISKS-AND-EXCEPTIONS.md#r-017)) | HARD BLOCKER (first paying merchant) | Owner approval of Pro cost | Youssef + Codex | OPEN | Separate approval | — |
| <a id="o-018"></a>O-018 | **Formal V1 gate amendment decision.** The frozen gates require Gates 2 and 3 (Wallet, NFC). [D-024](DECISIONS.md#d-024) lets the first pilot proceed without them but does not amend the gates. Decide whether "sellable v1" requires them. | DECISION | — | Youssef | OPEN | Decide and record as a new `D-###`, leaving V1_RELEASE_GATES unchanged | — |
| <a id="o-019"></a>O-019 | Cloudflare processor/DPA review and the Gate-7 privacy TODOs (session IP address in the session table, retention, deletion) ([X-005](RISKS-AND-EXCEPTIONS.md#x-005)) | HARD BLOCKER | [O-013](OPEN-ITEMS.md#o-013) | Adviser | OPEN | — | — |

## 3. Wallet

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-020"></a>O-020 | Decide provider order: Google first / Apple via a managed bridge / native Apple ([D-020](DECISIONS.md#d-020)) | DECISION | — | Youssef | OPEN | Decide after pilot-hygiene planning | — |
| <a id="o-021"></a>O-021 | Wallet P0 hardening before any real merchant: public `/api/wallet/status` leaks diagnostics; no rate limits on Apple web-service routes; ops-check alerts on every failed job; no Wallet rules in `config-check`; image lacks `openssl`/`zip`; Google objects not deactivated on closure (Claude static findings, not re-verified here) | HARD BLOCKER (Wallet) | [O-020](OPEN-ITEMS.md#o-020) | Codex | OPEN | Plan | — |
| <a id="o-022"></a>O-022 | PassFast production adapter: provider interface, managed provider, `provider` CHECK migration, revoke job, flag and tenant allow-list, tests | PLANNED | [O-020](OPEN-ITEMS.md#o-020), [O-023](OPEN-ITEMS.md#o-023) | Codex | BLOCKED | — | Drop if [O-023](OPEN-ITEMS.md#o-023) fails |
| <a id="o-023"></a>O-023 | PassFast vendor diligence: written Apple-compliance confirmation, signed DPA, quota/pricing, post-closure behavior, data region ([R-002](RISKS-AND-EXCEPTIONS.md#r-002)) | HARD BLOCKER (bridge) | — | Youssef | OPEN | Request written answers | **No written Apple-compliance confirmation or no signed DPA → do not adopt the bridge** |
| <a id="o-024"></a>O-024 | Google Wallet: issuer, Demo-Mode tester, service account, public HTTPS logo host, Save-button artwork, resolve the production-guard conflict with Demo Mode | HARD BLOCKER (Google) | [O-020](OPEN-ITEMS.md#o-020) | Youssef + Codex | OPEN | — | — |
| <a id="o-025"></a>O-025 | Apple Developer enrollment: the owner reports being unable to complete it (cause UNKNOWN) | HARD BLOCKER (native Apple) | — | Youssef | OPEN | Establish the cause | Skip native Apple if it cannot be resolved; keep Apple optional ([D-024](DECISIONS.md#d-024)) |
| <a id="o-026"></a>O-026 | Remote pass revocation on card closure (Google deactivate/redact; Apple void) | HARD BLOCKER (Wallet) | [O-020](OPEN-ITEMS.md#o-020) | Codex | OPEN | — | — |

## 4. NFC

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-030"></a>O-030 | Reader compatibility with the cyberJack RFID basis: read-only `nfc:reader-check` (PC/SC enumeration, ATR, GetVersion). Hardware delivery UNKNOWN. ([D-029](DECISIONS.md#d-029)) | PLANNED | Hardware in hand | Youssef + Codex | OPEN | Run read-only first | Incompatible → pick another PC/SC reader |
| <a id="o-031"></a>O-031 | Tag #1 factory-state inspection (read-only) then provisioning on the device-test lane; define a policy for failed attempts (the UID is burned) and how to run the backend non-production for validation | PLANNED | [O-030](OPEN-ITEMS.md#o-030) | Codex | BLOCKED | — | Stop on any unexpected tag state |
| <a id="o-032"></a>O-032 | Production `TapKeyProvider` and a key-custody decision | HARD BLOCKER (NFC) | — | Youssef + Codex | OPEN | — | — |
| <a id="o-033"></a>O-033 | Production-origin provisioning CLI (the current one is hard-locked to the preview origin and device database) | HARD BLOCKER (NFC) | [O-032](OPEN-ITEMS.md#o-032) | Codex | OPEN | — | — |
| <a id="o-034"></a>O-034 | Audit events for NFC policy and tag changes; `config-check` NFC rules; dashboard disclosure | HARD BLOCKER (NFC) | — | Codex | OPEN | — | — |
| <a id="o-035"></a>O-035 | `automatic_fixed` guardrails: acknowledgement, cooldown floor, daily cap, counter-jump hold, audit, analytics category. **Stays disabled** ([D-023](DECISIONS.md#d-023)). | PLANNED | [O-034](OPEN-ITEMS.md#o-034) | Codex | DEFERRED | — | — |
| <a id="o-036"></a>O-036 | Physical NFC tests: iPhone and Android taps, replay, malformed MAC, stale counter, cooldown, cross-card and cross-location, revocation, restart, QR fallback ([T-073](TEST-EVIDENCE.md#t-073), [T-074](TEST-EVIDENCE.md#t-074)) | HARD BLOCKER (NFC) | [O-031](OPEN-ITEMS.md#o-031)–[O-034](OPEN-ITEMS.md#o-034) | Youssef + Codex | OPEN | — | — |
| <a id="o-037"></a>O-037 | NFC analytics semantics: checkout vs card activity; automatic taps are not checkouts; staff-confirmed taps already count | DECISION | — | Youssef | DEFERRED | — | — |

## 5. Security hardening

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-040"></a>O-040 | Least-privilege runtime database role separate from the migration owner ([R-001](RISKS-AND-EXCEPTIONS.md#r-001)) | SHOULD (public) | — | Codex | OPEN | Plan with a rehearsal; do not reuse the trigger-bypass mechanism ([X-006](RISKS-AND-EXCEPTIONS.md#x-006)) | Pull forward if pilot data or sensitivity grows |
| <a id="o-041"></a>O-041 | Triage the four moderate npm advisories (`drizzle-kit` → `@esbuild-kit/*` → `esbuild`) without applying the suggested major downgrade blindly ([X-008](RISKS-AND-EXCEPTIONS.md#x-008)) | SHOULD (public) | — | Codex | OPEN | — | Any high/critical advisory → immediate |
| <a id="o-042"></a>O-042 | Card bearer-URL hardening (fragment-to-POST/session bootstrap) ([R-011](RISKS-AND-EXCEPTIONS.md#r-011)) | SHOULD (public) | — | Codex | OPEN | Needs design approval | — |
| <a id="o-043"></a>O-043 | Canonical invite-gated sign-up (also fixes staff onboarding when registration is disabled) | POST-LAUNCH (before second merchant) | [O-005](OPEN-ITEMS.md#o-005) | Codex | DEFERRED | — | — |
| <a id="o-044"></a>O-044 | Periodic access review (Railway apps/tokens, GitHub App, Cloudflare) and change-control alerting; consider per-actor tokens ([X-001](RISKS-AND-EXCEPTIONS.md#x-001), [X-011](RISKS-AND-EXCEPTIONS.md#x-011), [R-009](RISKS-AND-EXCEPTIONS.md#r-009)) | SHOULD (pilot) | — | Youssef | OPEN | Review before the pilot | A new unattributed event reopens [X-001](RISKS-AND-EXCEPTIONS.md#x-001) |

## 6. Documentation and evidence

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-050"></a>O-050 | Execute the [evidence-preservation plan](EVIDENCE-INDEX.md#preservation-plan): archive off-git, push or bundle local-only refs, export alert e-mails, decide on iCloud for secret-bearing files ([R-004](RISKS-AND-EXCEPTIONS.md#r-004), [R-006](RISKS-AND-EXCEPTIONS.md#r-006), [R-007](RISKS-AND-EXCEPTIONS.md#r-007)) | SHOULD (pilot) | — | Youssef + agent | OPEN | Do before Railway log windows age out | — |
| <a id="o-051"></a>O-051 | Add supersession notes to stale repository docs (Gate-1 status, accepted risk, RC, README/ARCHITECTURE rename, EXTERNAL_EMAIL_TEST, the "existing marketing site" line) without rewriting history ([R-014](RISKS-AND-EXCEPTIONS.md#r-014)) | SHOULD (pilot) | — | Claude/Codex | OPEN | — | — |
| <a id="o-052"></a>O-052 | Decide branch roles and how the ledger branch lands: `railway-rc` as release branch; fate of `main` and `integration/owner-dashboard-v1`; whether to merge `docs/launch-ledger-checkpoint-001` into `railway-rc` (docs-only, deploys nothing) | DECISION | — | Youssef | OPEN | Decide | — |
| <a id="o-053"></a>O-053 | Attach Tier-2 artifacts for owner-reported facts where available (e.g. a screenshot of the Wallet "Expired" section, order confirmations with secrets removed) | OPTIONAL | — | Youssef | OPEN | — | — |
| <a id="o-054"></a>O-054 | Independent cross-check of Checkpoint 001 against the evidence | SHOULD (pilot) | — | Another agent | OPEN | — | — |
| <a id="o-055"></a>O-055 | Capture creation times not preserved: web `5285bbb4`, ops `a6c40859`, Pages deployment IDs | OPTIONAL | — | Agent | OPEN | — | — |

## 7. Post-launch

| ID | Title | Class | Depends on | Owner | State | Next action | Kill / pivot criteria |
|---|---|---|---|---|---|---|---|
| <a id="o-060"></a>O-060 | Migrate managed Apple passes to the owner's own Apple account ([D-019](DECISIONS.md#d-019)) | POST-LAUNCH | Apple account | — | DEFERRED | — | — |
| <a id="o-061"></a>O-061 | French merchant flow, Morocco readiness, full Arabic application | POST-LAUNCH | — | — | DEFERRED | — | — |
| <a id="o-062"></a>O-062 | Apple VAS and Google Smart Tap | POST-LAUNCH | — | — | DEFERRED | — | — |
| <a id="o-063"></a>O-063 | Hosted billing provider (only if the manual route is rejected) | POST-LAUNCH | [O-011](OPEN-ITEMS.md#o-011) | — | DEFERRED | — | — |
| <a id="o-064"></a>O-064 | Live AI adviser, customer import, POS, SMS/WhatsApp ([POST_V1.md](../../POST_V1.md)) | POST-LAUNCH | — | — | DEFERRED | — | — |
| <a id="o-065"></a>O-065 | Dashboard clean-ups and backend gaps: unused components/CSS, legacy demo-script selectors, location-precise customer list, per-location analytics, persisted reward cost, programme draft state | POST-LAUNCH | — | — | DEFERRED | — | — |
| <a id="o-066"></a>O-066 | Retention/deletion administration and merchant-account deletion | POST-LAUNCH | [O-013](OPEN-ITEMS.md#o-013) | — | DEFERRED | — | — |
