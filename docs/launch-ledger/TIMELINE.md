# TIMELINE

Append-only. One entry per event (`TL-###`), in order of start time. Failed, blocked and superseded events are **kept**.
Statuses and evidence tiers are defined in the [README](README.md). Evidence IDs point to [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md).

**Reading an entry.** The entry title names the workstream and gives the start time. `Agent` gives the *actual* model from the agent's own session log and the *requested* model where a task or handoff
stated one (`not recorded` otherwise). `Branch · SHA` is the branch and the start → end SHA of the work (`—` where no commit was
involved). Times are UTC; CEST = UTC+2. Git commit times are converted to UTC. Codex "effort" is the logged value (low/medium/high/ultra).

Coverage: 2026-09-25 (first owner prompt) through 2026-10-02 00:33 CEST (owner-dashboard promotion). Anything after is out of scope for
Checkpoint 001.

---

## Phase A — Origin and local platform (Sept 25–28)

<a id="tl-001"></a>
### TL-001 — 2026-09-25 11:41Z — Fidelix product review
- **Workstream:** Understand the reference product (Fidelix) and prepare a brief for an external GPT-6 Pro business-model review.
- **Agent:** Codex · actual gpt-6-sol/high · requested not recorded.
- **Branch · SHA:** — · **Deployment:** none.
- **Result:** Product summary and a paste-ready review brief produced (11:46–11:49Z). The output of the external review is **not preserved locally** (UNKNOWN).
- **Status:** VERIFIED (activity) · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-002"></a>
### TL-002 — 2026-09-25 12:57Z — Master build prompt: Fidelix-comparable platform, working name LoopLocal
- **Workstream:** Original platform direction ([D-001](DECISIONS.md#d-001)).
- **Agent:** Codex · actual gpt-6-sol/ultra · requested not recorded.
- **Result:** Owner prompt: build a multi-tenant merchant-loyalty SaaS "comparable in functionality to Fidelix, with better checkout usability, operational transparency, and data controls"; German-first for Kassel; French and EUR/MAD configuration prepared but not assumed; €0 external spend; TypeScript modular monolith (Next.js, PostgreSQL, Drizzle, Better Auth, worker/outbox, wallet adapters); synthetic data only; "LoopLocal" is a changeable internal name.
- **Status:** VERIFIED (the prompt exists) · **Evidence:** [E-011](EVIDENCE-INDEX.md#e-011), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-003"></a>
### TL-003 — 2026-09-25 13:00–14:23Z — Initial commit and first local build
- **Workstream:** Initial loyalty engine and customer/cashier/owner flows.
- **Agent:** Codex · actual gpt-6-sol/high→ultra.
- **Branch · SHA:** `main` · `2dabc10` (13:00:23Z, "Initial commit from Create Next App") → `e3b1f67` (14:22:43Z, tag `checkpoint/pre-demo-rc-20260925`).
- **Result:** Local app running with synthetic data: ledger, QR enrollment, browser card, cashier, staff roles.
- **Status:** IMPLEMENTED, TESTED (local, synthetic) · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-004"></a>
### TL-004 — 2026-09-25 14:37–15:29Z — Synthetic release candidate for controlled demonstration
- **Workstream:** Priority path: join → card → camera scan → award → redeem → reopen → correct balance.
- **Agent:** Codex · actual gpt-6-sol/ultra.
- **Branch · SHA:** `main` · `e3b1f67` → `4714eb5` (15:29:54Z, tag `checkpoint/pre-device-test-20260925`).
- **Result:** Mobile card and cashier usability fixes; physical-device handoff prepared. No external service used.
- **Status:** IMPLEMENTED, TESTED · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002).

<a id="tl-005"></a>
### TL-005 — 2026-09-25 16:24–19:05Z — Merchant-branded paper-card experience; device-test handoff
- **Workstream:** Merchant-branded UX for businesses already using paper stamp cards ([D-002](DECISIONS.md#d-002)).
- **Agent:** Codex · actual gpt-6-sol/ultra.
- **Branch · SHA:** `main` · `4714eb5` → `0d271e9` (16:46:33Z, isolated protected device-test handoff) → `38bb4da` (19:05:09Z, tag `checkpoint/merchant-platform-20260925`).
- **Result:** Assisted setup from an existing stamp rule; merchant identity prominent, Loynara attribution secondary; browser card as the base.
- **Status:** IMPLEMENTED, TESTED · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-006"></a>
### TL-006 — 2026-09-25 19:11–22:45Z — Scope reset to a complete Fidelix-comparable platform
- **Workstream:** Product scope ([D-001](DECISIONS.md#d-001)).
- **Agent:** Codex · actual gpt-6-sol/ultra.
- **Branch · SHA:** `main` · `38bb4da` → `4e95aa7` (22:45:47Z, tag `checkpoint/kassel-demo-4e95aa7`).
- **Result:** Campaigns, referrals, audiences, automations, offline earning, rule-based adviser, multi-location, staff audit, per-location billing fixture added. Public Fidelix pages used only as evidence of advertised categories; the parity matrix is an *inventory*, not a parity score.
- **Status:** IMPLEMENTED, TESTED (local) · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002) (PARITY_MATRIX), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-007"></a>
### TL-007 — 2026-09-25 23:10Z → 2026-09-26 01:34Z — Business priority: credible Kassel merchant demonstrations
- **Agent:** Codex · actual gpt-6-sol/ultra → gpt-6-astra/ultra (switch at 01:05Z).
- **Branch · SHA:** `main` · `4e95aa7` → `7a8bd30` (01:34:44Z).
- **Result:** Gated Google device-test configuration (providers off), full Kassel demo, 194 tests per the session report. French merchant flow explicitly deferred.
- **Status:** IMPLEMENTED, TESTED · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-008"></a>
### TL-008 — 2026-09-26 14:06–14:41Z — Protected HTTPS device-test environment
- **Workstream:** Cloudflare protected device environment ([D-007](DECISIONS.md#d-007)).
- **Agent:** Codex · actual gpt-6-astra/ultra→high.
- **Branch · SHA:** `main` · `7a8bd30` → `1fd3bf8` (14:16:44Z) → `6382aab` (14:40:23Z). **Deployment:** none on Railway (Mac-hosted).
- **Result:** Owner approved a controlled test and activated Cloudflare Zero Trust (Free). One Access application, one exact-email Allow policy (session later set to 30 minutes), named tunnel `loynara-device-test`, `preview.getloynara.com` → private Mac listener, isolated synthetic database. The approval prompt (14:06Z) already names the public brand **Loynara**. Authorized/unauthorized access, health, headers, enrollment/reopen passed (14:41Z).
- **Status:** DEPLOYED (device-test, non-production, Mac-dependent), VERIFIED · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-009"></a>
### TL-009 — 2026-09-26 ~16:00Z (reported 16:12Z) — Physical camera scans, both directions
- **Agent:** owner (Tier 3); no agent observed it · **Requested/actual model:** n/a.
- **Result:** The owner reports scanning an iPhone-displayed customer QR with the Mac camera and a Mac-displayed QR with the iPhone camera; correct synthetic membership identified in both. Codex did not observe it; models, OS versions and timings were not supplied.
- **Branch · SHA:** `main` · `8929e06` (16:14:14Z) recorded it.
- **Status:** OWNER-REPORTED · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002) (TEST_EVIDENCE). See [T-080](TEST-EVIDENCE.md#t-080).

<a id="tl-010"></a>
### TL-010 — 2026-09-26 22:34Z — Rename LoopLocal → Loynara; German marketing site and demo
- **Workstream:** Brand ([D-005](DECISIONS.md#d-005)).
- **Agent:** Codex · actual gpt-6-sol/medium.
- **Branch · SHA:** `main` · `f80a054` (22:34:53Z).
- **Result:** Product-facing text, signs, demo video, sales sheet use Loynara. Internal names (`looplocal_*` database/user names, `LOOPLOCAL_*` env) were intentionally left unchanged.
- **Status:** IMPLEMENTED · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002).

<a id="tl-011"></a>
### TL-011 — 2026-09-27 00:36–02:39Z — Interactive marketing site, public audit copy, v1 scope freeze
- **Agent:** Codex · actual gpt-6-astra/medium → gpt-6-sol/high (switch 02:36Z).
- **Branch · SHA:** `main` · `3f813e8` (00:36:15Z) → `602c1c3` (02:30:53Z) → `b2c2ef1` (02:39:16Z).
- **Result:** Owner approved publishing a public, `noindex`, clearly labelled *audit copy* at `loynara-audit.pages.dev` (Cloudflare Pages Direct Upload, €0). **v1 scope frozen:** eight gates, "no commercial sales until all eight gates are PASS"; later ideas go to POST_V1 ([D-006](DECISIONS.md#d-006)).
- **Status:** IMPLEMENTED (site, gates doc); audit copy DEPLOYED (Pages, not the root site) · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002) (V1_RELEASE_GATES, POST_V1), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-012"></a>
### TL-012 — 2026-09-27 03:07–10:52Z — Secure NTAG 424 DNA verification and provisioning CLI
- **Agent:** Codex · actual gpt-6-sol/high.
- **Branch · SHA:** `main` · `e179ba5` (03:07:41Z, SUN/SDM verifier and atomic fixed-stamp path) → `beeb7eb` (10:52:47Z, local PC/SC provisioning CLI).
- **Result:** Verifier passes the NXP AN12196 vector and negative tests; synthetic PostgreSQL tests cover atomicity, race, replay, cooldown, revocation. The Mac's PC/SC service found **zero readers**; no hardware tag was ever read ([D-021](DECISIONS.md#d-021)).
- **Status:** IMPLEMENTED, TESTED (vectors, mocks, synthetic DB); physical NOT RUN · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-002](EVIDENCE-INDEX.md#e-002) (PHYSICAL_NFC_TEST).

<a id="tl-013"></a>
### TL-013 — 2026-09-27 12:23–19:46Z — Premium marketing redesign, calculator, English and Arabic
- **Agent:** Codex · actual gpt-6-astra/medium–ultra and gpt-6-sol/high.
- **Branch · SHA:** `main` · `f3a4967` (12:23:02Z) … `112f130` (19:46:35Z).
- **Result:** Fluid redesign, four-input revenue calculator, 33 pages in German/English/Arabic. Audit copy updated repeatedly. Business claims in the calculator remain unapproved.
- **Status:** IMPLEMENTED; audit copy DEPLOYED · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001), [E-005](EVIDENCE-INDEX.md#e-005).

<a id="tl-014"></a>
### TL-014 — 2026-09-27 22:20Z → 2026-09-28 13:34Z — Secure card recovery and Mailgun EU transactional e-mail
- **Agent:** Codex · actual gpt-6-sol/high→medium.
- **Branch · SHA:** `main` · `2199022` (22:20:34Z) → `1da9639` (12:39:16Z) → `9bb365b` (13:34:30Z).
- **Result:** Mailgun EU domain, signed webhook; one real verification and one real recovery e-mail delivered with machine-recorded `accepted`/`delivered` events; old card link rejected (404), new link works, balance/ledger/referrals unchanged. The iPhone private-browser step is owner-reported. Outbound e-mail switched off afterwards.
- **Status:** VERIFIED (delivery, device-test origin); owner browser step OWNER-REPORTED · **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (EXTERNAL_EMAIL_TEST), [E-005](EVIDENCE-INDEX.md#e-005). See [T-081](TEST-EVIDENCE.md#t-081).

<a id="tl-015"></a>
### TL-015 — 2026-09-28 16:17–19:10Z — Promotional e-mail path, unsubscribe host, controlled Gate-5 send
- **Agent:** Codex · actual gpt-6-sol/low–high.
- **Branch · SHA:** `main` · `d0d9554` → `e15c9f7` (16:54Z) → `6e9aa75` (16:59Z) → `2bed62b` (17:33Z) → `9223012` (19:10:24Z).
- **Result:** Consent-aware promotional path (separately gated), public no-login unsubscribe host `unsubscribe.getloynara.com` (restricted tunnel route). One promotional message to one verified, opted-in synthetic recipient delivered; owner completed unsubscribe (one withdrawal recorded); second campaign excluded the recipient. Promotional flags off again. A first attempt was paused when the unsubscribe hostname did not resolve (18:43Z) — preserved.
- **Status:** VERIFIED (device-test origin) · **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (V1_RELEASE_GATES Gate 5), [E-005](EVIDENCE-INDEX.md#e-005). See [T-082](TEST-EVIDENCE.md#t-082).

<a id="tl-016"></a>
### TL-016 — 2026-09-28 20:47–21:39Z — Gate-1 production preparation (nothing provisioned)
- **Agent:** Codex · actual gpt-6-sol/medium.
- **Branch · SHA:** `main` · `acda7ab` (20:47:45Z) → `007ab5b` → `cb46f11` (21:02:03Z) → `9d28ec4` (21:36:59Z).
- **Result:** Railway Hobby (Stage A) / Pro (Stage B) plan, costed approval package, Stage-A images prepared locally. Gate 1 still NOT_IMPLEMENTED; spend €0 ([D-008](DECISIONS.md#d-008)).
- **Status:** PLANNED · **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_DEPLOYMENT, RAILWAY_GO_LIVE_UPGRADE).

---

## Phase B — Gate 1: production infrastructure (Sept 29 – Oct 1)

<a id="tl-017"></a>
### TL-017 — 2026-09-29 09:03–11:10Z — R2 bucket, Railway Hobby, PostgreSQL
- **Agent:** Codex · actual gpt-6-sol/low–medium.
- **Branch · SHA:** `main` · `70417f8` (09:02:44Z) → `0f6bbff` (09:19:46Z).
- **Result:** Private Cloudflare R2 bucket `loynara-rc-backups` (EU jurisdiction, public access disabled). Railway Hobby subscription active ($5.95 charged); limits $10 warning / $16 hard / $0 Agent saved. PostgreSQL 18 service in EU West (Amsterdam), project `loynara-rc`.
- **Status:** DEPLOYED · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_DEPLOYMENT).

<a id="tl-018"></a>
### TL-018 — 2026-09-29 13:54–15:25Z — Private GitHub, first Railway builds, workspace relocation
- **Agent:** Codex · actual gpt-6-sol/medium.
- **Branch · SHA:** `railway-rc` pushed at `0f6bbff`. **Deployment:** migrate `46ae14d0-ad5c-454e-a8e7-7173f3166d80`, web `e38600d2-9016-42dc-a603-9dd7ea5b45d4` (both from `0f6bbff`).
- **Result:** Private repo `belmo-hub/loynara` created; only `railway-rc` pushed; Railway GitHub App limited to that repository. Migration completed (auth + app schema, append-only trigger present, no seed); web passed its health check. The worker built but its production guard **refused to start** without an HTTPS heartbeat monitor — intended behavior. The project directory was moved from `Documents/Codex/2026-09-25/…/outputs/looplocal` to `~/Desktop/Loynara` (15:25Z).
- **Status:** DEPLOYED · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_RELEASE_TEST).

<a id="tl-019"></a>
### TL-019 — 2026-09-29 15:48Z — Claude joins as independent reviewer
- **Agent:** Claude · actual claude-opus-5-5 (session interrupted 15:48:48Z) then claude-sonnet-5-5 · requested not recorded.
- **Result:** Read-only onboarding report (architecture, gates, risks). Claude's role from here: independent review, parallel unblocking, read-only analysis, later the dashboard build and production RC verification ([D-026](DECISIONS.md#d-026), [D-027](DECISIONS.md#d-027)).
- **Status:** VERIFIED (activity) · **Evidence:** [E-010](EVIDENCE-INDEX.md#e-010), [E-032](EVIDENCE-INDEX.md#e-032).

<a id="tl-020"></a>
### TL-020 — 2026-09-29 16:09–16:42Z — Heartbeat monitors, worker auto-deploy off, peer-identity hold
- **Agent:** Codex · actual gpt-6-sol/medium → gpt-6-astra/medium (16:40Z).
- **Branch · SHA:** `railway-rc` · `200cdb3` (16:00:35Z, reviewed Healthchecks heartbeat URLs; also the tip of `main`).
- **Result:** Free Healthchecks.io checks for worker, outbox and backup; worker GitHub auto-deploy disabled (16:28Z). Static review **confirmed** that every production-accepted proxy-trust setting gave unrelated visitors the same `untrusted-peer` rate-limit identity. Per the owner's stop rule, no tunnel/DNS exposure was attempted.
- **Status:** DEPLOYED (monitors); hazard VERIFIED then fixed ([TL-021](TIMELINE.md#tl-021)) · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002).

<a id="tl-021"></a>
### TL-021 — 2026-09-29 17:02–19:44Z — Peer-identity fix with two independent Claude reviews
- **Agent:** Codex gpt-6-astra/medium; Claude claude-sonnet-5-5 (first review, 18:53Z); Claude final review requested on **Claude Opus 5.5** (task 19:24Z), but the owner switched the session back to Sonnet within about a minute and the approving verdict (~19:44Z) was produced by **claude-sonnet-5-5** (transcript metadata; corrected after independent review).
- **Branch · SHA:** `railway-rc` · `d0d7426` (16:41Z hold) → `0946c81` (17:02:36Z) → `e94fd5c` (19:16:02Z).
- **Result:** `0946c81` added explicit trusted Cloudflare ingress, validated visitor identity, hashed peer keys. Claude review (18:53Z): **CHANGES_REQUIRED** — IPv6 clients could bypass per-peer limits (F-1). `e94fd5c` groups IPv6 by /64 and signals ingress failures. Claude final review (task 19:24Z, verdict ~19:44Z, Sonnet): **APPROVE_FOR_DEPLOYMENT_VERIFICATION**, F-1/F-2 resolved. `e94fd5c` became the reviewed web/worker/migrate runtime.
- **Status:** TESTED; later DEPLOYED ([TL-025](TIMELINE.md#tl-025)) · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-009](EVIDENCE-INDEX.md#e-009), [E-032](EVIDENCE-INDEX.md#e-032). See [D-026](DECISIONS.md#d-026).

<a id="tl-022"></a>
### TL-022 — 2026-09-29 19:52Z — Claude credential-exposure disclosure
- **Agent:** Claude · actual claude-sonnet-5-5.
- **Result:** A Claude command printed a process listing that showed the **name** of a Claude Code harness variable (not a Loynara credential). Claude reported it, did not use, print or hash the value, and treated it as a secret. Recorded as [R-012](RISKS-AND-EXCEPTIONS.md#r-012).
- **Status:** VERIFIED (disclosure only) · **Evidence:** [E-009](EVIDENCE-INDEX.md#e-009).

<a id="tl-023"></a>
### TL-023 — 2026-09-29 19:49–21:30Z — Credential-safety pause; Hobby backup limitation → owner amendment; connector exception; mail routing
- **Agent:** Codex · actual gpt-6-sol/medium–low and gpt-6-astra/medium (21:42Z relay).
- **Result:** Deployment paused at the owner's credential-safety checkpoint. On Hobby, scheduled native PostgreSQL backups require Pro. The owner **amended Stage A**: automated age-encrypted logical dump to private EU R2, backup-age monitoring and a verified isolated restore; native backups deferred to Stage B ([D-009](DECISIONS.md#d-009), [X-002](RISKS-AND-EXCEPTIONS.md#x-002)). Owner split a pending approval (21:13Z): the official `cloudflare/cloudflared` image is allowed as a narrow vendor-image exception with a pinned digest; the backup-monitor source push waited for Claude's review. Cloudflare Email Routing for a support address was configured (status "Syncing", forwarding test not recorded).
- **Status:** ACCEPTED-RISK (native backups deferred, [X-002](RISKS-AND-EXCEPTIONS.md#x-002)); infrastructure DEPLOYED ([TL-025](TIMELINE.md#tl-025)) · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002).

<a id="tl-024"></a>
### TL-024 — 2026-09-29 21:05–21:45Z — Claude parallel unblocker packs and backup-monitor review
- **Agent:** Claude · actual claude-sonnet-5-5.
- **Result:** Gate-7 legal/operator/data inventory (21:05Z), backup-monitor review of `558524848d1373d1d050f2227d74630f88b314f4` (21:12Z, verdict **APPROVE_FOR_PUSH** with three low-severity notes), Gate-2/Gate-3 unblocker pack (21:22Z). No legal conclusions were reached.
- **Status:** PLANNED (analysis only) · **Evidence:** [E-009](EVIDENCE-INDEX.md#e-009), [E-032](EVIDENCE-INDEX.md#e-032).

<a id="tl-025"></a>
### TL-025 — 2026-09-29 19:59Z → 22:15Z — Runtime services, production tunnel, app origin online
- **Agent:** Codex · actual gpt-6-sol/medium.
- **Branch · SHA:** `railway-rc` · runtime source `e94fd5c`. **Deployment:** migrate `8ded1625-3560-4582-b0fd-4a1ba20facfb` (19:59:05Z), worker `fbc5ac5a-90d7-4337-b4e3-1c192adc5569` (20:40:24Z), cloudflared `d0fc5af6-abae-4b74-a65a-b5155ed7bc85` (21:21:27Z); web `5285bbb4-cc0d-453b-bf08-ceb94a2f5109` (restarted, not rebuilt, later; creation time **not captured**).
- **Result:** Dedicated Railway-hosted cloudflared connector to a named production tunnel; `app.getloynara.com` online with healthy HTTPS at ~22:15Z. Commits: `7cea7f0`, `e37a82f`, `4b61841`, `5585248`.
- **Status:** DEPLOYED · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_RELEASE_TEST), [E-015](EVIDENCE-INDEX.md#e-015).

<a id="tl-026"></a>
### TL-026 — 2026-09-29 22:14Z → 2026-09-30 07:22Z — Backup CA fix and real alert drill
- **Agent:** Codex gpt-6-sol/low; Claude claude-sonnet-5-5 (07:05Z review).
- **Branch · SHA:** `railway-rc` · `90ad26a` (22:14:07Z). **Deployment:** backup `c237a1ca-6eb4-489d-a90e-16a54d3b534c` (07:21:39Z).
- **Result:** Debian CA certificates added after a TLS failure; real encrypted upload, heartbeat, controlled missing-bucket failure → Healthchecks DOWN → restored → UP, both e-mails received (07:20–07:22Z). Claude's review of this commit was **INCONCLUSIVE** (Claude's shell-safety tool failed); Codex proceeded on its own evidence. The scheduled 03:03Z run that day still used the CA-deficient image and is not counted as a success.
- **Status:** DEPLOYED, VERIFIED · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-009](EVIDENCE-INDEX.md#e-009), [E-015](EVIDENCE-INDEX.md#e-015). See [T-017](TEST-EVIDENCE.md#t-017).

<a id="tl-027"></a>
### TL-027 — 2026-09-30 09:25–14:18Z — Owner dashboard built and frozen (Claude)
- **Workstream:** Owner-dashboard design/build in an isolated worktree ([D-015](DECISIONS.md#d-015)).
- **Agent:** Claude · actual claude-sonnet-5-5 · requested not recorded in the task text.
- **Branch · SHA:** `claude/owner-dashboard-v1` · base `5c51d992d18095211e169eeb9e5e9ebf8c565b8a` (07:39:54Z) → `ddf8569` (10:05:08Z, first) … `652d214f2f572a6f82a6591d3e9641e791ad1d83` (14:17:39Z, frozen). 17 commits.
- **Result:** Five-destination dashboard (A shell/overview, B programme/wizard/card studio, C customers/campaigns/referrals, D remaining pages, Back guard, polish). No change to `src/lib`, `src/db`, `src/app/api`, migrations, deploy files or packages. 21/21 dashboard e2e (17 spec files, controlled run), typecheck, lint, 13 unit tests, isolated build (76 pages), overflow checks 56/56 at four widths. Backend gaps documented, none implemented. **Not integrated; branch not pushed.**
- **Status:** IMPLEMENTED, TESTED · **Evidence:** [E-004](EVIDENCE-INDEX.md#e-004), [E-003](EVIDENCE-INDEX.md#e-003), [E-009](EVIDENCE-INDEX.md#e-009).

<a id="tl-028"></a>
### TL-028 — 2026-09-30 09:31–10:25Z — ops-check deployed under explicit approval; first alert drill
- **Agent:** Codex · actual gpt-6-sol/medium → gpt-6-astra/medium.
- **Branch · SHA:** `railway-rc` · `90ad26a`. **Deployment:** ops `a6c40859-ca82-440e-9d2d-86da13184d66` (creation time not captured).
- **Result:** One owner-approved deployment of the ops cron (every five minutes); controlled failed-outbox → DOWN/UP alerts received (09:55–10:02Z); synthetic stale lease reclaimed on attempt 2 at 10:17:43Z. GitHub auto-deploy off.
- **Status:** DEPLOYED, VERIFIED · **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002), [E-012](EVIDENCE-INDEX.md#e-012). See [T-011](TEST-EVIDENCE.md#t-011), [T-021](TEST-EVIDENCE.md#t-021).

<a id="tl-029"></a>
### TL-029 — 2026-09-30 12:15–12:38Z — Synthetic owners on production HTTPS
- **Agent:** Codex · actual gpt-6-astra/medium.
- **Branch · SHA:** `railway-rc` · `6f8a45e` → `92db2ee` (12:37:25Z, docs). **Deployment:** web `5285bbb4` restarted (no rebuild).
- **Result:** Two operator-provisioned identities (user + account + tenant + location + owner role, **no programme**) via a temporary private script using Better Auth's own password functions; public registration stayed disabled. Cross-tenant location read/select 404 in both directions, no/invalid session 401, sessions survived a web restart (12:34:38Z), everything removed afterwards.
- **Status:** VERIFIED · **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_RELEASE_TEST), [E-005](EVIDENCE-INDEX.md#e-005). See [T-006](TEST-EVIDENCE.md#t-006).

<a id="tl-030"></a>
### TL-030 — 2026-09-30 12:53–16:25Z — Logging inventory; restricted callback hosts cut over
- **Agent:** Codex · actual gpt-6.1-sol/high.
- **Branch · SHA:** `railway-rc` · `cd9887e` (16:23:50Z, docs).
- **Result:** The blocked Cloudflare sampled-log query was superseded by a plan inventory: Free plan, no Logpush, no raw log product (standard sampled telemetry only). Synthetic canaries were absent from web (37), worker (56) and connector (7) log entries at 13:00:41Z. `mail-events` and `unsubscribe` hosts moved to the production tunnel with exact path restrictions; signed webhook idempotency, unsubscribe and 404 checks passed. The persistent card-URL bearer was recorded as pre-commercial hardening ([R-011](RISKS-AND-EXCEPTIONS.md#r-011)).
- **Status:** VERIFIED · **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_URI_LOGGING), [E-016](EVIDENCE-INDEX.md#e-016), [E-005](EVIDENCE-INDEX.md#e-005). See [T-005](TEST-EVIDENCE.md#t-005), [T-023](TEST-EVIDENCE.md#t-023).

<a id="tl-031"></a>
### TL-031 — 2026-09-30 19:15–19:21Z — Mac-off exercise
- **Agent:** Codex · actual gpt-6.1-sol/high.
- **Branch · SHA:** `railway-rc` · `a96fc12313fc6f8153cc7d21472bf9fe06877a01` (19:21:07Z, docs) — later the **accepted release baseline**.
- **Result:** The owner turned the Mac off for at least six minutes and checked health and the unsubscribe page from an iPhone on mobile data; the owner replied "Mac-off passed". Independent probes afterwards: app health 200, unsubscribe 200, unsigned Mailgun callback 406; worker/ops heartbeats healthy. Exact shutdown/startup times were not supplied.
- **Status:** OWNER-REPORTED (corroborated by Tier-2 probes) · **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_RELEASE_TEST), [E-005](EVIDENCE-INDEX.md#e-005). See [T-024](TEST-EVIDENCE.md#t-024), [X-003](RISKS-AND-EXCEPTIONS.md#x-003).

<a id="tl-032"></a>
### TL-032 — 2026-09-30 20:31–21:55Z — Claude read-only planning: integration, onboarding, NFC, Wallet
- **Agent:** Claude · actual claude-sonnet-5-5 (20:31Z, 21:55Z) and claude-opus-5-5 (20:49Z).
- **Result:** Dashboard integration forecast and corrected A→B→C→D order; production onboarding analysis (bridge = identity-only provisioning + idempotent retry; canonical = invite-gated sign-up); NFC modes and `automatic_fixed` threat model; Wallet P0/P1 hardening table; Tag-#1 procedure (CLI hard-locked to the preview origin; a failed attempt burns the tag UID). Owner statements in the same window (21:52Z): ten on-metal NTAG tags ordered, first pilot uses `staff_confirmed`, generic PC/SC reader intended.
- **Status:** PLANNED (analysis only; nothing built) · **Evidence:** [E-009](EVIDENCE-INDEX.md#e-009), [E-032](EVIDENCE-INDEX.md#e-032), [E-034](EVIDENCE-INDEX.md#e-034). See [D-022](DECISIONS.md#d-022), [D-023](DECISIONS.md#d-023).

<a id="tl-033"></a>
### TL-033 — 2026-09-30 22:09–22:21Z — Apple Developer question; managed-signing provider research
- **Agent:** Claude · actual claude-sonnet-5-5.
- **Result:** Answer: an installable Apple pass needs a Pass Type ID certificate from a paid Apple Developer account (about USD 99/year per Apple's enrollment page as read by Claude; not re-verified here); third-party providers sign with their own identity. WalletWallet/PassFast research verdict **CAUTION**: usable only as a flag-gated pilot bridge; passes issued by a managed signer cannot move to an own Pass Type ID; adapter design and kill criteria recorded ([D-018](DECISIONS.md#d-018), [D-019](DECISIONS.md#d-019)).
- **Status:** PLANNED · **Evidence:** [E-009](EVIDENCE-INDEX.md#e-009), [E-032](EVIDENCE-INDEX.md#e-032).

<a id="tl-034"></a>
### TL-034 — 2026-09-30 23:01–23:37Z — PassFast synthetic Apple Wallet proof of concept
- **Workstream:** Temporary managed-signing Apple bridge — external account only; no Loynara code or infrastructure touched.
- **Agent:** Codex · actual gpt-6.1-sol/high · requested not recorded.
- **Result (agent-observed, provider side):** Managed signing selected; template "Loynara Apple Bridge Test" published (immutable) and **one** pass generated (23:26Z); update 6/10 → 7/10 saved with "device push requested for 1 registered device" (23:32Z; no APNs acceptance was displayed); void executed once, provider response "Pass voided — .pkpass rebuilt — 1 device notified" (23:37Z). Free quota: 1 of 100 used; no API key created; no payment method added.
- **Status:** TESTED (PoC, synthetic, not Loynara code); provider-side facts VERIFIED (Tier 2) · **Evidence:** [E-033](EVIDENCE-INDEX.md#e-033), [E-005](EVIDENCE-INDEX.md#e-005). See [T-062](TEST-EVIDENCE.md#t-062). Device-side observations: [TL-035](TIMELINE.md#tl-035).

<a id="tl-035"></a>
### TL-035 — 2026-09-30 23:30Z → after 23:37Z — PassFast device-side observations (owner-reported)
- **Agent:** owner (Tier 3); reports relayed in Codex session turns run on gpt-6.1-sol/high · **Requested/actual model:** n/a for the observation.
- **Result:** The owner reports: the managed-signed pass installed in Apple Wallet on the owner's real iPhone showing **6/10**; it then updated remotely to **7/10** and an Apple Wallet update notification appeared (reported 23:35Z); after the void, the pass appeared under Wallet's **"Expired"** section (time of this last observation not recorded).
- **Status:** OWNER-REPORTED (Tier 3) · **Evidence:** [E-034](EVIDENCE-INDEX.md#e-034), [E-005](EVIDENCE-INDEX.md#e-005) (install and update reports in the next owner prompts). See [T-063](TEST-EVIDENCE.md#t-063).

<a id="tl-036"></a>
### TL-036 — dates not recorded — NFC hardware purchased (owner-reported)
- **Agent:** owner (Tier 3) · **Requested/actual model:** n/a.
- **Result:** The owner reports purchasing **ten NTAG 424 DNA 28×28 mm on-metal tags** for Loynara physical testing (an order is mentioned on 2026-09-30 21:52Z; the purchase is stated in the 2026-10-01 22:36Z task prompt) and a **REINER SCT cyberJack RFID basis** reader (purchase date not recorded; first reported 2026-10-01 22:36Z). Compatibility is expected from the generic PC/SC architecture; physical NTAG 424 provisioning is **not yet verified**. Purchase cost, supplier, delivery date and serial numbers are **UNKNOWN** and deliberately not recorded.
- **Status:** OWNER-REPORTED · **Evidence:** [E-034](EVIDENCE-INDEX.md#e-034). See [D-028](DECISIONS.md#d-028), [D-029](DECISIONS.md#d-029), [O-030](OPEN-ITEMS.md#o-030).

<a id="tl-037"></a>
### TL-037 — 2026-09-30 22:21Z (first owner report; restated 2026-10-01 22:36Z) — Apple Developer enrollment cannot be completed (owner-reported)
- **Agent:** owner (Tier 3) · **Requested/actual model:** n/a.
- **Result:** The owner reports currently being **unable to complete Apple Developer Program enrollment**; this is why managed-signing providers were investigated as a temporary bridge. First stated by the owner on 2026-09-30 22:21Z in the WalletWallet/PassFast research task ("I currently cannot enroll in the Apple Developer Program"); restated in the 2026-10-01 22:36Z task prompt (00:36 CEST on Oct 2). The reason is not recorded (UNKNOWN). Apple Developer enrollment is not on the critical path for the first pilot ([D-024](DECISIONS.md#d-024)).
- **Status:** OWNER-REPORTED · **Evidence:** [E-034](EVIDENCE-INDEX.md#e-034). See [D-018](DECISIONS.md#d-018), [O-025](OPEN-ITEMS.md#o-025).

---

## Phase C — Gate 1 completion and accepted risk (Oct 1)

<a id="tl-038"></a>
### TL-038 — 2026-10-01 03:00:14.901–03:00:25.979Z — First natural encrypted backup
- **Agent:** none (scheduled cron); evidence collected by Codex · actual gpt-6-astra/high ([TL-039](TIMELINE.md#tl-039) run) · requested GPT-6 Astra.
- **Result:** Scheduled cron run of the repaired backup image; encrypted upload and independent HEAD verification logged; 144,994-byte object under the `loynara/2026/10/01/` prefix; expires 2026-10-15T03:00:16Z (14-day rule). Not manually triggered.
- **Branch · SHA:** `railway-rc` · `90ad26a` (backup `c237a1ca`).
- **Status:** VERIFIED (Tier 2, independent object check) · **Evidence:** [E-012](EVIDENCE-INDEX.md#e-012). See [T-014](TEST-EVIDENCE.md#t-014).

<a id="tl-039"></a>
### TL-039 — 2026-10-01 07:53–08:41Z — Fresh Gate-1 verification run: drills
- **Agent:** Codex · actual gpt-6-astra/high.
- **Branch · SHA:** `railway-rc` · `a96fc12` (unchanged).
- **Result:** Phase 0 integrity PASS, then drills: worker heartbeat pause 08:14:30–08:22:30Z; external HTTPS outage DOWN 08:28:50Z, recovered after 5m04s; failed-job diagnosis and reviewed replay 08:26–08:27Z; web pause/restart and DB restart (503 → 200 at 08:33:02Z); cashier scope and revocation across restart 08:38–08:41Z. All fixtures removed.
- **Status:** VERIFIED · **Evidence:** [E-015](EVIDENCE-INDEX.md#e-015), [E-012](EVIDENCE-INDEX.md#e-012), [E-006](EVIDENCE-INDEX.md#e-006). See [T-007](TEST-EVIDENCE.md#t-007)–[T-010](TEST-EVIDENCE.md#t-010), [T-013](TEST-EVIDENCE.md#t-013), [T-019](TEST-EVIDENCE.md#t-019), [T-020](TEST-EVIDENCE.md#t-020).

<a id="tl-040"></a>
### TL-040 — 2026-10-01 08:30:50.904Z — Unexplained redeploy of the ops service
- **Agent:** initiator UNKNOWN; detected by Codex · actual gpt-6-astra/high · requested not recorded.
- **Result:** Railway recorded a **redeploy** of `loynara-ops-check` (audit event `9fc41cbf-d593-47f1-835a-e283122304ba`; deployment `a6c40859-…` → `9d7b991d-ac24-4989-8449-009ffb92d6dc`, created 08:30:50.867Z; image digest changed). Railway attributed it to the owner's account (not "Railway System"), executed by a background process without session information. Source commit, configuration, schedule and all 15 variables matched; the replacement built and its scheduled runs passed. Discovered at the final readback (~08:41Z). Codex stopped without repair.
- **Status:** UNKNOWN (initiator) · **Evidence:** [E-015](EVIDENCE-INDEX.md#e-015), [E-014](EVIDENCE-INDEX.md#e-014), [E-006](EVIDENCE-INDEX.md#e-006). See [X-001](RISKS-AND-EXCEPTIONS.md#x-001).

<a id="tl-041"></a>
### TL-041 — 2026-10-01 08:48–09:57Z — Stop and forensics
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** 08:48Z: stopped, release integrity failed at final readback. 09:24Z: Gate 1 **PARTIAL**; provenance **UNKNOWN**. 09:57Z forensic review of all 53 tool calls in 08:20–08:35Z, 630 session files, shell histories, source and the Railway API helper: **no positive evidence that the Codex run initiated it**; the Codex-caused failed fixture (08:25:58Z) did not explain a redeploy at 08:30:50Z. Replacement not accepted. Needed: Railway request/client provenance or an affirmative operator record.
- **Status:** UNKNOWN (never resolved) · **Evidence:** [E-014](EVIDENCE-INDEX.md#e-014), [E-006](EVIDENCE-INDEX.md#e-006).

<a id="tl-042"></a>
### TL-042 — 2026-10-01 09:12Z — Claude: what blocks publishing the public root
- **Agent:** Claude · actual claude-sonnet-5-5.
- **Result:** Read-only analysis of `LEGAL_LAUNCH_FIELDS.md`: eight unresolved owner inputs, no Impressum/Datenschutz pages anywhere in the site, placeholders and an unconditional build guard; apex and `www` have no web DNS record. Assessment BLOCKED; no legal conclusions.
- **Status:** VERIFIED (analysis); root site NOT published · **Evidence:** [E-009](EVIDENCE-INDEX.md#e-009), [E-002](EVIDENCE-INDEX.md#e-002) (marketing-site/LEGAL_LAUNCH_FIELDS.md).

<a id="tl-043"></a>
### TL-043 — 2026-10-01 10:05–10:16Z — Containment, re-baseline, accepted risk
- **Agent:** Codex · actual gpt-6-astra/high.
- **Branch · SHA:** `railway-rc` · `a96fc12`. **Deployment:** ops `56bb5199-79e9-4b6b-8005-696c72769937` (created 10:08:20.137Z; source `90ad26a`; image `sha256:87db53a2…cc5b77`).
- **Result:** The owner reviewed Railway authorized apps and tokens and revoked anything unrecognized or unnecessary (**owner attestation**, not independently attested) and authorized containment — explicitly *not* an acceptance or explanation of the historical event. Exactly one deliberate redeploy by Codex at 10:08:19.9Z (audit `274ba786-7705-4af0-ae44-6d92b57a1253`, client `Loynara-Deployment/1.0`) created the new baseline; build SUCCESS 10:10:39Z; first scheduled PASS 10:15:52Z; same source, manifest, schedule and 15 variables. Accepted at 10:16:18Z. The historical event was labelled **ACCEPTED-RISK — contained and superseded; provenance UNKNOWN** ([D-014](DECISIONS.md#d-014), [X-001](RISKS-AND-EXCEPTIONS.md#x-001)).
- **Status:** ACCEPTED-RISK (historical event); VERIFIED (re-baseline) · **Evidence:** [E-013](EVIDENCE-INDEX.md#e-013), [E-012](EVIDENCE-INDEX.md#e-012), [E-006](EVIDENCE-INDEX.md#e-006).

<a id="tl-044"></a>
### TL-044 — 2026-10-01 10:24–10:36Z — In-flight interruption and isolated missed-run alert
- **Agent:** Codex · actual gpt-6-astra/high · requested not recorded.
- **Result:** A synthetic job was claimed at 10:24:00.128Z with the handler actually observed running; the worker was restarted at 10:24:26Z; the original lease held until 10:29:00.128Z; a replacement worker reclaimed it on attempt 2 and committed exactly one terminal "suppressed" outcome (10:29:00.949Z) with zero delivery/ledger effects. Two preliminary observer attempts and a backend-disappearance timeout are preserved, not counted. A disposable Healthchecks check (period and grace 60 s) produced Late → Down → owner e-mail (10:33Z) → recovery (10:35:26Z) → UP e-mail; the check was deleted; the production backup monitor was **not** exercised.
- **Status:** VERIFIED · **Evidence:** [E-012](EVIDENCE-INDEX.md#e-012), [E-006](EVIDENCE-INDEX.md#e-006). See [T-012](TEST-EVIDENCE.md#t-012), [T-018](TEST-EVIDENCE.md#t-018).

<a id="tl-045"></a>
### TL-045 — 2026-10-01 10:43Z — Infrastructure/operations part of Gate 1 COMPLETE; public root separated
- **Agent:** Codex · actual gpt-6-astra/high · requested not recorded.
- **Result:** Codex reported **INFRASTRUCTURE/OPERATIONS PORTION OF GATE 1 = COMPLETE** (31 report rows, 58 artifact checksums). Public-root readiness was retained as **FAIL — separate scope** ([D-013](DECISIONS.md#d-013)). The frozen Gate-1 definition in V1_RELEASE_GATES includes the public root, so Gate 1 *as frozen* is not PASS; the repository's gate documents were **not updated** ([O-051](OPEN-ITEMS.md#o-051)).
- **Status:** VERIFIED (Tier 2) · **Evidence:** [E-012](EVIDENCE-INDEX.md#e-012), [E-013](EVIDENCE-INDEX.md#e-013). See [T-026](TEST-EVIDENCE.md#t-026).

---

## Phase D — Owner-dashboard release candidate (Oct 1)

<a id="tl-046"></a>
### TL-046 — 2026-10-01 11:18–12:11Z — Integration A → B → C → D
- **Agent:** Codex · actual gpt-6-astra/high · requested GPT-6 Astra (handoff).
- **Branch · SHA:** `integration/owner-dashboard-v1` · `a96fc12` → `6f80c72aaa930bde545eb296dc81b8568c5af826` (12:10:30Z). Frozen source `652d214`.
- **Result:** All 17 frozen commits applied in the corrected order (`4c6bde0` inside C), patch IDs matching, no conflicts; temporary onboarding bridge (identity-only provisioning, idempotent completed-retry, German setup/access errors) in three source files; independent review found three dashboard defects (location-switch loading screen, three links bypassing the edit guard, customer-scope filter reset), fixed with five regression tests. Verification: typecheck/lint exit 0; **334/334** tests (62 files); 46 distinct browser tests; 8/8 responsive/accessibility; production build exit 0. Tests ran in a byte-verified `/tmp` snapshot because Desktop reads stalled.
- **Status:** TESTED · **Evidence:** [E-003](EVIDENCE-INDEX.md#e-003), [E-017](EVIDENCE-INDEX.md#e-017), [E-007](EVIDENCE-INDEX.md#e-007). See [D-015](DECISIONS.md#d-015), [T-030](TEST-EVIDENCE.md#t-030), [T-032](TEST-EVIDENCE.md#t-032), [T-033](TEST-EVIDENCE.md#t-033).

<a id="tl-047"></a>
### TL-047 — 2026-10-01 12:25–12:32Z — First RC deployment attempt BLOCKED in Phase 0 (superseded)
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** Stopped before any deployment: public `/api/health` returned Cloudflare **403 / error 1010** to a Python client, and no private migration-readback path existed. Nothing was changed.
- **Status:** SUPERSEDED (the 1010 was a client-configuration false blocker, [TL-048](TIMELINE.md#tl-048)) · **Evidence:** [E-018](EVIDENCE-INDEX.md#e-018), [E-007](EVIDENCE-INDEX.md#e-007).

<a id="tl-048"></a>
### TL-048 — 2026-10-01 13:03–13:37Z — Claude Phase-0 diagnosis
- **Agent:** Claude · actual claude-opus-5-5.
- **Result:** The 1010 was Cloudflare **Browser Integrity Check** rejecting Python's default `Python-urllib` user agent (Ray ID recorded); curl, a browser UA and `Loynara-Deployment/1.0` returned 200; no Cloudflare change needed ([D-012](DECISIONS.md#d-012)). Migrations read through the Railway web console in a signed-in browser with a read-only transaction ending in `ROLLBACK`: 18/18 match, database empty. Verdict **RC PHASE 0 = PASS — SAFE TO RESUME DEPLOYMENT**.
- **Status:** VERIFIED · **Evidence:** [E-021](EVIDENCE-INDEX.md#e-021), [E-009](EVIDENCE-INDEX.md#e-009).

<a id="tl-049"></a>
### TL-049 — 2026-10-01 13:37–13:52Z — First RC deployment
- **Agent:** Codex · actual gpt-6-astra/high.
- **Branch · SHA:** `integration/owner-dashboard-v1` pushed at `6f80c72`. **Deployment:** web **`7b26de48-949f-4eb8-b65e-b5ef1de79bae`** (created 13:41:39.275Z, SUCCESS event 13:43:46Z, image `sha256:b77aee77…eaaf`); rollback target `5285bbb4-cc0d-453b-bf08-ceb94a2f5109` (image `sha256:8322e3e4…1048e`, source `e94fd5c`).
- **Result:** One exact-commit web deployment via `serviceInstanceDeployV2(commitSha)` while the tracked branch stayed `railway-rc` ([D-010](DECISIONS.md#d-010)); other six services, configuration and flags unchanged; 18/18 migrations; health 200; production guard passed. Audit actor is a project token plus client `Loynara-Deployment/1.0` (no named human attribution).
- **Status:** DEPLOYED, VERIFIED · **Evidence:** [E-019](EVIDENCE-INDEX.md#e-019), [E-007](EVIDENCE-INDEX.md#e-007). See [T-036](TEST-EVIDENCE.md#t-036).

<a id="tl-050"></a>
### TL-050 — 2026-10-01 14:02–16:43Z — Synthetic production verification (Claude)
- **Agent:** Claude · actual claude-sonnet-5-5 · requested Claude Sonnet 5.5 / Extra (per its handoff).
- **Result:** On the real production origin, with identities typed in by the owner (Claude did not enter passwords): onboarding wizard + idempotent retry, every dashboard route, manager/cashier authorization (15 owner-only endpoints refused for the manager), two-tenant isolation with real IDs both directions, customer → cashier → owner flow with idempotent replays, analytics reconciliation, campaign draft/referral rule (nothing sent), billing/Wallet/NFC safety surfaces. **RC FUNCTIONAL VERIFICATION = PASS** — no P0/P1; one **P2** (Overview activity dates, "1 Oct" shown as "10.01.") and several **P3** items. Created two tenants, three memberships, six ledger rows and related rows (the four users had been provisioned beforehand, [TL-051](TIMELINE.md#tl-051)), all listed in a cleanup manifest.
- **Status:** VERIFIED · **Evidence:** [E-022](EVIDENCE-INDEX.md#e-022), [E-009](EVIDENCE-INDEX.md#e-009). See [T-037](TEST-EVIDENCE.md#t-037)–[T-045](TEST-EVIDENCE.md#t-045).

<a id="tl-051"></a>
### TL-051 — 2026-10-01 14:52–14:59Z — Four synthetic identities provisioned (Codex)
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** Exactly four Better Auth users and credential accounts (identity-only) created through the approved private operator mechanism; credentials transported RSA-OAEP-encrypted into one local 0600 file; no tenant, role, programme or session created. The file was removed after cleanup ([TL-057](TIMELINE.md#tl-057)).
- **Status:** VERIFIED · **Evidence:** [E-020](EVIDENCE-INDEX.md#e-020).

<a id="tl-052"></a>
### TL-052 — 2026-10-01 19:28–19:32Z — Synthetic cleanup attempt #1 FAILED (no writes)
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** Reported "SYNTHETIC CLEANUP = FAIL — INVESTIGATION REQUIRED". The instruction referred to a "documented Gate-1 approach" for deleting append-only history, but **no such procedure existed**; the Railway console was also signed out. **No database mutation, no transaction, no trigger change.** Classified PROCEDURE_DEFECT.
- **Status:** SUPERSEDED · **Evidence:** [E-023](EVIDENCE-INDEX.md#e-023), [E-007](EVIDENCE-INDEX.md#e-007). See [T-051](TEST-EVIDENCE.md#t-051).

<a id="tl-053"></a>
### TL-053 — 2026-10-01 19:38–19:56Z — Claude investigation; append-only triggers discovered
- **Agent:** Claude · actual claude-sonnet-5-5.
- **Result:** Live read-only inspection (Railway console, `BEGIN READ ONLY … ROLLBACK`): all 39 application IDs and 4 auth IDs present; four append-only triggers (`ledger_append_only`, `program_rule_versions_append_only`, `staff_audit_append_only`, and `purchase_awards_append_only` with no synthetic rows); 76 foreign keys. The application connects as the `postgres` superuser ([R-001](RISKS-AND-EXCEPTIONS.md#r-001)). Recommendation: an owner-approved, ID-scoped, single-transaction temporary disable of exactly the three relevant triggers ([D-017](DECISIONS.md#d-017)).
- **Status:** VERIFIED (read-only) · **Evidence:** [E-024](EVIDENCE-INDEX.md#e-024), [E-009](EVIDENCE-INDEX.md#e-009).

<a id="tl-054"></a>
### TL-054 — 2026-10-01 19:59–20:17Z — Cleanup rehearsal (forced ROLLBACK)
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** Owner approved the three-trigger mechanism for synthetic data only. A writable transaction deleted the exact IDs with the three triggers disabled and re-enabled one at a time, asserted every row count and then **rolled back**: "CLEANUP REHEARSAL = PASS". Baseline snapshot 20:11:17Z.
- **Status:** TESTED against production data with a forced rollback (nothing persisted) · **Evidence:** [E-025](EVIDENCE-INDEX.md#e-025). See [T-049](TEST-EVIDENCE.md#t-049).

<a id="tl-055"></a>
### TL-055 — 2026-10-01 20:35–20:39Z — Cleanup commit attempt FAILED in a read-only precondition (no writes)
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** Reported "FAIL — ROLLED BACK" but **never opened a write transaction** and executed no DELETE or ALTER. Phase 0 (read-only) compared a full-content fingerprint of the volatile `rate_limits` table against a 25-minute-old snapshot and failed at 20:36:52.225Z (`ASSERTION_FAILED: all initial row fingerprints unchanged`); the ROLLBACK was that of a READ ONLY transaction. Row count was unchanged (175); five rows had legitimately changed.
- **Status:** SUPERSEDED · **Evidence:** [E-026](EVIDENCE-INDEX.md#e-026), [E-007](EVIDENCE-INDEX.md#e-007). See [T-051](TEST-EVIDENCE.md#t-051).

<a id="tl-056"></a>
### TL-056 — 2026-10-01 20:43–20:53Z — Claude strategy reset (Opus)
- **Agent:** Claude · actual claude-opus-5-5 · requested Claude Opus 5.5 / Extra (task text).
- **Result:** Root cause **PRECONDITION_DRIFT** (the deletion plan did not fail). All 34 stable tables still byte-identical to the rehearsal baseline; only `rate_limits` content differed. Compared repair-hard-delete, mark/archive (unsupported by the data model) and restore-from-backup (no approved mechanism). Recommended Route A, corrected: exclude `rate_limits` from the equality precondition and postcondition, change nothing else.
- **Status:** VERIFIED · **Evidence:** [E-027](EVIDENCE-INDEX.md#e-027), [E-009](EVIDENCE-INDEX.md#e-009).

<a id="tl-057"></a>
### TL-057 — 2026-10-01 21:07–21:20Z — Corrected synthetic cleanup COMMITTED
- **Agent:** Codex · actual gpt-6-astra/high.
- **Result:** Owner approved only the `rate_limits` assertion correction. One corrected rehearsal (BEGIN 21:12:14.645Z, forced ROLLBACK 21:12:14.826Z) then the real run (BEGIN 21:14:35.361Z, **COMMIT 21:14:35.632Z**): the rehearsal and commit scripts differ only in the disposition constant, with an identical transaction body (hash recorded). 26 exact-scope DELETE statements affected 53 rows; four credential accounts cascaded (57 rows removed in total). Three triggers were disabled, deleted through and re-enabled one at a time; `purchase_awards_append_only` was never touched. Independent post-commit verification used a new connection in a READ ONLY transaction. `email_provider_events` still 2; `rate_limits` untouched. The temporary credential file was removed (21:18:44Z). "SYNTHETIC CLEANUP = PASS — PRODUCTION BASELINE RESTORED".
- **Status:** VERIFIED · **Evidence:** [E-028](EVIDENCE-INDEX.md#e-028), [E-007](EVIDENCE-INDEX.md#e-007). See [T-049](TEST-EVIDENCE.md#t-049), [T-050](TEST-EVIDENCE.md#t-050), [X-006](RISKS-AND-EXCEPTIONS.md#x-006).

<a id="tl-058"></a>
### TL-058 — 2026-10-01 21:45–21:57Z — Overview date P2 fixed
- **Agent:** Codex · actual **gpt-6.1-sol/high** (thread setting switched 21:45:30Z) · requested GPT-6 Astra (handoff).
- **Branch · SHA:** `integration/owner-dashboard-v1` · `6f80c72` → `5c580be9b1887327cc456e672d2f25f29fc25830` (21:56:28Z).
- **Result:** The API supplies an already German-formatted activity string; `germanDate()` re-parsed it as a US date. Fix: render the string as supplied; raw timestamp only for `datetime`. Four files, +73/−2; regression tests failed before and pass after; **340/340** tests (63 files), 12/12 relevant browser tests, typecheck, lint, build exit 0.
- **Status:** TESTED · **Evidence:** [E-029](EVIDENCE-INDEX.md#e-029). See [T-031](TEST-EVIDENCE.md#t-031), [T-046](TEST-EVIDENCE.md#t-046).

<a id="tl-059"></a>
### TL-059 — 2026-10-01 22:01–22:15Z — Revised RC deployed
- **Agent:** Codex · actual gpt-6-astra/high.
- **Branch · SHA:** `integration/owner-dashboard-v1` pushed at `5c580be`. **Deployment:** web **`b588220e-82c5-429b-891a-a147d12c0f33`** (created 22:07:51.073Z, audit `86d61430-32e7-4f6c-a7e1-7386450440f7`, image `sha256:68738a14…dade38`).
- **Result:** One exact-commit web deployment; 20/20 GET smoke checks; 18/18 migrations; database baseline unchanged; other six services and configuration unchanged. "REVISED RC DEPLOYMENT = PASS — READY FOR PROMOTION".
- **Status:** DEPLOYED, VERIFIED · **Evidence:** [E-030](EVIDENCE-INDEX.md#e-030). See [T-047](TEST-EVIDENCE.md#t-047).

<a id="tl-060"></a>
### TL-060 — 2026-10-01 22:12–22:28Z — Claude historical reconstruction and launch-state audit (draft)
- **Agent:** Claude · actual claude-sonnet-5-5 · requested Claude Sonnet 5.5 / Extra.
- **Result:** Strictly read-only draft reconstruction (sources, timeline, decisions, SHA map, evidence matrix, services, launch audit, preservation risks). This ledger is built from it and corrects it where later evidence arrived.
- **Status:** VERIFIED (activity); content superseded by this ledger · **Evidence:** [E-035](EVIDENCE-INDEX.md#e-035).

<a id="tl-061"></a>
### TL-061 — 2026-10-01 22:20–22:33Z — Promotion of the tested revised RC to `railway-rc`
- **Agent:** Codex · actual gpt-6-astra/high.
- **Branch · SHA:** `railway-rc` · `a96fc12` (local) / `90ad26a` (remote) → `5c580be9b1887327cc456e672d2f25f29fc25830` by fast-forward; push 22:23:33.7–22:23:35.2Z. **Deployment:** web **`c87f2b50-783b-45d6-9d2a-6c880b0aa14f`** (created 22:26:47.695Z, audit `551ba124-b0d9-4973-8d63-550582a23e72`, SUCCESS event 22:27:16.360Z).
- **Result:** Both old tips were ancestors of the tested SHA. Because auto-deploy is disabled, the push created **no** deployment; Codex asked for, and received, the explicit approval "Approve one web deployment" and issued exactly one exact-commit deployment whose image digest equals the tested RC's. 20/20 smoke checks; 18/18 migrations; clean baseline; other services/config unchanged; ops-check PASS 22:31:01Z. Rollback target `b588220e`. **OWNER DASHBOARD RELEASE = PROMOTED.** Frozen 2026-10-02 00:33:32 CEST.
- **Status:** DEPLOYED, VERIFIED · **Evidence:** [E-031](EVIDENCE-INDEX.md#e-031). See [REL-012](RELEASES.md#rel-012), [T-048](TEST-EVIDENCE.md#t-048).

<a id="tl-062"></a>
### TL-062 — 2026-10-02 (CEST) — Launch Ledger Checkpoint #1 authored
- **Agent:** Claude · actual claude-sonnet-5-5 · requested Claude Sonnet 5.5 / Extra.
- **Branch · SHA:** `docs/launch-ledger-checkpoint-001` from `5c580be` (documentation only; the ledger commit SHA is intentionally not embedded here).
- **Result:** This ledger. No application code, infrastructure or database was touched.
- **Status:** IMPLEMENTED (documentation); **not deployed** ([REL-013](RELEASES.md#rel-013)) · **Evidence:** [E-001](EVIDENCE-INDEX.md#e-001).

---

## Post-checkpoint housekeeping (2026-10-02)

Recorded with Checkpoint 001 because they close its own open items; they do not change the release.

<a id="tl-063"></a>
### TL-063 — 2026-10-02, completed 07:57:48Z — Evidence preservation checkpoint #1
- **Agent:** as recorded in the preservation record (not re-checked in the correction pass).
- **Result:** Preservation of the Checkpoint-001 evidence completed: an archive outside the repository (636 files; 635 checksum files verified; three age-encrypted parts for secret-bearing material; plain-text sensitive scan PASS), bound to release `5c580be` and ledger commit `d73f1f1`. The record's final remote-ref listing shows `claude/owner-dashboard-v1` and the four `checkpoint/*` tags on `origin`.
- **Status:** VERIFIED (Tier 2, preservation record) · **Evidence:** [E-045](EVIDENCE-INDEX.md#e-045). Closes [O-050](OPEN-ITEMS.md#o-050) for Checkpoint 001.

<a id="tl-064"></a>
### TL-064 — 2026-10-02 — Independent review of Checkpoint 001 and required corrections
- **Agent:** Claude · actual claude-opus-5-5 · requested Claude Opus 5.5 / High (review) and Claude Sonnet 5.5 / Medium (corrections; performed in the same Opus session).
- **Branch · SHA:** `docs/launch-ledger-checkpoint-001` · `d73f1f1` → one documentation-only correction commit.
- **Result:** Strictly read-only review: structure, a 15-item risk-based factual sample, status semantics, secret scan, release tuple and open items. Verdict **LEDGER REVIEW = PASS WITH MINOR CORRECTIONS**; no major discrepancy; release tuple confirmed. The six required corrections were applied ([CHECKPOINT-001](checkpoints/CHECKPOINT-001.md#post-review-corrections)); optional suggestions were not.
- **Status:** VERIFIED (activity); IMPLEMENTED (documentation); **not deployed** ([REL-013](RELEASES.md#rel-013)) · **Evidence:** [E-044](EVIDENCE-INDEX.md#e-044). Closes [O-054](OPEN-ITEMS.md#o-054).
