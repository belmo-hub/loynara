# Founder console setup and recovery

Phase 1 provides the private console, team access and audit log. It does not deploy the application or configure the public hostname. All commands below are local rehearsals with synthetic identities. Never point them at a shared or production database.

## 1. Access application and configuration

For a separately approved live setup, create a Cloudflare Access application for `admin.getloynara.com` on the existing private tunnel. Allow only the founder, partner and founder's offline backup identity. The origin must have no public bypass. This phase makes no tunnel, DNS or Access changes.

Configure these five values:

| Variable | Value |
|---|---|
| `ADMIN_ORIGIN` | `https://admin.getloynara.com` |
| `ADMIN_ACCESS_MODE` | `cloudflare` |
| `ADMIN_ACCESS_TEAM_DOMAIN` | The team's hostname, such as `your-team.cloudflareaccess.com`, without a scheme or path |
| `ADMIN_ACCESS_AUD` | This Access application's audience tag |
| `ADMIN_ALLOWED_EMAILS` | Comma-separated founder, partner and offline-backup addresses |

The application verifies the assertion's signature, issuer, audience, expiry and allow-listed email. That email must match the signed-in console account. Missing assertions and denied roles receive 404. Cookies stay host-only. The admin host serves only console paths, required auth endpoints and static assets; other hosts hide console paths.

An Access allow-list entry alone does not give console access. The offline backup identity needs its **own pre-provisioned console account with the founder role**, its own password, TOTP and offline backup codes. A different Access email cannot be used with the main founder account. Rehearse this identity before relying on it for inbox loss.

## 2. Provision accounts and grant roles

Use the existing encrypted identity flow described in `docs/pilot-operator-identity-runbook.md`. Generate and store the transport private key offline; supply only its RSA public key through `OPERATOR_TRANSPORT_PUBLIC_KEY`. Provisioning prints an encrypted credential envelope, never a password. Decrypt and transfer each initial credential privately using that runbook.

Use separate accounts for the founder and partner. They must not be merchant accounts. With the local runtime database `looplocal` and localhost HTTP URLs configured:

```sh
npm run operator:provision-identity -- --target local --email founder-admin@example.test --name "Synthetic Founder"
npm run operator:provision-identity -- --target local --email partner-admin@example.test --name "Synthetic Partner"
npm run admin:grant -- --target local --email founder-admin@example.test --role founder
npm run admin:grant -- --target local --email partner-admin@example.test --role support
npm run admin:grant -- --target local --email partner-admin@example.test --role sales
npm run admin:list -- --target local
```

For the offline identity, repeat provisioning with a separate address and grant `founder`. These example addresses are synthetic; actual addresses remain an operational setup decision.

Each write requires the exact displayed confirmation, for example `GRANT support partner-admin@example.test`. To revoke a role:

```sh
npm run admin:revoke -- --target local --email partner-admin@example.test --role sales
```

Type `REVOKE sales partner-admin@example.test`. Revoking the final founder is refused, including concurrent attempts. Role grants/revocations and recovery writes are audited atomically. No web route grants roles.

## 3. First sign-in and enrollment

1. Open `/admin/sign-in` through the configured Access identity and enter the separate console email and password.
2. The first sign-in is forced to `/admin/two-factor`. Confirm the password, scan the QR code in an authenticator app, and confirm a current six-digit code.
3. Save all **10 one-time backup codes** offline, then confirm **Ich habe die Backup-Codes sicher gespeichert**. The UI shows them only during this setup; they are not placed in URLs or browser storage.
4. Later sign-ins require the password and TOTP, or one unused backup code. Trusted-device bypass is disabled. Initial enrollment ends other password-only sessions. Console access requires evidence that this specific session completed MFA.

Console sessions expire after 30 minutes idle or 12 hours from sign-in. Sensitive actions require password plus TOTP again, valid for five minutes in that session only. Password failures on the console host and step-up failures are limited to five per 15 minutes per account and per IP; merchant limits remain unchanged.

The founder sees all audit events and all console accounts. Support and sales see their own events and account. The founder can reset another admin's factor after step-up. Their own factor is recovered through a backup code or the operator command.

## 4. Recovery

| Lost item | Recovery |
|---|---|
| Partner's phone/authenticator | Founder opens **Team**, chooses **Zweiten Faktor zurücksetzen**, confirms the action and completes step-up if requested. The partner signs in again and enrolls a new authenticator. |
| Founder's phone/authenticator | On sign-in choose **Backup-Code verwenden** and use one unused offline code; or run the local reset command below for a rehearsal. |
| Access identity or email inbox | Use the separately provisioned offline founder identity and its own credentials; its email must be on both Access allow lists. |
| Password | Use the existing encrypted `operator:reset-credential` workflow. Password-reset email is deferred to phase 2. |

Local founder recovery:

```sh
npm run admin:reset-2fa -- --target local --email founder-admin@example.test
```

Type `RESET-2FA founder-admin@example.test`. The command disables the factor, removes its encrypted data, revokes all that user's sessions, clears outstanding verification/MFA records and appends `admin.two_factor_reset` in the same transaction. The next password sign-in forces enrollment again. Never put passwords or codes in command arguments.

