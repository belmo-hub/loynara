CREATE TABLE customer_export_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email_hash varchar(64) NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  credential_hash varchar(64) NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_export_member_fk FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT customer_export_ten_minute_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT customer_export_one_member UNIQUE (tenant_id,membership_id)
);
--> statement-breakpoint
CREATE INDEX customer_export_expiry_idx ON customer_export_challenges(expires_at);
