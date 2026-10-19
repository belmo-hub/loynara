# Founder Console Phase 1 (Foundation) Implementation Plan

> Work through the tasks in order, one at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locked-down `admin.getloynara.com` where the founder and the partner sign in (password + TOTP), each limited by role, with session limits, session-bound step-up, an append-only audit log, idempotent actions, operator commands for roles and 2FA recovery, and a minimal console shell (team, audit log).

**Architecture:** Same Next.js app and database. `src/proxy.ts` gates the admin host; every admin page and API passes one guard (`requireAdmin` / `requireAdminPage`) that checks the Cloudflare Access assertion, the Better Auth session, TOTP enrolment, the role's capability and the admin session limits. Admin state lives in four new tables; Better Auth's two-factor plugin adds its own schema. Roles are granted only by an operator CLI.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts`), Better Auth 1.7 (+ `twoFactor` plugin), Drizzle ORM + hand-edited SQL migrations, Postgres, `jose` (JWT verification), Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-10-15-founder-console-design.md` (revised 2026-10-16). Phase 1 = §9 row 1; it implements §4 (all), §6.1, §6.2, §6.4, §10 (the items for phase 1) and the recovery drill from §4.7.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md: this Next.js version has breaking changes; `middleware` is `proxy`).
- **Never touch production**: no deploys, no production database, no Cloudflare changes. Work only on the local stack and an isolated test Postgres (`TEST_PG_CONTAINER=… TEST_PG_PORT=… npm test`; the test database name must stay `looplocal_test`).
- **Commits:** no AI tool or vendor names and no attribution or co-author lines anywhere in commit messages, code comments or docs. Plain imperative subject lines, like the existing history ("Reserve each sign-in attempt before the password check").
- UI copy in **German**, matching the owner dashboard; reuse `src/components/owner/*` components and `owner.css` tokens. No new design system.
- Roles: exactly `founder`, `support`, `sales`. Capabilities and the role matrix: copy spec §4.6 verbatim (Task 2).
- Limits (exact values): admin idle **1800 s**, admin absolute **43200 s**, step-up validity **300 s**, step-up and admin sign-in failures **5 per 900 s** per account and per IP, backup codes **10**.
- Denials answer **404** (`DomainError("NOT_FOUND")`); a missing session on the admin host redirects pages to `/admin/sign-in` and answers 401 on APIs; a missing step-up answers **403** with code `STEP_UP_REQUIRED`.
- Customer personal data is not shown anywhere in phase 1.
- Admin sign-in brute force is covered by the existing per-account sign-in limit (`src/app/api/auth/sign-in-account-limit.integration.test.ts`) and Better Auth's own limits; step-up gets its own limit (Task 5). Do not weaken either.
- Merchant sessions and the merchant app behave exactly as before (existing test suite stays green).
- Passkeys are out of scope (spec C6).

## Review Focus

