CREATE TABLE "weekly_owner_reports" (
	"tenant_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_owner_reports_tenant_id_week_start_pk" PRIMARY KEY("tenant_id","week_start"),
	CONSTRAINT "weekly_owner_report_monday" CHECK (extract(isodow from "weekly_owner_reports"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "weekly_report_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_owner_reports" ADD CONSTRAINT "weekly_owner_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;