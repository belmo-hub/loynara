# Merchant onboarding and support handoff — local technical rehearsal

This is the current integrated **technical procedure**, not a release, human identity approval or launch-readiness certificate. LOY-151 requires a repeatable onboarding/support handoff; LOY-152's independent 15–30-minute operator trial remains OPEN. Historical pilot procedures and their deployment state remain in [identity provisioning](pilot-operator-identity-runbook.md) and [manual recovery](pilot-recovery-runbook.md). This document connects existing application operations; it adds no recovery or commercial policy.

## Prerequisites and boundary

Use only an explicitly disposable synthetic local database named `looplocal_test`, reachable on loopback, with the existing schema and dependencies. Never point this rehearsal at production, a hosted preview, personal data or a concurrent test run. Preserve the reviewed Git SHA and environment identity. Database reset is destructive to this **test database**: the automated fixture truncates tenant/auth/rate-limit data. All fixtures use `.test` identities. Provider delivery, Wallet transport and live billing stay OFF. No installs or new worktrees are necessary when existing dependencies are available; disk/worktree rules still apply.

The automated rehearsal uses actual Better Auth sign-in and authenticated application **route handlers with Request/Response objects**, backed by PostgreSQL. It is not a network/browser run, physical identity verification, provider delivery or a timed novice-user trial. Temporary synthetic sign-up is fixture setup, not authorization to enable public registration on a hosted environment. Real identity provisioning/reset still requires the separate approvals described in the historical runbooks.

With the project's established local test environment configured, run this focused package:

```sh
./node_modules/.bin/vitest run src/lib/merchant-handoff.integration.test.ts src/lib/readiness.integration.test.ts
```

For a complete fresh synthetic stack, use the existing `npm test` infrastructure; inspect `scripts/test-local.sh` first, including its Docker/database targets and disk needs. Do not start or alter Docker/Colima just to obtain a rehearsal result. The native Goal used its already-owned PostgreSQL on loopback port55433, database `looplocal_test`, with a credential-whitelisted runner and no production dotenv files. Do not copy production credentials into a worker. A refusal or missing prerequisite is a blocker to reconcile, not permission to bypass a guard.

## Operator steps and authoritative checks

| Step | Existing product operation | Expected result and retained non-secret evidence |
| --- | --- | --- |
| Identify access | Sign in as the synthetic owner; `GET /api/me` before onboarding | Exact authenticated user ID; tenant is null. Never infer a merchant from an email search or another session. |
| Configure merchant | Complete normal onboarding; `POST /api/merchant/onboard` | HTTP201 with tenant, location, programme IDs and programme slug. Re-read `/api/me`: same owner, matching tenant/location/programme, role owner. Record IDs only in the synthetic rehearsal. |
| Check setup | Owner overview Startklar; `GET /api/merchant/readiness` | Same location, programme configured, requiredDone1/requiredTotal3 before enrollment or award. Configuration alone is not acceptance. |
| Give cashier access | Owner Team invitation; invited synthetic account accepts `/api/staff/accept` | Cashier `/api/me` reports the intended tenant/location and cashier role. An invitation alone is not working access. Share real invitation links only through the approved operator process. |
| Enroll and book | Customer joins without email/marketing consent; cashier scans card or deliberately confirms locator lookup | Authorized `/api/cashier/lookup` supplies membership ID. The public card response intentionally does not. Book the synthetic award, retry the **same** request/key, then redeem the available reward. Exactly one award and one redemption remain in the scoped ledger. |
| Diagnose lost link | Owner/manager selects Customers → the correct card → **Karte neu ausstellen** | Confirm the intended merchant/location/card and entitlement independently. Cashiers and unauthenticated callers cannot perform reissue. Foreign membership access fails. Do not use recovery as permission to transfer balances or create a second membership. |
| Recover existing card | Record reason and supported verification method; explicitly tick **Berechtigung geprüft** | Same membership and locator, rotated bearer/scan credentials; old link and QR rejected. Retry the same decision/key after uncertainty; do not create a new key merely because a response was lost. Existing UI retains the retry key. |
| Reconcile | Re-open the new link; compare scoped ledger and security audit; refresh readiness | Balance/activity unchanged by reissue; one audited reissue for the same-key retry; no extra membership. Award/redemption/team evidence remains. Foreign merchant readiness remains unchanged. Legal/access entries remain external. |

Supported verification methods already in code are `card_link`, `stored_contact`, and `other_check`. They record **how the authorized person says entitlement was checked**; the application cannot independently know who is at the counter. The automated fixture uses `other_check` only as synthetic test input. Never report this as real identity acceptance.

Saved Wallet passes belong to the old credential and are revoked by the existing reissue operation. The customer adds a new pass from the new link. A local audit or queued revocation is not proof of device/provider propagation. Physical NFC/Wallet acceptance and current provider configuration require their separate gates.

## Failure, reconciliation and escalation

- Wrong merchant/location/role, HTTP401/403/404, false entitlement, or a missing readiness prerequisite: stop the affected operation. Refresh the correct authorized context; do not edit roles, identifiers, balances or sessions directly to manufacture success.
- In an uncertain recovery response, preserve the same decision/key and retry through the existing workflow. Reconcile membership/security evidence before another decision. A newly generated key is another rotation, not a rollback.
- Reissue cannot restore the old bearer link. Do not publish the old/new card URL, scan credential, password, invitation token, session cookie or sealed credential envelope in tickets, chat, screenshots or operator logs. Preserve SHA, environment, time, actor/merchant/location IDs where appropriate, status, audit action and sanitized counts instead.
- Forgotten operator/owner/staff password: use the reviewed operator-assisted reset runbook, with real in-person verification and named action-time approval. This rehearsal does not rerun or authorize a real credential reset.
- No available authorized identity check, provider confirmation, legal/commercial policy, hosted access or operator approval: queue the exact human action under the relevant issue and continue independent engineering.

An independent operator must still perform and time the actual UI workflow, test real support handover, and record environment, exact SHA, reviewer and failures. A passing automated package is **LOCAL TESTED technical evidence**, not LOY-151/152 independent acceptance or permission to launch.
