# LOY-283 — readable persisted merchant colours on enrollment

2026-10-11 Europe/Berlin, assignment LOY-ENG-20261011-049, coding child of LOY-175. Base e69e745b1e8388cbf1e2ea4b8e037b08b839cfd6. Reused existing staff-http-permissions checkout on codex/merchant-brand-consistency-049; no worktree/dependency installation. Disk27GiB. Coordinator requested Sol Medium discovery/High implementation/Medium review; existing executor retained because effective configuration setter unavailable. Independent read-only reviewer gpt-6.1-sol Medium; no parallel coding.

IMPLEMENTED: src/components/join-client.tsx now chooses inherited text colour with existing readableInk helper, using the same persisted six-digit colour and default background. No new branding option, colour validation, schema, permission, NFC/session, Wallet or provider contract. Existing light-colour browser card and studio behavior supplied the established rule.

RED: on unchanged app source, actual local Chrome owner signup/onboarding/editor saved #ffffff through authenticated routes into disposable PostgreSQL. At375px, enrollment heading After Café was rgb(255,255,255) on rgb(255,255,255), failing the new browser regression. One genuine expected failure; no fixture/provider/policy failure.

TESTED: extended e2e/merchant-brand.spec.ts verifies persisted light colour and heading after reload, first-visit and returning-member enrollment, secure existing-card link, correct card colour/identity and visible Coffee reward, while preserving original dark-colour route persistence and unauthenticated brand-read rejection. Browser1PASS after fix. Existing branding validation/cashier/foreign-merchant isolation, onboarding compatibility and contrast regression suite3files25PASS. Typegen/typecheck/zero-warning changed-file lint/default Next build/diff PASS. Full-suite and integrated exact-SHA receipt appended after verification.

Independent review found no material findings; inherited colour/fallback correct and recognition, redirect, consent and tenant authorization unchanged. Reviewer reran no tests. Local synthetic loopback app and disposable looplocal_test database only; external email flags disabled. Stopped local dev server before database/global suites.

PLANNED/OPEN: LOY-175 retains all original merchant-approved, Wallet/QR/stand, keyboard/screen-reader/reduced-motion/slow-state and physical iPhone/Android acceptance gates. Chrome375px is local browser evidence, not independent physical acceptance. No hosted migration, deploy, provider activation, customer message, tag operation, remote push or commercial acceptance. Existing deployment-trigger push hold remains.

Usage: cumulative native Goal6,193,503 reported tokens /32,025seconds observed during verification. Input, cached subset, output, reviewer/browser breakdown unmeasured; historical accounting not reset. Latest exact-SHA/usage receipt follows. External tracker creation LOY-283 and parent link confirmed; broad parent not transitioned.

Final configured global suite:159files1475PASS0FAIL1existing opt-inMailpitSKIP,125.70seconds, exit0. No assertion weakening or skips added. This count does not include the separate Chrome1PASS.
