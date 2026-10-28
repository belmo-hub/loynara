CREATE TABLE "free_month_reminders" (
	"tenant_id" uuid NOT NULL,
	"free_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_month_reminders_tenant_id_free_until_pk" PRIMARY KEY("tenant_id","free_until")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "free_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "free_month_reminders" ADD CONSTRAINT "free_month_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;