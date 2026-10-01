# RISKS AND EXCEPTIONS

- **R-### — Risks:** known weaknesses or hazards that are **not** (or not yet) accepted by the owner. Each points to the open item that addresses it.
- **X-### — Accepted exceptions:** a gap or anomaly the owner consciously accepted, with containment, reopen triggers and a review point.
  Status for every `X-###` is **ACCEPTED-RISK** unless stated.

Severity wording is the ledger author's judgement (Tier 4) and is deliberately qualitative; no likelihood or loss figures are invented.
No secret values appear here. Statuses and tiers: [README](README.md). Evidence IDs: [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md).

| Accepted exceptions | | Risks | |
|---|---|---|---|
| [X-001](RISKS-AND-EXCEPTIONS.md#x-001) Unexplained Railway redeploy | [X-007](RISKS-AND-EXCEPTIONS.md#x-007) GET-only promotion smoke | [R-001](RISKS-AND-EXCEPTIONS.md#r-001) Runtime DB superuser | [R-010](RISKS-AND-EXCEPTIONS.md#r-010) No logout / password reset |
| [X-002](RISKS-AND-EXCEPTIONS.md#x-002) Native Railway backup deferred | [X-008](RISKS-AND-EXCEPTIONS.md#x-008) npm findings and build warnings | [R-002](RISKS-AND-EXCEPTIONS.md#r-002) PassFast bridge | [R-011](RISKS-AND-EXCEPTIONS.md#r-011) Card-URL bearer in paths |
| [X-003](RISKS-AND-EXCEPTIONS.md#x-003) Mac-off by attestation | [X-009](RISKS-AND-EXCEPTIONS.md#x-009) Known P3 issues shipped | [R-003](RISKS-AND-EXCEPTIONS.md#r-003) NFC production gaps | [R-012](RISKS-AND-EXCEPTIONS.md#r-012) Agent-harness token disclosure |
| [X-004](RISKS-AND-EXCEPTIONS.md#x-004) Restore proven on empty schema | [X-010](RISKS-AND-EXCEPTIONS.md#x-010) Hobby hard compute limit | [R-004](RISKS-AND-EXCEPTIONS.md#r-004) Ephemeral / local evidence | [R-013](RISKS-AND-EXCEPTIONS.md#r-013) No production recovery e-mail |
| [X-005](RISKS-AND-EXCEPTIONS.md#x-005) Cloudflare processor handling | [X-011](RISKS-AND-EXCEPTIONS.md#x-011) Token-attributed deployments | [R-005](RISKS-AND-EXCEPTIONS.md#r-005) Log and image retention | [R-014](RISKS-AND-EXCEPTIONS.md#r-014) Stale repository docs |
| [X-006](RISKS-AND-EXCEPTIONS.md#x-006) Synthetic-cleanup trigger bypass | | [R-006](RISKS-AND-EXCEPTIONS.md#r-006) Local-only refs | [R-015](RISKS-AND-EXCEPTIONS.md#r-015) V1 scope ambiguity |
| | | [R-007](RISKS-AND-EXCEPTIONS.md#r-007) iCloud replication of secrets | [R-016](RISKS-AND-EXCEPTIONS.md#r-016) Public audit copy placeholders |
| | | [R-008](RISKS-AND-EXCEPTIONS.md#r-008) Backup identity custody | [R-017](RISKS-AND-EXCEPTIONS.md#r-017) Single points of failure |

---

# Accepted exceptions

<a id="x-001"></a>
## X-001 — Historical unexplained Railway redeploy of `loynara-ops-check`
- **Status:** **ACCEPTED-RISK — contained and superseded. Provenance remains UNKNOWN.** Accepted 2026-10-01T10:16:18Z ([E-013](EVIDENCE-INDEX.md#e-013)). Related: [D-014](DECISIONS.md#d-014), [TL-040](TIMELINE.md#tl-040), [TL-043](TIMELINE.md#tl-043).
- **What happened:** Railway audit event `9fc41cbf-d593-47f1-835a-e283122304ba` at 2026-10-01 08:30:50.904Z recorded a redeploy of the ops service (`a6c40859` → `9d7b991d`), attributed by Railway to the owner's account (not "Railway System"), executed by a background process without session information. Source commit, service configuration, schedule and all 15 variables matched; the replacement's runs passed; only the image digest changed (a redeploy rebuilds, so a digest change alone is not drift).
- **What was established:** No Codex action in the window initiated it (53 tool calls, 630 session files and shell histories reviewed, Tier 2). No positive evidence of any other initiator. It was **never explained**, never attributed, and is **not** retroactively accepted as authorized.
- **Containment:** The owner reviewed Railway authorized apps and tokens and revoked anything unrecognized or unnecessary — **owner attestation only**, not independently attested. The current ops baseline `56bb5199` was created by one deliberate, attributable, owner-authorized redeploy (client `Loynara-Deployment/1.0`), then accepted only after a scheduled healthy run and same-state comparisons. The unexplained deployment `9d7b991d` was never accepted.
- **Reopen triggers:** Any further unattributed deployment, restart or variable/source change; Railway supplying request-level provenance; any sign of token or account compromise; ops source/variables diverging from an authorized action; an unexplained `ProjectToken` or GitHub App change.
- **Review point:** Before the first real merchant pilot and at each checkpoint ([O-044](OPEN-ITEMS.md#o-044)). **Evidence:** [E-012](EVIDENCE-INDEX.md#e-012), [E-013](EVIDENCE-INDEX.md#e-013), [E-014](EVIDENCE-INDEX.md#e-014), [E-015](EVIDENCE-INDEX.md#e-015).

<a id="x-002"></a>
## X-002 — Native Railway scheduled backups deferred to Stage B
- **Accepted by/when:** Owner amendment, 2026-09-29 20:12–20:53Z ([D-009](DECISIONS.md#d-009)). **Why:** the Hobby Backups tab requires Pro (screenshot [E-016](EVIDENCE-INDEX.md#e-016)).
- **Containment:** Daily age-encrypted dumps to private EU R2 with a backup-age monitor and a proven (empty-schema) isolated restore; first natural run verified 2026-10-01 ([T-014](TEST-EVIDENCE.md#t-014), [T-016](TEST-EVIDENCE.md#t-016)).
- **Reopen / expiry:** **Before the first paying merchant**: upgrade to Pro, enable native backups and run a native restore test while keeping R2 ([O-017](OPEN-ITEMS.md#o-017)). Also reopen if a populated restore fails.

<a id="x-003"></a>
## X-003 — Mac-off recovery accepted on owner attestation
- **Accepted:** 2026-09-30 19:21Z, recorded as "owner-attested core Mac-off PASS" ([T-024](TEST-EVIDENCE.md#t-024)). The owner powered the Mac off for at least six minutes and reported success; exact times were not supplied; independent post-test probes (health 200, unsubscribe 200, unsigned webhook 406, healthy heartbeats) corroborate availability, not the power state.
- **Containment:** Architecture evidence (no local daemon on the Mac for production; production routes through the Railway-hosted tunnel).
- **Reopen:** If a Mac dependency is ever suspected, or at the Pro go-live recheck. Status note: OWNER-REPORTED, not VERIFIED.

<a id="x-004"></a>
## X-004 — Isolated restore proven on an empty schema only
- **Accepted:** Gate-1 evidence 2026-09-29 (real encrypted object, separate decryption identity, separate PostgreSQL 18.6 host; 18 migrations, trigger, FKs and zero-row counts reconciled). **No populated-data restore claim is made.**
- **Reopen:** After first real data exists, run the restore check against a populated dump ([O-017](OPEN-ITEMS.md#o-017); pilot week 1 under [O-009](OPEN-ITEMS.md#o-009)).

<a id="x-005"></a>
## X-005 — Cloudflare processor handling and persistent card bearer accepted for Gate 1 under the owner-clarified logging model
- **Accepted:** 2026-09-30 (owner-clarified evidence model): canaries absent from controlled application/Railway/cloudflared logs; optional raw HTTP logging inventoried and not enabled; Cloudflare necessarily processes URIs as the proxy.
- **Not claimed:** zero storage or an EU-boundary guarantee. The persistent browser-card URL bearer is recorded separately as pre-commercial hardening ([R-011](#r-011), [O-042](OPEN-ITEMS.md#o-042)). Gate 7 is **not** satisfied ([O-019](OPEN-ITEMS.md#o-019)).
- **Reopen:** Cloudflare plan or logging change; legal/processor review outcome; any real card bearer observed in a log. **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (PRODUCTION_URI_LOGGING), [E-016](EVIDENCE-INDEX.md#e-016).

<a id="x-006"></a>
## X-006 — Synthetic-cleanup exception: temporary disable of three append-only triggers
- **Accepted by/when:** Owner approvals 2026-10-01 19:59Z (mechanism) and 21:07Z (precondition correction); executed once, committed 21:14:35.632Z ([D-017](DECISIONS.md#d-017), [T-050](TEST-EVIDENCE.md#t-050)).
- **Scope that was allowed and used:** Only `ledger_append_only`, `program_rule_versions_append_only`, `staff_audit_append_only`, one at a time inside a single transaction, to delete exactly identified synthetic rows (57 rows). `purchase_awards_append_only` untouched; no `session_replication_role`; FKs enforced; triggers verified enabled with unchanged definitions afterwards.
- **Why it is an exception:** Append-only triggers exist to protect real merchant history. This was a one-time, audited, ID-scoped bypass for test fixtures.
- **Reopen / limit:** The mechanism must **not** be reused for real merchant data without a new explicit approval. Related risk: [R-001](#r-001). **Evidence:** [E-024](EVIDENCE-INDEX.md#e-024)–[E-028](EVIDENCE-INDEX.md#e-028).

<a id="x-007"></a>
## X-007 — Revised RC and promotion verified by GET-only smoke
- **Accepted:** The revised RC (`b588220e`) and the official deployment (`c87f2b50`) were verified by 20 GET-only HTTP checks, runtime logs, database readbacks and configuration comparison — **no authenticated workflow was rerun** on the exact image. Reliance: the functional verification of `7b26de48` (same code except four files) and the P2 regression tests ([T-037](TEST-EVIDENCE.md#t-037), [T-046](TEST-EVIDENCE.md#t-046)).
- **Reopen:** If a pilot-hygiene change touches the dashboard, rerun the authenticated synthetic walkthrough ([O-003](OPEN-ITEMS.md#o-003)). **Evidence:** [E-030](EVIDENCE-INDEX.md#e-030), [E-031](EVIDENCE-INDEX.md#e-031).

<a id="x-008"></a>
## X-008 — npm audit (4 moderate) and build/startup warnings accepted for the release
- **Facts:** Four moderate advisories on the development-tooling path `drizzle-kit` → `@esbuild-kit/*` → `esbuild`; none high or critical; the suggested fix is a major downgrade that was not applied. Build emits Better Auth "missing baseURL / default secret" messages during image construction (runtime variables verified), deprecated-package and install-script notices, and Node `DEP0205` startup warnings. No dependency changed in the dashboard release.
- **Reopen:** Before public launch ([O-041](OPEN-ITEMS.md#o-041)); on any high/critical advisory. **Evidence:** [E-002](EVIDENCE-INDEX.md#e-002) (LAUNCH_BLOCKERS), [E-019](EVIDENCE-INDEX.md#e-019), [E-030](EVIDENCE-INDEX.md#e-030).

<a id="x-009"></a>
## X-009 — Known P3 issues shipped in the released dashboard
- **Facts (found 2026-10-01 14:02–16:43Z, [E-022](EVIDENCE-INDEX.md#e-022)):** no logout control anywhere; manager Overview links to a read-only programme page; "synthetisch/Synthetic" wording visible to real merchants (billing, adviser hint, CSV preview link); NFC "Automatisch" selectable in production (inert without keys/tags); `/api/card/<token>/referral` returns 400 (console error) when referrals are off; the join page links to the draft privacy page (a known legal item, not a regression).
- **Containment:** None are data-integrity or authorization defects; the NFC option is inert.
- **Reopen / fix:** Pilot-hygiene slice ([O-003](OPEN-ITEMS.md#o-003), [O-004](OPEN-ITEMS.md#o-004)); the legal item under [O-002](OPEN-ITEMS.md#o-002).

<a id="x-010"></a>
## X-010 — Hobby hard compute limit may take workloads offline
- **Accepted:** 2026-09-29 by the owner (limits $10 warning / $16 hard / $0 Agent). The hard limit does **not** cap taxes or every invoice item and **does** shut workloads down at the limit ([D-008](DECISIONS.md#d-008)).
- **Containment:** Measured usage far below the limit on 2026-10-01 (≈ $0.26; Tier 2). **Reopen:** usage trending toward $16; first paying merchant (Pro).

<a id="x-011"></a>
## X-011 — Deployments are attributed to a project token, not a named human
- **Facts:** Railway audit records the project-scoped token and client string for the three web deployments and the authorized ops redeploy; the local operator (Codex acting on explicit owner approval) is identified only by the local intent files. No human creator is inferred from token attribution.
- **Containment:** Single-shot, intent-first deployment scripts with preserved evidence ([D-010](DECISIONS.md#d-010), [D-027](DECISIONS.md#d-027)). **Reopen:** see [X-001](RISKS-AND-EXCEPTIONS.md#x-001) triggers; consider per-actor tokens ([O-044](OPEN-ITEMS.md#o-044)).

---

# Risks

<a id="r-001"></a>
## R-001 — The application connects to PostgreSQL as the `postgres` superuser
- **Facts:** Read-only inspection on 2026-10-01 ([E-024](EVIDENCE-INDEX.md#e-024)) showed the application role is the `postgres` superuser and owns all 49 public tables. (Recorded in the Claude session log; **not** in the repository docs.)
- **Impact:** An application-level compromise could disable or bypass the append-only triggers that protect ledger, rule-version and staff-audit history, and could modify any table. Tenant isolation is enforced in application code, not by database roles.
- **Status:** Pre-public-launch hardening candidate. Mitigations already in place: private database network, no TCP proxy, parameterized queries, tested tenant isolation, backups.
- **Next:** Separate migration owner from a least-privilege runtime role ([O-040](OPEN-ITEMS.md#o-040)). Related: [X-006](#x-006).

<a id="r-002"></a>
## R-002 — PassFast is a temporary managed signer with no production adapter
- **Facts:** Synthetic proof of concept only; no adapter; no repository reference; DPA and Apple-compliance diligence **outstanding**; vendor is young, no SLA or status page, data region undisclosed; shared Pass Type ID means Apple could revoke it; installed managed passes cannot migrate to an own Pass Type ID; a voided pass remains on the phone (it showed under Wallet's "Expired" section, OWNER-REPORTED).
- **Impact:** If adopted prematurely, balances/tokens sit with a third party and updates can stop silently (quota exhaustion, revoked certificate).
- **Next:** [O-023](OPEN-ITEMS.md#o-023), [O-022](OPEN-ITEMS.md#o-022); kill criteria in [D-018](DECISIONS.md#d-018).

<a id="r-003"></a>
## R-003 — NFC cannot run in production and has no physical test
- **Facts:** No production `TapKeyProvider` (the only provider refuses `NODE_ENV=production`, so taps fail closed); no physical provisioning or phone-tap test; the provisioning CLI is **preview-only** (preview origin and the device-test database); tags provisioned for the preview origin cannot be reused; a failed attempt burns the tag UID and the repository has no recovery command; keys live in a development key file; no audit events exist for NFC policy or tag changes.
- **Impact:** None while NFC is unavailable in production; blocks any NFC pilot. `automatic_fixed` proves a fresh tag read, not a purchase ([D-022](DECISIONS.md#d-022)).
- **Next:** [O-030](OPEN-ITEMS.md#o-030)–[O-037](OPEN-ITEMS.md#o-037).

<a id="r-004"></a>
## R-004 — Most Oct 2026 evidence is ephemeral or local
- **Facts:** The proof for the Gate-1 completion, accepted risk, RC, cleanup and promotion lives in ignored `var/`, agent session stores (about 5 GB, no retention guarantee), `/tmp`, the owner's mailbox and provider consoles — not in Git. Some copies are only in `/tmp` (macOS may clear it) or in a worker container (lost on restart).
- **Impact:** The final dossier could lose its proof. **Next:** execute the [preservation plan](EVIDENCE-INDEX.md#preservation-plan) ([O-050](OPEN-ITEMS.md#o-050)).

<a id="r-005"></a>
## R-005 — Railway Hobby log and image retention
- **Facts:** Hobby keeps 7 days of logs and about 72 hours of removed images ([PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md)). Evidence from 2026-10-01 will age out of Railway by 2026-10-08 (local copies of key windows exist). Older web rollback targets may stop being redeployable ([RELEASES.md](RELEASES.md#web-rollback-lineage)).
- **Next:** Preserve key log windows now ([O-050](OPEN-ITEMS.md#o-050)); Pro extends retention (30 days, 120 hours; targets, not SLAs).

<a id="r-006"></a>
## R-006 — Historical refs exist only on one Mac
- **Facts:** `claude/owner-dashboard-v1` (`652d214`), `main` (`200cdb3`) and four `checkpoint/*` tags are **not on `origin`**; the dashboard worktree's git directory lives under the Desktop repository. The integration branch carries the same patches (patch IDs verified) under different SHAs, so the frozen SHA itself is verifiable only from the local object.
- **Next:** Push safe refs or create a bundle ([O-050](OPEN-ITEMS.md#o-050)).

<a id="r-007"></a>
## R-007 — Secret-bearing files under `var/` may replicate through iCloud Desktop
- **Facts:** Finder reports "Desktop & Documents in iCloud" is **on** (`FXICloudDriveDesktop = 1`, read 2026-10-01 ~22:2xZ; [E-035](EVIDENCE-INDEX.md#e-035)). `var/` holds tunnel tokens, environment files, an auth secret, R2 credentials, and the backup age identity/recipient (names only inspected, contents never opened). Whether `var/` is excluded from sync is **UNKNOWN**.
- **Impact:** Secrets may be replicated to iCloud and other devices. **Next:** owner decision to move or exclude them ([O-050](OPEN-ITEMS.md#o-050)). Do not put them in Git.

<a id="r-008"></a>
## R-008 — Custody of the backup decryption identity is unknown
- **Facts:** The age private identity used to decrypt R2 backups exists as a local file; no source states an offline copy. A Mac loss would make backups undecryptable.
- **Next:** [O-008](OPEN-ITEMS.md#o-008).

<a id="r-009"></a>
## R-009 — Operational dependence on one owner, one Mac, one inbox, one token, one account
- **Facts:** One Railway project token performs all deployments; one inbox receives all alerts; local tooling and evidence live on one Mac; one owner account holds Railway, Cloudflare and GitHub.
- **Next:** [O-044](OPEN-ITEMS.md#o-044), [O-009](OPEN-ITEMS.md#o-009).

<a id="r-010"></a>
## R-010 — No logout, password change or password reset
- **Facts:** No logout control in the dashboard; `git grep` finds no reset/change/sign-out code in `src` outside tests; sign-up is disabled so credentials are operator-set and handed over out of band.
- **Impact:** Shared-device hygiene and credential recovery for pilot users. **Next:** [O-003](OPEN-ITEMS.md#o-003), [O-004](OPEN-ITEMS.md#o-004), [O-005](OPEN-ITEMS.md#o-005).

<a id="r-011"></a>
## R-011 — Persistent card-URL bearer in request paths
- **Facts:** The customer card URL carries a persistent bearer token that can appear in browser history, proxies and provider logs; Wallet token routes carry bearers too. Recorded as pre-commercial hardening ([X-005](#x-005)).
- **Next:** Fragment-to-POST/session bootstrap ([O-042](OPEN-ITEMS.md#o-042)).

<a id="r-012"></a>
## R-012 — Agent-harness credential name appeared in a command's output (reported and inspected 2026-09-29 19:52Z)
- **Facts:** A Claude command printed a process listing that exposed the **name** of a Claude Code harness variable. It is not a Loynara credential. Claude did not use, print or hash the value and treated it as a secret ([E-009](EVIDENCE-INDEX.md#e-009)).
- **Lesson:** Avoid commands that print process environments. No Loynara secret exposure is known from this event.

<a id="r-013"></a>
## R-013 — No customer recovery path on the production origin
- **Facts:** All external-e-mail flags are false in production; recovery and verification e-mail were proven only on the device-test origin. A customer who loses the private card URL cannot recover on production.
- **Next:** [O-006](OPEN-ITEMS.md#o-006).

<a id="r-014"></a>
## R-014 — Repository documents are stale or contradictory after 2026-09-30
- **Facts:** `V1_RELEASE_GATES`, `PRODUCTION_RELEASE_TEST`, `FEATURE_STATUS`, `LAUNCH_BLOCKERS` stop at Sept 30; `README` and `ARCHITECTURE` still say "LoopLocal" and "no public deployment"; `EXTERNAL_EMAIL_TEST` says Gate 5 NOT_IMPLEMENTED; `PRODUCTION_DEPLOYMENT` calls the root an "existing marketing site" while the apex has no web record. The ledger preserves them unchanged and supersedes them by statement ([O-051](OPEN-ITEMS.md#o-051)).

<a id="r-015"></a>
## R-015 — "Pilot-ready" could be mistaken for "frozen-V1 PASS"
- **Facts:** The frozen gates require Wallet and NFC; the owner's pilot scope amendment ([D-024](DECISIONS.md#d-024)) does not amend them. **Next:** a recorded decision ([O-018](OPEN-ITEMS.md#o-018)); this ledger keeps the terms separate ([STATE.md](STATE.md#5-pilot-versus-public-launch-they-are-different)).

<a id="r-016"></a>
## R-016 — Public audit copy contains placeholders and is live
- **Facts:** `loynara-audit.pages.dev` returned HTTP 200 on 2026-10-01 ([E-035](EVIDENCE-INDEX.md#e-035)); it is `noindex`, labelled as an audit copy, and shows unapproved prices and a disabled contact form. It must not be reused as the root site.
- **Next:** Decide retention or unpublish ([O-014](OPEN-ITEMS.md#o-014)).

<a id="r-017"></a>
## R-017 — Single points of failure in production
- **Facts:** One replica per service, no standby database, Hobby (no contractual SLA), single region, one tunnel connector.
- **Context:** Acceptable for a supervised pilot; revisit before commercial go-live ([O-017](OPEN-ITEMS.md#o-017)).
