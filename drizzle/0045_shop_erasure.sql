CREATE TABLE "shop_erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"erased_tenant_id" uuid NOT NULL,
	"legal_name" varchar(180) NOT NULL,
	"end_date" date NOT NULL,
	"export_until" date NOT NULL,
	"actor_user_id" text NOT NULL,
	"contract" jsonb NOT NULL,
	"row_counts" jsonb NOT NULL,
	"external" jsonb NOT NULL,
	"confirmation_name" varchar(200),
	"confirmation_email" varchar(320),
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmation_sendable_at" timestamp with time zone NOT NULL,
	"confirmation_sent_at" timestamp with time zone,
	CONSTRAINT "shop_erasures_erased_tenant_id_unique" UNIQUE("erased_tenant_id")
);
--> statement-breakpoint
-- ENG-166 (DS-05): the one sanctioned exception to the append-only history tables. A row may be deleted only inside the
-- transaction that erases its shop: eraseShop sets the transaction-local loynara.erasure to that shop's id, so the setting ends
-- with the transaction and names exactly one shop. Updates stay refused, and so does every delete outside an erasure.
CREATE FUNCTION erasure_permits(p_tenant uuid) RETURNS boolean AS $$
  SELECT p_tenant IS NOT NULL AND p_tenant::text = current_setting('loynara.erasure', true);
$$ LANGUAGE sql STABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$ BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ledger history is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_programme_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Programme audit rows are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_staff_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Staff audit history is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_card_security_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'card security history is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_reward_history_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Reward versions and redemptions are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- A plate's history names shops in old/new_tenant_id; a tag of the shop's own (no plate) carries the shop on the tag itself.
CREATE OR REPLACE FUNCTION reject_plate_link_event_mutation() RETURNS trigger AS $$
BEGIN
  -- Only a row that names no other shop: a plate moved from the erased shop to another one keeps that history.
  IF TG_OP = 'DELETE' AND (OLD.old_tenant_id IS NULL OR erasure_permits(OLD.old_tenant_id)) AND (OLD.new_tenant_id IS NULL OR erasure_permits(OLD.new_tenant_id))
    AND (erasure_permits(OLD.old_tenant_id) OR erasure_permits(OLD.new_tenant_id) OR erasure_permits((SELECT tenant_id FROM secure_tags WHERE id = OLD.tag_id))) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Plate link events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_wallet_consent_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Wallet message consents are append-only'; END IF;
  IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
    OR (NEW.id, NEW.tenant_id, NEW.membership_id, NEW.text_version, NEW.channel, NEW.given_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.membership_id, OLD.text_version, OLD.channel, OLD.given_at) THEN
    RAISE EXCEPTION 'Wallet message consents are append-only: only a first withdrawal may be recorded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_wallet_template_binding_event_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND erasure_permits(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Wallet template binding events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- The erasure record is append-only; the one allowed change is stamping, once, when the confirmation went out.
CREATE FUNCTION reject_shop_erasure_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.confirmation_sent_at IS NULL AND NEW.confirmation_sent_at IS NOT NULL
    AND (to_jsonb(NEW) - 'confirmation_sent_at') = (to_jsonb(OLD) - 'confirmation_sent_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Shop erasure records are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER shop_erasures_append_only BEFORE UPDATE OR DELETE ON "shop_erasures" FOR EACH ROW EXECUTE FUNCTION reject_shop_erasure_mutation();
