-- ENG-175: one Google Wallet class per tenant, location and programme, made and kept in sync by the worker. A new table, nothing
-- backfilled: GOOGLE_WALLET_LOCATION_CLASSES stays the read-only fallback. Rows carry tenant_id, so a shop's erasure takes them.
CREATE TABLE "wallet_google_classes" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"class_id" varchar(230) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"synced_hash" varchar(64),
	"last_error" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_google_classes_tenant_id_location_id_program_id_pk" PRIMARY KEY("tenant_id","location_id","program_id"),
	CONSTRAINT "wallet_google_classes_class_id_unique" UNIQUE("class_id"),
	CONSTRAINT "wallet_google_classes_status_check" CHECK ("wallet_google_classes"."status" IN ('pending', 'under_review', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "wallet_google_classes" ADD CONSTRAINT "wallet_google_classes_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_google_classes" ADD CONSTRAINT "wallet_google_classes_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;