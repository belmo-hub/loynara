# Security audit, 10 November 2026

Full review of the Loynara application at `railway-rc` `1b77eeca`: web app, worker, operator scripts, CI and deployment files. It follows the audit of 15 October (`security/AUDIT-2026-10-15.md`) and concentrates on what was added since (27 new routes, Stripe billing, native Apple Wallet, operator tools, the demo environment), while re-checking the earlier results.

**Result: no Critical and no High finding.** Six Medium and thirteen Low findings, all listed below as tickets. Nothing was found that lets one shop read or change another shop's data, lets a lower role do an owner's work, forges a webhook, or books value without a signed-in staff member. No live problem on production data was found, and no fix was merged or deployed.

## How it was tested

- Code reading of every route under `src/app/api` (110 handlers) and the library functions behind them, in the risk order of the brief.
- Reproductions ran only against a throwaway local PostgreSQL 18 cluster on 127.0.0.1:54471 with synthetic data, through the project's own integration-test fixtures. No request was sent to any hosted address, and nobody logged in anywhere hosted.
- "Reproduced" below means a local test showed the behaviour. "Read" means the deciding lines were read and are quoted by file and line, but nothing was executed.
- The reproduction tests are not in the repository. They are kept with the audit notes (`security-audit-2026-11-10/repros/` in the CTO folder) and run with `npx vitest run <file>` after copying them into `src/lib/`.
- Secrets were never printed. The secret scan ran with full redaction.

## Summary

| ID | Severity | Finding | Proof |
| --- | --- | --- | --- |
| M-1 | Medium | `next`, `better-auth` and `zod` carry published critical and high advisories; none is reachable today | `npm audit`, each advisory checked against the code |
| M-2 | Medium | The NFC verification master was not rotated after the 21 October exposure; a forged tap can switch a plate off for good | Reproduced |
| M-3 | Medium | Self-service card recovery leaves the old QR code and saved Wallet passes working | Reproduced |
| M-4 | Medium | One Apple pass can register any number of made-up devices and overwrite another device's push token | Reproduced |
| M-5 | Medium | A signed-in account without a role can create its own working shop, outside the operator's shop creation | Reproduced |
| M-6 | Medium | No pace limit on award, redeem and correction | Reproduced |
| L-1 | Low | Two routes read the whole request body before checking its size | Read |
| L-2 | Low | Recovery requests can be used to pester or block a known address | Read |
| L-3 | Low | Typing a new address drops the confirmed recovery address at once | Read |
| L-4 | Low | Shared limits are charged before the request is checked | Read |
| L-5 | Low | The logo decoder runs before the permission check on the setup route | Read |
| L-6 | Low | A programme row is locked before the owner check, on routes without a limit | Read |
| L-7 | Low | Remaining routes without any rate limit | Read |
| L-8 | Low | Refused offline bookings are stored without a cap | Read |
| L-9 | Low | The ledger's append-only guard does not cover `TRUNCATE` | Read |
| L-10 | Low | Restore check leaves a decrypted dump on disk if killed; heartbeat URL on a command line | Read |
| L-11 | Low | The switched-off START guarantee can be gamed if it is ever switched on | Read |
| L-12 | Low | Runtime image still carries the whole source tree (open since October) | Read |
| L-13 | Low | 403 or 404 reveals whether a foreign id exists | Read |

## Medium findings

### M-1. Dependencies with published critical advisories

- **Where:** `package.json:54` (`better-auth` 1.7.6), `:58` (`next` 16.3.8), `:65` (`zod` 4.1.13 installed).
- **What:** `npm audit --omit=dev` reports 2 critical and 2 high advisories.
  - `next` ≤ 16.4.0: GHSA-2464-fhr4-w9xw (remote code execution in image optimisation), GHSA-673q-mjm6-r5xr (remote code execution through `use cache` functions), GHSA-p3m5-59mp-jv5r (denial of service with Server Actions). Fixed in 16.4.1.
  - `better-auth` < 1.7.7: GHSA-965c-763c-88jm and GHSA-r4xp-prcw-77qf (sign in as another user through Magic Link or the OAuth Proxy).
  - `zod` < 4.6.6: GHSA-mrhx-c7xc-m3w5 (memory exhaustion on unbounded arrays).
