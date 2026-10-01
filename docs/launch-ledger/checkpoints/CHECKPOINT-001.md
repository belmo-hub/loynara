# CHECKPOINT 001 — OWNER DASHBOARD RELEASE PROMOTED

| | |
|---|---|
| Covers | 2026-09-25 (first owner prompt) → 2026-10-02 00:33 CEST (promotion frozen) |
| Authored | 2026-10-02 (CEST), by Claude (actual `claude-sonnet-5-5`; requested Claude Sonnet 5.5, effort Extra) |
| Base | `railway-rc` = `5c580be9b1887327cc456e672d2f25f29fc25830` |
| Branch | `docs/launch-ledger-checkpoint-001` — documentation only, **not deployed code** ([REL-013](../RELEASES.md#rel-013)) |
| Independent review | **Not yet done** ([O-054](../OPEN-ITEMS.md#o-054)) |

Read first: [README](../README.md) (vocabulary and tiers) → [STATE](../STATE.md) (current snapshot).

## 1. Official release tuple

| | |
|---|---|
| Branch | `railway-rc` |
| Release SHA | `5c580be9b1887327cc456e672d2f25f29fc25830` |
| Railway web deployment | `c87f2b50-783b-45d6-9d2a-6c880b0aa14f` (created 2026-10-01T22:26:47.695Z) |
| Image | `sha256:68738a1479faac1b1d8de5ac8c0b7298c1e21218f8a4f5626e93542043dade38` |
| Promotion smoke | 20/20 PASS ([T-048](../TEST-EVIDENCE.md#t-048)) |
| Database | clean application baseline; 18/18 migrations; `email_provider_events` = 2 preserved |
| Other services / configuration | unchanged |
| Rollback target | `b588220e-82c5-429b-891a-a147d12c0f33` |
| Integration branch | `integration/owner-dashboard-v1` preserved at `5c580be` |
| Record | [REL-012](../RELEASES.md#rel-012); evidence [E-031](../EVIDENCE-INDEX.md#e-031) |

## 2. Major accomplishments through this checkpoint

1. **Platform built and tested locally (Sept 25–28):** Fidelix-comparable multi-tenant loyalty platform — ledger, QR card, cashier, rewards, referrals, campaigns, automations, offline earning, rule-based adviser, multi-location, billing fixture ([TL-002](../TIMELINE.md#tl-002)–[TL-007](../TIMELINE.md#tl-007), [D-001](../DECISIONS.md#d-001)).
2. **Protected device-test environment** and owner-reported physical camera scans ([TL-008](../TIMELINE.md#tl-008), [TL-009](../TIMELINE.md#tl-009)); rename LoopLocal → Loynara ([D-005](../DECISIONS.md#d-005)); v1 scope frozen into eight gates ([D-006](../DECISIONS.md#d-006)).
3. **Secure NFC and e-mail foundations (software):** NTAG 424 DNA verifier and provisioning CLI ([TL-012](../TIMELINE.md#tl-012)); Mailgun EU recovery and promotional paths with controlled real sends on the device-test origin ([TL-014](../TIMELINE.md#tl-014), [TL-015](../TIMELINE.md#tl-015)).
4. **Production infrastructure (Gate 1):** Railway Hobby EU West, private PostgreSQL, Cloudflare tunnel, R2 age-encrypted backups with restore proof, Healthchecks/UptimeRobot monitoring, peer-identity fix with two independent reviews, callback cutovers, Mac-off exercise ([TL-017](../TIMELINE.md#tl-017)–[TL-031](../TIMELINE.md#tl-031)).
5. **Gate-1 completion and an accepted risk:** natural backup, fresh drills, in-flight interruption and missed-run alert evidence; an unexplained ops redeploy was investigated, contained and accepted as a risk with provenance still UNKNOWN ([TL-038](../TIMELINE.md#tl-038)–[TL-045](../TIMELINE.md#tl-045), [X-001](../RISKS-AND-EXCEPTIONS.md#x-001)).
6. **Owner dashboard:** built isolated and frozen (`652d214`), integrated A→B→C→D (`6f80c72`), verified on production with synthetic tenants, P2 date bug fixed (`5c580be`), revised RC deployed and **promoted** ([TL-027](../TIMELINE.md#tl-027), [TL-046](../TIMELINE.md#tl-046)–[TL-061](../TIMELINE.md#tl-061)).
7. **Synthetic production verification and cleanup:** a first false blocker (Cloudflare Browser Integrity Check) diagnosed; two cleanup attempts that performed **no writes** preserved as superseded; a corrected, rehearsed, committed cleanup restored the clean baseline ([TL-047](../TIMELINE.md#tl-047)–[TL-057](../TIMELINE.md#tl-057)).
8. **Wallet proof of concept:** a synthetic PassFast managed-signing Apple pass was issued, updated and voided; device-side steps are OWNER-REPORTED ([TL-034](../TIMELINE.md#tl-034), [TL-035](../TIMELINE.md#tl-035)).

## 3. Verified capabilities (production, synthetic data unless stated)

| Capability | Status | Tests |
|---|---|---|
| Owner onboarding wizard from an identity-only account; idempotent retry | VERIFIED | [T-038](../TEST-EVIDENCE.md#t-038) |
| All 15 dashboard routes reachable and behaving; manager and cashier scopes enforced | VERIFIED | [T-037](../TEST-EVIDENCE.md#t-037), [T-039](../TEST-EVIDENCE.md#t-039) |
| Two-tenant isolation in both directions | VERIFIED | [T-006](../TEST-EVIDENCE.md#t-006), [T-040](../TEST-EVIDENCE.md#t-040) |
| Customer → cashier → owner with idempotent awards/redemptions; analytics reconcile | VERIFIED | [T-041](../TEST-EVIDENCE.md#t-041), [T-043](../TEST-EVIDENCE.md#t-043) |
| Billing, Wallet and NFC are inert in production (flags off; routes disabled) | VERIFIED | [T-045](../TEST-EVIDENCE.md#t-045) |
| Operations: monitors and alerts, backup and restore (empty schema), restart/interruption recovery | VERIFIED | [T-009](../TEST-EVIDENCE.md#t-009)–[T-022](../TEST-EVIDENCE.md#t-022) |
| Deployment and rollback mechanism with auto-deploy off | VERIFIED | [T-035](../TEST-EVIDENCE.md#t-035), [T-048](../TEST-EVIDENCE.md#t-048) |
| Synthetic cleanup procedure and clean baseline | VERIFIED | [T-049](../TEST-EVIDENCE.md#t-049), [T-050](../TEST-EVIDENCE.md#t-050) |

Local-only (TESTED, not production): 340/340 tests, 46 browser tests, responsive/accessibility checks, NFC verifier and Wallet fixtures ([T-031](../TEST-EVIDENCE.md#t-031)–[T-034](../TEST-EVIDENCE.md#t-034), [T-060](../TEST-EVIDENCE.md#t-060), [T-070](../TEST-EVIDENCE.md#t-070)–[T-072](../TEST-EVIDENCE.md#t-072)).

## 4. Excluded or deferred capabilities

Not enabled or not done, and **not** part of this release: public registration; external e-mail in production; live billing and any real invoice; native Apple/Google Wallet and any
PassFast adapter; NFC in production (no key provider, no physical test); public root site and legal documents; canonical invite-gated sign-up; logout and password change/reset;
Railway Pro and native backups; least-privilege database role; real two-phone production checkout. See [STATE](../STATE.md#2-headline-state).

## 5. Accepted risks and exceptions

[X-001](../RISKS-AND-EXCEPTIONS.md#x-001) unexplained Railway redeploy (**provenance UNKNOWN**), [X-002](../RISKS-AND-EXCEPTIONS.md#x-002) native backups deferred,
[X-003](../RISKS-AND-EXCEPTIONS.md#x-003) Mac-off by attestation, [X-004](../RISKS-AND-EXCEPTIONS.md#x-004) restore proven on an empty schema,
[X-005](../RISKS-AND-EXCEPTIONS.md#x-005) Cloudflare processor handling, [X-006](../RISKS-AND-EXCEPTIONS.md#x-006) one-time cleanup trigger bypass,
[X-007](../RISKS-AND-EXCEPTIONS.md#x-007) GET-only promotion smoke, [X-008](../RISKS-AND-EXCEPTIONS.md#x-008) npm findings/build warnings,
[X-009](../RISKS-AND-EXCEPTIONS.md#x-009) shipped P3 issues, [X-010](../RISKS-AND-EXCEPTIONS.md#x-010) Hobby hard limit, [X-011](../RISKS-AND-EXCEPTIONS.md#x-011) token-attributed deployments.
Open risks include the runtime database superuser ([R-001](../RISKS-AND-EXCEPTIONS.md#r-001)), PassFast ([R-002](../RISKS-AND-EXCEPTIONS.md#r-002)), NFC production gaps ([R-003](../RISKS-AND-EXCEPTIONS.md#r-003)),
and evidence fragility ([R-004](../RISKS-AND-EXCEPTIONS.md#r-004)–[R-008](../RISKS-AND-EXCEPTIONS.md#r-008)).

## 6. Remaining first-pilot blockers

Hard: owner launch inputs ([O-001](../OPEN-ITEMS.md#o-001)) and operator-specific privacy/participation text ([O-002](../OPEN-ITEMS.md#o-002)).
Should fix before a pilot: pilot-hygiene slice ([O-003](../OPEN-ITEMS.md#o-003)), credential-lifecycle decision ([O-004](../OPEN-ITEMS.md#o-004)), repeatable provisioning
([O-005](../OPEN-ITEMS.md#o-005)), customer recovery on production ([O-006](../OPEN-ITEMS.md#o-006)), supervised two-phone dry run ([O-007](../OPEN-ITEMS.md#o-007)), backup-key custody
([O-008](../OPEN-ITEMS.md#o-008)), pilot operating arrangements ([O-009](../OPEN-ITEMS.md#o-009)), access review ([O-044](../OPEN-ITEMS.md#o-044)), evidence preservation ([O-050](../OPEN-ITEMS.md#o-050)),
stale-docs supersession ([O-051](../OPEN-ITEMS.md#o-051)), independent ledger cross-check ([O-054](../OPEN-ITEMS.md#o-054)).

## 7. Remaining public-launch blockers

Pricing and offer ([O-012](../OPEN-ITEMS.md#o-012)), legal documents ([O-013](../OPEN-ITEMS.md#o-013), [O-019](../OPEN-ITEMS.md#o-019)), manual-invoice route ([O-011](../OPEN-ITEMS.md#o-011)), public root site
([O-014](../OPEN-ITEMS.md#o-014)), demo re-record ([O-015](../OPEN-ITEMS.md#o-015)), golden-path run ([O-016](../OPEN-ITEMS.md#o-016)), Railway Pro and native-backup test before the first paying merchant
([O-017](../OPEN-ITEMS.md#o-017)), the formal V1 gate amendment decision ([O-018](../OPEN-ITEMS.md#o-018)). Wallet and NFC have their own lists ([O-020](../OPEN-ITEMS.md#o-020)–[O-037](../OPEN-ITEMS.md#o-037)).

## 8. Evidence summary

The proof for this checkpoint is mostly **outside Git** (Tier 2 handoff records with Tier-1 readbacks, session logs, provider consoles). [EVIDENCE-INDEX](../EVIDENCE-INDEX.md) indexes 43 items
with SHA-256 values and the [preservation plan](../EVIDENCE-INDEX.md#preservation-plan). Key anchors: promotion [E-031](../EVIDENCE-INDEX.md#e-031), revised RC [E-030](../EVIDENCE-INDEX.md#e-030),
corrected cleanup [E-028](../EVIDENCE-INDEX.md#e-028), Gate-1 completion [E-012](../EVIDENCE-INDEX.md#e-012), containment record [E-013](../EVIDENCE-INDEX.md#e-013), integration [E-017](../EVIDENCE-INDEX.md#e-017),
frozen dashboard [E-004](../EVIDENCE-INDEX.md#e-004), sessions [E-005](../EVIDENCE-INDEX.md#e-005)–[E-010](../EVIDENCE-INDEX.md#e-010).

## 9. Owner-reported facts added (Tier 3, not machine-verified)

| Fact | Where |
|---|---|
| The managed-signed PassFast pass was installed on the owner's real iPhone, showed 6/10, updated remotely to 7/10 with a Wallet update notification, was voided, and afterwards appeared under Wallet's "Expired" section | [T-063](../TEST-EVIDENCE.md#t-063), [TL-035](../TIMELINE.md#tl-035) |
| Ten NTAG 424 DNA 28×28 mm on-metal tags purchased for Loynara physical testing | [D-028](../DECISIONS.md#d-028), [TL-036](../TIMELINE.md#tl-036) |
| A REINER SCT cyberJack RFID basis reader purchased; compatibility expected via generic PC/SC; physical NTAG 424 provisioning **not** verified | [D-029](../DECISIONS.md#d-029), [O-030](../OPEN-ITEMS.md#o-030) |
| The owner is currently unable to complete Apple Developer Program enrollment; managed-signing providers were investigated as a temporary bridge | [TL-037](../TIMELINE.md#tl-037), [D-018](../DECISIONS.md#d-018), [O-025](../OPEN-ITEMS.md#o-025) |

Not invented: purchase cost, supplier beyond what the evidence shows, delivery date, serial numbers, Google issuer status, the reason enrollment cannot be completed.

## 10. Contradictions found and how they were reconciled

| # | Apparent contradiction | Resolution (and where) |
|---|---|---|
| 1 | **Deployed SHA vs documentation-branch HEAD** | Two different things. Deployed SHA = `5c580be` ([REL-012](../RELEASES.md#rel-012)). The docs branch descends from it and adds only `docs/launch-ledger/**`; it is never built ([REL-013](../RELEASES.md#rel-013), README). The ledger never embeds its own commit SHA. |
| 2 | **Gate 1 frozen definition vs "operations COMPLETE, public root separate"** | Gate 1 *as frozen* includes the public root, so it is **not PASS**; the infrastructure/operations portion is COMPLETE (Tier 2). The split is a scoping decision ([D-013](../DECISIONS.md#d-013)), not a gate amendment; the repo gate docs were not updated ([O-051](../OPEN-ITEMS.md#o-051)). STATE shows both. |
| 3 | **Old frozen V1 scope (Wallet and NFC required) vs first-pilot scope amendment** | Recorded as a separate decision ([D-024](../DECISIONS.md#d-024)); V1_RELEASE_GATES is unchanged; a formal amendment is an open decision ([O-018](../OPEN-ITEMS.md#o-018), [R-015](../RISKS-AND-EXCEPTIONS.md#r-015)). |
| 4 | **Native Apple Wallet implementation vs the PassFast proof of concept** | Native Apple/Google code is IMPLEMENTED and fixture-TESTED, providers disabled; PassFast was a separate synthetic PoC with no adapter and no repository reference. The two are not conflated ([T-060](../TEST-EVIDENCE.md#t-060), [T-062](../TEST-EVIDENCE.md#t-062)). |
| 5 | **NFC software implemented vs physical NOT RUN** | Software IMPLEMENTED/TESTED; all physical rows are NOT RUN ([T-070](../TEST-EVIDENCE.md#t-070)–[T-074](../TEST-EVIDENCE.md#t-074)); hardware is OWNER-REPORTED purchased only. |
| 6 | **Owner-reported vs machine-verified** | Mac-off, camera scans, PassFast device-side, hardware purchases and Apple enrollment state are OWNER-REPORTED; provider-side PassFast steps and all alert/restart/backup evidence are VERIFIED at Tier 2 ([T-024](../TEST-EVIDENCE.md#t-024), [T-063](../TEST-EVIDENCE.md#t-063), [T-080](../TEST-EVIDENCE.md#t-080)). |
| 7 | **"Accepted risk" vs "explained"** | The historical redeploy remains UNKNOWN in provenance; only the *current* baseline was re-established and accepted ([X-001](../RISKS-AND-EXCEPTIONS.md#x-001)). |
| 8 | **Cleanup "FAIL — ROLLED BACK" vs the corrected cleanup that committed** | The two failed attempts performed **no writes** (attempt #1 never connected to a transaction; the commit attempt stopped in a read-only precondition and "rolled back" only that read-only transaction). The corrected cleanup is the **only** run that committed deletions (57 rows) ([TL-052](../TIMELINE.md#tl-052), [TL-055](../TIMELINE.md#tl-055), [TL-057](../TIMELINE.md#tl-057), [T-051](../TEST-EVIDENCE.md#t-051)). |
| 9 | **"Database empty" vs two retained and one volatile table** | "Clean baseline" is defined precisely: 33 tables at 0 rows; `email_provider_events` = 2 (historical, preserved); `rate_limits` is operational and volatile ([T-050](../TEST-EVIDENCE.md#t-050)). |
| 10 | **Rollback target status "REMOVED" vs `canRollback = true`** | REMOVED means the old container was replaced, not that rollback is lost ([RELEASES](../RELEASES.md#web-rollback-lineage)). Older targets may age out ([R-005](../RISKS-AND-EXCEPTIONS.md#r-005)). |
| 11 | **Handoffs say "actual model not independently verified" vs session logs that record it** | The ledger uses the logged model; the P2 fix actually ran on `gpt-6.1-sol`, while its handoff lists "requested GPT-6 Astra" ([TL-058](../TIMELINE.md#tl-058)). |
| 12 | **Draft reconstruction vs later evidence** | Worker and migrate sources are now `e94fd5c` (promotion snapshot); "tags ordered" became OWNER-REPORTED "purchased"; promotion required a separate manual deployment because auto-deploy is off ([D-011](../DECISIONS.md#d-011)). |
| 13 | **First RC "BLOCKED" vs later PASS** | The first block was a client-configuration false blocker (Browser Integrity Check vs a default user agent); preserved as SUPERSEDED ([TL-047](../TIMELINE.md#tl-047), [D-012](../DECISIONS.md#d-012)). |
| 14 | **Repo docs stale vs ledger** | Older documents are preserved unchanged and superseded by statement ([R-014](../RISKS-AND-EXCEPTIONS.md#r-014), [O-051](../OPEN-ITEMS.md#o-051)). |

## Unknowns deliberately preserved

- Provenance of the 2026-10-01 08:30:50Z ops redeploy ([X-001](../RISKS-AND-EXCEPTIONS.md#x-001)).
- Purchase cost, supplier, quantities beyond the stated ten tags, delivery date and serial numbers of the NFC hardware; the date of the reader purchase.
- Google Wallet issuer status; the reason Apple Developer enrollment cannot be completed; the time of the Wallet "Expired" observation.
- Creation times of web `5285bbb4`, ops `a6c40859` and Cloudflare Pages deployment IDs ([O-055](../OPEN-ITEMS.md#o-055)).
- Output of the external GPT-6 Pro business review; whether a trademark/name clearance exists ([D-005](../DECISIONS.md#d-005)); registrar and domain price.
- Whether `var/` is excluded from iCloud sync and where an offline copy of the backup age identity is held ([R-007](../RISKS-AND-EXCEPTIONS.md#r-007), [R-008](../RISKS-AND-EXCEPTIONS.md#r-008)).
- Whether a real two-phone production checkout, an Android test, or any real-merchant legal arrangement works (all NOT RUN / OPEN).

## Validation performed

Run on the final files in the documentation worktree before committing (read-only checks; the scripts live in the author's scratch space and are not part of the ledger).

| Check | Result |
|---|---|
| All 11 required files exist | PASS |
| Internal links and anchors, including relative links to existing repository documents (1,124 links checked) | PASS — 0 broken paths, 0 missing anchors |
| ID integrity: every referenced decision, risk, exception, evidence, release, test, open-item and timeline ID is defined exactly once (237 distinct IDs referenced; 299 anchors defined) | PASS — 0 undefined, 0 duplicates |
| Git SHAs: every 40-character and 7–8-character commit reference resolves to a commit in this repository (9 full, 53 short) | PASS; the other short hex tokens are Railway deployment-ID prefixes and agent session IDs |
| Deployment, audit and session UUIDs (29) and image digests (11) appear in a preserved evidence file, a repository document, or a session path | PASS |
| SHA-256 values in the evidence index (45) were computed from the files at generation time, not typed | PASS |
| Sensitive-pattern scan (e-mail addresses, ping URLs, age/private-key markers, JWT-like strings, bearer headers, vendor key prefixes, password/token assignments, Cloudflare account URLs) | PASS — no hits (a pattern scan is not proof of absence; secret-bearing files were never opened) |
| Every `Status` field in the timeline, decisions and test matrix uses the README vocabulary | PASS (one descriptive word, "INCONCLUSIVE", appears inside a parenthesis and is not a status) |
| Scope of the commit: only `docs/launch-ledger/**` | checked at commit time (see the final handoff) |
| Contradiction reconciliation (section 10) | done by the author; **not yet independently reviewed** ([O-054](../OPEN-ITEMS.md#o-054)) |

## Exact next workstream

Next workstream will be selected after pilot-hygiene planning and owner launch inputs; Wallet/NFC remain parallel/non-critical for the first pilot unless the scope decision changes.

Immediate follow-ups that are not a "workstream": execute the evidence-preservation plan ([O-050](../OPEN-ITEMS.md#o-050)), decide how this documentation branch lands ([O-052](../OPEN-ITEMS.md#o-052)),
and have a second agent cross-check this ledger ([O-054](../OPEN-ITEMS.md#o-054)).
