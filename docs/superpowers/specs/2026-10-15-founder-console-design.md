# Founder console (admin.getloynara.com)

Date: 2026-10-15, revised 2026-10-16 after an external review · Status: revised spec awaiting approval · Planning only: nothing is built, and no implementation starts without the founder's explicit go.

Related: [Generic NFC plaque](2026-10-15-generic-nfc-plaque-design.md) (its decision D9 places plaque support actions in this console).

## 1 · Goal

One private place where the founder **and the partner** run the business without the terminal: find a shop, see where each shop is in its activation, link plaques, help owners, track who pays, and spot failures. It is a **lean console**: what makes the first paying merchants manageable comes first, and reporting comes later.

Success means:

- The daily questions ("which shops are stuck before their first tap, who is overdue, where is plaque K7QM-3XPA, what did we change") are answered in the console.
- The partner can onboard shops and handle approved support **without the founder's account**.
- Support actions work from a phone at a shop.
- Shop owners, staff and customers cannot reach the console; every admin action is recorded; customers' personal data stays hidden unless the founder reveals it for a logged reason.
- Losing a phone or an authenticator does not lock the business out.

## 2 · Decisions

| # | Decision |
|---|---|
| C1 | Console covers shops & plaques, money, usage & health, support & leads, **built lean** (§9 order) |
| C2 | **Three roles active in v1:** `founder` (the founder), `support` and `sales` (the partner holds both). The legal split of who may do what (ownership, residence) is to be confirmed by an adviser; the software only enforces the roles |
| C3 | Payments: one payment system later (automatic debit, invoice with bank transfer, manual entry); provider decided in a separate sub-project. v1 tracks invoices and payments **by hand** on the **existing per-location billing model** |
| C4 | Hosting: `admin.getloynara.com`, same codebase and rules, own subdomain and cookie |
| C5 | Desktop first, phone-usable for shop lookup, plaques and support |
| C6 | Second factor in v1: **password + TOTP** (authenticator app) with backup codes. Passkeys later, after testing |
| C7 | Home page centres on the **merchant activation pipeline** (Lead → Signed up → Plaque linked → First tap → Paying) |

Changes from the first version (external review, 2026-10-16): billing redesigned on the existing tables (§7), TOTP and session-bound step-up made explicit (§4.3), roles active in v1 (§4.6), money before usage & health (§9), recovery and operational safeguards added (§4.7, §6.5, §8).

## 3 · What exists today (checked in the code)

- Auth: Better Auth with email and password (`src/lib/auth.ts`), 7-day sessions, invite-gated sign-up, host-only cookies (no cross-subdomain setting). No second factor, no password-reset email (`sendResetPassword` is not configured).
- Accounts are created safely by the existing operator command `operator:provision-identity` (encrypted credential envelope, production guard `assertOperatorTarget` in `scripts/operator-identity.ts`).
- Roles: per merchant only (`staff_roles`: owner, manager, cashier).
- Subdomain gating: `src/proxy.ts` already restricts `mail-events.getloynara.com` and the unsubscribe host to whitelisted paths; tests in `src/proxy.test.ts`. `preview.getloynara.com` is already behind Cloudflare Access.
- Ingress: Cloudflare Tunnel (`TRUSTED_INGRESS=cloudflare_tunnel`, client IP from `cf-connecting-ip`).
- Billing: `subscriptions` (one row per merchant: status, currency, `price_minor`, `active_location_count`, provider, period end, grace), `billing_location_plans` (one row per location: `plan_code = 'local_standard'`, `price_minor`, member limit), `billing_handoffs` and `billing_invoices` (provider invoices only, `status = 'fixture_paid'`, handoff required), `billing_webhook_events`. Only a local test provider (`local_fixture`) exists. Locations have no status column.
- Data for the pipeline and health: tenants, locations, programmes, staff, memberships, ledger, secure tags and tap requests, outbox jobs (kind, status, attempts, last error, claim token), email deliveries and provider events, demo requests (no status), `rate_limits` (also holds sign-in locks).

## 4 · Access and security

### 4.1 Three locks in front of every admin request