- **Reachable today?** No, checked one by one:
  - The image advisory is closed by `sharp` ≥ 0.35.5, which is pinned and is the only copy installed (`npm ls sharp`).
  - The code has no `use cache` and no Server Action (`grep` for both directives finds nothing).
  - `src/lib/auth.ts` enables neither Magic Link, social sign-in nor the OAuth Proxy.
  - Every array a client can send is length-limited (`src/lib/offline-queue.ts:16`, `src/lib/product.ts:360,387,563`, `src/app/api/merchant/program/rewards/route.ts:15`); the unbounded ones parse Stripe's answers only.
- **Why it still matters:** one new feature (a cached function, a sign-in plugin) would make a critical advisory live, and nothing in CI reports new advisories. Two criticals were published without anyone being told.
- **Fix:** upgrade `next` and `eslint-config-next` to 16.4.6, `better-auth` to 1.7.7, `zod` to 4.6.6; read the Next.js 16.4 upgrade notes in `node_modules/next/dist/docs/` first. Add a weekly `npm audit --omit=dev --audit-level=high` job or Dependabot alerts.
- **Ticket:** *Upgrade next, better-auth and zod past their open advisories.* Done when `npm audit --omit=dev` shows no high or critical entry, the full suite and the build pass, and CI reports new advisories.

### M-2. NFC verification master not rotated; a forged tap can disable a plate

