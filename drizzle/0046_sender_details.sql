ALTER TABLE "locations" ADD COLUMN "street" varchar(180);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "postal_code" varchar(5);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "contact_phone" varchar(30);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "representative" varchar(120);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legal_form" varchar(40);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "register_court" varchar(120);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "register_number" varchar(40);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vat_id" varchar(14);