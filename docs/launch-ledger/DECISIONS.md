# DECISIONS

Stable decision records (`D-###`). IDs are never reused. A superseded decision keeps its entry and gains a `Superseded by` line.

**Two fields per decision.**
- **State** — `DECIDED` (an owner or agreed decision exists), `OPEN` (not decided), `PROPOSED` (recommended, not adopted).
- **Status** — evidence/implementation status from the [README vocabulary](README.md#status-vocabulary).

Decisions marked *owner statement* were made in chat; the only record is the task text preserved in the agent session logs (Tier 3 for
anything beyond the words themselves). Evidence IDs point to [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md).

| Index | | | |
|---|---|---|---|
| Product | [D-001](DECISIONS.md#d-001), [D-002](DECISIONS.md#d-002), [D-003](DECISIONS.md#d-003), [D-004](DECISIONS.md#d-004), [D-005](DECISIONS.md#d-005), [D-006](DECISIONS.md#d-006) | Environments and operations | [D-007](DECISIONS.md#d-007), [D-008](DECISIONS.md#d-008), [D-009](DECISIONS.md#d-009), [D-010](DECISIONS.md#d-010), [D-011](DECISIONS.md#d-011), [D-012](DECISIONS.md#d-012), [D-013](DECISIONS.md#d-013), [D-014](DECISIONS.md#d-014) |
| Delivery | [D-015](DECISIONS.md#d-015), [D-016](DECISIONS.md#d-016), [D-017](DECISIONS.md#d-017) | Wallet | [D-018](DECISIONS.md#d-018), [D-019](DECISIONS.md#d-019), [D-020](DECISIONS.md#d-020) |
| NFC | [D-021](DECISIONS.md#d-021), [D-022](DECISIONS.md#d-022), [D-023](DECISIONS.md#d-023), [D-028](DECISIONS.md#d-028), [D-029](DECISIONS.md#d-029) | Scope and process | [D-024](DECISIONS.md#d-024), [D-025](DECISIONS.md#d-025), [D-026](DECISIONS.md#d-026), [D-027](DECISIONS.md#d-027) |

---

## Product

<a id="d-001"></a>
### D-001 — Fidelix functional-parity direction
- **Date:** 2026-09-25 12:57Z (master prompt); widened 19:11Z. **State:** DECIDED. **Status:** IMPLEMENTED (local, synthetic); features TESTED; **no parity claim is verified**.
- **Why:** The reference product defines the category merchants will compare against; the owner wanted comparable function with better checkout usability, operational transparency and data controls.
- **Alternatives:** A browser stamp card only (rejected at 19:11Z: "not merely a browser stamp card"); a market-validation exercise first (the owner explicitly declined: "Product development is authorised").
- **Evidence:** [E-011](EVIDENCE-INDEX.md#e-011), [E-005](EVIDENCE-INDEX.md#e-005); [PARITY_MATRIX.md](../../PARITY_MATRIX.md) states it is an inventory of Loynara's implementation, not a Fidelix parity score.
- **Reversible:** Yes (scope). **Pivot trigger:** pilot shows most modules unused; effort exceeds value.

<a id="d-002"></a>
### D-002 — Merchant-branded premium experience
- **Date:** 2026-09-25 18:28Z; reinforced 2026-09-27 ("fluid and premium, like Fidelix and better"). **State:** DECIDED. **Status:** IMPLEMENTED, TESTED.
- **Why:** The merchant's identity should dominate the customer card and counter sign; Loynara is secondary attribution. Premium feel supports the sales story.
- **Alternatives:** Loynara-branded card. **Limits found later:** the Apple pass generator renders white text and ignores the logo; Google needs a PNG and an approved asset origin ([E-004](EVIDENCE-INDEX.md#e-004)).
- **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-004](EVIDENCE-INDEX.md#e-004), [E-001](EVIDENCE-INDEX.md#e-001). **Reversible:** Yes. **Pivot trigger:** pilot usability findings; provider branding rules.

<a id="d-003"></a>
### D-003 — Browser/QR is the canonical baseline
- **Date:** 2026-09-25; reaffirmed in the v1 gates (2026-09-27). **State:** DECIDED. **Status:** DEPLOYED (production release `c87f2b50`); owner-reported physical scans; real two-phone production checkout **not run**.
- **Why:** Needs no provider, hardware or paid account; a cashier scans a random scan code, the server reads the balance. The browser card works without Wallet; NFC keeps QR as fallback.
- **Alternatives:** Wallet-first; NFC-first.
- **Evidence:** [LAUNCH_BLOCKERS.md](../../LAUNCH_BLOCKERS.md), [V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md) Gate 3, [T-041](TEST-EVIDENCE.md#t-041), [T-080](TEST-EVIDENCE.md#t-080).
- **Reversible:** No in practice (design base). **Pivot trigger:** two-phone counter checkout proves too slow or unreliable ([O-007](OPEN-ITEMS.md#o-007)).

<a id="d-004"></a>
### D-004 — Wallet is a projection, never the canonical ledger
- **Date:** from the first architecture; restated 2026-09-30 23:01Z. **State:** DECIDED. **Status:** IMPLEMENTED (outbox `wallet.refresh`, fixtures TESTED); providers disabled in production.
- **Why:** Balances must reconcile from PostgreSQL; a wallet outage must never undo a committed loyalty transaction. A third-party signer "must not become the ledger/database".
- **Evidence:** [ARCHITECTURE.md](../../ARCHITECTURE.md) ("Wallet balances remain display copies"), [E-005](EVIDENCE-INDEX.md#e-005). **Alternatives:** provider-held balances (rejected).
- **Reversible:** No. **Pivot trigger:** none.

<a id="d-005"></a>
### D-005 — Rename LoopLocal → Loynara
- **Date:** approved 2026-09-26 14:06Z ("PUBLIC BRAND: Loynara", domain `getloynara.com` owner-controlled); implemented 22:34Z (`f80a054`). **State:** DECIDED. **Status:** IMPLEMENTED.
- **Why:** Brand and domain for the sales site and app origin. The master prompt called LoopLocal "a changeable internal name, not a trademark or domain-clearance claim".
- **Notes:** Internal names (`looplocal_*` databases/users, `LOOPLOCAL_*` env) were left unchanged. **No trademark or name-clearance record exists in any source (UNKNOWN).**
- **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-001](EVIDENCE-INDEX.md#e-001). **Reversible:** Yes. **Pivot trigger:** a name-clearance objection.

<a id="d-006"></a>
### D-006 — v1 scope frozen to eight release gates
- **Date:** 2026-09-27 02:39Z (`b2c2ef1`). **State:** DECIDED. **Status:** IMPLEMENTED (document).
- **Why:** Stop scope drift: "no commercial sales until all eight gates are PASS"; new ideas go to POST_V1 unless they fix a security, legal, transaction-integrity or severe-usability defect.
- **Gates:** 1 production infrastructure; 2 real Apple/Google Wallet; 3 secure NFC; 4 loyalty/rewards/referrals; 5 real campaign delivery; 6 customer recovery; 7 billing and operator/legal; 8 public site and golden path.
- **Evidence:** [V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md), [POST_V1.md](../../POST_V1.md). **Reversible:** Yes, by a recorded amendment (see [D-024](DECISIONS.md#d-024), [O-018](OPEN-ITEMS.md#o-018)).

---

## Environments and operations

<a id="d-007"></a>
### D-007 — Protected device-test environment before any public exposure
- **Date:** 2026-09-26 14:06Z. **State:** DECIDED. **Status:** DEPLOYED (device-test; Mac-hosted; non-production).
- **Why:** Real-device testing with synthetic data, no public exposure: separate database, Cloudflare Access (exact-email policy), named tunnel, origin JWT validation, sensitive-path log suppression.
- **Alternatives (explicitly forbidden):** quick tunnel, public unprotected route, LAN exposure, insecure browser flags.
- **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005), [E-002](EVIDENCE-INDEX.md#e-002) (TEST_EVIDENCE). **Reversible:** Yes. **Pivot trigger:** the Mac dependency; superseded for real pilots by the production origin ([D-008](DECISIONS.md#d-008)).

<a id="d-008"></a>
### D-008 — Hosting architecture: Railway Hobby (Stage A), Pro before the first paying merchant; Cloudflare Tunnel ingress
- **Date:** 2026-09-28 20:47Z → 2026-09-29. **State:** DECIDED. **Status:** DEPLOYED.
- **Decision:** Railway Hobby in EU West (Amsterdam) for web, worker, migrate, PostgreSQL, ops and backup crons and a `cloudflared` connector; limits $10 warning / $16 hard / $0 Agent accepted by the owner (they do not cap taxes or every invoice item; the hard limit takes services offline). Upgrade to **Pro** (and add native backups) before the first paying merchant. Browser traffic enters through a Cloudflare Tunnel to a private web listener; no public Railway domain or database TCP proxy.
- **Why tunnel:** Railway's public HTTP edge logs request paths, which carry bearer card tokens; the tunnel avoids that surface.
- **Alternatives:** Pro from the start (first recommended 2026-09-28 20:48Z, then Hobby RC chosen after the cost discussion); direct Cloudflare CNAME to Railway (rejected for URI logging).
- **Evidence:** [PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md), [RAILWAY_GO_LIVE_UPGRADE.md](../../RAILWAY_GO_LIVE_UPGRADE.md), [E-012](EVIDENCE-INDEX.md#e-012). **Reversible:** Yes (portable Dockerfiles; dump/restore).
- **Pivot trigger:** compute nearing the $16 limit; availability needs; first paying merchant ([O-017](OPEN-ITEMS.md#o-017)).

<a id="d-009"></a>
### D-009 — Stage-A backups: age-encrypted R2 dumps instead of native Railway backups
- **Date:** 2026-09-29 20:12–20:53Z. **State:** DECIDED (owner amendment). **Status:** DEPLOYED. See [X-002](RISKS-AND-EXCEPTIONS.md#x-002).
- **Why:** On Hobby the PostgreSQL Backups tab requires Pro (screenshot preserved, [E-016](EVIDENCE-INDEX.md#e-016)). The owner required instead: automated age-encrypted logical dump to a private EU R2 bucket, 14-day retention, backup-age monitoring, separate decryption identity, and a real isolated restore. Native backups plus a native restore test remain **mandatory before commercial go-live**.
- **Alternatives:** Pay for Pro early; run without backups (rejected).
- **Evidence:** [V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md) amendment, [E-016](EVIDENCE-INDEX.md#e-016), [E-012](EVIDENCE-INDEX.md#e-012). **Reversible:** Yes. **Pivot trigger:** first paying merchant; a populated restore drill fails ([O-017](OPEN-ITEMS.md#o-017)).

<a id="d-010"></a>
### D-010 — Exact-commit deployments while the tracked branch stays `railway-rc`
- **Date:** 2026-10-01 13:37Z; used for the first RC, the revised RC and the official promotion. **State:** DECIDED. **Status:** DEPLOYED.
- **Decision:** Deploy a named commit with `serviceInstanceDeployV2(serviceId, environmentId, commitSha)` (live schema and Railway documentation checked first). Each deployment records the intent before the single mutation, no retries, and a deployment-count verification.
- **Why:** Deploy exactly the reviewed SHA, keep rollback available, and avoid moving the tracked branch before verification ("do not merge into railway-rc yet").
- **Alternatives:** Merge to `railway-rc` first; source upload via CLI (failed earlier with a TLS `BadRecordMac`); enable auto-deploy.
- **Evidence:** [E-019](EVIDENCE-INDEX.md#e-019), [E-030](EVIDENCE-INDEX.md#e-030), [E-031](EVIDENCE-INDEX.md#e-031). **Reversible:** Yes (rollback IDs in [REL-012](RELEASES.md#rel-012)). **Pivot trigger:** Railway changes the API; owner prefers CD.

<a id="d-011"></a>
### D-011 — Manual Railway deployment policy (auto-deploy disabled)
- **Date:** 2026-09-29 (worker auto-deploy disabled 16:28Z; others per docs); confirmed 2026-10-01 22:21Z. **State:** DECIDED. **Status:** DEPLOYED.
- **Decision:** GitHub auto-deploy is **disabled** for web, worker, migrate, ops and backup (`canEnable: true`); every production deployment is a single, explicit, owner-approved action. A branch push deploys nothing. During promotion the owner gave a separate action-time approval ("Approve one web deployment").
- **Why:** A push must never silently change production; support the owner's change-control expectation after the unexplained redeploy ([X-001](RISKS-AND-EXCEPTIONS.md#x-001)).
- **Evidence:** [E-031](EVIDENCE-INDEX.md#e-031) (autodeploy snapshot), [E-019](EVIDENCE-INDEX.md#e-019), [PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md). **Reversible:** Yes. **Pivot trigger:** owner authorizes a gated CD pipeline.

<a id="d-012"></a>
### D-012 — Cloudflare Browser Integrity Check stays enabled
- **Date:** 2026-10-01 13:03–13:37Z. **State:** DECIDED. **Status:** VERIFIED.
- **Why:** The first RC attempt stopped on HTTP 403 / error 1010; the cause was the default `Python-urllib` user agent, not an outage. Zone-wide Browser Integrity Check is doing its job; Bot Fight Mode is off and there are no custom rules.
- **Rule:** Operator and monitoring clients must send an explicit user agent (`Loynara-Deployment/1.0` is used); a 403 is looked up by Ray ID before it is called an outage.
- **Evidence:** [E-021](EVIDENCE-INDEX.md#e-021), [E-018](EVIDENCE-INDEX.md#e-018). **Alternatives:** relax or bypass the check (rejected). **Reversible:** Yes. **Pivot trigger:** a legitimate integration cannot send a user agent.

<a id="d-013"></a>
### D-013 — Public root is separate from Gate-1 operations
- **Date:** 2026-10-01 (~09:51–10:43Z; restated 11:18Z). **State:** DECIDED. **Status:** VERIFIED (the split is recorded; root still unpublished).
- **Why:** Operations readiness (Railway, backups, alerts) should not wait on legal/operator inputs for the marketing root. Gate 1 *as frozen* includes the public root, so the split is a **scoping decision, not a gate amendment**.
- **Evidence:** [E-012](EVIDENCE-INDEX.md#e-012) (row 28: public root FAIL, separate scope), [E-006](EVIDENCE-INDEX.md#e-006). **Reversible:** Yes. **Related:** [O-014](OPEN-ITEMS.md#o-014), [O-018](OPEN-ITEMS.md#o-018).

<a id="d-014"></a>
### D-014 — Historical unexplained Railway redeploy accepted as a contained risk
- **Date:** 2026-10-01 10:05–10:16Z. **State:** DECIDED (owner-authorized containment; acceptance recorded 10:16:18Z). **Status:** ACCEPTED-RISK. See [X-001](RISKS-AND-EXCEPTIONS.md#x-001).
- **Decision:** The 08:30:50.904Z ops redeploy remains **UNKNOWN in provenance**. It is neither explained nor retro-accepted. The *current* ops baseline was re-established by a deliberate, attributable owner-authorized redeploy (`56bb5199`) after the owner reviewed Railway authorized apps/tokens (attestation).
- **Alternatives not taken (author's framing, Tier 4):** block Gate 1 until Railway supplies request provenance; roll back ops; recreate the service. None became necessary once no source, configuration or variable drift was found.
- **Evidence:** [E-013](EVIDENCE-INDEX.md#e-013), [E-012](EVIDENCE-INDEX.md#e-012), [E-014](EVIDENCE-INDEX.md#e-014). **Reversible:** Yes (reopen).
- **Pivot trigger:** another unattributed deployment or configuration change; Railway supplies attribution; any evidence of token compromise; a change to ops source/variables not matching an authorized action.

---

## Delivery

<a id="d-015"></a>
### D-015 — Owner dashboard built isolated, frozen, then integrated in order
- **Date:** isolation 2026-09-30 09:25Z/12:28Z; frozen 14:17:39Z; integration approved 2026-10-01 11:18Z after Gate-1 infrastructure completion. **State:** DECIDED. **Status:** DEPLOYED (release `c87f2b50`).
- **Decision:** Claude built the dashboard in a separate worktree/branch (`claude/owner-dashboard-v1`) touching presentation only, froze it at `652d214`; Codex later cherry-picked the 17 commits in the order A→B→C→D (not squashed or merged; patch IDs verified) onto the accepted baseline `a96fc12`, with a small authorized onboarding bridge (identity-only provisioning, idempotent completed retry, German setup/access errors).
- **Why:** Avoid collisions with Gate-1 work in shared files and avoid destabilizing the release branch; keep each slice testable.
- **Alternatives not taken (author's framing, Tier 4):** build directly on the release branch; merge or squash (the integration plan says "cherry-pick in this order, do not squash"). Canonical invite-gated sign-up was **not** built (see [O-043](OPEN-ITEMS.md#o-043)).
- **Evidence:** [E-003](EVIDENCE-INDEX.md#e-003), [E-004](EVIDENCE-INDEX.md#e-004), [E-017](EVIDENCE-INDEX.md#e-017), [E-007](EVIDENCE-INDEX.md#e-007). **Reversible:** Yes (revert; redeploy previous image).
- **Pivot trigger:** a P0/P1 after promotion.

<a id="d-016"></a>
### D-016 — Synthetic production verification strategy
- **Date:** 2026-10-01 13:37–14:51Z. **State:** DECIDED. **Status:** VERIFIED (executed; [TL-050](TIMELINE.md#tl-050)).
- **Decision:** Verify the RC on the real production origin with clearly synthetic tenants. Four identity-only auth users are created by Codex through the approved private operator mechanism; the **owner types the passwords** (Claude does not enter passwords on production, even when asked); public registration, e-mail, billing and Wallet stay off; every artifact is recorded in a manifest; **Claude does not perform cleanup**.
- **Why:** The behavior of interest (HTTPS origin, cookies, tunnel, real database) cannot be proven locally; Claude's safety boundary forbids creating or deleting production identities.
- **Alternatives not taken (author's framing, Tier 4):** local-only verification (cannot prove the real origin, cookies and tunnel); Claude creating identities itself (blocked by its safety boundary).
- **Evidence:** [E-020](EVIDENCE-INDEX.md#e-020), [E-022](EVIDENCE-INDEX.md#e-022). **Reversible:** n/a. **Pivot trigger:** any non-synthetic data appears.

<a id="d-017"></a>
### D-017 — Synthetic-cleanup exception: ID-scoped hard delete with a three-trigger temporary bypass
- **Date:** approved 2026-10-01 19:59Z; corrected 21:07Z. **State:** DECIDED. **Status:** VERIFIED (committed 21:14:35.632Z). See [X-006](RISKS-AND-EXCEPTIONS.md#x-006).
- **Decision:** In **one** PostgreSQL transaction, disable and re-enable only `ledger_append_only`, `program_rule_versions_append_only` and `staff_audit_append_only` to delete only the exactly identified synthetic rows. **Not allowed:** `session_replication_role`, disabling FKs, other triggers, the `purchase_awards` trigger, deleting provider events or general rate limits, schema change. A forced-rollback rehearsal precedes the commit; scripts differ only in the disposition constant.
- **Correction (21:07Z):** the first commit attempt failed in a read-only precondition that wrongly treated the volatile `rate_limits` table as immutable; only that equality (and its postcondition) was excluded, everything else unchanged.
- **Alternatives:** Leave/mark/archive (the data model has no tenant/location archive or synthetic flag); restore a backup (no approved mechanism; would risk data written after the backup).
- **Evidence:** [E-024](EVIDENCE-INDEX.md#e-024), [E-025](EVIDENCE-INDEX.md#e-025), [E-026](EVIDENCE-INDEX.md#e-026), [E-027](EVIDENCE-INDEX.md#e-027), [E-028](EVIDENCE-INDEX.md#e-028). **Reversible:** **No** (hard delete, synthetic only).
- **Pivot trigger / limit:** this mechanism must **not** be reused for real merchant data without a new explicit approval.

---

## Wallet

<a id="d-018"></a>
### D-018 — Temporary managed-signing Apple bridge: investigate and prove with PassFast
- **Date:** research 2026-09-30 22:21Z; PoC directed 23:01Z. **State:** DECIDED (investigation and PoC); adoption **not** decided. **Status:** TESTED (PoC; provider side VERIFIED, device side OWNER-REPORTED). No Loynara adapter exists.
- **Why:** The owner reports being unable to complete Apple Developer Program enrollment (OWNER-REPORTED; reason UNKNOWN), and a native Apple pass needs that account. Managed-signing providers sign with their own Pass Type ID.
- **Alternatives:** WalletWallet (better privacy evidence, but server-generated serials and no external ID); skip Apple at launch; native enrollment. Claude's verdict was **CAUTION** — a flag-gated, pilot-only bridge at most; no-go for multiple merchants or scale until vendor answers (written Apple-compliance confirmation, signed DPA, quota/price, post-closure behavior) arrive.
- **Evidence:** [E-032](EVIDENCE-INDEX.md#e-032), [E-033](EVIDENCE-INDEX.md#e-033), [E-034](EVIDENCE-INDEX.md#e-034); [T-062](TEST-EVIDENCE.md#t-062), [T-063](TEST-EVIDENCE.md#t-063). **Reversible:** Yes.
- **Pivot trigger:** vendor cannot confirm Apple compliance or sign a DPA; install/update/void fails on a device; price or quota change; the owner obtains an Apple account.

<a id="d-019"></a>
### D-019 — Later migration to the owner's own Apple account
- **Date:** research 2026-09-30; direction restated by the owner 2026-10-01. **State:** DECIDED (direction only). **Status:** PLANNED.
- **Why:** A managed pass is tied to the provider's Pass Type ID and **cannot** move to another one. Migration means issuing native passes, notifying and then voiding the old ones while the vendor account stays active.
- **Evidence:** [E-032](EVIDENCE-INDEX.md#e-032) (WalletWallet/PassFast research §6). **Reversible:** Yes. **Pivot trigger:** Apple account available; vendor risk materializes.

<a id="d-020"></a>
### D-020 — Which Wallet provider goes first (Google vs Apple)
- **State:** **OPEN.** **Status:** UNKNOWN. No owner decision is recorded; Claude proposed Google Demo Mode first (no paid enrollment) and listed it as an open decision on 2026-09-30.
- **Evidence:** [E-032](EVIDENCE-INDEX.md#e-032). See [O-020](OPEN-ITEMS.md#o-020).

---

## NFC

<a id="d-021"></a>
### D-021 — NTAG 424 DNA with SUN/SDM for secure taps
- **Date:** frozen in the gates 2026-09-27; software 2026-09-27 03:07Z. **State:** DECIDED. **Status:** IMPLEMENTED, TESTED (vectors, mocks, synthetic DB); physical **NOT RUN**.
- **Why:** AES-128 authenticated, counter-bearing dynamic URL; keys cannot be extracted to clone a tag. Passive tags, Apple VAS and Google Smart Tap are not the same and are post-v1; none of them may ever award.
- **Alternatives:** Passive NDEF tags (never award); VAS/Smart Tap (need terminals and entitlements).
- **Evidence:** [V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md) Gate 3, [PHYSICAL_NFC_TEST.md](../../PHYSICAL_NFC_TEST.md), [E-001](EVIDENCE-INDEX.md#e-001). **Reversible:** Yes.
- **Pivot trigger:** reader/tag incompatibility; Android support problems; key-custody cost.

<a id="d-022"></a>
### D-022 — `staff_confirmed` is the NFC default and the first pilot's only mode
- **Date:** recommended 2026-09-30 20:49Z; owner statement 21:52Z. **State:** DECIDED. **Status:** PLANNED — enforcement is **not** implemented: the production dashboard still lets an owner select "Automatisch" (a P3, inert today because no keys/tags exist; [X-009](RISKS-AND-EXCEPTIONS.md#x-009)).
- **Why:** `automatic_fixed` proves a fresh read of a genuine tag, not a purchase; reads can be harvested and submitted later; no actor audit exists for policy changes.
- **Alternatives:** keep automatic as-is; explicit opt-in; force staff confirmation (chosen); remove automatic awards.
- **Evidence:** [E-032](EVIDENCE-INDEX.md#e-032), [E-034](EVIDENCE-INDEX.md#e-034); [E-022](EVIDENCE-INDEX.md#e-022) (P3). **Reversible:** Yes. **Pivot trigger:** guardrails ([D-023](DECISIONS.md#d-023)) and physical tests complete.

<a id="d-023"></a>
### D-023 — `automatic_fixed` remains disabled; a guarded opt-in is a future option
- **Date:** owner statement 2026-09-30 21:52Z. **State:** DECIDED (stay disabled). **Status:** PLANNED.
- **Guardrails proposed:** recorded owner acknowledgement, minimum cooldown floor, per-tag daily cap, hold on large counter jumps, audit of policy/tag changes, separate analytics category.
- **Evidence:** [E-032](EVIDENCE-INDEX.md#e-032), [E-034](EVIDENCE-INDEX.md#e-034). **Reversible:** Yes. See [O-035](OPEN-ITEMS.md#o-035).

<a id="d-028"></a>
### D-028 — NFC tags: ten NTAG 424 DNA 28×28 mm on-metal
- **Date:** order mentioned 2026-09-30 21:52Z; purchase reported by the owner. **State:** DECIDED. **Status:** OWNER-REPORTED.
- **Why:** For physical development/testing and possibly the same SKU for merchant deployments. Supplier, quantity beyond ten, cost, delivery and serial numbers: **UNKNOWN** (deliberately not recorded).
- **Constraint:** Tags provisioned for the preview origin cannot be reused for production; a failed provisioning attempt burns the tag UID in the database ([E-032](EVIDENCE-INDEX.md#e-032)). Budget tags accordingly.
- **Evidence:** [E-034](EVIDENCE-INDEX.md#e-034). **Reversible:** No (purchase). **Pivot trigger:** RF performance on metal fails.

<a id="d-029"></a>
### D-029 — NFC reader: REINER SCT cyberJack RFID basis
- **Date:** not recorded (reported 2026-10-02). **State:** DECIDED. **Status:** OWNER-REPORTED.
- **Why / notes:** Compatibility is *expected* from the generic PC/SC architecture (the CLI uses transparent ISO-DEP APDUs through the OS PC/SC library and no reader-specific commands); **not** physically verified. Earlier candidates (Identiv uTrust 3700 F "most likely" on 2026-09-30; ACS ACR1252U in the docs) are superseded by this purchase. The Mac saw zero readers on 2026-09-30.
- **Evidence:** [E-034](EVIDENCE-INDEX.md#e-034), [E-032](EVIDENCE-INDEX.md#e-032). **Reversible:** Yes. See [O-030](OPEN-ITEMS.md#o-030).

---

## Scope and process

<a id="d-024"></a>
### D-024 — FIRST-MERCHANT PILOT SCOPE AMENDMENT
- **Date:** owner statements 2026-10-01 22:12Z and 22:36Z. **State:** DECIDED. **Status:** OWNER-REPORTED (recorded only in task text; no signed gate amendment exists).
- **Meaning:**
  - Browser/QR loyalty may pilot first.
  - Wallet and secure NFC may proceed in parallel or later and do **not** block the first real merchant pilot.
  - This does **not** automatically redefine what "full frozen V1" means. The eight frozen gates, including Gates 2 and 3, are **unchanged** in [V1_RELEASE_GATES.md](../../V1_RELEASE_GATES.md).
  - A formal V1 gate amendment remains an **open decision** if one is wanted ([O-018](OPEN-ITEMS.md#o-018)).
- **Why:** The first pilot needs no Wallet or NFC (the browser card is the base, [D-003](DECISIONS.md#d-003)), and Apple enrollment and NFC hardware have long external lead times.
- **Evidence:** [E-034](EVIDENCE-INDEX.md#e-034), [E-032](EVIDENCE-INDEX.md#e-032) (Claude's pilot assessment: QR checkout, no automatic NFC). **Reversible:** Yes.
- **Pivot trigger:** the pilot merchant requires Wallet/NFC; Apple/Google/NFC lead times resolve.

<a id="d-025"></a>
### D-025 — Billing route and pricing
- **State:** **OPEN.** **Status:** UNKNOWN.
- **Record:** The gates recommend a real manual-invoice route; the billing schema is fixture-only (a real manual invoice needs a migration and an auditable activation/cancellation path). Pricing in the sales sheet (€69 per location per month standard, €49 founding, €99 assisted setup) is a **proposal**, not approved; a "€99 including month one" package is a private draft; VAT/invoice treatment needs adviser input.
- **Evidence:** [LAUNCH_BLOCKERS.md](../../LAUNCH_BLOCKERS.md), [E-032](EVIDENCE-INDEX.md#e-032). See [O-011](OPEN-ITEMS.md#o-011), [O-012](OPEN-ITEMS.md#o-012).

<a id="d-026"></a>
### D-026 — Independent Claude review before security-sensitive Gate-1 changes ship
- **Date:** from 2026-09-29. **State:** DECIDED (practice). **Status:** VERIFIED (used for `0946c81`, `e94fd5c`, the backup-monitor diff; one review INCONCLUSIVE).
- **Why:** A second agent reviews bounded diffs read-only before they are pushed or deployed (on 2026-09-29 21:13Z the owner withheld the backup-monitor source push because Claude was independently reviewing that exact local diff).
- **Evidence:** [TL-021](TIMELINE.md#tl-021), [TL-024](TIMELINE.md#tl-024), [TL-026](TIMELINE.md#tl-026), [E-009](EVIDENCE-INDEX.md#e-009), [E-005](EVIDENCE-INDEX.md#e-005). **Reversible:** Yes. **Pivot trigger:** review tooling failures (as on 2026-09-30 07:05Z).

<a id="d-027"></a>
### D-027 — Agent roles and handoff protocol
- **Date:** from 2026-09-29. **State:** DECIDED (practice). **Status:** VERIFIED (observed throughout).
- **Rules observed:** Codex executes infrastructure and release work under explicit, scoped owner approvals (each deployment single-shot, with intent recorded first); Claude reviews, plans, verifies and is read-only by default; the owner types production passwords; Claude never performs production cleanup; every task ends with a FINAL HANDOFF RECORD (workstream, agent, model, start/end state, changes, evidence, open items); local evidence is stored with SHA-256 manifests.
- **Evidence:** [E-005](EVIDENCE-INDEX.md#e-005)–[E-007](EVIDENCE-INDEX.md#e-007), [E-009](EVIDENCE-INDEX.md#e-009), [E-028](EVIDENCE-INDEX.md#e-028). **Reversible:** Yes.