1. **Cloudflare Access** on `admin.getloynara.com`, allow list = the founder's and the partner's addresses plus the founder's offline backup identity (§4.7). The app verifies `Cf-Access-Jwt-Assertion` on **every** admin request (signature against the team's public keys, audience, expiry, issuer, email on `ADMIN_ALLOWED_EMAILS`) and refuses without it.
2. **Admin login:** each person has a **separate** Better Auth account used only for the console (never a merchant login), password + **TOTP**, enrolment forced on first sign-in, with **10 one-time backup codes** shown once.
3. **Admin roles:** table `platform_admins` (`user_id`, `role` in `founder` / `support` / `sales`, `granted_at`, `granted_by`; primary key `(user_id, role)`, so one person can hold several roles). Roles are granted and revoked **only** by an operator command on the founder's Mac (`admin:grant`, `admin:revoke`, `admin:list`, same production guard as the existing operator tools), never by a web route. The Cloudflare email of the request must match the admin account's email.

### 4.2 Separation from the shop app

- `proxy.ts`: on the admin host, allow only `/admin/*`, `/api/admin/*`, the Better Auth endpoints the admin sign-in needs, and static assets; everything else is 404. On every other host, `/admin/*` and `/api/admin/*` are 404.
- Cookies stay host-only; the admin origin is added to Better Auth's trusted origins.
- One guard for every admin page and API: Access assertion valid → session valid → TOTP enabled → role allows the action → session within the admin limits. Denials answer **404** (the console does not reveal itself), except "not signed in" on the admin host (redirect to the admin sign-in). A route-inventory test fails if any `/api/admin/*` handler skips the guard.

### 4.3 Admin sessions and step-up

- Admin limits are enforced **by the admin guard only** (merchant sessions are unchanged): 30 minutes idle (tracked per session in `admin_session_activity`), 12 hours since sign-in.
- **Step-up** = a session-bound re-authentication: the admin enters password + TOTP again; the server records `step_up_at` on that session's `admin_session_activity` row; it is valid **5 minutes, for that session only**. Required for every action marked "step-up" in §5–§7.

### 4.4 Audit log

`admin_audit_events`: `id`, `at`, `admin_user_id`, `roles` (held at the time), `action` (enumerated), `tenant_id` (nullable), `target_type`, `target_id`, `summary` (before → after, never secrets), `reason` (required for reveals and money changes), `ip`, `user_agent`. Written **in the same transaction** as the action; append-only, enforced by a database trigger that rejects `UPDATE` always and `DELETE` unless the transaction has set `loynara.audit_retention = 'on'` and the row is older than the retention period (only the retention job does this, §8). Founder sees all events; support and sales see their own.

### 4.5 Customer privacy

The console shows shops, staff names and roles, and aggregates. Customer emails, phone numbers and card locators are masked by default. **Reveal** is founder-only, needs a step-up and a typed reason, and is logged. No bulk export of customer data.

### 4.6 Roles in v1

| Capability | founder | support | sales |
|---|---|---|---|
| Home: pipeline, tiles, alerts | ✓ | ✓ | ✓ (no money tiles) |
| Shops: list and detail | ✓ | ✓ | ✓ |
| Shop notes: add | ✓ | ✓ | ✓ |
| Plaques: view | ✓ | ✓ | ✓ |
| Plaques: link for a shop, new activation code (step-up) | ✓ | ✓ | – |
| Plaques: retire (step-up) | ✓ | ✓ | – |
| Support: password-reset link, resend staff invite | ✓ | ✓ | – |
| Support: unlock sign-in (step-up) | ✓ | ✓ | – |
| Leads: view, status, notes | ✓ | ✓ | ✓ |
| Leads: send owner invite (step-up) | ✓ | – | ✓ |
| Money: view | ✓ | paying status only | paying status only |
| Money: record invoice, payment, adjustment; set plan price (step-up) | ✓ | – | – |
| Health: view | ✓ | ✓ | – |
| Health: retry a retry-safe job (step-up) | ✓ | ✓ | – |
| Reveal customer data (step-up) | ✓ | – | – |
| Audit log | all | own | own |
| Reset another admin's second factor (step-up) | ✓ | – | – |

The partner holds `support` and `sales`. Every action checks the capability, not the role name, so a later change to this table is a data change in one module.

### 4.7 Recovery

| Lost | Recovery |
|---|---|
| Phone / authenticator (partner) | Founder resets the partner's second factor in the console (step-up); the partner enrols again |
| Phone / authenticator (founder) | A backup code; or `admin:reset-2fa` on the Mac (operator guard, interactive confirmation, audited) |
| Cloudflare identity / email inbox | The founder's **offline backup identity** on the Access allow list (separate email with a hardware key or a printed recovery), stored offline |
| Password | Password-reset link to the admin email (needs the reset email from phase 2) or `operator:reset-credential` |

