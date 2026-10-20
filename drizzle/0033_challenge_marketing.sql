-- Double opt-in (ENG-007): the confirmation link also confirms the marketing consent. Constant default: metadata-only, no table rewrite; old code ignores the column and its links confirm the address only.
ALTER TABLE "contact_verification_challenges" ADD COLUMN "marketing" boolean DEFAULT false NOT NULL;
