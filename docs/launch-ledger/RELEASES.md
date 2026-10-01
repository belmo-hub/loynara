# RELEASES

Releases and checkpoints (`REL-###`), branches, SHAs, deployments and rollback lineage.
Statuses and tiers are defined in the [README](README.md); evidence IDs point to [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md).

## Deployed SHA versus documentation branch head

| | Value | Meaning |
|---|---|---|
| **DEPLOYED SHA** (production web) | `5c580be9b1887327cc456e672d2f25f29fc25830` | What Railway built for deployment `c87f2b50-783b-45d6-9d2a-6c880b0aa14f`. This is the official release. |
| **Official release branch** | `railway-rc` @ `5c580be9b1887327cc456e672d2f25f29fc25830` | Unchanged by the ledger. |
| **DOCUMENTATION BRANCH HEAD** | `docs/launch-ledger-checkpoint-001` → the ledger commit | Descended from `5c580be`; adds **only** files under `docs/launch-ledger/`. **Not deployed code**, never built by Railway. The commit's own SHA is not embedded in the ledger; read it with `git rev-parse docs/launch-ledger-checkpoint-001`. |

Rule: any statement about "what is running" uses the **deployed SHA**. Any statement about "what the docs branch contains" uses the documentation
branch head. The two are never interchangeable ([REL-013](#rel-013)).

---

## Official owner-dashboard release record

<a id="rel-012"></a>
### REL-012 — OFFICIAL OWNER-DASHBOARD RELEASE (promoted)

| Field | Value |
|---|---|
| Branch | `railway-rc` |
| **Release SHA** | `5c580be9b1887327cc456e672d2f25f29fc25830` ("fix(owner): render overview activity dates without locale reparsing", 2026-10-01 21:56:28Z) |
| **Official deployment** | `c87f2b50-783b-45d6-9d2a-6c880b0aa14f` (loynara-web), created 2026-10-01T22:26:47.695Z, SUCCESS event 22:27:16.360Z |
| Image | `sha256:68738a1479faac1b1d8de5ac8c0b7298c1e21218f8a4f5626e93542043dade38` — identical to the tested revised RC |
| Promotion method | Local and remote fast-forward of `railway-rc` (`a96fc12` local, `90ad26a` remote → `5c580be`); push 2026-10-01T22:23:33.7–22:23:35.2Z; no merge commit, squash, cherry-pick, rebase or new commit |
| Deployment method | One manual exact-commit `serviceInstanceDeployV2` after the owner's separate approval (auto-deploy disabled), creation audit `551ba124-b0d9-4973-8d63-550582a23e72` at 22:26:47.789Z; actor = project token, client `Loynara-Deployment/1.0` (no named human attribution) |
| Promotion smoke | **20/20** GET checks PASS ([T-048](TEST-EVIDENCE.md#t-048)) |
| Database | Clean application baseline; 18/18 migrations; two historical `email_provider_events` preserved |
| Other services | Unchanged (six deployment IDs identical to before) |
| Configuration | Unchanged (fingerprint `bd13c7a8f6a67afc1068b08a86cd86935e6ee9197bdf60b15a16b3f54825b5ca`); flags unchanged |
| Rollback target | `b588220e-82c5-429b-891a-a147d12c0f33` — same SHA and image; status REMOVED (the running container was replaced), `canRollback` and `canRedeploy` true (read 2026-10-01 22:28Z) |
| Integration branch | `integration/owner-dashboard-v1` preserved at `5c580be` locally and on `origin` |
| Verified and frozen | 2026-10-02T00:33:32+02:00 (22:33:32Z) |
| Status | **DEPLOYED**, VERIFIED (Tier 2 handoff with Tier-1 readbacks) |
| Evidence | [E-031](EVIDENCE-INDEX.md#e-031) (handoff, tuple JSON, SHA256SUMS), [E-030](EVIDENCE-INDEX.md#e-030) |

---

## Releases and checkpoints

<a id="rel-001"></a>
### REL-001 — Early local checkpoints (Sept 25–26)
Tags `checkpoint/pre-demo-rc-20260925` → `e3b1f67` (2026-09-25 14:22Z), `checkpoint/pre-device-test-20260925` → `4714eb5` (15:29Z),
`checkpoint/merchant-platform-20260925` → `38bb4da` (19:05Z), `checkpoint/kassel-demo-4e95aa7` → `4e95aa7` (22:45Z). Local synthetic builds
(then named LoopLocal). **Tags are local only** ([R-006](RISKS-AND-EXCEPTIONS.md#r-006)). Status: IMPLEMENTED, TESTED. Evidence: [E-001](EVIDENCE-INDEX.md#e-001).

<a id="rel-002"></a>
### REL-002 — Protected device-test instance (Mac-hosted, non-production)
Revision `6382aab` (2026-09-26 14:40:23Z) and the later device-test builds used for Gate-5/6 e-mail tests (through `9223012`, 2026-09-28 19:10Z).
Served from the owner's Mac via tunnel `loynara-device-test` at `preview.getloynara.com` behind Cloudflare Access. Status: DEPLOYED (device-test).
Evidence: [E-002](EVIDENCE-INDEX.md#e-002), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="rel-003"></a>
### REL-003 — v1 release-gate baseline
`b2c2ef1` (2026-09-27 02:39:16Z), "docs: freeze Loynara v1 release gates". Status: IMPLEMENTED (documentation). Evidence: [E-002](EVIDENCE-INDEX.md#e-002).

<a id="rel-004"></a>
### REL-004 — Public audit copy (Cloudflare Pages, not the root site)
`loynara-audit.pages.dev`, public, `noindex`, audit banner; last recorded revision `98fe576` (2026-09-27 19:50Z, multilingual). Pages deployment IDs are
not recorded locally (UNKNOWN). **Not** the production root: `getloynara.com` is unpublished. Status: DEPLOYED. Evidence: [E-002](EVIDENCE-INDEX.md#e-002), [E-035](EVIDENCE-INDEX.md#e-035).

<a id="rel-005"></a>
### REL-005 — Stage-A first production source `0f6bbff`
`0f6bbff8186ef795822ecaa7844f5a7ff316cf62` (2026-09-29 09:19:46Z), first push of `railway-rc`. Railway: migrate `46ae14d0-ad5c-454e-a8e7-7173f3166d80`, web
`e38600d2-9016-42dc-a603-9dd7ea5b45d4`; worker `d47a109c-afaa-45e3-8d89-2a132b54c0e5` later built from `200cdb3`. Superseded by [REL-006](RELEASES.md#rel-006). Status: DEPLOYED, SUPERSEDED.
Evidence: [E-002](EVIDENCE-INDEX.md#e-002), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="rel-006"></a>
### REL-006 — Reviewed runtime `e94fd5c`
`e94fd5c1fa20da5b4fbdcb086ad01034947bcea0` (2026-09-29 19:16:02Z), after two independent Claude reviews ([TL-021](TIMELINE.md#tl-021)).
Web `5285bbb4-cc0d-453b-bf08-ceb94a2f5109` (image `sha256:8322e3e42eb9075b21032e7e3a3aec3b577ff61724e6c42b5457610d64f1048e`), worker
`fbc5ac5a-90d7-4337-b4e3-1c192adc5569`, migrate `8ded1625-3560-4582-b0fd-4a1ba20facfb`. Production web until [REL-010](RELEASES.md#rel-010). Status: DEPLOYED. Evidence: [E-002](EVIDENCE-INDEX.md#e-002), [E-019](EVIDENCE-INDEX.md#e-019), [E-031](EVIDENCE-INDEX.md#e-031).

<a id="rel-007"></a>
### REL-007 — Backup and ops runtime `90ad26a`
`90ad26a0f3553c89f17ce5d07e8246591240b852` (2026-09-29 22:14:07Z; remote `railway-rc` tip until 2026-10-01 22:23Z). Backup `c237a1ca-6eb4-489d-a90e-16a54d3b534c`
(07:21:39Z Sept 30). Ops: `a6c40859-ca82-440e-9d2d-86da13184d66` → `9d7b991d-ac24-4989-8449-009ffb92d6dc` (unexplained redeploy, **never accepted**, superseded) →
**`56bb5199-79e9-4b6b-8005-696c72769937`** (authorized re-baseline, 2026-10-01 10:08:20Z, accepted 10:16:18Z; [X-001](RISKS-AND-EXCEPTIONS.md#x-001)). Status: DEPLOYED. Evidence: [E-012](EVIDENCE-INDEX.md#e-012)–[E-014](EVIDENCE-INDEX.md#e-014).

<a id="rel-008"></a>
### REL-008 — Accepted production release baseline `a96fc12`
`a96fc12313fc6f8153cc7d21472bf9fe06877a01` (2026-09-30 19:21:07Z), "docs: record owner-confirmed Stage-A Mac-off verification". A documentation-only head over the
Stage-A runtime (`e94fd5c` web/worker/migrate, `90ad26a` backup/ops). Used as the base for the dashboard integration. Local `railway-rc` stood here until promotion;
remote `railway-rc` stood at `90ad26a` (the intervening commits are documentation). Status: VERIFIED as the baseline. Evidence: [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002).

<a id="rel-009"></a>
### REL-009 — Frozen Claude owner dashboard `652d214`
`652d214f2f572a6f82a6591d3e9641e791ad1d83` (2026-09-30 14:17:39Z), 17 commits on base `5c51d992d18095211e169eeb9e5e9ebf8c565b8a`. Branch
`claude/owner-dashboard-v1`, **local only**, never deployed as such. Status: IMPLEMENTED, TESTED. Evidence: [E-004](EVIDENCE-INDEX.md#e-004), [E-003](EVIDENCE-INDEX.md#e-003).

<a id="rel-010"></a>
### REL-010 — Integrated release candidate `6f80c72`
`6f80c72aaa930bde545eb296dc81b8568c5af826` (2026-10-01 12:10:30Z) on `integration/owner-dashboard-v1`: 17 frozen commits + onboarding bridge + review fixes. Web deployment
**`7b26de48-949f-4eb8-b65e-b5ef1de79bae`** (created 2026-10-01T13:41:39.275Z, image `sha256:b77aee7776728c677ae17b7869a11bbcc7c5d9e53c87c94422b76136677aeaaf`), rollback target `5285bbb4`.
Carried the synthetic verification ([TL-050](TIMELINE.md#tl-050)) and the cleanup. Status: DEPLOYED, SUPERSEDED by [REL-011](RELEASES.md#rel-011). Evidence: [E-003](EVIDENCE-INDEX.md#e-003), [E-019](EVIDENCE-INDEX.md#e-019).

<a id="rel-011"></a>
### REL-011 — Revised tested RC `5c580be` (P2 date fix)
`5c580be9b1887327cc456e672d2f25f29fc25830` (2026-10-01 21:56:28Z; parent `6f80c72`; four files). Web deployment **`b588220e-82c5-429b-891a-a147d12c0f33`** (created
2026-10-01T22:07:51.073Z, audit `86d61430-32e7-4f6c-a7e1-7386450440f7`, image `sha256:68738a1479faac1b1d8de5ac8c0b7298c1e21218f8a4f5626e93542043dade38`), 20/20 GET smoke checks.
Became the rollback target of [REL-012](RELEASES.md#rel-012). Status: DEPLOYED, VERIFIED. Evidence: [E-029](EVIDENCE-INDEX.md#e-029), [E-030](EVIDENCE-INDEX.md#e-030).

<a id="rel-013"></a>
### REL-013 — Launch-ledger documentation branch (not deployed code)
Branch `docs/launch-ledger-checkpoint-001`, created from `5c580be`; one documentation commit adding `docs/launch-ledger/**`. Pushed to `origin` (documentation only). Never
merged into `railway-rc` by this checkpoint; Railway does not track it and auto-deploy is disabled. Status: IMPLEMENTED (documentation). Evidence: [E-001](EVIDENCE-INDEX.md#e-001).

---

## Reference table (at the promotion freeze)

| Ref | SHA | Local | `origin` | Role |
|---|---|---|---|---|
| `railway-rc` | `5c580be…` | yes | yes | Official release branch (Railway source branch) |
| `integration/owner-dashboard-v1` | `5c580be…` | yes | yes | Preserved integration branch |
| `claude/owner-dashboard-v1` | `652d214…` | **yes** | **no** | Frozen dashboard (worktree `~/Developer/Loynara-claude-dashboard`) |
| `main` | `200cdb3…` | **yes** | **no** | Early development branch; behind `railway-rc` |
| `checkpoint/*` (4 tags) | see [REL-001](RELEASES.md#rel-001) | **yes** | **no** | Early checkpoints |
| `docs/launch-ledger-checkpoint-001` | ledger commit | yes | yes (after push) | Documentation only ([REL-013](RELEASES.md#rel-013)) |

`origin` is the private repository `belmo-hub/loynara`. Before this checkpoint it carried exactly two branches and no tags.

## Important SHAs (UTC)

| SHA | Time | Subject / meaning |
|---|---|---|
| `2dabc10` | 2026-09-25 13:00:23Z | Initial commit from Create Next App |
| `e3b1f67` | 09-25 14:22:43Z | First local build (tag pre-demo-rc) |
| `4714eb5` | 09-25 15:29:54Z | Synthetic release candidate (tag pre-device-test) |
| `38bb4da` | 09-25 19:05:09Z | Merchant-first paper-card setup (tag merchant-platform) |
| `4e95aa7` | 09-25 22:45:47Z | Referral outcomes by event date (tag kassel-demo) |
| `7a8bd30` | 09-26 01:34:44Z | Kassel demo verified |
| `6382aab` | 09-26 14:40:23Z | Active protected phone-test preview |
| `8929e06` | 09-26 16:14:14Z | Owner-reported physical camera tests |
| `f80a054` | 09-26 22:34:53Z | Loynara brand, marketing site, merchant demo |
| `b2c2ef1` | 09-27 02:39:16Z | v1 release gates frozen |
| `e179ba5` | 09-27 03:07:41Z | Secure NTAG 424 DNA verification and fixed stamp path |
| `beeb7eb` | 09-27 10:52:47Z | Local NTAG 424 DNA provisioning CLI |
| `2199022` | 09-27 22:20:34Z | Secure card recovery + Mailgun EU foundation |
| `9223012` | 09-28 19:10:24Z | Controlled Mailgun campaign and unsubscribe evidence |
| `acda7ab` | 09-28 20:47:45Z | Gate-1 production deployment preparation |
| `0f6bbff` | 09-29 09:19:46Z | First Railway source ([REL-005](RELEASES.md#rel-005)) |
| `200cdb3` | 09-29 16:00:35Z | Reviewed heartbeat URLs (tip of `main`) |
| `0946c81` | 09-29 17:02:36Z | Explicit trusted Cloudflare ingress for peer limits |
| `e94fd5c` | 09-29 19:16:02Z | IPv6 /64 grouping — reviewed runtime ([REL-006](RELEASES.md#rel-006)) |
| `90ad26a` | 09-29 22:14:07Z | Backup CA fix — backup/ops runtime ([REL-007](RELEASES.md#rel-007)) |
| `5c51d99` | 09-30 07:39:54Z | Dashboard base commit |
| `ddf8569` | 09-30 10:05:08Z | First dashboard commit |
| `652d214` | 09-30 14:17:39Z | Frozen dashboard ([REL-009](RELEASES.md#rel-009)) |
| `a96fc12` | 09-30 19:21:07Z | Accepted release baseline ([REL-008](RELEASES.md#rel-008)) |
| `16f3093` | 10-01 11:52:08Z | Onboarding bridge |
| `6f80c72` | 10-01 12:10:30Z | Integrated RC ([REL-010](RELEASES.md#rel-010)) |
| `5c580be` | 10-01 21:56:28Z | P2 date fix — revised RC and official release ([REL-011](RELEASES.md#rel-011), [REL-012](RELEASES.md#rel-012)) |

## Railway production services — current deployments and lineage

Project `b07a3919-b3fc-4637-8b91-d0b4418d2856` (`loynara-rc`), environment `a3ba3a4a-3d4c-4149-91c4-735e8bae3447` (production), web service
`5c1303ad-42c2-4094-a996-3ac6140d088d`. Region EU West Metal, Amsterdam. Plan Hobby. Source for application services: `belmo-hub/loynara`, branch `railway-rc`.

| Service | Current deployment | Created (UTC) | Source | Image digest | Earlier / rollback |
|---|---|---|---|---|---|
| web | `c87f2b50-783b-45d6-9d2a-6c880b0aa14f` | 2026-10-01 22:26:47.695 | `5c580be` | `sha256:68738a1479faac1b1d8de5ac8c0b7298c1e21218f8a4f5626e93542043dade38` | `b588220e` (same SHA/image) ← `7b26de48` (`6f80c72`, `sha256:b77aee77…eaaf`) ← `5285bbb4` (`e94fd5c`, `sha256:8322e3e4…1048e`) ← `e38600d2` (`0f6bbff`) |
| worker | `fbc5ac5a-90d7-4337-b4e3-1c192adc5569` | 2026-09-29 20:40:24.584 | `e94fd5c` | `sha256:f5eed29d49766a6cfceaf51ea3f6b93a3e3b144ff621d6b41922b1ef6c2f2e91` | `d47a109c` (`200cdb3`) |
| migrate | `8ded1625-3560-4582-b0fd-4a1ba20facfb` | 2026-09-29 19:59:05.777 | `e94fd5c` | `sha256:a7f29887f300a5dece89cd13dafa6be3c2a501ad7723db528afb22f80b374b75` | `46ae14d0` (`0f6bbff`) |
| postgres | `f5c99930-8e68-4bac-9744-3828db680fe6` | 2026-09-29 10:14:22.224 | image only (PostgreSQL 18.6) | `sha256:1fae04f974a05551008a17d779f67ed90bcc02841e25419aa5c05c0216e2b78f` | — |
| ops | `56bb5199-79e9-4b6b-8005-696c72769937` | 2026-10-01 10:08:20.137 | `90ad26a` | `sha256:87db53a24fcbc55be54822f13230279db1ed7040859831167004494048cc5b77` | Earlier: `a6c40859-ca82-440e-9d2d-86da13184d66` (`sha256:20beb663c6085d78ce75b24ebdb637f9ab2af8f0a995afc8bd901bcae17432c9`) → `9d7b991d-ac24-4989-8449-009ffb92d6dc` (`sha256:1a328fb3332260cb1148693c7815c7ea0e1329f140164b9af0c275c29af42f06`; unexplained redeploy, never accepted) |
| backup | `c237a1ca-6eb4-489d-a90e-16a54d3b534c` | 2026-09-30 07:21:39.997 | `90ad26a` | `sha256:5ce1f83d09e64c863c9115eb2b9501523617eaf494eb8ce4db54ee220cdb2565` | — |
| cloudflared | `d0fc5af6-abae-4b74-a65a-b5155ed7bc85` | 2026-09-29 21:21:27.929 | official `cloudflare/cloudflared` image, digest pinned | `sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c` | — |

Creation time of web `5285bbb4` and of ops `a6c40859` was **not captured** in the preserved evidence (UNKNOWN). Source SHAs for worker and migrate come from the promotion snapshot ([E-031](EVIDENCE-INDEX.md#e-031)).
Cron: backup `0 3 * * *` (03:00 UTC); ops `*/5 * * * *`.

### Web rollback lineage

1. **`c87f2b50`** — official, current (`5c580be`).
2. **`b588220e`** — same SHA and image; rollback target recorded 2026-10-01 22:28Z (`canRollback`, `canRedeploy` true).
3. **`7b26de48`** — first RC (`6f80c72`); rollback availability recorded true at 22:12Z when it was the revised-RC rollback target; **not re-read afterwards**.
4. **`5285bbb4`** — pre-dashboard production web (`e94fd5c`); recorded `canRollback` true on 2026-10-01 15:48Z; **not re-read since**.

Caution: Railway Hobby keeps removed images for about 72 hours ([PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md)); rollback targets older than that may not be redeployable ([R-005](RISKS-AND-EXCEPTIONS.md#r-005)). The current image is also the rollback image for item 2.

## Audit events (identifiers only)

| Event | Time (UTC) | Meaning |
|---|---|---|
| `9fc41cbf-d593-47f1-835a-e283122304ba` | 2026-10-01 08:30:50.904 | **Unexplained** ops redeploy ([X-001](RISKS-AND-EXCEPTIONS.md#x-001)) |
| `274ba786-7705-4af0-ae44-6d92b57a1253` | 10:08:20.188 | Authorized ops re-baseline redeploy |
| `76025614-3847-43fc-9689-2f8f6070da8b` | 10:24:29.695 | Owner-authorized worker restart for the in-flight interruption drill |
| `b7447a94-fc77-4612-99dd-595c06c97d15` | 13:41:39.508 | Creation of web `7b26de48` |
| `86d61430-32e7-4f6c-a7e1-7386450440f7` | 22:07:51.140 | Creation of web `b588220e` |
| `551ba124-b0d9-4973-8d63-550582a23e72` | 22:26:47.789 | Creation of web `c87f2b50` (official) |

Deployment audit actors for the three web deployments are a project-scoped Railway token (named "first token") with client `Loynara-Deployment/1.0`; Railway records token attribution, not a named human. Token IDs and values are intentionally not recorded here.

## Environment fingerprint

Environment configuration SHA-256 `bd13c7a8f6a67afc1068b08a86cd86935e6ee9197bdf60b15a16b3f54825b5ca` was identical before and after every deployment from 2026-10-01 13:41Z
through promotion, and across the cleanup run.
