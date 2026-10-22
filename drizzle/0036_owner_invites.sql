ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_role_valid";--> statement-breakpoint
ALTER TABLE "staff_invites" DROP CONSTRAINT "staff_invite_role_valid";--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_role_valid" CHECK ("staff_audit_events"."role" in ('owner','manager','cashier'));--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invite_role_valid" CHECK ("staff_invites"."role" in ('owner','manager','cashier'));