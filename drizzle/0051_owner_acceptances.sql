CREATE TABLE "owner_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" uuid,
	"path" varchar(16) DEFAULT 'register' NOT NULL,
	"terms_version" varchar(40) NOT NULL,
	"avv_version" varchar(40) NOT NULL,
	"privacy_version" varchar(40) NOT NULL,
	"text_version" varchar(40) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "owner_acceptances_path_valid" CHECK ("owner_acceptances"."path" = 'register')
);
--> statement-breakpoint
CREATE INDEX "owner_acceptances_user_idx" ON "owner_acceptances" USING btree ("user_id");--> statement-breakpoint
-- ENG-277: append-only; the only permitted change is setting tenant_id once, when the owner's shop is created.
CREATE FUNCTION reject_owner_acceptance_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Owner acceptances are append-only'; END IF;
  IF OLD.tenant_id IS NOT NULL OR NEW.tenant_id IS NULL
    OR (NEW.id, NEW.user_id, NEW.path, NEW.terms_version, NEW.avv_version, NEW.privacy_version, NEW.text_version, NEW.accepted_at)
       IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.path, OLD.terms_version, OLD.avv_version, OLD.privacy_version, OLD.text_version, OLD.accepted_at) THEN
    RAISE EXCEPTION 'Owner acceptances are append-only: only the business may be set, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER owner_acceptances_append_only BEFORE UPDATE OR DELETE ON "owner_acceptances" FOR EACH ROW EXECUTE FUNCTION reject_owner_acceptance_mutation();
