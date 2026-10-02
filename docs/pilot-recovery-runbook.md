# Pilot runbook — manual account and card recovery (production e-mail disabled)

IDs such as O-004 or R-010 refer to the Launch Ledger (`docs/launch-ledger/` on branch `docs/launch-ledger-checkpoint-001`).

**Scope:** the minimum pilot-safe handling of lost access while production external e-mail stays **disabled** (R-013, O-006). This is policy and procedure only. It does not enable e-mail, change code, or add database edits. Anything that would write to production data outside the normal product flows needs its own explicit owner approval at action time.

## Principles

1. **No self-service reset exists** for passwords (R-010) and e-mail recovery of cards is off. Do not improvise database edits.
2. **Verify before acting.** Recovery is for a person the merchant knows in person at the counter; the operator or owner never acts on a request received only by message.
3. **Prefer prevention.** Tell people before the pilot starts: the card link is the card; save it; passwords go in a password manager.
4. **Nothing is silently written.** Every manual step is either a normal in-product action (cashier award, staff revoke/invite) or is escalated.
5. **Record each recovery** in a pilot log: date, merchant, kind, who verified, what was done. No passwords, no full card links.

## A. Customer lost the card link (browser card)

The card link carries the only credential. The product has no operator tool to re-display or rotate it; the e-mail recovery path is disabled in production.

1. Merchant staff verify the person in the shop (they know the customer or the customer shows an earlier receipt/stamp history).
2. **Enrol a new card** for the same programme through the normal join QR.
3. The **owner** decides how many stamps/points to carry over, based on what the merchant's own record shows (for example the paper card or the cashier history). The cashier then books them as a **normal award** with an `idempotencyKey` and a note in the pilot log that it is a recovery carry-over. This uses the existing ledger and is auditable; do not edit balances in the database.
4. The old card cannot be closed without its link and stays dormant. Note it in the pilot log. It cannot earn unless someone presents the old link; the merchant accepts this residual risk for the pilot.
5. If the customer later finds the old link, the merchant decides which card stays; closing a card is done by the card's holder from the card page.

If the merchant is not willing to carry stamps over manually, the fallback statement to customers is: **"Save your card link; if you lose it, you start a new card."** State this at enrolment during the pilot.

## B. Staff member lost their password

No reset. Procedure:

1. Owner verifies the person in person.
2. Owner **revokes** the staff access in the dashboard (staff page). This stops the old access immediately.
3. Operator provisions a **new identity** with a **different e-mail address** ([pilot-operator-identity-runbook.md](pilot-operator-identity-runbook.md)); the old identity stays inactive and unused.
4. Owner invites the new e-mail to the location with the same role; the invite is shared out of band.
5. Log the change. The audit trail of revocation and invite is kept by the product.

## C. Owner lost their password

There is **no safe in-product or operator path today.** Do not guess:

- Staff accounts cannot take over ownership, and a second owner identity cannot be attached to the same merchant.
- A password reset would be a direct production credential write. It needs a **separately designed and explicitly approved** procedure (not part of this slice).

Pilot handling: the merchant keeps operating through already-signed-in staff sessions where possible; the operator opens a pilot incident, and the **owner (Youssef) decides** between (a) building the reset procedure first, or (b) pausing the pilot. Until that decision exists, treat this case as **BLOCKED**, and make sure each merchant owner has stored the password in a password manager before go-live.

## D. Operator-side prevention checklist (before the first real merchant)

- [ ] Owner password stored by the merchant in a password manager; confirmed at handoff.
- [ ] Merchant told: no self-service reset, who to call, and that card links must be saved.
- [ ] Customer join text or counter sign tells guests to save/bookmark the card link.
- [ ] Pilot log started; support contact recorded (O-009).
- [ ] O-004 decision recorded (operator-set credentials with out-of-band handoff accepted for the pilot, or a reset flow scheduled).

## What would end this manual process

Approving the transactional e-mail flag and running the release-origin recovery test (T-083), plus a password change/reset flow. Neither is part of this slice.
