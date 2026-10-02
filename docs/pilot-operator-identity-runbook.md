# Pilot runbook — operator identity provisioning

IDs such as O-004 or R-010 refer to the Launch Ledger (`docs/launch-ledger/` on branch `docs/launch-ledger-checkpoint-001`).

**Scope:** create the sign-in identity for a pilot merchant owner (or a staff member) while public registration is disabled.
**Tool:** `scripts/operator-provision-identity.ts` (`npm run operator:provision-identity -- …`), library and guards in `scripts/operator-identity.ts`.
**Status:** committed on `pilot/hygiene-claude`; **not deployed**. Running it on production needs a deployed build that contains it plus a separate, action-time owner approval (see §1).

## What the tool does and does not do

| It does | It never does |
|---|---|
| Creates exactly one Better Auth user and one credential account (`emailVerified=false`), in one transaction | Create a tenant, location, programme, reward, subscription, staff role, invite, membership, session, wallet pass, tag or outbox job |
| Generates a 256-bit random temporary password in-process | Accept a password as an argument or environment variable, or print it |
| Seals `{email, temporary_password, auth_user_id}` with RSA-OAEP (SHA-256) to a transport **public** key you provide and prints only the sealed envelope | Send any e-mail, enable registration, or change any setting or flag |
| Reports an existing identity and changes nothing when the e-mail already exists (case-insensitive) | Reset a password, link an account to an existing user, or "repair" a user without a single credential account (it refuses) |
| Prints a non-secret audit line: time, status, user id, first 12 hex of SHA-256(e-mail), e-mail domain, counts that must be 1/false/0/0 | Print the full e-mail, the password, connection strings or error details (refusals print one reason code) |

**Refusals (all happen before any database connection):** missing/unknown `--target`; `PRODUCTION_ENVIRONMENT` is not `loynara-production`; `NODE_ENV` is not `production`; database host is not a private `*.railway.internal` host (a public TCP proxy, localhost or any other host is refused); `BETTER_AUTH_URL`/`PUBLIC_BASE_URL` not an identical non-local `https` origin; `PUBLIC_REGISTRATION_ENABLED` is not `false`; invalid e-mail/name; transport key missing, a private key, not RSA, or under 3072 bits. The `local` target accepts only the loopback `looplocal` database and refuses when the production marker is set. It also refuses to run if Better Auth is configured with a database hook or a verification-mail hook, so user creation cannot send e-mail.

## 1. Before you run it

1. The owner gives an explicit approval, in chat, for **this identity** (named person, role, purpose) at action time. An earlier approval for a different identity does not carry over.
2. A production build containing this script is deployed (separate approval, same exact-commit process as the dashboard releases). Until then the script does not exist on the host.
3. The credential-lifecycle decision (O-004) is recorded: passwords are operator-set and handed over out of band; **there is no self-service password change or reset in the product** (R-010). Tell the merchant before creating the account that there is no self-service reset; the operator resets the password in person (recovery runbook, section B).
4. Registration stays disabled (`PUBLIC_REGISTRATION_ENABLED=false`). Do not change any variable for this task.

## 2. Prepare the transport key (operator machine, outside iCloud Desktop)

```bash
umask 077
mkdir -p ~/Loynara-operator-keys && cd ~/Loynara-operator-keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out transport-private.pem
openssl pkey -in transport-private.pem -pubout -out transport-public.pem
```

Use one key pair per handoff and delete the private key after the credential is delivered. Never commit, e-mail or paste the private key. Only `transport-public.pem` goes to the host.

## 3. Run (private Railway worker console, the same private context used for earlier identity provisioning)

```bash
export OPERATOR_TRANSPORT_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----
…contents of transport-public.pem…
-----END PUBLIC KEY-----'
npx tsx scripts/operator-provision-identity.ts --target loynara-production --email owner@pilot-merchant.example --name "Owner Name"
```

Expected output: one `OPERATOR_IDENTITY_AUDIT {…}` line with `"status":"created"` and one `OPERATOR_CREDENTIAL_ENVELOPE <base64>` line. A refusal prints only `OPERATOR_IDENTITY_REFUSED <CODE>` and exits 1; fix the cause, do not work around the guard.

Copy the envelope and the audit line to the operator machine (they are not secret without the private key). Do not paste the envelope into chat logs unnecessarily.

## 4. Verify (read-only)

Run in a `BEGIN READ ONLY … ROLLBACK` transaction, as in earlier verification:

```sql
select (select count(*) from "user") as users, (select count(*) from account where "providerId" = 'credential') as credential_accounts,
       (select count(*) from session) as sessions, (select count(*) from staff_roles) as staff_roles,
       (select count(*) from tenants) as tenants, (select count(*) from outbox_jobs) as outbox_jobs;
```

Compare with the counts before: only `users` and `credential_accounts` increase, by exactly one per identity. Record the audit line in the operator log (not the envelope's contents).

## 5. Open the credential and hand it over (operator machine only)

```bash
umask 077
echo '<envelope>' | base64 -d | openssl pkeyutl -decrypt -inkey transport-private.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 > credential.json
```

`credential.json` holds the e-mail and temporary password. Never `cat` it into a shared screen or chat. Hand the password to the merchant out of band (in person or by a different channel than the e-mail address), have them store it in a password manager, then `shred`/`rm` `credential.json` and the private key.

## 6. After provisioning

- **Owner:** signs in and completes the onboarding wizard (identity-only accounts are supported); that is what creates tenant, location and programme.
- **Staff:** provision their identity the same way, then the owner creates an invite for the **same e-mail address**; acceptance requires that e-mail to match. The invite link is shown to the owner on the staff page with a copy button and is not sent by e-mail; the owner shares it out of band.
- **Retry:** re-running with the same e-mail is safe and reports `existing`; it issues no new credential.
- **Lost envelope or forgotten password:** use the operator-assisted reset, `npm run operator:reset-credential -- --target loynara-production --email …`, described in [pilot-recovery-runbook.md](pilot-recovery-runbook.md) section B. The provisioning tool itself never re-issues. Do not delete rows to "start over". Any deletion is a production write that needs its own explicit approval, and the earlier synthetic-cleanup exception does not apply to real merchant data (X-006).

## 7. Local rehearsal (no production)

```bash
DATABASE_URL=postgresql://looplocal:…@localhost:<port>/looplocal BETTER_AUTH_URL=http://localhost:3000 PUBLIC_BASE_URL=http://localhost:3000 NODE_ENV=development \
OPERATOR_TRANSPORT_PUBLIC_KEY="$(cat transport-public.pem)" npx tsx scripts/operator-provision-identity.ts --target local --email test@example.test --name "Local Test"
```

Automated tests: `scripts/operator-identity.test.ts` (guards, identity-only, idempotency, rollback, no password in output).
