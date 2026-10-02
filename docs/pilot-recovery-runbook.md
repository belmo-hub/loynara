# Pilot runbook — manual account and card recovery (production e-mail disabled)

IDs such as O-004 or R-010 refer to the Launch Ledger (`docs/launch-ledger/` on branch `docs/launch-ledger-checkpoint-001`).

**Scope:** the minimum pilot-safe handling of lost access while production external e-mail stays **disabled** (R-013, O-006). This is policy and procedure only. It does not enable e-mail, change code, or add database edits. Anything that would write to production data outside the normal product flows needs its own explicit owner approval at action time.

## Principles

1. **No self-service reset exists** for passwords (R-010) and e-mail recovery of cards is off. Do not improvise database edits.
2. **Verify before acting.** Recovery is for a person the merchant knows in person at the counter; the operator or owner never acts on a request received only by message.
3. **Prefer prevention.** Tell people before the pilot starts: the card link is the card; save it; passwords go in a password manager.
4. **Nothing is silently written.** Every manual step is either a normal in-product action (cashier award, staff revoke/invite), the reviewed operator reset tool (section B), or is escalated.
5. **Record each recovery** in a pilot log: date, merchant, kind, who verified, what was done. No passwords, no full card links.

## A. Customer lost the card link (browser card)

The card link carries the only credential. The product has no operator tool to re-display or rotate it; the e-mail recovery path is disabled in production.

1. Merchant staff verify the person in the shop (they know the customer or the customer shows an earlier receipt/stamp history).
2. **Enrol a new card** for the same programme through the normal join QR.
3. The **owner** decides how many stamps/points to carry over, based on what the merchant's own record shows (for example the paper card or the cashier history). The cashier then books them as a **normal award** with an `idempotencyKey` and a note in the pilot log that it is a recovery carry-over. This uses the existing ledger and is auditable; do not edit balances in the database.
4. The old card cannot be closed without its link and stays dormant. Note it in the pilot log. It cannot earn unless someone presents the old link; the merchant accepts this residual risk for the pilot.
5. If the customer later finds the old link, the merchant decides which card stays; closing a card is done by the card's holder from the card page.

If the merchant is not willing to carry stamps over manually, the fallback statement to customers is: **"Save your card link; if you lose it, you start a new card."** State this at enrolment during the pilot.

## B. Owner or staff member forgot their password — operator-assisted reset

There is no self-service or e-mail reset (and none is planned for the pilot). The operator resets the password of the **existing** identity with `scripts/operator-reset-credential.ts`. The reset keeps the same account, the same merchant, role and history: no new e-mail identity, no re-invite, no revoke.

1. **Verify the person in person** (owner: the merchant owner themselves; staff: the owner confirms who it is). Never reset on a message alone.
2. **Owner approval at action time** for this reset, named person and role. An earlier approval does not carry over.
3. Prepare a transport key pair exactly as in [pilot-operator-identity-runbook.md](pilot-operator-identity-runbook.md) §2.
4. In the private Railway worker console:

   ```bash
   export OPERATOR_TRANSPORT_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----
   …contents of transport-public.pem…
   -----END PUBLIC KEY-----'
   npx tsx scripts/operator-reset-credential.ts --target loynara-production --email owner@pilot-merchant.example
   ```

   The tool applies the same target guards as provisioning (private Railway database, production marker, https origin, registration disabled). It refuses an unknown e-mail, a user without exactly one credential account, a credential account Better Auth's own reset would not target, and any wrong environment. It prints one `OPERATOR_CREDENTIAL_RESET_AUDIT` line and one `OPERATOR_CREDENTIAL_ENVELOPE` line; a refusal prints one reason code only.
5. **What it does, in one transaction:** generates a new random temporary password; stores its hash with Better Auth's own hasher and `updatePassword` (the steps of Better Auth's own reset route); **revokes every session of that user** (they are signed out everywhere); reads back that the new password verifies, the old hash is gone and no session remains; seals the password to your transport key. If any step fails, nothing changes.
6. **What it never does:** create a user, change the e-mail, touch tenants, locations, programmes, roles or invites, send e-mail, or print the password.
7. Open the envelope on the operator machine (identity runbook §5), hand the password over out of band, have the person store it in a password manager, then delete `credential.json` and the private key. Record the audit line (not the envelope) in the pilot log: it contains the user id, an e-mail hash prefix and the number of revoked sessions.
8. Read-only check afterwards: the user count is unchanged and no session exists for that user.

The old password stops working immediately. If the envelope is lost, run the reset again; it simply issues another temporary password.

## C. Operator-side prevention checklist (before the first real merchant)

- [ ] Owner password stored by the merchant in a password manager; confirmed at handoff (a reset is possible, section B, but costs the merchant a visit and an approval).
- [ ] Merchant told: no self-service reset (the operator resets it in person), who to call, and that card links must be saved.
- [ ] Customer join text or counter sign tells guests to save/bookmark the card link.
- [ ] Pilot log started; support contact recorded (O-009).
- [ ] O-004 decision recorded (operator-set credentials with out-of-band handoff accepted for the pilot, or a reset flow scheduled).

## What would end this manual process

Approving the transactional e-mail flag and running the release-origin recovery test (T-083), plus a self-service password change/reset flow. Neither is part of this slice.
