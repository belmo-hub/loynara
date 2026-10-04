ALTER TABLE "card_security_events" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "card_security_events" ADD COLUMN "reason" varchar(240);--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "card_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "next_card_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Backfill existing cards per tenant in enrolment order (closed cards keep their number; numbers are never reused).
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id)::int AS n FROM "memberships"
)
UPDATE "memberships" m SET "card_number" = numbered.n FROM numbered WHERE m.id = numbered.id;--> statement-breakpoint
UPDATE "tenants" t SET "next_card_number" = COALESCE((SELECT max(m."card_number") FROM "memberships" m WHERE m."tenant_id" = t.id), 0) + 1;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_card_number_uq" UNIQUE("tenant_id","card_number");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "membership_card_number_positive" CHECK ("memberships"."card_number" > 0);--> statement-breakpoint
-- Every insert path (enrolment, seeds, imports, tests) gets the next number from the tenant row; the row lock
-- serialises concurrent enrolments of one tenant. Explicit numbers are refused so the counter cannot be bypassed.
CREATE FUNCTION assign_membership_card_number() RETURNS trigger AS $$
BEGIN
  IF NEW.card_number IS NOT NULL AND NEW.card_number <> 0 THEN
    RAISE EXCEPTION 'card numbers are assigned by the database';
  END IF;
  UPDATE tenants SET next_card_number = next_card_number + 1 WHERE id = NEW.tenant_id RETURNING next_card_number - 1 INTO NEW.card_number;
  IF NEW.card_number IS NULL THEN RAISE EXCEPTION 'tenant not found for card number'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER memberships_assign_card_number BEFORE INSERT ON "memberships" FOR EACH ROW EXECUTE FUNCTION assign_membership_card_number();--> statement-breakpoint
CREATE FUNCTION reject_card_number_change() RETURNS trigger AS $$
BEGIN
  IF NEW.card_number IS DISTINCT FROM OLD.card_number THEN RAISE EXCEPTION 'card numbers are immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER memberships_card_number_immutable BEFORE UPDATE OF "card_number" ON "memberships" FOR EACH ROW EXECUTE FUNCTION reject_card_number_change();
