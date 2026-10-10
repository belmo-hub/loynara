# LOY-43 customer export snapshot and privacy acceptance matrix

Local engineering evidence, 2026-10-10 Europe/Berlin. Base 7e5da56d8de0a157dfb0242c494161c43cc6e9a3. Result is the commit containing this record. LOY-43 and LOY-209 remain Backlog / Must Launch; no external acceptance or legal approval is asserted.

## Verified defect and change

A real PostgreSQL driver gate pauses delivery of the actual membership SELECT result. A concurrent award commits before the remaining export reads. On unchanged base this reproducibly returns membership balance 0 with ledger total 2. The same regression passes after every customer-export query uses one read-only repeatable-read transaction. A fresh request sees balance 2 and its ledger. No financial writer locks, new fields, authorization relaxation, retention periods or deletion rules are introduced.

An export already authorized at its first SELECT may finish after concurrent closure/reissue; later requests reject the changed bearer. exportedAt is response generation time, not an exact snapshot timestamp. Concurrent redemption/consent and transaction failure cleanup lack dedicated new interleaving tests; all reads use the same transaction. Independent read-only security review found no material production defect and prompted robust driver-spy cleanup.

## Requirement matrix

| Requirement | Local evidence | Outstanding acceptance |
| --- | --- | --- |
| Consistent card activity download | Read-only repeatable-read snapshot; balance/ledger regression | Independent two-tenant mobile/new/returning/closed-card acceptance |
| Bearer and tenant isolation | Unknown token, scan-code, retired token rejected; another tenant activity excluded and unchanged | Independent role/session/origin/replay matrix and complete export scope |
| Export coverage | Format v1 explicitly pseudonymous-card-activity-without-contact-records: programme, balance, ledger, redemptions, consent events | Contact/recovery/referral/purchase/security/provider/suppression data coverage requires approved scope; current narrow format is not a complete privacy-rights export |
| Closure | Existing member-locked closure deletes member contacts/challenges, withdraws marketing consent, suppresses member-linked queues, retires bearer/scan code, queues Wallet revocation | Shared recovery identity and other categories require explicit approved handling; provider and physical acceptance remain open |
| Actual deletion and retention | Existing retained pseudonymous membership/append-only ledger/consent explicitly pending approved policy | Founder/professional category-level grounds, periods, deletion/anonymization and backup/processor policy; do not delete ledger or invent periods |
| Incident response | No new claim or implementation in this slice | Approved runbook and independently verified response procedures under LOY-209 |

## Validation and limitations

Dedicated synthetic localhost PostgreSQL; exact lockfile dependencies; no production credentials or external sends. Final focused run: 5 files, 27 passed, 0 failed, 1 existing optional Mailpit skip. Includes customer-export snapshot, lifecycle, reissue, recovery and merchant-member integration suites. Route type generation, tsc --noEmit, scoped ESLint, git diff --check and default Next.js 16.3.6 production build pass. No fresh browser or global-suite claim: previous global run remains 152 files / 1414 passed / one skip, with a separate earlier 10-pass Mailpit capture.

Test development failures were a driver-probe callback/Promise mismatch (corrected before real RED) and a synthetic consent source UUID exceeding existing varchar(32) (corrected to 32-character synthetic identifier). Production tests were not weakened. One automatic approval-review timeout was retried once successfully; it was not a safety rejection. Sanitized evidence reports outcomes rather than bearer tokens, recovery links, message bodies or live personal data.

Frozen codex/nfc-final-customer-policy-v1 remains 32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388; campaign e1aae658 and diagnostic 9848e759 are ancestors. No protected merge, deployment, hosted product mutation, provider activation or acceptance closure.