1. **Cloudflare email ≠ admin account email** (someone with a valid Access login uses another admin's password): must be refused with 404. Test in Task 6 (`refuses when the Access email differs from the session email`).
2. **Admin session reused on the app host** or **merchant session on the admin host** (a merchant owner signs in on `admin.` with merchant credentials): the merchant has no `platform_admins` row → 404, and no admin route exists on `app.`. Tests in Task 6 (`refuses a signed-in merchant owner`) and Task 7 (both host directions).
3. **Step-up done in one session, used in another** (two browsers): must be refused. Test in Task 5 (`step-up does not carry over to another session`).
4. **Double-click / retried request on an admin write** (reset 2FA twice): one effect, one audit row. Test in Task 4 (`same idempotency key returns the first result and writes one audit row`).
5. **Founder loses the authenticator**: backup code sign-in and `admin:reset-2fa` both work and are audited. Tests in Task 3 (`backup code signs in once`) and Task 8 (`reset-2fa clears the factor and writes an audit row`).

---

### Task 1: Schema and migration

**Files:**
- Modify: `src/db/schema.ts` (append four tables)
- Create: `drizzle/0025_founder_console.sql`, `drizzle/meta/0025_snapshot.json` (via `npm run db:generate`), update `drizzle/meta/_journal.json`
- Create: `docs/rollback/0025-founder-console-down.sql`
- Test: `src/lib/admin/schema.integration.test.ts`

**Interfaces:**
- Produces (Drizzle tables, exported from `src/db/schema.ts`):
  - `platformAdmins` → `platform_admins`: `userId text`, `role varchar(16)` check in (`founder`,`support`,`sales`), `grantedAt timestamptz default now()`, `grantedBy varchar(120)` (operator label, e.g. `operator_cli:<os user>`); PK `(user_id, role)`; FK `user_id → "user"(id) on delete cascade` (hand-added in SQL).
  - `adminAuditEvents` → `admin_audit_events`: `id uuid pk`, `at timestamptz default now()`, `actor varchar(16)` check in (`console`,`operator_cli`), `adminUserId text null`, `roles text[] not null`, `action varchar(48)`, `tenantId uuid null`, `targetType varchar(32) null`, `targetId varchar(120) null`, `summary varchar(500)`, `reason varchar(500) null`, `ip varchar(64) null`, `userAgent varchar(300) null`; check `actor = 'operator_cli' or admin_user_id is not null`; index `(at desc)`, `(admin_user_id, at desc)`.
  - `adminSessionActivity` → `admin_session_activity`: `sessionId text pk` (FK `"session"(id) on delete cascade`, hand-added), `userId text`, `startedAt timestamptz`, `lastSeenAt timestamptz`, `stepUpAt timestamptz null`.
  - `adminIdempotencyKeys` → `admin_idempotency_keys`: `adminUserId text`, `key uuid`, `action varchar(48)`, `result jsonb`, `createdAt timestamptz default now()`; PK `(admin_user_id, key)`.
- Better Auth two-factor schema (hand-written in the same SQL file, `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`): take the exact table and column names from the installed `better-auth` two-factor plugin schema (`node_modules/better-auth/dist/plugins/two-factor/…`); expected `"user"."twoFactorEnabled" boolean` and table `"twoFactor"` (`id`, `secret`, `backupCodes`, `userId → user on delete cascade`). Do **not** edit `drizzle/auth.sql`.
- Append-only trigger on `admin_audit_events` (hand-written): `UPDATE` always raises; `DELETE` raises unless `current_setting('loynara.audit_retention', true) = 'on'` **and** `OLD.at < now() - interval '3 years'`.

- [ ] **Step 1: Write the failing tests** in `src/lib/admin/schema.integration.test.ts`:
  - `rejects updates to audit events`: insert an event, `UPDATE` → rejects with a trigger error.
  - `rejects deletes without the retention setting`: `DELETE` → rejects.
  - `rejects deletes of recent rows even with the retention setting`: in a transaction `SET LOCAL loynara.audit_retention = 'on'`, delete a row with `at = now()` → rejects.
  - `allows the retention delete of old rows`: same setting, row with `at = now() - interval '3 years 1 day'` → deleted.
  - `allows one person to hold support and sales`: two `platform_admins` rows for one user succeed; a third row with role `owner` fails the check.
  - `cascades admin session activity when the session is deleted`.
  - `adds the two-factor schema`: `"twoFactor"` table and `"user"."twoFactorEnabled"` exist.
- [ ] **Step 2: Run** `npm test -- src/lib/admin/schema.integration.test.ts` → FAIL (tables missing).
- [ ] **Step 3: Add the four tables to `src/db/schema.ts`, run `npm run db:generate`, rename the output to `0025_founder_console.sql`, and append by hand:** the two FKs to auth tables, the two-factor schema, the trigger function and trigger. Write `docs/rollback/0025-founder-console-down.sql` (drops in reverse order, drops the two-factor column/table, the trigger and function), following `docs/rollback/0021-*-down.sql`.
- [ ] **Step 4: Run** the same command → PASS; then `npm test` (whole suite) → PASS.
- [ ] **Step 5: Commit** `Add the founder console tables and the two-factor schema`.

### Task 2: Capabilities

**Files:**
- Create: `src/lib/admin/capabilities.ts`
- Test: `src/lib/admin/capabilities.test.ts`

**Interfaces:**
- Produces:
  - `export type AdminRole = "founder" | "support" | "sales"`
  - `export type Capability = "home.view" | "home.money" | "shops.view" | "shops.note" | "plaques.view" | "plaques.link" | "plaques.code" | "plaques.retire" | "support.reset_link" | "support.resend_invite" | "support.unlock" | "leads.view" | "leads.edit" | "leads.invite" | "money.view_full" | "money.view_status" | "money.write" | "health.view" | "health.retry" | "customers.reveal" | "audit.view_all" | "audit.view_own" | "admins.reset_2fa"`
  - `export const STEP_UP_CAPABILITIES: ReadonlySet<Capability>` = `plaques.link`, `plaques.code`, `plaques.retire`, `support.unlock`, `leads.invite`, `money.write`, `health.retry`, `customers.reveal`, `admins.reset_2fa`
  - `export function can(roles: readonly AdminRole[], capability: Capability): boolean`

- [ ] **Step 1: Write the failing test** `matches the spec role table`: one table literal transcribing spec §4.6 row by row (founder / support / sales → allowed or not, with "paying status only" = `money.view_status`, "own" = `audit.view_own`, "no money tiles" = sales lacks `home.money`); loop and `expect(can([role], cap)).toBe(expected)` for every cell. Plus `combines roles`: `can(["support","sales"], "leads.invite") === true` and `can(["support","sales"], "money.write") === false`, and `step-up set matches the spec` (equality with the list above).
- [ ] **Step 2: Run** `npx vitest run src/lib/admin/capabilities.test.ts` → FAIL.
- [ ] **Step 3: Implement** a `Record<AdminRole, ReadonlySet<Capability>>` and `can` as "any role grants it".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Add the admin role capability table`.

### Task 3: Two-factor sign-in and second-factor helpers

**Files:**
- Modify: `src/lib/auth.ts` (add the `twoFactor` plugin with `issuer: "Loynara Admin"`; add `process.env.ADMIN_ORIGIN` to `trustedOrigins` when set), `src/lib/auth-client.ts` (add `twoFactorClient`), `package.json` (add `"jose": "^6.2.3"` to dependencies, used in Task 4)
- Create: `src/lib/admin/second-factor.ts`, `src/lib/admin/types.ts`
- Test: `src/lib/admin/second-factor.integration.test.ts`

**Interfaces:**
- Produces:
  - `src/lib/admin/types.ts`: `export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]` (same alias as `src/lib/secure-tap.ts:16`); every later task imports `Transaction` from here.
  - `export async function verifyAdminSecondFactor(userId: string, code: string): Promise<boolean>` — TOTP only (not backup codes).
  - `export async function verifyAdminPassword(userId: string, password: string): Promise<boolean>`
  - `export async function resetSecondFactor(tx: Transaction, userId: string): Promise<void>` — disables 2FA and deletes the user's `"twoFactor"` row and all their admin session activity and Better Auth sessions.
  - `export async function hasSecondFactor(userId: string): Promise<boolean>`
- Implementation choice: use Better Auth's own APIs where the installed version offers a session-scoped TOTP verification and a password check; otherwise call the same internals the plugin uses (its symmetric decryption with `BETTER_AUTH_SECRET` and its OTP verification). Record the choice in a short comment at the top of the file. `backupCodes: { amount: 10 }`.

- [ ] **Step 1: Write the failing tests** (create a user through `auth.api.signUpEmail` in a test helper, enable 2FA through `auth.api.enableTwoFactor`, read the TOTP secret from the returned URI, generate codes with the plugin's OTP helper):
  - `requires the TOTP after the password once enabled`: `signInEmail` returns the two-factor redirect, no session.
  - `verifies a current TOTP and rejects a wrong one` (`verifyAdminSecondFactor`).
  - `verifies the password and rejects a wrong one` (`verifyAdminPassword`).
  - `backup code signs in once`: first use succeeds, second use of the same code fails.
  - `resetSecondFactor removes the factor and the sessions`: afterwards `hasSecondFactor` is false and the user's sessions are gone.
  - `merchant sign-in is unchanged`: a user without 2FA signs in with password only.
- [ ] **Step 2: Run** `npm test -- src/lib/admin/second-factor.integration.test.ts` → FAIL.
- [ ] **Step 3: Implement** the plugin configuration and the four functions.
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** `Add two-factor sign-in for console accounts`.

### Task 4: Access assertion, audit writer and idempotency

**Files:**
- Create: `src/lib/admin/access.ts`, `src/lib/admin/audit.ts`, `src/lib/admin/idempotency.ts`
- Modify: `scripts/config-check.ts` (`productionConfigIssues`: refuse `ADMIN_ACCESS_MODE=local_test`; when `ADMIN_ORIGIN` is set require `ADMIN_ACCESS_MODE=cloudflare`, `ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`), `.env.example` (document the five variables)
- Test: `src/lib/admin/access.test.ts`, `src/lib/admin/audit.integration.test.ts`, `scripts/config-check.test.ts` (extend if it exists, else create)

**Interfaces:**
- Produces:
  - `export type AccessEnv = { ADMIN_ACCESS_MODE?: string; ADMIN_ACCESS_TEAM_DOMAIN?: string; ADMIN_ACCESS_AUD?: string; ADMIN_ALLOWED_EMAILS?: string; ADMIN_ACCESS_TEST_JWKS?: string }`
  - `export async function verifyAccessAssertion(token: string | null, env?: AccessEnv): Promise<{ email: string }>` — throws `DomainError("NOT_FOUND")` on any failure. `cloudflare` mode: JWKS `https://<team>/cdn-cgi/access/certs` (cached `createRemoteJWKSet`), issuer `https://<team>`, audience `ADMIN_ACCESS_AUD`. `local_test` mode: JWKS from `ADMIN_ACCESS_TEST_JWKS` (JSON), issuer `https://loynara-local-access.invalid`, audience `loynara-local-admin`, allowed only when `NODE_ENV !== "production"`. Email lower-cased and required to be in the comma-separated `ADMIN_ALLOWED_EMAILS`.
  - `export type AdminAction = "admin.session_started" | "admin.step_up" | "admin.role_granted" | "admin.role_revoked" | "admin.two_factor_reset"`
  - `export type AdminEventInput = { actor: "console" | "operator_cli"; adminUserId: string | null; roles: AdminRole[]; action: AdminAction; tenantId?: string | null; targetType?: string; targetId?: string; summary: string; reason?: string; ip?: string | null; userAgent?: string | null }`
  - `export async function recordAdminEvent(tx: Transaction, input: AdminEventInput): Promise<void>`
  - `export async function listAdminEvents(input: { viewerUserId: string; viewAll: boolean; limit: number; before?: Date; action?: AdminAction }): Promise<Array<{ id: string; at: Date; actor: string; adminUserId: string | null; action: string; tenantId: string | null; targetType: string | null; targetId: string | null; summary: string; reason: string | null }>>` — `viewAll = false` returns only the viewer's events; `limit` max 200.
  - `export async function withAdminIdempotency<T>(tx: Transaction, input: { adminUserId: string; key: string; action: AdminAction }, run: () => Promise<T>): Promise<T>` — first call stores `run()`'s JSON result; a repeat with the same `(adminUserId, key)` returns the stored result without calling `run`; same key with a different `action` → `DomainError("INVALID_REQUEST")`.

