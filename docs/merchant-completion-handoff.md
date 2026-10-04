# Merchant-completion handoff (Tapja benchmark → Loynara)

> **Superseded in part (hardening review, see [merchant-completion-hardening.md](merchant-completion-hardening.md)).**
> Statements below that were written before the review and are no longer true:
> - Card numbers are **not** sequential (`K-0007`, tenant counter). The final design is a random six-character locator `K-XXXXXX`; the migration is now `0019_card_locators.sql` (the file `0019_card_numbers.sql` never existed outside this branch).
> - Lookup by `7`, `#7`, `Nr. 7` is gone. A typed locator shows a minimal preview first and opens the card only on a second, deliberate step.
> - Reissue now needs an explicit *Berechtigung geprüft* confirmation, a verification method and a retry key; it also revokes Apple Wallet registrations.
> - The "enumerable at the counter" risk is replaced by the locator analysis in the hardening record.
> - Rollback is now a tested script: `docs/rollback/0019-card-locators-down.sql`.
> - The "pre-existing red test `logout.spec.ts:133`" was diagnosed and fixed (login form hydration), see the hardening record.
> - Test counts and SHAs here describe `b7b9298`, not the hardened candidate.


Companion: [tapja-delta-register.md](tapja-delta-register.md) (evidence, decisions, priorities).

## Run record

| Field | Value |
|---|---|
| Agent | Claude Code session, model Claude Opus 5.5 (`claude-opus-5-5`). Requested effort: not evidenced. |
| UTC | Product worktree created 2026-10-04T12:49:31Z (Tapja reading started a few minutes earlier). Handoff written ≈2026-10-04T14:00Z. |
| Baseline | `70ecc72349f213f45ead25e6889ab55222fb95aa` (`feature/nfc-v1`). Its only parent chain above the official release `5c580be` is pilot RC `65f32fdbf58b2775bdd6b3ad5e2a0783508a93ae` (`pilot/hygiene-v1`), then NFC. `pilot/logout` (`5b86079`) and `pilot/hygiene-claude` (`38f9034`) are already contained as patch-equivalent commits (`git cherry` shows `-`). |
| Candidate | branch `product/merchant-completion` @ `52d61b8780c76c385fc362446d90f2d2139a867a`. **Local only, not pushed.** |
| Worktree | `~/Developer/Loynara-product` |
| Local resources | Postgres `loynara-product-pg` (127.0.0.1:54391; DBs `looplocal` and `looplocal_test`), Mailpit `loynara-product-mailpit` (1027/8027), Next dev on 3020 (temporarily 3000 for e2e). Synthetic `.env`/`.env.local`/`var/` are gitignored. Shared DBs on 54329/54390 were never touched. |
| Approvals used | None beyond the brief's local-implementation authority. No push, merge, deployment, migration on a remote, flags, provider, payment, hardware or real-account action. Tapja: read-only. |

### Commits (oldest first)

| SHA | Slice |
|---|---|
| `69d29cc5970ed96498fc0396f7130f1df8d15f3f` | Counter: card numbers (migration 0019), lookup by number, staff corrections UI, staff-assisted reissue |
| `91066b6b74911e02b6547febc69348174e73c1d1` | Activation: state-derived start readiness |
| `430fa6ea4eb5d0c5a42ca32e28449b160af54510` | Messaging: quiet hours 21–09 location-local, defer-not-drop |
| `799f47098f5d14c408507019027a6657a69dd68c` | Staff: invite-gated sign-up behind `STAFF_INVITE_SIGNUP_ENABLED` (default off) |
| `42be885347e1a959298626a18d35dbc0c5c64c3c` | Export format 4: card numbers + card security events |
| `1e6218bdbb7c68c32175a27e75693a2d724dcc6b` | e2e specs follow the new label, card number and readiness |
| `52d61b8780c76c385fc362446d90f2d2139a867a` | Card-number contrast |

## What a merchant can now do that they could not at the baseline

Measured against the same Loynara baseline, on the same local stack:

