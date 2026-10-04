-- 0019: random card locators for manual counter lookup, and staff-reissue audit fields.
-- Not yet deployed anywhere. Additive: no existing column, row, ledger entry or trigger is changed or removed.
-- Older application code keeps working against this schema: inserts that omit card_locator get one from the trigger.

-- 1. Staff-initiated card security events carry who, why, how the merchant checked, and a retry key.
ALTER TABLE "card_security_events" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "card_security_events" ADD COLUMN "reason" varchar(240);--> statement-breakpoint
ALTER TABLE "card_security_events" ADD COLUMN "verification_method" varchar(24);--> statement-breakpoint
ALTER TABLE "card_security_events" ADD COLUMN "idempotency_key" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "card_security_idempotency_uq" ON "card_security_events" USING btree ("tenant_id","idempotency_key") WHERE "card_security_events"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "card_security_events" ADD CONSTRAINT "card_security_verification_valid" CHECK ("card_security_events"."verification_method" is null or "card_security_events"."verification_method" in ('card_link','stored_contact','other_check'));--> statement-breakpoint

-- 2. Locator column. Nullable and uniquely indexed first, so the backfill below is an indexed lookup per row.
ALTER TABLE "memberships" ADD COLUMN "card_locator" varchar(6);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_card_locator_uq" UNIQUE("tenant_id","card_locator");--> statement-breakpoint

-- 3. Generator: six symbols from a 31-symbol alphabet (no I, L, O, 0, 1), drawn from gen_random_uuid() (the
--    server's strong random source). Rejection sampling (248 = 31 * 8) keeps every symbol equally likely. UUID bytes 6
--    and 8 hold version/variant bits and are skipped. Kept as its own function so tests can substitute a fixed sequence.
CREATE FUNCTION card_locator_candidate() RETURNS text AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  raw bytea;
  i int;
  b int;
BEGIN
  WHILE length(result) < 6 LOOP
    raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8);
      b := get_byte(raw, i);
      CONTINUE WHEN b >= 248;
      result := result || substr(alphabet, (b % 31) + 1, 1);
      EXIT WHEN length(result) = 6;
    END LOOP;
  END LOOP;
  RETURN result;
END; $$ LANGUAGE plpgsql VOLATILE;--> statement-breakpoint

-- 4. Allocation: draw candidates until one is unused in the tenant (bounded; failure is loud, never a duplicate).
CREATE FUNCTION allocate_card_locator(p_tenant uuid) RETURNS text AS $$
DECLARE
  candidate text;
  attempts int := 0;
BEGIN
  LOOP
    candidate := card_locator_candidate();
    IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = p_tenant AND m.card_locator = candidate) THEN
      RETURN candidate;
    END IF;
    attempts := attempts + 1;
    IF attempts >= 100 THEN RAISE EXCEPTION 'could not allocate a card locator'; END IF;
  END LOOP;
END; $$ LANGUAGE plpgsql VOLATILE;--> statement-breakpoint

-- 5. Backfill existing cards (closed ones included; a locator is never reused). Ledger rows are not touched.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, tenant_id FROM memberships WHERE card_locator IS NULL ORDER BY created_at, id LOOP
    UPDATE memberships SET card_locator = allocate_card_locator(r.tenant_id) WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint

-- 6. Every card now has a valid locator; enforce that, keeping '' as the insert default so the trigger can assign.
ALTER TABLE "memberships" ALTER COLUMN "card_locator" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "card_locator" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "membership_card_locator_valid" CHECK ("memberships"."card_locator" ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');--> statement-breakpoint

-- 7. Assignment on every insert path (enrolment, seeds, imports, tests). Explicit values are refused. The per-tenant
--    advisory lock lives until commit, so two concurrent enrolments cannot both pick the same unused locator; the unique
--    constraint remains the final guard.
CREATE FUNCTION assign_membership_card_locator() RETURNS trigger AS $$
BEGIN
  IF NEW.card_locator IS NOT NULL AND NEW.card_locator <> '' THEN
    RAISE EXCEPTION 'card locators are assigned by the database';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('card_locator:' || NEW.tenant_id::text, 0));
  NEW.card_locator := allocate_card_locator(NEW.tenant_id);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER memberships_assign_card_locator BEFORE INSERT ON "memberships" FOR EACH ROW EXECUTE FUNCTION assign_membership_card_locator();--> statement-breakpoint

-- 8. Immutability.
CREATE FUNCTION reject_card_locator_change() RETURNS trigger AS $$
BEGIN
  IF NEW.card_locator IS DISTINCT FROM OLD.card_locator THEN RAISE EXCEPTION 'card locators are immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER memberships_card_locator_immutable BEFORE UPDATE OF "card_locator" ON "memberships" FOR EACH ROW EXECUTE FUNCTION reject_card_locator_change();--> statement-breakpoint

-- 9. The security audit trail keeps actor, time, reason and method: no later edit or delete.
CREATE FUNCTION reject_card_security_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'card security history is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER card_security_events_append_only BEFORE UPDATE OR DELETE ON "card_security_events" FOR EACH ROW EXECUTE FUNCTION reject_card_security_mutation();