- [ ] **Step 1: Write the failing tests:**
  - `access.test.ts` (generate an ES256 key pair with `jose`, sign tokens in `local_test` mode): `accepts a valid token`; `rejects a missing token`; `rejects a bad signature`; `rejects the wrong audience`; `rejects an expired token`; `rejects an email not on the allow list`; `refuses local_test in production` (`NODE_ENV=production` → NOT_FOUND).
  - `audit.integration.test.ts`: `writes the event inside the caller's transaction` (transaction rolled back → no row); `lists only own events unless viewAll`; `same idempotency key returns the first result and writes one audit row` (call twice with an audit write inside `run` → `run` called once, one row); `rejects a reused key for another action`.
  - `config-check`: `refuses the local Access mode in production`; `requires the Access settings when the admin origin is set`.
- [ ] **Step 2: Run** `npm test -- src/lib/admin/access.test.ts src/lib/admin/audit.integration.test.ts scripts/config-check.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three modules and the config checks.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Verify Cloudflare Access assertions and record admin events`.

### Task 5: Admin sessions and step-up

**Files:**
- Create: `src/lib/admin/session.ts`
- Test: `src/lib/admin/session.integration.test.ts`

**Interfaces:**
- Consumes: `recordAdminEvent` (Task 4), `verifyAdminPassword`, `verifyAdminSecondFactor` (Task 3), `enforceRateLimit` from `src/lib/rate-limit.ts`.
- Produces:
  - `export const ADMIN_IDLE_SECONDS = 1800`, `ADMIN_MAX_SESSION_SECONDS = 43200`, `ADMIN_STEP_UP_SECONDS = 300`
  - `export async function touchAdminSession(input: { sessionId: string; userId: string; sessionCreatedAt: Date; roles: AdminRole[]; ip: string | null; userAgent: string | null; now?: Date }): Promise<"ok" | "expired">` — first call for a session inserts the row and records `admin.session_started`; idle over 1800 s or session older than 43200 s → deletes the Better Auth session and the activity row, returns `"expired"`; otherwise updates `last_seen_at`.
  - `export async function performStepUp(input: { sessionId: string; userId: string; password: string; code: string; roles: AdminRole[]; ip: string | null; userAgent: string | null; now?: Date }): Promise<void>` — rate-limited (scope `admin_step_up`, 5 per 900 s, identities `user:<id>` and `ip:<ip>`); wrong password or code → `DomainError("FORBIDDEN")`; success sets `step_up_at` and records `admin.step_up`.
  - `export async function hasFreshStepUp(sessionId: string, now?: Date): Promise<boolean>`

