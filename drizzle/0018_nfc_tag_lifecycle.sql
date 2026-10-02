ALTER TABLE "secure_tags" DROP CONSTRAINT "secure_tags_uid_unique";--> statement-breakpoint
ALTER TABLE "tap_requests" DROP CONSTRAINT "tap_request_status_valid";--> statement-breakpoint
CREATE UNIQUE INDEX "secure_tag_uid_live_uq" ON "secure_tags" USING btree ("uid") WHERE "secure_tags"."status" in ('provisioned','active');--> statement-breakpoint
ALTER TABLE "tap_requests" ADD CONSTRAINT "tap_request_status_valid" CHECK ("tap_requests"."status" in ('awarded','cooldown','pending_staff','confirmed','expired','cancelled'));