A recovery drill (sign in with a backup code; run `admin:reset-2fa` against the local stack) is part of phase 1 acceptance.

## 5 · Pages

All pages reuse the owner dashboard components and tokens. Tables collapse into cards on phone widths.

### 5.1 Home

- **Tiles:** paying locations, monthly contracted revenue, active customers (30 days), needs attention (count). Money tiles founder-only.
- **Activation pipeline**, counts per stage and the shops waiting longer than 7 days in each stage:

| Stage | A shop is in this stage when |
|---|---|
| Lead | a demo request with status `new` or `contacted` (not yet a merchant) |
| Signed up | a tenant exists, no active plaque yet |
| Plaque linked | ≥ 1 active plaque, no confirmed or awarded tap yet |
| First tap | ≥ 1 confirmed or awarded tap, not paying |
| Paying | subscription not cancelled, ≥ 1 invoice `paid` (manual or provider) with `period_end` in the last 45 days, and no invoice overdue |

  Until the plaque system exists (phase 3), "Plaque linked" and "First tap" use the existing `secure_tags` and `tap_requests` and stay mostly empty; until money exists (phase 4), "Paying" stays empty.
- **Quick operations:** find shop, find plaque, record payment (founder), open support.
- **Needs attention** list: overdue invoices, shops stuck in a stage > 7 days, failed or stuck jobs, failing emails (24 h).

### 5.2 Shops

Search and filters: name, city, locations, programme type, pipeline stage, paying status, plaques, active customers (30 days), last activity. **Detail:** locations, programmes and rules, staff (names, roles, last sign-in), plaques, payments (per role), notes (`tenant_admin_notes`), admin actions on this shop.

### 5.3 Plaques

Stock per batch (planned / free / linked / retired), search by plaque number or shop, last tap. Actions per §4.6. Built together with the plaque system (phase 3).

### 5.4 Money (§7)

### 5.5 Usage & health

Per shop: active customers (a card with ≥ 1 ledger entry in 30 days), stamps and points given (7 / 30 days), taps, last activity; "quiet" = no ledger entry for 14 days. System: failed outbox jobs and jobs pending > 15 minutes past due; failed or bounced emails in 24 h. **Retry** only for retry-safe kinds (§6.5).

### 5.6 Support

Owner and staff accounts of a shop, sign-in lock state, pending staff invites. Actions per §4.6. Password-reset links need Better Auth's `sendResetPassword` (built in phase 2); nobody ever sees or sets a password.

### 5.7 Leads

Demo requests with status new / contacted / won / lost, notes, `status_changed_at`, `assigned_to` (admin user). Won lead → owner invite through the existing invite sign-up.

### 5.8 Audit log

Newest first, filters by shop, action, admin and date; visibility per §4.4.

## 6 · Operational safeguards

### 6.1 Idempotent actions

Every write action takes a client-generated idempotency key; repeating a request with the same key returns the first result and writes no second audit event.

### 6.2 Atomic audit

Action and audit row commit together or not at all.

### 6.3 External effects through the outbox

Actions with external effects (password-reset email, staff invite, owner invite) only enqueue outbox jobs inside the action's transaction; the worker sends them. The console never calls an email provider directly.

### 6.4 Rate limits

Admin sign-in and step-up attempts use the existing `enforceRateLimit` (5 failures per 15 minutes per account and per IP), in addition to Better Auth's own limits.

### 6.5 Retry-safe jobs

"Retry" is offered only for kinds listed in one constant, `RETRY_SAFE_OUTBOX_KINDS`, each with a test proving a repeat cannot duplicate an external effect (e.g. `wallet.refresh` coalesces per membership). Email kinds are **not** retry-safe in v1. Retry resets exactly one `failed` job to `pending` and is audited.

## 7 · Money: billing model

Built on the existing tables; contracts are **per location**.

| Concept | Where | Notes |
|---|---|---|
| Contract | `subscriptions` (per merchant: status, currency) + `billing_location_plans` (per location: price) | **Monthly contracted revenue** = sum of `billing_location_plans.price_minor` over merchants whose subscription is not `cancelled`. 2 locations × €49 = €98, whether or not an invoice is late |
| Invoice | `billing_invoices`, extended | New `source` (`provider` / `manual`); `handoff_id` and `provider_invoice_id` nullable for manual invoices; statuses `open`, `paid`, `void`, `uncollectible` (plus the existing `fixture_paid`); `invoice_number` (the number from the accounting tool), `issued_at`, `due_at`, `period_start`, `period_end`, `location_id` (nullable: one invoice may cover several locations) |
| Payment | new `billing_payments` | `invoice_id` (nullable for unallocated money), amount, currency, `method` (`provider` / `transfer` / `cash` / `other`), `received_at`, `reference`, `source`, `recorded_by`. Partial payments allowed |
| Adjustment | new `billing_adjustments` | credit, waiver or refund against an invoice, amount, `reason` (required), `recorded_by` |

