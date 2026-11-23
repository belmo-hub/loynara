CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp with time zone,
	"aaguid" text,
	CONSTRAINT "passkey_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("userId");--> statement-breakpoint
-- hand: deleting the user (account removal, shop erasure) removes their passkeys with it.
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