| Task | Baseline | Candidate | Evidence |
|---|---|---|---|
| Find a card at the counter when the QR won't scan | Type `sc_` + 32 characters | Type `7` (or `K-0007`, `#7`, `Nr. 7`); a warning appears before redeeming a card found by number | browser run `.review/slice12.mjs`; `card-number.integration.test.ts` |
| Fix a cashier mistake | No UI (API only) | Customers → card → *Korrigieren* → reason → booked as a linked entry; balance, history, analytics and referral reconcile | `card-reissue.integration.test.ts`; screenshots `.review/slice12/05–07` |
| Help a customer who lost the card link | Only e-mail self-recovery, which is disabled in production | Owner/manager: *Karte neu ausstellen* → reason + entitlement confirmation → one-time QR; old link and QR invalid; balance and number kept | same test; `.review/slice12/08–09` |
| Know what is left before day one | 4-step list, gone after the first card; seed and referral credits counted as tested | Server-derived *Startklar* with "Pflicht" marks, one next step with its reason, outside-Loynara items, kept until real evidence exists | `readiness.integration.test.ts`; `.review/slice3/*` |
| Give a cashier their own access | Operator must provision the account | (flag on) Cashier opens the invite link, creates an account for the invited address, lands at the counter | `invite-signup.integration.test.ts`; `.review/slice5/01–04` |
| Avoid night-time promotional mail | No quiet hours; UTC caps | No sends 21:00–09:00 location-local (DST-correct), deferred and re-checked | `quiet-hours*.test.ts` |

Steps were not timed against first-time users. These are counts of required actions and decisions from our own repeated runs, not a
usability-superiority claim.

## Schema and contracts

**Migration `drizzle/0019_card_numbers.sql`** (one schema owner, this session):
- `tenants.next_card_number int not null default 1`
- `memberships.card_number int not null default 0`, backfilled per tenant by `(created_at, id)`, plus `UNIQUE(tenant_id, card_number)` and
  `CHECK > 0`
- `BEFORE INSERT` trigger assigns from the tenant row (row lock serialises concurrent enrolments) and refuses explicit numbers.
  `BEFORE UPDATE OF card_number` trigger refuses changes.
- `card_security_events.actor_user_id text`, `card_security_events.reason varchar(240)` (both nullable)

Verified: fresh database (test DB: full migrate from 0000), and upgrade from 0018 with synthetic historical data (seeded dev DB: existing
card → `K-0001`, counter → 2, ledger untouched). Existing triggers and constraints are unaffected. Ledger rows are not rewritten.

**Rollback note (not a guarantee).** 0019 is additive. Older application code still inserts memberships, because the column default (0)
and the trigger assign the number. So the previous image can run on a migrated database. Reversing the schema needs a manual down
script (drop the triggers, functions, constraints and columns), and it loses card numbers. The old rollback drill does not cover this
candidate (ledger O-010).

**New and changed HTTP contracts:**
- `GET /api/cashier/lookup?code=` now also accepts a card number, and returns `cardNumber` and `matchedBy`.
- `GET /api/card/[token]` returns `cardNumber`.
- `GET /api/merchant/customers[...]` members carry `cardNumber` and `locationId`. `q` accepts a card number. The timeline carries `reason`.
- `POST /api/merchant/customers/[membershipId]/reissue` (new; same-origin, rate-limited, owner/manager of the location).
- `GET /api/merchant/readiness` (new; owner/manager).
- `GET /api/staff` adds `accountCreation`.
- The owner export is now `formatVersion: 4`.

**New env:** `STAFF_INVITE_SIGNUP_ENABLED` (default false; `config-check` refuses `true` in production).
`TEST_PG_CONTAINER`/`TEST_PG_PORT` are test-only (`scripts/test-local.sh`, billing fixture).

**Affected services if ever released:** web (UI and API), worker (quiet-hours deferral), migrate (0019). Ops, backup and cloudflared are
unaffected.

## Tests and visual QA

- Unit and integration (vitest, isolated DB): **82 files, 522 passed, 1 skipped** on the commit before the e2e/style commits. The later
  commits changed only e2e specs and CSS. New: `card-number`, `card-reissue` (incl. correction and export reconciliation), `readiness`,
  `quiet-hours` (unit + integration), `invite-signup`.