For a lost local password, follow the existing transport-key runbook, then:

```sh
npm run operator:reset-credential -- --target local --email founder-admin@example.test
```

Follow the existing recovery runbook's target checks and encrypted-envelope instructions. Keep the new envelope and transport private key separate. No credentials are displayed by the console.

## 5. Local development and verification

Use a disposable local database. The operator guard intentionally requires the runtime database name `looplocal`. Automated integration tests instead require `looplocal_test`; never relax either guard. A separate empty `looplocal` database in the owned disposable container is suitable for browser checks and the recovery drill.

For example, a local app on port 3095 uses:

```sh
export BETTER_AUTH_URL=http://localhost:3095
export PUBLIC_BASE_URL=http://localhost:3095
export ADMIN_ORIGIN=http://admin.localhost:3095
export ADMIN_ACCESS_MODE=local_test
export ADMIN_ALLOWED_EMAILS=founder-admin@example.test,partner-admin@example.test,founder-backup@example.test
npm --silent run admin:local-access -- --email founder-admin@example.test > /tmp/loynara-local-access.json
```

The output contains a public `jwks` object and a 12-hour `token`. Copy `JSON.stringify(jwks)` into `ADMIN_ACCESS_TEST_JWKS` in the local app environment before starting it. The signing private key is discarded. The helper refuses production and emails outside the allow list. Generating another key pair requires updating the local JWKS and restarting the local app.

Start the app with its separate local `DATABASE_URL` and a synthetic local `BETTER_AUTH_SECRET` of at least 32 characters. Keep external email disabled. Use the hostname from `ADMIN_ORIGIN` in the browser. For curl:

```sh
curl --resolve admin.localhost:3095:127.0.0.1 \
  -H "Cf-Access-Jwt-Assertion: <local token>" \
  http://admin.localhost:3095/admin/sign-in
```

For browser checks, use a header-injecting extension scoped strictly to this local admin origin. Send the token only in `Cf-Access-Jwt-Assertion`. There is no cookie or query-string fallback. The local mode is rejected by both the application verifier and production configuration checks when `NODE_ENV=production`.

The existing suite contains guards requiring port **55433** and the data directory `/private/tmp/loynara-goal-133-pg`. These can be satisfied inside an owned container without using a host database directory:

```sh
docker run -d --name loynara-console-pg \
  -e POSTGRES_USER=looplocal -e POSTGRES_PASSWORD=looplocal_local_only \
  -e POSTGRES_DB=postgres -e PGDATA=/private/tmp/loynara-goal-133-pg \
  -p 127.0.0.1:55433:5432 --tmpfs /private/tmp/loynara-goal-133-pg postgres:16
```

Before running this example, confirm the container name and port are unused. The directory shown is inside the disposable container, not a host mount. The test launcher creates `looplocal_test` and applies migrations. Set synthetic local auth configuration as well:

```sh
export TEST_PG_CONTAINER=loynara-console-pg TEST_PG_PORT=55433
export BETTER_AUTH_URL=http://localhost:3000 PUBLIC_BASE_URL=http://localhost:3000
export BETTER_AUTH_SECRET=synthetic-local-console-test-secret-at-least-32-characters
npm run typecheck
npm run lint
npm test
```

After a fresh checkout, run `npx next typegen` once if route types have not yet been generated. The forward migration is `0026_founder_console.sql`; its separately reviewed rollback is `docs/rollback/0026-founder-console-down.sql`. The rollback removes admin audit data and factor state, so preserve required evidence before any rollback; no rollback was performed against a shared environment.

## 6. Local recovery drill — 2026-10-16

Repeated after integrating `railway-rc` and renumbering the founder migration to 0026. The rehearsal uses only synthetic identities and the owned disposable local stack. Results are recorded after the backup-code sign-in, operator reset, reenrollment and audit-page checks complete. No production, Access or tunnel changes are part of this drill.

Completed at **2026-10-16 18:31 (Europe/Berlin)** on `admin.localhost:3095`, with synthetic `founder-console-local@example.test` in the separate local runtime database.

| Check | Observed result |
|---|---|
| Password + unused backup code | Browser sign-in succeeded and opened the console. |
| Operator recovery | `npm run admin:reset-2fa -- --target local --email founder-console-local@example.test` accepted the exact typed confirmation `RESET-2FA founder-console-local@example.test`. |
| Session revocation | Zero sessions and zero outstanding verification/MFA records remained for the synthetic founder immediately after reset; revisiting Team redirected to sign-in. |
| Reenrollment | The next password sign-in forced authenticator setup. The QR code and current TOTP were accepted; ten new backup codes were displayed and acknowledged. |
| Atomic audit | The audit page displayed both **Sitzung gestartet** and **Zweiter Faktor zurückgesetzt**. Filtering to `admin.two_factor_reset` showed exactly one operator reset event. |
| Earlier browser checks | Normal TOTP sign-in, session-bound step-up, desktop Team and phone-width audit views passed. |

The local Access assertion came from `admin:local-access`. No real account credentials were used, and no production, Cloudflare or tunnel state was changed.
