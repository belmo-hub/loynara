-- Manual rollback of migration 0019_card_locators. NOT run automatically and never applied to production by this repository.
--
-- Effect: the database returns to the exact 0018 schema. No ledger, balance, card, referral or staff row is touched.
-- Data that is LOST by design: every card's locator (customers' printed or remembered "K-XXXXXX" would stop working;
-- the next forward run assigns NEW random locators) and the extra audit columns on card_security_events
-- (actor, reason, verification method, retry key of staff reissues). EXPORT THE OWNER DATA FIRST if those matter.
--
-- Run once, inside a transaction, with the web and worker services stopped or on the previous image:
--   psql "$DATABASE_URL" --single-transaction -f docs/rollback/0019-card-locators-down.sql
-- The previous application image keeps working on the 0019 schema too (inserts without a locator get one from the
-- trigger), so rolling back the schema is rarely necessary; rolling back the IMAGE alone is the normal, safer path.
-- Re-applying 0019 afterwards works because the last drizzle bookkeeping row is removed below.

DROP TRIGGER card_security_events_append_only ON card_security_events;
DROP TRIGGER memberships_card_locator_immutable ON memberships;
DROP TRIGGER memberships_assign_card_locator ON memberships;
DROP FUNCTION reject_card_security_mutation();
DROP FUNCTION reject_card_locator_change();
DROP FUNCTION assign_membership_card_locator();
DROP FUNCTION allocate_card_locator(uuid);
DROP FUNCTION card_locator_candidate();

ALTER TABLE memberships DROP CONSTRAINT membership_card_locator_valid;
ALTER TABLE memberships DROP CONSTRAINT memberships_card_locator_uq;
ALTER TABLE memberships DROP COLUMN card_locator;

DROP INDEX card_security_idempotency_uq;
ALTER TABLE card_security_events DROP CONSTRAINT card_security_verification_valid;
ALTER TABLE card_security_events DROP COLUMN idempotency_key;
ALTER TABLE card_security_events DROP COLUMN verification_method;
ALTER TABLE card_security_events DROP COLUMN reason;
ALTER TABLE card_security_events DROP COLUMN actor_user_id;

-- Forget that 0019 was applied (guard: only if the newest bookkeeping row is 0019's).
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)
  AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 20;