- **Invoice balance** = amount − payments − adjustments. **Overdue** = status `open`, `due_at` < today, balance > 0. Overdue money is shown **separately** from contracted revenue.
- v1 does **not** issue legal invoices: invoices are issued in the founder's accounting tool (or later by the provider) and **recorded** in the console. The payments sub-project later writes the same tables with `source = 'provider'`.
- Founder actions (step-up, reason required): record an invoice, record a payment, record an adjustment, change a location's plan price.

## 8 · Retention

| Data | Kept | Then |
|---|---|---|
| Billing records (invoices, payments, adjustments) | 10 years (German commercial and tax retention) | Not deletable from the console |
| Admin audit events | 3 years | Removed by a scheduled job (the only allowed delete) |
| Shop notes, lead notes | Until 1 year after the shop leaves or the lead is lost | Removed by the same job |
| Admin session activity | 30 days | Removed by the same job |

Durations are proposals to be confirmed with the founder's adviser. Notes must not contain customers' personal data (shown as a hint under every note field).

## 9 · Build order (interleaved with the plaque system)

| Phase | Scope |
|---|---|
| 1 | **Foundation:** admin host gate, Access verification, admin accounts with TOTP + backup codes, `platform_admins` with the three roles and the capability table, `admin:grant / revoke / list / reset-2fa`, admin session limits, session-bound step-up, audit log (+ append-only trigger), idempotency keys, console shell, recovery drill |
| 2 | **Onboarding & support:** shops list and detail, notes, leads with status and owner invite, support actions (incl. the password-reset email), home with pipeline (stages from existing data) |
| 3 | **Plaques:** plaque system server side (plaque spec steps 1–3), console Plaques page, desk tools (plaque spec step 4) |
| 4 | **Money:** billing model extension (§7), founder money page, money tiles, overdue in "needs attention" |
| 5 | **Usage & health:** usage per shop, system health, retry-safe jobs, retention job |

Then the payments sub-project (provider choice and integration) as its own spec. Each phase gets its own implementation plan and pull request; nothing starts without the founder's go.

## 10 · Testing

Automated (Vitest, isolated Postgres):

- Host separation both ways; Access assertion missing / bad signature / wrong audience / expired / email not allowed / email not matching the account → 404.
- No TOTP enrolled → only the enrolment page; backup code works once; `admin:reset-2fa` audited.
- **Capability matrix:** for every action in §4.6, each role is allowed or refused exactly as the table says (one table-driven test).
- Idle and absolute session limits; step-up valid 5 minutes and only for the session that did it.
- Each action writes exactly one audit row in the same transaction; a repeated idempotency key writes nothing; audit rows reject update and delete.
- Reveal requires founder, step-up and reason.
- Money: contracted revenue per location, partial payments, adjustments, overdue boundaries (due today vs. yesterday), cancelled subscriptions excluded.
- Pipeline: a shop in each stage from fixtures; a shop never appears in two stages.
- Retry offered only for kinds in `RETRY_SAFE_OUTBOX_KINDS`; email kinds refused.
- Retention job deletes only expired rows of the allowed tables.

Locally the console runs with a simulated Access issuer (test keys). Before going live: a manual check on the real `admin.getloynara.com` from the founder's Mac and phone and the partner's phone, plus the recovery drill.

## 11 · Out of scope (v1)

- Passkeys (after testing; C6).
- Payment provider integration and legal invoice issuing (separate sub-project).
- Granting roles from the web; impersonating shop owners; editing programmes or customer balances; bulk exports of customer data.
- Charts beyond the per-shop numbers in §5.5.

## 12 · Open items

- Admin email addresses for the founder and the partner, and the founder's offline backup identity.
- Confirm Access can be enabled for the admin hostname on the existing Cloudflare tunnel.
- Adviser: the founder/partner split of responsibilities, and the retention durations in §8.
- Which email sender is used for reset links and invites (depends on the Mailgun setup).
