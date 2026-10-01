# STATE — current verified snapshot

**Snapshot:** 2026-10-01T22:33:32Z (2026-10-02 00:33 CEST), the moment Codex froze the owner-dashboard promotion ([E-031](EVIDENCE-INDEX.md#e-031)).
**Checkpoint:** [CHECKPOINT-001](checkpoints/CHECKPOINT-001.md). This file is rewritten at every checkpoint; history lives in
[TIMELINE.md](TIMELINE.md). Statuses and tiers are defined in the [README](README.md).

## 1. Official release

| Field | Value | Status |
|---|---|---|
| Official release branch | `railway-rc` (local and `origin` both at the release SHA) | VERIFIED ([E-031](EVIDENCE-INDEX.md#e-031)) |
| **Official release SHA** | `5c580be9b1887327cc456e672d2f25f29fc25830` | VERIFIED ([E-001](EVIDENCE-INDEX.md#e-001), [E-031](EVIDENCE-INDEX.md#e-031)) |
| **Official Railway web deployment** | `c87f2b50-783b-45d6-9d2a-6c880b0aa14f`, created 2026-10-01T22:26:47.695Z, SUCCESS event 22:27:16.360Z | DEPLOYED ([E-031](EVIDENCE-INDEX.md#e-031)) |
| Image | `sha256:68738a1479faac1b1d8de5ac8c0b7298c1e21218f8a4f5626e93542043dade38` (identical to the tested revised RC) | VERIFIED ([E-031](EVIDENCE-INDEX.md#e-031)) |
| Promotion | `railway-rc` fast-forwarded `90ad26a` → `5c580be`, pushed 2026-10-01T22:23:35Z; no merge commit, squash or rebase | VERIFIED ([E-031](EVIDENCE-INDEX.md#e-031)) |
| Promotion smoke | 20/20 GET checks PASS ([T-048](TEST-EVIDENCE.md#t-048)) | VERIFIED |
| Rollback target | `b588220e-82c5-429b-891a-a147d12c0f33` (same SHA and image; status REMOVED, `canRollback` and `canRedeploy` true) | VERIFIED |
| Integration branch | `integration/owner-dashboard-v1` preserved at `5c580be` (local and `origin`) | VERIFIED |
| Deploy method | Manual exact-commit `serviceInstanceDeployV2` after a separate owner approval; **auto-deploy is disabled**, so the branch push deployed nothing by itself ([D-010](DECISIONS.md#d-010), [D-011](DECISIONS.md#d-011)) | VERIFIED |

Full lineage: [REL-012](RELEASES.md#rel-012). Documentation commits do not change this tuple ([README](README.md#deployed-sha-versus-documentation-branch-head)).

## 2. Headline state

| Area | State | Status | Notes |
|---|---|---|---|
| Owner dashboard | **PROMOTED** | DEPLOYED | Frozen `652d214` → integrated `6f80c72` → revised `5c580be`. [REL-009](RELEASES.md#rel-009)–[REL-012](RELEASES.md#rel-012). |
| Infrastructure/operations part of Gate 1 | **COMPLETE** | VERIFIED (Tier 2) | Codex report with 58 checksummed artifacts ([E-012](EVIDENCE-INDEX.md#e-012)). Not re-run by a second agent. Gate 1 *as originally frozen* also required the public root, which is **not** done (see below). |
| Historical unexplained Railway redeploy (2026-10-01T08:30:50.904Z) | **ACCEPTED-RISK — contained and superseded; provenance remains UNKNOWN** | ACCEPTED-RISK | [X-001](RISKS-AND-EXCEPTIONS.md#x-001), [D-014](DECISIONS.md#d-014). Never explained, never retro-accepted. |
| Production application data | **Clean baseline** | VERIFIED | Final read-only snapshot 2026-10-01T22:30:18.987Z: all 33 application/auth/outbox tables are 0 rows except `email_provider_events` = 2 (historical, deliberately preserved). `rate_limits` holds operational rows that change under normal traffic. [T-050](TEST-EVIDENCE.md#t-050). |
| Database migrations | **18/18 match**; latest hash `19a8a062…bb59ff9`; aggregate `0b29899e…c432737` | VERIFIED | Unchanged since Sept 29. No migration in the dashboard release. |
| Public root (`getloynara.com`) | **Not published**; separate workstream | VERIFIED (negative) | Apex has MX (Cloudflare Email Routing) but no web record; `www` has none. Placeholders and missing legal pages block it ([O-014](OPEN-ITEMS.md#o-014)). A separate public audit copy (`loynara-audit.pages.dev`, noindex) exists and is **not** the root site ([E-035](EVIDENCE-INDEX.md#e-035)). |
| Wallet | Native Apple/Google code **exists** and is fixture-tested; **no production provider is enabled** | IMPLEMENTED, TESTED | [T-060](TEST-EVIDENCE.md#t-060). Real provider/device test NOT RUN ([T-061](TEST-EVIDENCE.md#t-061)). |
| PassFast | **Synthetic Apple proof of concept only**; no Loynara adapter exists; nothing in the repository references it | TESTED (provider side VERIFIED; device side OWNER-REPORTED) | [D-018](DECISIONS.md#d-018), [T-062](TEST-EVIDENCE.md#t-062), [T-063](TEST-EVIDENCE.md#t-063). |
| NFC | **Software implemented and fixture/vector-tested; physical testing not completed**; no production key provider; provisioning CLI is preview-only | IMPLEMENTED, TESTED | [T-070](TEST-EVIDENCE.md#t-070)–[T-074](TEST-EVIDENCE.md#t-074). Hardware is OWNER-REPORTED purchased. |
| E-mail | Mailgun EU configured; production sending **disabled**; controlled real sends passed on the device-test origin only | VERIFIED (device-test), no production use | [T-081](TEST-EVIDENCE.md#t-081), [T-082](TEST-EVIDENCE.md#t-082). |
| Billing | Fixture only; **live billing disabled**; no real invoice path | IMPLEMENTED (fixture) | [O-011](OPEN-ITEMS.md#o-011). |

## 3. Production feature flags and safety state

As recorded in the promotion snapshot ([E-031](EVIDENCE-INDEX.md#e-031)); all unchanged since the first RC.

| Flag / setting | Value |
|---|---|
| Public registration (`PUBLIC_REGISTRATION_ENABLED`) | **false** (disabled) |
| External e-mail: general, transactional, promotional | **false**, **false**, **false** (disabled) |
| Live billing / billing fixture mode | **false** / **false** |
| Apple Wallet / Google Wallet | **false** / **false** (disabled) |
| NFC (`NFC_ENABLED`, `NFC_PRODUCTION_ENABLED`, `NFC_KEY_PROVIDER`) | **absent** → NFC production unavailable |
| Trusted ingress | `cloudflare_tunnel`; legacy proxy-trust switch `false` |
| Approved origin / auth URL | `https://app.getloynara.com` |
| Environment config fingerprint | `bd13c7a8f6a67afc1068b08a86cd86935e6ee9197bdf60b15a16b3f54825b5ca` (unchanged since the first RC) |
| Railway auto-deploy | **disabled** for web, worker, migrate, ops and backup |

## 4. Production services (seven)

| Service | Deployment | Source | Last changed (UTC) |
|---|---|---|---|
| web | `c87f2b50-783b-45d6-9d2a-6c880b0aa14f` | `5c580be` | 2026-10-01 22:26 |
| worker | `fbc5ac5a-90d7-4337-b4e3-1c192adc5569` | `e94fd5c` | 2026-09-29 20:40 |
| migrate | `8ded1625-3560-4582-b0fd-4a1ba20facfb` | `e94fd5c` | 2026-09-29 19:59 |
| postgres | `f5c99930-8e68-4bac-9744-3828db680fe6` | image only (PostgreSQL 18.6) | 2026-09-29 10:14 |
| ops | `56bb5199-79e9-4b6b-8005-696c72769937` | `90ad26a` | 2026-10-01 10:08 (re-baseline, [X-001](RISKS-AND-EXCEPTIONS.md#x-001)) |
| backup | `c237a1ca-6eb4-489d-a90e-16a54d3b534c` | `90ad26a` | 2026-09-30 07:21 |
| cloudflared | `d0fc5af6-abae-4b74-a65a-b5155ed7bc85` | image only | 2026-09-29 21:21 |

Monitoring at the freeze: worker heartbeat healthy (42 s old), outbox monitor healthy (43 s), backup monitor healthy, ops-check PASS at
2026-10-01T22:31:01Z ([E-031](EVIDENCE-INDEX.md#e-031)). Backup: natural 03:00Z runs; the last natural run verified by the ledger is 2026-10-01 03:00Z
([T-014](TEST-EVIDENCE.md#t-014)).

## 5. Pilot versus public launch (they are different)

The owner decided that Wallet and secure NFC do **not** block the *first real merchant pilot* ([D-024](DECISIONS.md#d-024)). That decision does
**not** silently redefine "full frozen V1".

| Level | Meaning | Includes | Current readiness |
|---|---|---|---|
| **First real merchant pilot** | One real merchant, browser/QR loyalty, operator-provisioned accounts, supervised | Owner dashboard, QR card, cashier, ledger, monitoring, backups. Wallet, NFC, billing and external e-mail off unless separately approved. | **NOT READY** — owner/legal inputs and pilot-hygiene work open ([O-001](OPEN-ITEMS.md#o-001)–[O-009](OPEN-ITEMS.md#o-009)). |
| **Public / sellable launch** | Commercial sales, public root site, billing, legal documents | Pilot scope plus Gates 7 and 8 work | **NOT READY** ([O-011](OPEN-ITEMS.md#o-011)–[O-019](OPEN-ITEMS.md#o-019)). |
| **Wallet-enabled launch** | Real Apple/Google passes | Provider choice, adapter, diligence, P0 hardening | **NOT STARTED** in code; PoC only ([O-020](OPEN-ITEMS.md#o-020)–[O-026](OPEN-ITEMS.md#o-026)). |
| **Secure-NFC-enabled launch** | Real tag taps | Key provider, production CLI, physical tests | **NOT STARTED** physically ([O-030](OPEN-ITEMS.md#o-030)–[O-037](OPEN-ITEMS.md#o-037)). |
| **Full frozen V1** | All eight frozen gates incl. Wallet and NFC | [V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md) | **Not redefined.** A formal amendment, if wanted, is an open decision ([O-018](OPEN-ITEMS.md#o-018)). |

## 6. Git and reference state

| Ref | State |
|---|---|
| `railway-rc` | `5c580be…` local and `origin` |
| `integration/owner-dashboard-v1` | `5c580be…` local and `origin` |
| `claude/owner-dashboard-v1` | `652d214…` **local only** (frozen; worktree outside the repo checkout) |
| `main` | `200cdb3…` **local only**; behind `railway-rc` |
| tags `checkpoint/*` (4) | **local only** |
| `docs/launch-ledger-checkpoint-001` | documentation-only branch from `5c580be`; **not deployed** ([REL-013](RELEASES.md#rel-013)) |

Local-only refs are a preservation risk ([R-006](RISKS-AND-EXCEPTIONS.md#r-006)).

## 7. Owner-reported facts (Tier 3 — not machine-verified)

| Fact | Status | Where recorded |
|---|---|---|
| PassFast pass installed on the owner's real iPhone; 6/10 → 7/10 remote update; Wallet update notification; voided pass later shown under "Expired" | OWNER-REPORTED | [T-063](TEST-EVIDENCE.md#t-063), [TL-035](TIMELINE.md#tl-035) |
| Ten NTAG 424 DNA 28×28 mm on-metal tags purchased for physical testing | OWNER-REPORTED | [D-028](DECISIONS.md#d-028), [TL-036](TIMELINE.md#tl-036) |
| REINER SCT cyberJack RFID basis reader purchased; compatibility *expected* via generic PC/SC, **not** physically verified | OWNER-REPORTED | [D-029](DECISIONS.md#d-029), [TL-036](TIMELINE.md#tl-036) |
| Owner is currently unable to complete Apple Developer Program enrollment | OWNER-REPORTED | [D-018](DECISIONS.md#d-018), [TL-037](TIMELINE.md#tl-037), [O-025](OPEN-ITEMS.md#o-025) |
| Mac-off recovery passed (six-minute exercise) | OWNER-REPORTED (corroborated by probes) | [T-024](TEST-EVIDENCE.md#t-024) |
| Physical Mac/iPhone camera scans in both directions (2026-09-26) | OWNER-REPORTED | [T-080](TEST-EVIDENCE.md#t-080) |

Deliberately **not** recorded because no evidence exists: purchase cost, supplier, delivery date, serial numbers, Google issuer status,
the reason Apple enrollment cannot be completed ([UNKNOWN items](checkpoints/CHECKPOINT-001.md#unknowns-deliberately-preserved)).

## 8. What to read next

[OPEN-ITEMS.md](OPEN-ITEMS.md) for work; [RISKS-AND-EXCEPTIONS.md](RISKS-AND-EXCEPTIONS.md) for accepted gaps;
[RELEASES.md](RELEASES.md) for exact SHAs and rollback lineage; [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) for where proof lives.