- **Where:** `src/lib/secure-tap.ts:229` and `:238` (`set({ lastCounter: counter })`), `:213` (`if (counter <= tag.lastCounter)`).
- **What:** the rotation record of 22 October lists `NFC_VERIFY_MASTER_KEY` as not rotated ("later"). The runbook says a leaked master only allows fake waiting requests at the counter. It allows more: whoever holds the master, a tag's UID and its key reference can send one valid-looking tap with the highest counter value (16,777,215). The server stores it, and every later real tap of that plate counts as already used.
- **Proof (reproduced):** `repros/zz-audit-counter.integration.test.ts`. After one forged tap `last_counter` is 16777215; a real tap with counter 7 the next day returns `expired` and can never open a request. Only an operator re-registration brings the plate back.
- **Limits:** needs the master (exposed only if Railway's incident reached this project), plus UID and key reference, which are in the database and the registration bundle. No value is booked; the cashier confirmation still stands.
- **Fix:** rotate the verification master with the re-key tool (PR #234 is that work). Add this effect to section C of the incident runbook. Optional hardening: refuse a counter that jumps more than a few thousand beyond the last one.
- **Ticket:** *Rotate the NFC verification master and re-key the written plates.* Done when production verifies taps with a new master, every plate in use is re-keyed, and the runbook names plate shutdown as an effect of a leak.
- **Not known to this audit:** whether the rotation has happened since 22 October.

### M-3. Self-service recovery keeps the old QR code and Wallet passes valid

- **Where:** `src/lib/card-recovery.ts:72` rotates only `cardToken`. The staff reissue rotates both and revokes saved passes (`src/lib/card-reissue.ts:67` and `:74`). `src/lib/wallet/apple-service.ts:37` serves a pass as live while its credential hash, derived from the scan code, still matches.
- **Exploit:** someone who once held the card link (a found phone, a shared screenshot of the QR, a pass added to their own Wallet) keeps a working QR code after the owner "recovers" the card, and can redeem the owner's rewards at the counter. The notice mail tells the owner the old link no longer works.
- **Proof (reproduced):** `repros/zz-audit-repro.integration.test.ts`, test A: after recovery the old scan code still finds the card through `lookupCard`, and the pass issued before recovery is still served as `active`. The existing suite pins the same behaviour on purpose (`src/lib/card-recovery.integration.test.ts:72`).
- **Why Medium, not High:** the attacker must stand at the counter, and recovery was designed for a lost link, not a stolen card. It is a product decision: rotating the scan code also forces the honest owner to add the Wallet pass again.
- **Fix:** in `completeCardRecovery`, rotate `scanCode` and call `revokeCardWalletPasses(tx, tenantId, id, "reissued")`, as the reissue does; or keep the behaviour and say so in the recovery mail and the page ("Dein QR-Code bleibt gleich").
- **Ticket:** *Decide whether card recovery also replaces the QR code and saved Wallet passes.* Done when the decision is recorded and the code, its tests and the recovery texts match it.

### M-4. Apple Wallet device registration without a cap

- **Where:** `src/lib/wallet/apple-service.ts:57-58`; limiter at `src/app/api/apple/v1/devices/[deviceId]/registrations/[passTypeId]/[serial]/route.ts:10`, keyed on the device id the caller chooses.
- **Exploit:** join a shop (free), download the pass, read its serial and token, then register thousands of invented device ids for it. Each later update of that pass sends a push to every row, one after the other, on the production certificate; the outbox takes one job at a time, so other shops' pass updates wait behind it. Separately, the same call overwrites the push token of any device id the caller knows (`onConflictDoUpdate` on the device id alone), which silences that device's updates for every shop.
- **Proof (reproduced):** test B: 200 invented devices registered for one pass with one token, all stored; the push token of another card's device was overwritten.
- **Limits:** the per-address limit (600 per 15 minutes) still applies; a victim's device id is not public.
- **Fix:** refuse a new registration when the pass already has 10; do not change the push token of a device that holds registrations for other cards.
- **Ticket:** *Cap Apple Wallet registrations per pass and protect push tokens.* Done when an eleventh device for one pass is refused and a pass cannot change the token of a device registered for other cards, both pinned by tests.

### M-5. An account without a role can create its own shop

- **Where:** `src/lib/product.ts:98` (the branch for an account with no staff row), reached from `src/app/api/merchant/onboard/route.ts`.
- **Exploit:** public registration is closed, but with invite sign-up on, anyone holding a staff invitation link can create an account, skip the acceptance and call the setup route. They get a complete shop with a programme, a join link and Wallet passes. It has a draft subscription that is never billed, because no product path reads the subscription state (see I-1). Shops are meant to be created by the operator (`createShopWithOwnerInvite`).
- **Proof (reproduced):** test C: a fresh account with no role calls `createMerchant` and receives a working shop and subscription row. Every integration fixture uses this same path.
- **Limits:** needs an invitation link from a real shop; the shop shows up in the operator list.
- **Fix:** when public registration is off, refuse the no-role branch (`insertShop`) unless the caller is the invited owner of an operator-created shop. One condition in `createMerchant`.
- **Ticket:** *Refuse self-created shops while public registration is off.* Done when a role-less account gets 403 from the setup route in that configuration, and the owner-invite path still works.

### M-6. No pace limit on award, redeem and correction

- **Where:** `src/app/api/cashier/award/route.ts`, `src/app/api/cashier/redeem/route.ts`, `src/app/api/transactions/reverse/route.ts`: none calls a limiter. The offline path does (`src/app/api/cashier/offline/sync/route.ts:17`, 60 per 15 minutes).
- **Exploit:** a cashier, or whoever holds a cashier's session, books 10 stamps per call on their own card as often as they like, then redeems. The only limit is per call (`src/lib/award-limits.ts:4`).
- **Proof (reproduced):** test C: 100 awards of 10 by a cashier in a loop, balance 1,000.
- **Limits:** every booking is in the ledger with the actor, and the owner can correct it. Open since October as L-2; raised because the online door is now weaker than the offline one.
- **Fix:** the two limiter lines the offline route already has, per user, plus one per card (for example 120 bookings per user and 20 per card in 15 minutes; the numbers are a product call for busy counters).
- **Ticket:** *Limit how fast one account or one card can be booked.* Done when the limits are agreed, enforced on all three routes and pinned by a test.

## Low findings

Each is a ticket: title, where, acceptance.

- **L-1. Read the body with a size cap before parsing.** `apple/v1/.../[serial]/route.ts:14` and `api/auth/[...all]/route.ts:24` call `request.text()` and only then check the length, before any credential check. Done when both use the streaming cap of `jsonBody`.
- **L-2. Recovery mail: add a daily cap and keep the open link.** `src/lib/card-recovery.ts:32` deletes the address's open challenge on every request; `api/recover/route.ts:12` allows 3 per hour per address with no daily cap (up to 72 mails a day), and three requests lock the real owner out for the hour. Done when a repeat request re-sends the open link and one address gets at most a handful of mails a day.
- **L-3. Keep the confirmed recovery address until the new one is confirmed.** `src/lib/contact-verification.ts:114` sets the new address and clears the recovery token at once; the old address gets no notice. A brief holder of the link can so take the card over for good. Done when the old address stays valid until confirmation, or receives a notice.
- **L-4. Charge shared limits after the input is valid.** `api/tap/[ref]/route.ts:24` charges the per-plate bucket (600 per 15 minutes) before the chip data is checked: five addresses can block a plate. `api/enroll/route.ts:22` charges the per-programme bucket before validation, and five addresses fill it (25 per 15 minutes is 100 per hour each), not 20 as the comment says. Done when malformed requests no longer count and the comment is right.
- **L-5. Check permission and pace before decoding a logo.** `src/lib/product.ts:68` decodes the uploaded image (about 70 MB of memory for the largest allowed one) before the role check at `:73`, and the setup route has no limiter. Any signed-in account can use this to press on memory. Done when the setup route has the brand route's limiter and decodes after the role check.
- **L-6. Check the owner before locking the programme.** `src/lib/product.ts:193` and `:472` take `FOR UPDATE` on a programme found by its public slug before the owner check, on routes without a limit. A foreign account can make another shop's bookings wait. Done when the role is resolved first (as `src/lib/automations.ts:36-44` does) or the routes are limited.
- **L-7. Add limits to the remaining routes.** Without one: `merchant/export`, `merchant/email/test`, all six `staff/*`, `me`, `cashier/tap/pending`, `cashier/push/config`, and the public `program/[slug]`. Done when export, staff invite and `program/[slug]` at least are limited.
- **L-8. Apply the per-lease cap to refused offline bookings too.** `src/lib/offline-earning.ts:95` skips the cap once a refusal reason is set, so a revoked account can add 60 refused rows every 15 minutes without end. Done when the cap applies regardless of reason.
- **L-9. Refuse `TRUNCATE` on the ledger tables.** `drizzle/0000_real_boom_boom.sql:208` guards `UPDATE` and `DELETE` per row only. Not reachable from the application; defence in depth. Done when a statement-level trigger refuses `TRUNCATE` on `ledger_entries`, `redemptions` and `purchase_awards` (additive migration).
- **L-10. Tidy the backup scripts.** `scripts/production-restore-check.sh:51-54` writes the decrypted dump to a temp file removed only by an `EXIT` trap; `scripts/production-backup.sh:45` passes the heartbeat URL, itself a secret, on the `curl` command line. Done when the dump is piped or kept in a 0700 directory removed on every signal, and the URL comes from a config file or stdin.
- **L-11. Delete the dormant START guarantee code.** `src/lib/billing-stripe.ts:502-505`: an owner could reverse awards inside month one to earn the credit, then book them again. Switched off; removal is already planned (ENG-124). Done when the code is gone.
- **L-12. Slim the runtime image.** `Dockerfile:15` still copies the whole build stage, writable by the app user, and the base image is a tag, not a digest. Unchanged since October (L-3 there). Done as described there.
- **L-13. One answer for "not yours" and "not there".** `src/lib/product.ts:309-311`, `:368-370`, `:473-475`, `src/lib/secure-tap.ts:77-78`, `src/lib/referrals.ts:249-252`, `src/lib/plate-activation.ts:115-118` answer 403 for a foreign id and 404 for a missing one. Ids are random, so nothing practical leaks. Done when both give 404.

## Notes (no ticket unless you want one)

- **I-1. The subscription state gates nothing.** A cancelled or unpaid shop keeps working until the operator confirms the end (`src/lib/programme-end.ts:23`). This looks intended (#84); it is what makes M-5 cost money.
- **I-2. A correction can undo a redemption or an expiry** (`src/lib/loyalty.ts:427`), within the role limits and logged. Confirm it is wanted.
- **I-3. `GET /api/merchant/billing` can update the subscription row** (`src/lib/billing.ts:68-76`): own shop, fixture statuses only.
- **I-4. PassFast code and its webhook route are still shipped** although PassFast is not used. The route answers 404 unless its secret is set. Removing the code is a separate decision.
- **I-5. Carried over from October, unchanged:** the session token is readable in JSON answers, the CSP allows inline scripts, and recovery answers slightly faster for an unknown address.
- **I-6. Open items of the 22 October rotation** as last recorded: the log review (runbook step D) and the `loynara-device-test` tunnel. Their current state was not checked.

## Checked and found sound

- **Tenant and role separation.** Every route under `merchant/`, `cashier/`, `staff/`, `transactions/` and `me` was traced into its library function. Each id from a request is looked up with the actor's tenant, or the row is loaded and the actor's active role is checked against its tenant. Role lookups test `active`. The selected location is checked against the owner's tenant on every request. Request bodies pass strict schemas before any insert; the actor id is set after the spread.
- **CSRF.** Every state-changing route checks the Origin, public ones included. There are no Server Actions.
- **Operator routes and scripts.** All ten `operator/*` routes and their library functions call `assertPlateOperator`; non-operators get the same empty 404. Operator scripts refuse to run unless the target (`production`, `demo`, `local`) matches the environment marker and the database identity (`scripts/operator-identity.ts:32-64`).
- **Demo environment.** Demo-only paths need `DEMO_ENVIRONMENT=true` and never run with the production marker; the startup check refuses Mailgun, Stripe and Google settings there and requires a database that names itself demo.
- **Authentication.** Registration is closed unless an unexpired invitation for the exact address is presented; sign-in has per-address and per-account limits; Better Auth takes the client address only from the approved ingress header.
- **Billing.** No plan, price or quantity from a client reaches Stripe or the database. The Stripe webhook checks the signature in constant time within five minutes, stores each event id once, and re-reads the object from Stripe before writing. The fixture needs a non-production process, the local database and a long secret, and the configuration gate refuses it on production. Return addresses are built from `PUBLIC_BASE_URL` only.
- **Ledger.** The card row is locked before every balance check; amounts are whole numbers of at least 1, capped by role and guarded against overflow; one correction per booking, enforced by a unique index; idempotency keys are scoped to the tenant.
- **NFC.** The SDM check follows NXP AN12196 with a constant-time compare; keys are derived per tag from the verification master; the administrative master is refused in the production environment; counters are consumed under the tag's row lock. Production never books a tap without a staff confirmation.
- **Public card, recovery and Wallet routes.** Tokens have 256 bits, are stored hashed, single-use and short-lived. The Wallet download ticket is bound to its pass and expires after 120 seconds. The Apple pass token is bound to its serial. Mailgun and fixture webhooks compare in constant time and cannot verify with an unset secret.
- **Injection and browser.** No SQL is built from input (every `sql.raw` takes a constant or a name checked against `^[a-z_][a-z0-9_]*$`). No HTML sink exists. The review link is limited to Google hosts on the server. Return paths are limited to `/merchant/...`. No CORS header is sent. Logos are accepted as PNG, JPEG or WebP by magic bytes, limited to 2 MB and 25 megapixels, always re-encoded to PNG and served with `nosniff`; SVG never reaches the decoder. Push endpoints are limited to five known push hosts, so the server cannot be pointed at an internal address.
- **Logs and mail.** Log lines carry fixed text, ids and error names only. Mail subjects refuse line breaks; sender names are cleaned.
- **Secrets and supply chain.** A redacted scan of all 1,296 commits found 43 matches: test fixtures, commit hashes and session ids in documents, no real secret. `.env*`, `var/`, keys and dumps are ignored by git and by Docker. CI runs with `contents: read`, without stored credentials, on actions pinned to commit hashes. The production configuration gate refuses a production start without the environment marker, with placeholder or reused secrets, with any test or demo switch on, or with the administrative NFC key present.
- **Backups.** Dumps are encrypted before upload; a restore target must be another host, named `loynara_restore_*` and empty.

## Not audited

- Anything hosted: production, the demo environment, Railway, Cloudflare, Stripe and Mailgun dashboards, DNS. In particular, whether the Railway web service is reachable only through the tunnel (October's I-5; every per-address limit depends on it), whether DMARC is published (October's M-4), and the production database role's privileges.
- The state of the secret rotation after 22 October, beyond what the notes say.
- Real devices: Apple Wallet behaviour on a phone, NFC chips, the card reader tools under `src/lib/nfc-provision`.
- Google Wallet client code (switched off in production) and PassFast (not used).
- Behaviour under load for L-5 and L-6; the memory and lock effects are derived from the code, not measured.
- The marketing site build in `marketing-site/` beyond confirming it has no server code of its own.
- Better Auth's and Next.js's own internals beyond their published advisories.
- The October HTTP probes in `security/probes/` were not re-run; this audit used library-level tests instead of a running server.
