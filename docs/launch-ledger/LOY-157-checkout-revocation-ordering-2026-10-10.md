# LOY-157 / LOY-83 — checkout and revocation ordering

Base `667aafbe107aa0c2e54c88c220da50d19800ebd8`; bounded local correction only. Neither ticket nor independent LOY-158/84 acceptance is complete.

## Verified defect and invariant

Three controlled PostgreSQL regressions paused a real award, redemption or manager correction after reading an active role but before inserting its ledger entry. On unchanged source, revokeStaff completed while checkout remained paused, permitting that transaction to book after revocation returned. Three expected FAIL; onboarding compatibility control PASS.

Invariant: a financial checkout that locks an active role first commits before revocation returns; a revocation that wins the role lock makes checkout deny access. Previously completed ledger operations are not reversed.

The shared checkoutStaff helper now acquires authenticated user KEY SHARE before active staff SHARE inside award/redeem/reverse transactions. It retains existing tenant/location/role/limit checks and PostgreSQL rechecks the active predicate after waiting. The user-before-staff order is necessary because migration 0000 defines ledger_actor_user_fk; a staff-only SHARE shortcut could deadlock against onboarding's user UPDATE then staff UPDATE locks. Independent design review caught this before implementation; that shortcut was never implemented. No identity/session/role-model redesign or migration.

Cashier-confirmed NFC and offline reconciliation delegate to the same award authorization. Trusted automatic NFC retains its existing bypass. No provider network I/O is introduced or held by these locks. Customer 90-day inactivity / 365-day maximum policy is unchanged.

## Local evidence

Clean exact-lock offline install; disposable localhost looplocal_test on 55433; synthetic auth configuration only.

- Unchanged source: three financial-ordering tests expected FAIL, onboarding control PASS.
- Final controlled ordering: 5 PASS (award/redeem/reverse checkout-first, revocation-first no ledger/balance mutation, onboarding-first no deadlock).
- Combined focused evidence: 108 unique tests PASS across 13 files. Coverage includes staff invitations/revocation, loyalty/corrections, offline, NFC cashier/lifecycle/secure tap, referrals, onboarding compatibility, staff push ownership/revocation/adversarial cases and preserved customer sessions.
- Targeted ESLint, standalone tsc --noEmit, git diff --check and default Next/Turbopack build PASS.
- Independent read-only final sensitive review: no remaining Critical/Important introduced findings; user/FK/staff ordering verified from source and migrations. Inherited referral membership lock cycles remain separate.

No assertions were weakened. No new final test/build failures required unchanged-base triage; the original defect was reproduced on unchanged source.

## Still open

This establishes local financial authorization ordering, not complete staff credential recovery, password changes, actual browser-session end-to-end operator acceptance, invitation departure policy or production push/physical NFC acceptance. Existing outstanding invitations and LOY-159 multi-location/shared programme policy remain unresolved separately. Do not treat this commit as full LOY-157/83 acceptance. Full configured integrated suite remains pending; provider/legal/founder gates remain open. No deployment, hosted mutation, credential change, protected merge or acceptance closure.