- Typecheck and ESLint: clean.
- Playwright e2e, real Chrome, isolated server and DB, per-file runner with this DB's peer limits reset:
  **59 passed, 3 skipped (2 NFC browser tests and 1 billing test that skip by design in this environment), 1 failed.** `owner-dashboard-regressions.spec.ts:44` timed out once and passed on rerun (possible flake).
  - The failure is `logout.spec.ts:133` ("logout with unsaved edits … different account"). It fails identically on the **unchanged
    baseline** `70ecc72` in the same environment, so it is pre-existing and not caused by this work. Not investigated further.
  - The first sharded run failed many tests because of the app's sign-up peer limit (15 per 15 minutes) across a shard, plus my renamed
    label. The renamed label and the readiness copy are fixed in `1e6218b`. `mobile-card` failed because my own browser run had rotated
    the seeded demo card (correct reissue behaviour); the seed access file was re-pointed.
- `next build` (production build): **PASS** on `52d61b8`.
- Visual, real Chrome. Owner overview, customers, staff, automations at 1440×900, 1280×800, 768×1024, 390×844 and 320×568. Cashier at
  1440, 768, 390 and 320. Customer card at 390 and 320. Invite page at 390 and 320. **No horizontal overflow anywhere.** Fixes made:
  invite card overflow at 390, card-number contrast, raw English lookup error shown to cashiers, duplicated "Korrektur" label.
  Screenshots in `.review/{slice12,slice3,slice5,qa}/` (gitignored, local).
- Not covered: WebKit, Safari, physical iPhone, screen reader, keyboard-only audit of the new dialogs (they reuse the existing focus-trapped
  `OwnerDialog`), 200 % zoom, reduced motion.

## Real-world verification state

| Capability | State |
|---|---|
| Wallet (Apple/Google) | Unchanged. Fixture-tested only. Reissue enqueues `wallet.refresh`; real provider behaviour NOT RUN. |
| NFC | feature/nfc-v1 included unchanged. Readiness reports it honestly. Physical tag and phone acceptance **NOT RUN** and still required. |
| E-mail delivery | Mailpit/test only. Quiet hours tested locally. Real provider NOT RUN. Production flags untouched. |
| Production | **No release, migration, flag change or deployment.** |

## Remaining queue

**P0 (before a first real merchant, beyond owner/legal inputs O-001/O-002):**
1. Re-run the full e2e suite in one go on the final SHA (here it ran per file). Decide whether `logout.spec.ts:133` (pre-existing at baseline) blocks.
2. Owner decisions: card numbers on printed/visible cards (privacy: a number is not a credential, but it is enumerable at the counter by
   staff); staff-reissue entitlement wording; whether invite-gated sign-up may be enabled for the pilot (separate approval).
3. Two-phone dry run (O-007) including number lookup, correction and reissue.

**P1:**
- Shared-counter PIN/device mode as one complete slice.
- Referral monthly cap.
- Near-reward automation (all defaults off).
- Merchant-timezone analytics days.
- Customer/activity CSV export (formula-safe).
- Activity log with type/staff filters.
- Retention job once a policy is approved.

**P2:** reward value/VAT and a "rewards given" record (not tax certification); logo on browser card and Apple pass; additional card types.

**Marketing alignment:** not done. Concept D (`978016e`) may mention counter recovery and readiness only once the slices are released.
Keep advanced items qualified.

**Specific next action:** the owner reviews this branch with the two P0 decisions above. An agent then re-runs the full e2e on the
final SHA and prepares an RC from it. Only a separate approval allows a push.

## Launch-ledger update proposal (not applied)

- **O-003:** add "counter number fallback, corrections UI, staff reissue" as implemented locally on `product/merchant-completion`
  (LOCAL-TESTED).
- **O-006:** a manual re-issue path now exists (staff-assisted, same membership, audited). Propose closing it via this path once released
  and owner-approved.
- **O-043:** implemented locally behind a default-off flag. Production use needs a decision.
- New risk: card numbers are enumerable by authenticated staff (bounded by tenant/location scope, staff rate limits and the redemption
  warning).
- New open item: rollback drill for 0019.
- **TEST-EVIDENCE:** add the vitest and e2e results above with the pre-existing logout failure.
- **EVIDENCE-INDEX:** Tapja read-only benchmark 2026-10-04 (private screenshots outside the repo).