- [ ] **Step 1: Write the failing tests:** `starts and records a session once`; `expires after 1800 s idle`; `expires 43200 s after sign-in even when active`; `step-up is valid for 300 s`; `step-up does not carry over to another session`; `wrong code is refused and counted`; `sixth failed step-up in 900 s is rate limited`.
- [ ] **Step 2: Run** `npm test -- src/lib/admin/session.integration.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Enforce admin session limits and session-bound step-up`.

### Task 6: The admin guard

**Files:**
- Create: `src/lib/admin/guard.ts`, `src/lib/admin/route-inventory.test.ts`
- Modify: `src/lib/http.ts` (`respondError`: `STEP_UP_REQUIRED` → 403)
- Test: `src/lib/admin/guard.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `export type AdminContext = { userId: string; email: string; sessionId: string; roles: AdminRole[] }`
  - `export async function requireAdmin(request: Request, capability: Capability): Promise<AdminContext>` — order: `verifyAccessAssertion(request.headers.get("cf-access-jwt-assertion"))` → Better Auth session (none → `DomainError("UNAUTHENTICATED")`) → Access email equals session email (else NOT_FOUND) → `hasSecondFactor` (else NOT_FOUND for APIs) → roles from `platform_admins` (none or `!can` → NOT_FOUND) → `touchAdminSession` (`"expired"` → UNAUTHENTICATED) → if `STEP_UP_CAPABILITIES.has(capability)` and not `hasFreshStepUp` → `DomainError("STEP_UP_REQUIRED")`. Mutating methods also require `Origin` = `ADMIN_ORIGIN` (else `INVALID_ORIGIN`).
  - `export async function requireAdminPage(capability: Capability): Promise<AdminContext>` — same checks from `headers()`; no session → `redirect("/admin/sign-in")`; no TOTP → `redirect("/admin/two-factor")`; step-up missing → `redirect("/admin/step-up?next=…")`; every other denial → `notFound()`.

- [ ] **Step 1: Write the failing tests** (`guard.integration.test.ts`, local_test Access tokens, real sessions): `admits a founder with TOTP and a valid assertion`; `refuses without an assertion` (NOT_FOUND); `refuses when the Access email differs from the session email`; `refuses a signed-in merchant owner`; `refuses an admin without TOTP`; `refuses a capability the role lacks` (sales → `support.unlock`); `asks for step-up on step-up capabilities`; `refuses a cross-origin POST`. And `route-inventory.test.ts`: `every admin API route calls requireAdmin` — glob `src/app/api/admin/**/route.ts`, each file's content must contain `requireAdmin(` (passes vacuously until Task 9 adds the first routes; Task 9 adds the assertion that at least 2 files exist).
- [ ] **Step 2: Run** `npm test -- src/lib/admin/guard.integration.test.ts` → FAIL.
- [ ] **Step 3: Implement** the guard and the `respondError` mapping.
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** `Add the admin guard`.

### Task 7: Admin host gate

**Files:**
- Modify: `src/proxy.ts`
- Test: `src/proxy.test.ts` (new `describe("admin hostname isolation")`)

**Interfaces:**
- Admin host = host of `process.env.ADMIN_ORIGIN` (unset → no admin host; `/admin` and `/api/admin` are then 404 everywhere).
- Allowed on the admin host: `/admin` and `/admin/*`, `/api/admin/*`, `/api/auth/*`, `/_next/static/*`, `/_next/image`, `/icon.svg`, `/favicon.ico`. Everything else → 404 with `cache-control: no-store`.
- On every other host: `/admin`, `/admin/*`, `/api/admin`, `/api/admin/*` → 404.

- [ ] **Step 1: Write the failing tests:** `serves admin paths on the admin host`; `hides merchant, card and tap paths on the admin host` (`/merchant`, `/card/x`, `/tap/x`, `/join/x`, `/api/merchant/tap` → 404); `hides admin paths on the app host` (`/admin`, `/admin/team`, `/api/admin/step-up` → 404); `hides admin paths when no admin origin is configured`; existing mail-events and unsubscribe tests unchanged.
- [ ] **Step 2: Run** `npx vitest run src/proxy.test.ts` → FAIL.
- [ ] **Step 3: Implement** following the existing unsubscribe-host pattern.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Serve the founder console only on its own hostname`.

### Task 8: Admin management and operator commands

**Files:**
- Create: `src/lib/admin/admins.ts`, `scripts/admin-operator.ts`
- Modify: `package.json` scripts: `"admin:grant": "tsx scripts/admin-operator.ts grant"`, `"admin:revoke": "tsx scripts/admin-operator.ts revoke"`, `"admin:list": "tsx scripts/admin-operator.ts list"`, `"admin:reset-2fa": "tsx scripts/admin-operator.ts reset-2fa"`
- Test: `src/lib/admin/admins.integration.test.ts`, `scripts/admin-operator.test.ts`

**Interfaces:**
- Consumes: `recordAdminEvent`, `withAdminIdempotency` (Task 4), `resetSecondFactor` (Task 3), `assertOperatorTarget` from `scripts/operator-identity.ts`.
- Produces:
  - `export async function grantAdminRole(input: { email: string; role: AdminRole; operator: string }): Promise<"granted" | "already">`
  - `export async function revokeAdminRole(input: { email: string; role: AdminRole; operator: string }): Promise<"revoked" | "absent">` — revoking the last `founder` → `DomainError("INVALID_REQUEST")`.
  - `export async function listAdmins(): Promise<Array<{ userId: string; email: string; roles: AdminRole[]; hasSecondFactor: boolean; lastSeenAt: Date | null }>>`
  - `export async function resetAdminSecondFactor(input: { targetUserId: string; by: { actor: "console"; ctx: AdminContext; idempotencyKey: string } | { actor: "operator_cli"; operator: string } }): Promise<void>` — console path requires `admins.reset_2fa`; a founder may not reset their own factor from the console (only the CLI or a backup code).
- CLI: `--target local|loynara-production` via `assertOperatorTarget` (refusals before the auth module loads, as in `scripts/operator-provision-identity.ts`), `--email`, `--role`; every write asks for typed confirmation (`GRANT <role> <email>`, `REVOKE …`, `RESET-2FA <email>`); accounts are created beforehand with the existing `operator:provision-identity` (the CLI never creates users or prints secrets). Operator label = `operator_cli:<os user>`.

- [ ] **Step 1: Write the failing tests:** `grants support and sales to one person`; `granting twice is reported as already`; `refuses to revoke the last founder`; `each grant and revoke writes one operator_cli audit row`; `reset-2fa clears the factor and writes an audit row`; `founder cannot reset their own factor from the console`; `same idempotency key resets once`. CLI tests (pure argument and target checks, no DB): `refuses an unknown role`; `refuses production without the production markers`; `requires the typed confirmation`.
- [ ] **Step 2: Run** `npm test -- src/lib/admin/admins.integration.test.ts scripts/admin-operator.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Add operator commands for console roles and two-factor recovery`.

### Task 9: Console shell and pages

**Files:**
- Create: `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/sign-in/page.tsx`, `src/app/admin/two-factor/page.tsx`, `src/app/admin/step-up/page.tsx`, `src/app/admin/team/page.tsx`, `src/app/admin/audit/page.tsx`, `src/components/admin/admin-shell.tsx` (navigation shows only links the roles can use), `src/components/admin/*` forms
- Create: `src/app/api/admin/step-up/route.ts` (POST), `src/app/api/admin/admins/[userId]/reset-2fa/route.ts` (POST)
- Test: `src/lib/admin/pages.integration.test.ts` (server-side checks of the route handlers), route inventory from Task 6 now ≥ 2 files

**Interfaces:**
- Consumes: Tasks 2–8.
- Pages (German copy, `export const dynamic = "force-dynamic"`):
  - `/admin/sign-in`: email + password, then TOTP code or backup code (Better Auth client `signIn.email` → `twoFactor.verifyTotp` / `verifyBackupCode`). No guard except Access (page itself calls `verifyAccessAssertion`; denial → `notFound()`).
  - `/admin/two-factor`: forced enrolment for a signed-in admin without TOTP: QR from the TOTP URI, confirm with a code, show the 10 backup codes once with a "gespeichert" confirmation.
  - `/admin/step-up`: password + TOTP → `POST /api/admin/step-up` → back to `next` (same-origin relative paths only).
  - `/admin` (`home.view`): welcome, the admin's roles, links to Team and Audit log. No business tiles in phase 1.
  - `/admin/team` (founder: `admins.reset_2fa` for actions; others see only themselves): list from `listAdmins`; "Zweiten Faktor zurücksetzen" button per other admin (step-up, idempotency key generated client-side with `crypto.randomUUID()`).
  - `/admin/audit` (`audit.view_all` or `audit.view_own`): `listAdminEvents`, 50 per page, filter by action.
- APIs: `POST /api/admin/step-up` body `{ password: string; code: string }` (zod, `.strict()`), capability `home.view`, calls `performStepUp`; `POST /api/admin/admins/[userId]/reset-2fa` body `{ idempotencyKey: string (uuid) }`, capability `admins.reset_2fa`, calls `resetAdminSecondFactor`. Both use `respondError`.

- [ ] **Step 1: Write the failing tests:** `step-up endpoint sets a fresh step-up for this session`; `step-up endpoint rejects unknown fields`; `reset endpoint requires step-up` (403 `STEP_UP_REQUIRED`); `reset endpoint refuses support and sales` (404); `reset endpoint resets once per idempotency key`; `step-up next parameter only accepts relative admin paths` (unit test of the sanitiser: `/admin/team` ok, `https://evil.example`, `//evil`, `/merchant` → `/admin`).
- [ ] **Step 2: Run** `npm test -- src/lib/admin/pages.integration.test.ts src/lib/admin/route-inventory.test.ts` → FAIL.
- [ ] **Step 3: Implement** pages, components and the two route handlers.
- [ ] **Step 4: Run** → PASS; `npm run typecheck && npm run lint && npm test` → all PASS.
- [ ] **Step 5: Commit** `Add the founder console shell, team and audit pages`.

### Task 10: Runbook, local setup and recovery drill

**Files:**
- Create: `docs/founder-console-runbook.md`, `scripts/admin-local-access.ts` (prints a local_test JWKS and signs a 12-hour Access token for a given allowed email, refuses in production)
- Modify: `package.json` script `"admin:local-access": "tsx scripts/admin-local-access.ts"`

**Interfaces:**
- Runbook sections: (1) Cloudflare Access application for `admin.getloynara.com` on the existing tunnel: allow list = founder, partner, founder's offline backup identity; copy team domain and audience tag into the five variables; (2) creating the two admin accounts with `operator:provision-identity`, then `admin:grant` (founder: `founder`; partner: `support` and `sales`); (3) first sign-in and TOTP enrolment, storing backup codes offline; (4) recovery table from spec §4.7 with the exact commands; (5) local development: `ADMIN_ORIGIN=http://admin.localhost:<port>`, `ADMIN_ACCESS_MODE=local_test`; `admin:local-access` prints a token that is sent as the `Cf-Access-Jwt-Assertion` header (`curl -H`, or a header-injecting browser extension). There is no cookie or query-string fallback.

- [ ] **Step 1: Write the failing test** `scripts/admin-local-access.test.ts`: `refuses in production`; `signs a token that verifyAccessAssertion accepts in local_test mode`.
- [ ] **Step 2: Run** `npx vitest run scripts/admin-local-access.test.ts` → FAIL.
- [ ] **Step 3: Implement** the script and write the runbook.
- [ ] **Step 4: Recovery drill on the local stack** (manual, record results at the end of the runbook): sign in with a backup code; run `npm run admin:reset-2fa -- --target local --email <founder>`; re-enrol; confirm the audit page shows both events. Then `npm run typecheck && npm run lint && npm test` → all PASS.
- [ ] **Step 5: Commit** `Document the founder console setup and recovery`.

---

## Done means

- All tasks committed on one branch; `npm run typecheck`, `npm run lint`, `npm test` pass on the isolated test database.
- Recovery drill recorded in `docs/founder-console-runbook.md`.
- No change outside the files listed above except lockfile updates for `jose`.
- Nothing deployed; no Cloudflare or production changes.
