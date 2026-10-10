# LOY-153 — atomic staff invitation acceptance

Base: `1c2345367a8b2fa9fce7293790d1a163b799f2ac`. This commit contains a bounded local correction, not full ticket or launch acceptance. LOY-153/154 remain unaccepted; LOY-157/158 credential recovery/departure verification remains outstanding. LOY-159 explicitly requires founder multi-location/programme policy.

## Verified gap and correction

A real PostgreSQL controlled regression held an inactive staff role row while two distinct valid invitations attempted acceptance for the same account. Both operations read inactive state before their writes; the unchanged base accepted both and overwrote the role/location. The new test failed with two fulfilled results, while all four existing staff tests passed.

Acceptance now locks the authenticated account before reading its current email, locking the invitation and evaluating role assignment. This matches merchant onboarding's existing identity-first lock order, also serializing first assignment. Exactly one concurrent reactivation succeeds; the loser returns ALREADY_ASSIGNED, consumes no invitation and appends no acceptance event. Invalid/expired/revoked invitations and foreign-tenant assignments remain denied. No schema, customer session, NFC, consent, role-policy or provider changes.

## Verification

Synthetic local PostgreSQL on port 55433, disposable looplocal_test, clean exact-lock offline npm install, synthetic auth configuration and localhost origins only. No production credentials or hosted mutations.

- Before source change: staff integration 4 PASS / 1 expected FAIL; both competing invitations fulfilled.
- After correction: 50 PASS / 7 files: staff (7), onboarding compatibility, product, locations, NFC cashier, secure tap and loyalty.
- Additional compatibility: 29 PASS / 5 files: staff page, customer session, staff push and adversarial push cases.
- Targeted ESLint, standalone tsc --noEmit, git diff --check and default Next/Turbopack build PASS.
- Independent read-only sensitive review: no remaining Critical/Important findings introduced by the slice; identity-first ordering compatible with inspected onboarding/revocation/schema paths.

No new test/build failure required a base comparison. The newly added controlled regression ran against unchanged source before correction; assertions were not weakened.

## Outstanding acceptance and policy

79 tests across 12 files are local evidence, not a configured full-suite result, production authorization audit or independent merchant acceptance. Real staff credential recovery, revoked-session checkout matrices and multi-location semantics remain open. Existing reactivation through outstanding valid invitations is inherited behavior, not a new departure policy. No invitation revocation UI or schema redesign is claimed.

Founder actions: independently rehearse LOY-154 owner/manager/cashier, expiry/revocation and two-tenant/location matrices with reviewed SHA; explicitly decide LOY-159 multi-location staff and shared/independent programmes. Any hosted execution needs separate authorization. Preserved ancestry includes frozen 32b27ec, campaign e1aae658 and diagnostic 9848e759. No protected ref was merged or acceptance gate closed.
