-- ENG-278: accounts from before email confirmation count as confirmed. Public sign-up has never been on in production (the
-- gate refused it before ENG-275 and PUBLIC_REGISTRATION_ENABLED is still off), so every one of them was set up by the
-- operator or through an invitation. Run it only while PUBLIC_REGISTRATION_ENABLED is off or unset. The literal cut-off
-- (this change's commit time) keeps a later run elsewhere from confirming accounts that signed up afterwards.
-- Data only, forward-only: the column already exists and older code never reads it.
UPDATE "user" SET "emailVerified" = true WHERE NOT "emailVerified" AND "createdAt" < '2026-11-19T10:00:00Z';
