-- ENG-278: every account that exists before email confirmation was set up by the operator or through an invitation, so
-- it counts as confirmed. Data only, forward-only: the column already exists and older code never reads it.
UPDATE "user" SET "emailVerified" = true WHERE NOT "emailVerified";
