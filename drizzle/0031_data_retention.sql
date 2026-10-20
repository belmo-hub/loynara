-- Policy 2026-10-15. Production activation is a separate operator decision.
-- Roles are cluster-wide: never weaken or drop an existing role during a database migration.
DO $$
DECLARE n text; role_properties record;
BEGIN
  FOREACH n IN ARRAY ARRAY['loynara_purge_owner','loynara_maintenance','loynara_runtime','loynara_restore'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=n) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', n);
    END IF;
    SELECT * INTO role_properties FROM pg_catalog.pg_roles WHERE rolname=n;
    IF role_properties.rolcanlogin OR role_properties.rolsuper OR role_properties.rolcreatedb OR role_properties.rolcreaterole OR role_properties.rolreplication OR role_properties.rolbypassrls THEN
      RAISE EXCEPTION 'Unsafe retention role configuration';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles r ON r.oid IN (a.roleid,a.member) WHERE r.rolname='loynara_purge_owner')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles r ON r.oid=a.member WHERE r.rolname IN ('loynara_maintenance','loynara_runtime','loynara_restore'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper AND (
      (pg_catalog.pg_has_role(r.oid,'loynara_runtime','MEMBER') AND pg_catalog.pg_has_role(r.oid,'loynara_maintenance','MEMBER'))
      OR (pg_catalog.pg_has_role(r.oid,'loynara_restore','MEMBER') AND (pg_catalog.pg_has_role(r.oid,'loynara_runtime','MEMBER') OR pg_catalog.pg_has_role(r.oid,'loynara_maintenance','MEMBER'))))) THEN
    RAISE EXCEPTION 'Unsafe retention role membership';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE public.deletion_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK(scope IN ('member','tenant')),
  policy_version text NOT NULL DEFAULT '2026-10-15' CHECK(policy_version='2026-10-15'),
  requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  remote_outcome text NOT NULL DEFAULT 'pending' CHECK(remote_outcome IN ('pending','complete','incomplete')),
  exception text CHECK(exception IN ('remote_revocation_incomplete','legal_hold','accounting_classification_pending'))
);
--> statement-breakpoint
ALTER TABLE public.tenants ADD COLUMN closed_at timestamptz, ADD COLUMN deletion_receipt_id uuid REFERENCES public.deletion_receipts(id), ADD COLUMN retention_pruned_at timestamptz;
ALTER TABLE public.memberships ADD COLUMN last_customer_activity_at timestamptz, ADD COLUMN deletion_receipt_id uuid REFERENCES public.deletion_receipts(id), ADD COLUMN retention_pruned_at timestamptz;
ALTER TABLE public.outbox_jobs ADD COLUMN terminal_at timestamptz;
UPDATE public.outbox_jobs SET terminal_at=clock_timestamp() WHERE status IN ('complete','suppressed','failed','blocked');
ALTER TABLE public.campaign_recipients ADD COLUMN terminal_at timestamptz;
UPDATE public.campaign_recipients SET terminal_at=clock_timestamp() WHERE status IN ('complete','suppressed','failed');
ALTER TABLE public.automation_runs ADD COLUMN terminal_at timestamptz;
UPDATE public.automation_runs SET terminal_at=clock_timestamp() WHERE status IN ('complete','suppressed','failed');
--> statement-breakpoint
CREATE TABLE public.retention_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  membership_id uuid, categories text[] NOT NULL,
  legal_basis text NOT NULL CHECK(length(legal_basis) BETWEEN 1 AND 500),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
  custodian text NOT NULL CHECK(length(custodian) BETWEEN 1 AND 300),
  review_at timestamptz NOT NULL, release_condition text NOT NULL CHECK(length(release_condition) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
  FOREIGN KEY(tenant_id,membership_id) REFERENCES public.memberships(tenant_id,id),
  CHECK(cardinality(categories)>0 AND categories <@ ARRAY['membership','ledger','redemptions','purchases','consent','security','tenant']::text[] AND array_position(categories,NULL) IS NULL),
  CHECK(review_at>created_at AND review_at<=created_at+interval '30 days')
);
CREATE INDEX retention_holds_subject_idx ON public.retention_holds(tenant_id,membership_id) WHERE released_at IS NULL;
CREATE TABLE public.tenant_retention_classifications (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  classification text NOT NULL CHECK(classification IN ('no_statutory_records','archive_verified')),
  classified_at timestamptz NOT NULL DEFAULT now(), classified_by text NOT NULL CHECK(length(classified_by) BETWEEN 1 AND 300),
  archive_reference text CHECK(length(archive_reference) BETWEEN 1 AND 1000),
  CHECK(classification<>'archive_verified' OR archive_reference IS NOT NULL)
);
CREATE TABLE public.tenant_retention_auth_subjects (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id text NOT NULL, PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE public.inactivity_reviews (
  tenant_id uuid NOT NULL, membership_id uuid NOT NULL, flagged_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz, reviewed_by text, PRIMARY KEY(tenant_id,membership_id),
  FOREIGN KEY(tenant_id,membership_id) REFERENCES public.memberships(tenant_id,id)
);
--> statement-breakpoint
CREATE FUNCTION public.loynara_outbox_terminal_clock() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status IN ('complete','suppressed','failed','blocked') THEN
    IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN NEW.terminal_at:=clock_timestamp();
    ELSE NEW.terminal_at:=OLD.terminal_at; END IF;
  ELSE NEW.terminal_at:=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_terminal_clock BEFORE INSERT OR UPDATE ON public.outbox_jobs FOR EACH ROW EXECUTE FUNCTION public.loynara_outbox_terminal_clock();
CREATE TRIGGER campaign_recipient_terminal_clock BEFORE INSERT OR UPDATE ON public.campaign_recipients FOR EACH ROW EXECUTE FUNCTION public.loynara_outbox_terminal_clock();
CREATE TRIGGER automation_run_terminal_clock BEFORE INSERT OR UPDATE ON public.automation_runs FOR EACH ROW EXECUTE FUNCTION public.loynara_outbox_terminal_clock();
CREATE FUNCTION public.loynara_membership_admission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE closed timestamptz;
BEGIN
  SELECT closed_at INTO closed FROM public.tenants WHERE id=NEW.tenant_id FOR SHARE;
  IF NOT FOUND OR closed IS NOT NULL THEN RAISE EXCEPTION 'Tenant service closed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_tenant_admission BEFORE INSERT ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.loynara_membership_admission();
--> statement-breakpoint
CREATE FUNCTION public.loynara_retention_blocked(t uuid,m uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.retention_holds h WHERE h.tenant_id=t AND h.released_at IS NULL AND (m IS NULL OR h.membership_id IS NULL OR h.membership_id=m))
$$;
-- Supported hold categories are explicit: security means security event tables,
-- consent means consent_events, and the financial family keeps its complete
-- reconciled financial graph plus required parent context. Other evidence must
-- be placed in a separately authorized restricted archive before closure.
CREATE FUNCTION public.loynara_retention_category_held(t uuid,m uuid,c text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.retention_holds h WHERE h.tenant_id=t AND h.released_at IS NULL AND (h.membership_id IS NULL OR h.membership_id=m) AND c=ANY(h.categories))
$$;
CREATE FUNCTION public.loynara_retention_financial_held(t uuid,m uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.retention_holds h WHERE h.tenant_id=t AND h.released_at IS NULL AND (h.membership_id IS NULL OR h.membership_id=m) AND h.categories && ARRAY['membership','ledger','redemptions','purchases','tenant']::text[])
$$;
CREATE FUNCTION public.loynara_retention_exceptions(t uuid,m uuid) RETURNS TABLE(categories text[],legal_basis text,created_at timestamptz,review_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT h.categories,h.legal_basis,h.created_at,h.review_at FROM public.retention_holds h
  WHERE h.tenant_id=t AND h.released_at IS NULL AND (h.membership_id IS NULL OR h.membership_id=m)
    AND EXISTS(SELECT 1 FROM public.memberships s WHERE s.tenant_id=t AND s.id=m)
$$;
CREATE FUNCTION public.loynara_retention_health() RETURNS TABLE(overdue_cards integer,overdue_tenants integer,hold_reviews integer,remote_incomplete integer,unclassified_tenants integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT
    (SELECT count(*)::integer FROM public.memberships m JOIN public.tenants t ON t.id=m.tenant_id WHERE t.closed_at IS NULL AND m.closed_at IS NOT NULL AND NOT public.loynara_retention_blocked(m.tenant_id,m.id)
      AND (m.closed_at<=now()-interval '7 days' OR (m.closed_at<=now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM public.wallet_passes w WHERE w.membership_id=m.id AND w.status<>'revoked')))),
    (SELECT count(*)::integer FROM public.tenants t WHERE t.closed_at<=now()-interval '7 days' AND NOT public.loynara_retention_blocked(t.id,NULL)),
    (SELECT count(*)::integer FROM public.retention_holds h WHERE h.released_at IS NULL AND h.review_at<=now()),
    (SELECT count(*)::integer FROM public.deletion_receipts r WHERE r.remote_outcome='incomplete' AND r.exception='remote_revocation_incomplete' AND (r.completed_at IS NULL OR r.completed_at>now()-interval '30 days')),
    (SELECT count(*)::integer FROM public.tenants t WHERE t.closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_retention_classifications c WHERE c.tenant_id=t.id))
$$;
CREATE FUNCTION public.loynara_set_retention_hold(t uuid,m uuid,c text[],basis text,why text,keeper text,review timestamptz,release_when text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  PERFORM 1 FROM public.tenants WHERE id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retention subject missing'; END IF;
  IF m IS NOT NULL THEN
    PERFORM 1 FROM public.memberships WHERE tenant_id=t AND id=m FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Retention subject missing'; END IF;
  END IF;
  INSERT INTO public.retention_holds(tenant_id,membership_id,categories,legal_basis,reason,custodian,review_at,release_condition)
    VALUES(t,m,c,basis,why,keeper,review,release_when) RETURNING id INTO result;
  UPDATE public.memberships SET retention_pruned_at=NULL WHERE tenant_id=t AND (m IS NULL OR id=m);
  UPDATE public.tenants SET retention_pruned_at=NULL WHERE id=t;
  RETURN result;
END $$;
CREATE FUNCTION public.loynara_release_retention_hold(h uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid; m uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  SELECT tenant_id,membership_id INTO t,m FROM public.retention_holds WHERE id=h;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.tenants WHERE id=t FOR UPDATE;
  PERFORM 1 FROM public.memberships WHERE id=m FOR UPDATE;
  UPDATE public.retention_holds SET released_at=clock_timestamp() WHERE id=h AND released_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.memberships SET retention_pruned_at=NULL WHERE tenant_id=t AND (m IS NULL OR id=m);
  UPDATE public.tenants SET retention_pruned_at=NULL WHERE id=t;
  RETURN true;
END $$;
CREATE FUNCTION public.loynara_classify_tenant_retention(t uuid,c text,keeper text,archive text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  PERFORM 1 FROM public.tenants WHERE id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retention subject missing'; END IF;
  INSERT INTO public.tenant_retention_classifications(tenant_id,classification,classified_by,archive_reference)
    VALUES(t,c,keeper,archive) ON CONFLICT(tenant_id) DO UPDATE SET classification=excluded.classification,classified_by=excluded.classified_by,archive_reference=excluded.archive_reference,classified_at=clock_timestamp();
  UPDATE public.memberships SET retention_pruned_at=NULL WHERE tenant_id=t;
  UPDATE public.tenants SET retention_pruned_at=NULL WHERE id=t;
END $$;
--> statement-breakpoint
-- These guards remain SECURITY INVOKER: current_user is the private function owner only during an authorized purge.
CREATE OR REPLACE FUNCTION public.reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='loynara_purge_owner' AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.id=OLD.membership_id AND m.tenant_id=OLD.tenant_id AND m.closed_at IS NOT NULL)
    AND NOT public.loynara_retention_financial_held(OLD.tenant_id,OLD.membership_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Ledger is append-only';
END $$;
CREATE OR REPLACE FUNCTION public.reject_programme_audit_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='loynara_purge_owner' THEN
    IF TG_TABLE_NAME='purchase_awards' THEN
      IF EXISTS(SELECT 1 FROM public.ledger_entries l JOIN public.memberships m ON m.id=l.membership_id AND m.tenant_id=l.tenant_id WHERE l.id=OLD.ledger_entry_id AND l.tenant_id=OLD.tenant_id AND m.closed_at IS NOT NULL AND NOT public.loynara_retention_financial_held(m.tenant_id,m.id)) THEN RETURN OLD; END IF;
    ELSIF EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=OLD.tenant_id AND t.closed_at IS NOT NULL AND NOT public.loynara_retention_blocked(t.id,NULL)) THEN RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Programme audit is append-only';
END $$;
CREATE OR REPLACE FUNCTION public.reject_staff_audit_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='loynara_purge_owner' AND NOT public.loynara_retention_category_held(OLD.tenant_id,NULL,'security')
    AND (OLD.created_at<=clock_timestamp()-interval '90 days' OR EXISTS(SELECT 1 FROM public.tenants WHERE id=OLD.tenant_id AND closed_at IS NOT NULL)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Staff audit is append-only';
END $$;
CREATE OR REPLACE FUNCTION public.reject_card_security_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='loynara_purge_owner' AND NOT public.loynara_retention_category_held(OLD.tenant_id,OLD.membership_id,'security')
    AND (OLD.created_at<=clock_timestamp()-interval '90 days' OR EXISTS(SELECT 1 FROM public.memberships WHERE id=OLD.membership_id AND tenant_id=OLD.tenant_id AND closed_at IS NOT NULL)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Card security history is append-only';
END $$;
-- 0025 made reward versions and redemptions append-only for everyone. Erasure is the one exception, with the same
-- conditions as the ledger and programme audit above: a closed card's unheld redemptions, a closed merchant's unheld
-- reward versions, and only from the purge functions. UPDATE stays refused for every role.
CREATE OR REPLACE FUNCTION public.reject_reward_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='loynara_purge_owner' THEN
    IF TG_TABLE_NAME='redemptions' THEN
      IF EXISTS(SELECT 1 FROM public.memberships m WHERE m.id=OLD.membership_id AND m.tenant_id=OLD.tenant_id AND m.closed_at IS NOT NULL)
        AND NOT public.loynara_retention_financial_held(OLD.tenant_id,OLD.membership_id) THEN RETURN OLD; END IF;
    ELSIF TG_TABLE_NAME='reward_versions' THEN
      IF EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=OLD.tenant_id AND t.closed_at IS NOT NULL AND NOT public.loynara_retention_blocked(t.id,NULL)) THEN RETURN OLD; END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Reward versions and redemptions are append-only';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.loynara_prepare_erasure(s text,t uuid,m uuid,cutoff timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tr public.tenants%ROWTYPE; mr public.memberships%ROWTYPE;
BEGIN
  IF cutoff IS NULL OR cutoff>clock_timestamp() OR s NOT IN ('member','tenant') OR s IS NULL OR t IS NULL OR (s='member' AND m IS NULL) OR (s='tenant' AND m IS NOT NULL) THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  SELECT * INTO tr FROM public.tenants WHERE id=t FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF tr.created_at>cutoff THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
  IF s='member' THEN
    SELECT * INTO mr FROM public.memberships WHERE id=m AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF (tr.closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_retention_classifications WHERE tenant_id=t))
      OR mr.closed_at IS NULL OR mr.closed_at>cutoff OR mr.created_at>cutoff OR public.loynara_retention_blocked(t,m) THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
    IF mr.closed_at>clock_timestamp()-interval '7 days' AND EXISTS(SELECT 1 FROM public.wallet_passes WHERE tenant_id=t AND membership_id=m AND status<>'revoked') THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
  ELSE
    PERFORM 1 FROM public.memberships WHERE tenant_id=t ORDER BY id FOR UPDATE;
    IF tr.closed_at IS NULL OR tr.closed_at>cutoff OR public.loynara_retention_blocked(t,NULL) OR NOT EXISTS(SELECT 1 FROM public.tenant_retention_classifications WHERE tenant_id=t)
      OR EXISTS(SELECT 1 FROM public.memberships WHERE tenant_id=t AND (closed_at IS NULL OR closed_at>cutoff OR created_at>cutoff)) THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
    IF tr.closed_at>clock_timestamp()-interval '7 days' AND EXISTS(SELECT 1 FROM public.wallet_passes WHERE tenant_id=t AND status<>'revoked') THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
  END IF;
  RETURN true;
END $$;
--> statement-breakpoint
-- Private graph worker. No caller can select a bypass mode; replay is a separate maintenance-only entry point.
CREATE FUNCTION public.loynara_erase_member_graph(t uuid,m uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE jobs uuid[]; devices text[]; receipt uuid; incomplete boolean; emails text[]; challenges uuid[]; address text;
BEGIN
  SELECT deletion_receipt_id INTO receipt FROM public.memberships WHERE id=m AND tenant_id=t AND closed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.loynara_retention_blocked(t,m) THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
  -- Restore replay starts from an older open snapshot, before application closure cleanup.
  SELECT coalesce(array_agg(email ORDER BY email),ARRAY[]::text[]) INTO emails FROM public.membership_contacts WHERE tenant_id=t AND membership_id=m AND email IS NOT NULL;
  FOREACH address IN ARRAY emails LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(address,0)); END LOOP;
  SELECT coalesce(array_agg(c.id),ARRAY[]::uuid[]) INTO challenges FROM public.card_recovery_challenges c WHERE c.email=ANY(emails)
    AND NOT EXISTS(SELECT 1 FROM public.membership_contacts other JOIN public.memberships om ON om.id=other.membership_id AND om.tenant_id=other.tenant_id WHERE other.email=c.email AND other.email_verified AND om.closed_at IS NULL AND om.id<>m);
  SELECT EXISTS(SELECT 1 FROM public.wallet_passes WHERE tenant_id=t AND membership_id=m AND status<>'revoked') INTO incomplete;
  SELECT coalesce(array_agg(j.id),ARRAY[]::uuid[]) INTO jobs FROM public.outbox_jobs j WHERE (j.kind='email.recover' AND (j.payload->>'membershipId'=m::text OR j.payload->>'challengeId'=ANY(challenges::text[]))) OR (j.tenant_id=t AND (
    j.payload->>'membershipId'=m::text OR j.payload->>'tapRequestId' IN(SELECT id::text FROM public.tap_requests WHERE tenant_id=t AND membership_id=m)
    OR j.id IN(SELECT a.outbox_job_id FROM public.campaign_attempts a JOIN public.campaign_recipients r ON r.id=a.recipient_id AND r.tenant_id=a.tenant_id WHERE r.tenant_id=t AND r.membership_id=m)
    OR j.payload->>'runId' IN(SELECT id::text FROM public.automation_runs WHERE tenant_id=t AND membership_id=m)));
  SELECT coalesce(array_agg(device_library_identifier),ARRAY[]::text[]) INTO devices FROM public.apple_registrations WHERE tenant_id=t AND membership_id=m;
  -- Device FK/key locks serialize registration while removing only actual orphans.
  PERFORM 1 FROM public.apple_devices WHERE device_library_identifier=ANY(devices) ORDER BY device_library_identifier FOR UPDATE;
  DELETE FROM public.email_provider_events WHERE job_id=ANY(jobs);
  DELETE FROM public.email_deliveries WHERE job_id=ANY(jobs);
  DELETE FROM public.campaign_attempts WHERE tenant_id=t AND recipient_id IN(SELECT id FROM public.campaign_recipients WHERE tenant_id=t AND membership_id=m);
  DELETE FROM public.campaign_recipients WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.automation_runs WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.referrals WHERE tenant_id=t AND (referrer_membership_id=m OR referred_membership_id=m);
  DELETE FROM public.referral_codes WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.offline_award_events WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.offline_award_leases WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.tap_requests WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.customer_export_challenges WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.contact_verification_challenges WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.card_recovery_challenges WHERE id=ANY(challenges);
  DELETE FROM public.membership_contacts WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.consent_events WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.card_security_events WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.apple_registrations WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.apple_devices d WHERE d.device_library_identifier=ANY(devices) AND NOT EXISTS(SELECT 1 FROM public.apple_registrations r WHERE r.device_library_identifier=d.device_library_identifier);
  DELETE FROM public.wallet_passes WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.purchase_awards WHERE tenant_id=t AND ledger_entry_id IN(SELECT id FROM public.ledger_entries WHERE tenant_id=t AND membership_id=m);
  DELETE FROM public.redemptions WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.outbox_jobs WHERE id=ANY(jobs);
  DELETE FROM public.ledger_entries WHERE tenant_id=t AND membership_id=m;
  DELETE FROM public.retention_holds WHERE tenant_id=t AND membership_id=m AND released_at IS NOT NULL;
  DELETE FROM public.inactivity_reviews WHERE tenant_id=t AND membership_id=m;
  IF receipt IS NULL THEN INSERT INTO public.deletion_receipts(scope) VALUES('member') RETURNING id INTO receipt; END IF;
  UPDATE public.deletion_receipts SET completed_at=clock_timestamp(),remote_outcome=CASE WHEN incomplete OR remote_outcome='incomplete' THEN 'incomplete' ELSE 'complete' END,exception=CASE WHEN incomplete OR remote_outcome='incomplete' THEN 'remote_revocation_incomplete' END WHERE id=receipt;
  DELETE FROM public.memberships WHERE tenant_id=t AND id=m;
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.loynara_erase_tenant_graph(t uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m uuid; u text; users text[]; receipt uuid; incomplete boolean; jobs uuid[];
BEGIN
  SELECT deletion_receipt_id INTO receipt FROM public.tenants WHERE id=t AND closed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.loynara_retention_blocked(t,NULL) THEN RAISE EXCEPTION 'Erasure not eligible'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.wallet_passes WHERE tenant_id=t AND status<>'revoked') INTO incomplete;
  SELECT array_agg(DISTINCT user_id) INTO users FROM (
    SELECT user_id FROM public.staff_roles WHERE tenant_id=t UNION SELECT user_id FROM public.tenant_retention_auth_subjects WHERE tenant_id=t
    UNION SELECT actor_user_id FROM public.ledger_entries WHERE tenant_id=t UNION SELECT invited_by_user_id FROM public.staff_invites WHERE tenant_id=t
    UNION SELECT actor_user_id FROM public.staff_audit_events WHERE tenant_id=t UNION SELECT subject_user_id FROM public.staff_audit_events WHERE tenant_id=t
  ) candidates WHERE user_id IS NOT NULL;
  FOR m IN SELECT id FROM public.memberships WHERE tenant_id=t ORDER BY id FOR UPDATE LOOP PERFORM public.loynara_erase_member_graph(t,m); END LOOP;
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO jobs FROM public.outbox_jobs WHERE tenant_id=t OR (kind='email.recover' AND payload->>'erasureTenantId'=t::text);
  DELETE FROM public.email_provider_events WHERE job_id=ANY(jobs);
  DELETE FROM public.email_deliveries WHERE job_id=ANY(jobs);
  DELETE FROM public.campaign_attempts WHERE tenant_id=t;
  DELETE FROM public.campaign_recipients WHERE tenant_id=t;
  DELETE FROM public.automation_runs WHERE tenant_id=t;
  DELETE FROM public.outbox_jobs WHERE id=ANY(jobs);
  DELETE FROM public.campaigns WHERE tenant_id=t;
  DELETE FROM public.automation_rules WHERE tenant_id=t;
  DELETE FROM public.referrals WHERE tenant_id=t;
  DELETE FROM public.referral_codes WHERE tenant_id=t;
  DELETE FROM public.referral_settings WHERE tenant_id=t;
  DELETE FROM public.tap_requests WHERE tenant_id=t;
  DELETE FROM public.secure_tags WHERE tenant_id=t;
  DELETE FROM public.billing_invoices WHERE tenant_id=t;
  DELETE FROM public.billing_handoffs WHERE tenant_id=t;
  DELETE FROM public.billing_webhook_events WHERE tenant_id=t;
  DELETE FROM public.billing_location_plans WHERE tenant_id=t;
  DELETE FROM public.subscriptions WHERE tenant_id=t;
  DELETE FROM public.campaign_daily_usage WHERE tenant_id=t;
  DELETE FROM public.staff_push_subscriptions WHERE tenant_id=t;
  DELETE FROM public.staff_audit_events WHERE tenant_id=t;
  DELETE FROM public.staff_invites WHERE tenant_id=t;
  DELETE FROM public.staff_roles WHERE tenant_id=t;
  DELETE FROM public.reward_versions WHERE tenant_id=t;
  DELETE FROM public.rewards WHERE tenant_id=t;
  DELETE FROM public.program_rule_versions WHERE tenant_id=t;
  DELETE FROM public.programs WHERE tenant_id=t;
  DELETE FROM public.locations WHERE tenant_id=t;
  DELETE FROM public.retention_holds WHERE tenant_id=t AND released_at IS NOT NULL;
  DELETE FROM public.tenant_retention_classifications WHERE tenant_id=t;
  DELETE FROM public.tenant_retention_auth_subjects WHERE tenant_id=t;
  IF receipt IS NULL THEN INSERT INTO public.deletion_receipts(scope) VALUES('tenant') RETURNING id INTO receipt; END IF;
  UPDATE public.deletion_receipts SET completed_at=clock_timestamp(),remote_outcome=CASE WHEN incomplete OR remote_outcome='incomplete' THEN 'incomplete' ELSE 'complete' END,exception=CASE WHEN incomplete OR remote_outcome='incomplete' THEN 'remote_revocation_incomplete' END WHERE id=receipt;
  DELETE FROM public.tenants WHERE id=t;
  -- A shared staff identity survives every other relationship, including historical references.
  FOR u IN SELECT id FROM public."user" WHERE id=ANY(users) ORDER BY id FOR UPDATE LOOP
    IF NOT EXISTS(SELECT 1 FROM public.staff_roles WHERE user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.staff_invites WHERE invited_by_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.ledger_entries WHERE actor_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.staff_audit_events WHERE actor_user_id=u OR subject_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.card_security_events WHERE actor_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.campaigns WHERE created_by_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.automation_rules WHERE created_by_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.offline_award_events WHERE actor_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.offline_award_leases WHERE actor_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.referrals WHERE reviewed_by_user_id=u)
      AND NOT EXISTS(SELECT 1 FROM public.outbox_jobs WHERE payload->>'actorUserId'=u)
      AND NOT EXISTS(SELECT 1 FROM public.tenant_retention_auth_subjects WHERE user_id=u) THEN
      DELETE FROM public."verification" WHERE identifier LIKE 'reset-password:%' AND value=u;
      DELETE FROM public."user" WHERE id=u;
    END IF;
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION public.loynara_purge_tenant(t uuid,cutoff timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.loynara_prepare_erasure('tenant',t,NULL,cutoff) THEN RETURN false; END IF;
  RETURN public.loynara_erase_tenant_graph(t);
END $$;
CREATE FUNCTION public.loynara_replay_closure(s text,t uuid,m uuid,cutoff timestamptz,manifest uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tr public.tenants%ROWTYPE; mr public.memberships%ROWTYPE; members uuid[]; challenges uuid[]; emails text[]; address text;
BEGIN
  IF cutoff IS NULL OR cutoff>clock_timestamp() OR manifest IS NULL OR s IS NULL OR s NOT IN ('member','tenant') OR t IS NULL OR (s='member' AND m IS NULL) OR (s='tenant' AND m IS NOT NULL) THEN RAISE EXCEPTION 'Closure replay not eligible'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  SELECT * INTO tr FROM public.tenants WHERE id=t FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF tr.created_at>cutoff THEN RAISE EXCEPTION 'Closure replay not eligible'; END IF;
  IF s='member' THEN
    SELECT * INTO mr FROM public.memberships WHERE tenant_id=t AND id=m FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF mr.created_at>cutoff THEN RAISE EXCEPTION 'Closure replay not eligible'; END IF;
    IF mr.closed_at IS NOT NULL AND mr.closed_at<=cutoff THEN RETURN; END IF;
    members:=ARRAY[m];
  ELSE
    PERFORM 1 FROM public.memberships WHERE tenant_id=t ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.memberships WHERE tenant_id=t AND created_at>cutoff) THEN RAISE EXCEPTION 'Closure replay not eligible'; END IF;
    IF tr.closed_at IS NOT NULL AND tr.closed_at<=cutoff AND NOT EXISTS(SELECT 1 FROM public.memberships WHERE tenant_id=t AND closed_at IS NULL) THEN RETURN; END IF;
    SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO members FROM public.memberships WHERE tenant_id=t;
  END IF;
  IF EXISTS(SELECT 1 FROM public.deletion_receipts WHERE id=manifest AND scope<>s) THEN RAISE EXCEPTION 'Closure receipt conflict'; END IF;
  INSERT INTO public.deletion_receipts(id,scope,requested_at) VALUES(manifest,s,cutoff) ON CONFLICT(id) DO NOTHING;
  SELECT coalesce(array_agg(DISTINCT email ORDER BY email),ARRAY[]::text[]) INTO emails FROM public.membership_contacts WHERE membership_id=ANY(members) AND email IS NOT NULL;
  FOREACH address IN ARRAY emails LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(address,0)); END LOOP;
  SELECT coalesce(array_agg(c.id),ARRAY[]::uuid[]) INTO challenges FROM public.card_recovery_challenges c WHERE c.email=ANY(emails)
    AND NOT EXISTS(SELECT 1 FROM public.membership_contacts other JOIN public.memberships om ON om.id=other.membership_id AND om.tenant_id=other.tenant_id WHERE other.email=c.email AND other.email_verified AND om.closed_at IS NULL AND NOT(om.id=ANY(members)));
  UPDATE public.outbox_jobs SET payload=CASE WHEN s='member' THEN jsonb_build_object('membershipId',m::text) ELSE jsonb_build_object('erasureTenantId',t::text) END,
    status=CASE WHEN status IN ('pending','retry','processing','blocked') THEN 'suppressed' ELSE status END,last_error=NULL
    WHERE kind='email.recover' AND payload->>'challengeId'=ANY(challenges::text[]);
  DELETE FROM public.card_recovery_challenges WHERE id=ANY(challenges);
  DELETE FROM public.customer_export_challenges WHERE membership_id=ANY(members);
  DELETE FROM public.contact_verification_challenges WHERE membership_id=ANY(members);
  DELETE FROM public.membership_contacts WHERE membership_id=ANY(members);
  UPDATE public.outbox_jobs j SET payload=jsonb_build_object('membershipId',m::text)
    WHERE s='member' AND j.tenant_id=t AND (j.payload->>'tapRequestId' IN(SELECT id::text FROM public.tap_requests WHERE membership_id=m)
      OR j.payload->>'recipientId' IN(SELECT id::text FROM public.campaign_recipients WHERE membership_id=m)
      OR j.payload->>'runId' IN(SELECT id::text FROM public.automation_runs WHERE membership_id=m));
  UPDATE public.outbox_jobs SET payload=CASE WHEN payload?'membershipId' THEN jsonb_build_object('membershipId',payload->>'membershipId') ELSE '{}'::jsonb END,
    status=CASE WHEN status IN ('pending','retry','processing','blocked') THEN 'suppressed' ELSE status END,last_error=NULL
    WHERE tenant_id=t AND (s='tenant' OR payload->>'membershipId'=m::text);
  UPDATE public.automation_runs SET status='suppressed',reason='Subject closed' WHERE membership_id=ANY(members) AND status='queued';
  UPDATE public.campaign_recipients SET status='suppressed',suppress_reason='Subject closed' WHERE membership_id=ANY(members) AND status='queued';
  UPDATE public.tap_requests SET status='cancelled' WHERE membership_id=ANY(members) AND status='pending_staff';
  UPDATE public.wallet_passes SET revoked_at=cutoff,revoke_reason='closed',updated_at=clock_timestamp(),
    status=CASE WHEN status='pending' AND (provider='apple' OR provider_object_id LIKE 'passfast:%') THEN 'revoked' ELSE 'revocation_pending' END
    WHERE membership_id=ANY(members) AND revoked_at IS NULL;
  INSERT INTO public.outbox_jobs(tenant_id,kind,payload)
    SELECT DISTINCT t,'wallet.refresh',jsonb_build_object('membershipId',w.membership_id::text,'coalescingVersion','1') FROM public.wallet_passes w
    WHERE w.membership_id=ANY(members) AND w.status<>'revoked'
      AND NOT EXISTS(SELECT 1 FROM public.outbox_jobs j WHERE j.tenant_id=t AND j.kind='wallet.refresh' AND j.status='pending' AND j.payload->>'membershipId'=w.membership_id::text);
  INSERT INTO public.consent_events(tenant_id,membership_id,channel,purpose,granted,notice_version,source)
    SELECT t,id,'email','marketing',false,'2026-10-15','closure_replay' FROM public.memberships WHERE id=ANY(members) AND closed_at IS NULL;
  UPDATE public.memberships SET closed_at=least(coalesce(closed_at,cutoff),cutoff),card_token='retired_card_'||gen_random_uuid()::text,scan_code='retired_sc_'||gen_random_uuid()::text,
    deletion_receipt_id=CASE WHEN s='member' THEN coalesce(deletion_receipt_id,manifest) ELSE deletion_receipt_id END,retention_pruned_at=NULL WHERE id=ANY(members);
  IF s='tenant' THEN
    UPDATE public.automation_rules SET enabled=false WHERE tenant_id=t;
    UPDATE public.campaigns SET status='cancelled',updated_at=clock_timestamp() WHERE tenant_id=t AND status<>'complete';
    UPDATE public.programs SET status='archived',tap_mode='disabled' WHERE tenant_id=t;
    UPDATE public.secure_tags SET status='revoked',revoked_at=coalesce(revoked_at,cutoff) WHERE tenant_id=t AND status IN ('active','provisioned');
    UPDATE public.staff_invites SET revoked_at=coalesce(revoked_at,cutoff) WHERE tenant_id=t;
    DELETE FROM public.staff_push_subscriptions WHERE tenant_id=t;
    DELETE FROM public."session" WHERE "userId" IN(SELECT user_id FROM public.staff_roles WHERE tenant_id=t);
    UPDATE public.staff_roles SET active=false WHERE tenant_id=t;
    UPDATE public.subscriptions SET status='cancelled',updated_at=clock_timestamp() WHERE tenant_id=t;
    UPDATE public.tenants SET closed_at=least(coalesce(closed_at,cutoff),cutoff),deletion_receipt_id=coalesce(deletion_receipt_id,manifest),retention_pruned_at=NULL WHERE id=t;
  END IF;
END $$;
CREATE FUNCTION public.loynara_replay_erasure(s text,t uuid,m uuid,cutoff timestamptz,manifest uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tr public.tenants%ROWTYPE; mr public.memberships%ROWTYPE;
BEGIN
  IF cutoff IS NULL OR cutoff>clock_timestamp() OR manifest IS NULL OR s IS NULL OR s NOT IN ('member','tenant') OR t IS NULL OR (s='member' AND m IS NULL) OR (s='tenant' AND m IS NOT NULL) THEN RAISE EXCEPTION 'Erasure replay not eligible'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  SELECT * INTO tr FROM public.tenants WHERE id=t FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF tr.created_at>cutoff THEN RAISE EXCEPTION 'Erasure replay not eligible'; END IF;
  IF s='member' THEN
    SELECT * INTO mr FROM public.memberships WHERE id=m AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF mr.created_at>cutoff OR public.loynara_retention_blocked(t,m) THEN RAISE EXCEPTION 'Erasure replay not eligible'; END IF;
    UPDATE public.memberships SET closed_at=coalesce(closed_at,clock_timestamp()),card_token='retired_'||gen_random_uuid()::text,scan_code='retired_'||gen_random_uuid()::text WHERE id=m;
    PERFORM public.loynara_erase_member_graph(t,m);
  ELSE
    PERFORM 1 FROM public.memberships WHERE tenant_id=t ORDER BY id FOR UPDATE;
    IF public.loynara_retention_blocked(t,NULL) OR EXISTS(SELECT 1 FROM public.memberships WHERE tenant_id=t AND created_at>cutoff) THEN RAISE EXCEPTION 'Erasure replay not eligible'; END IF;
    -- A trusted encrypted completed/prepared tenant manifest attests that classification preceded erasure.
    UPDATE public.tenants SET closed_at=coalesce(closed_at,clock_timestamp()) WHERE id=t;
    UPDATE public.memberships SET closed_at=coalesce(closed_at,clock_timestamp()),card_token='retired_'||gen_random_uuid()::text,scan_code='retired_'||gen_random_uuid()::text WHERE tenant_id=t;
    PERFORM public.loynara_erase_tenant_graph(t);
  END IF;
END $$;
CREATE FUNCTION public.loynara_retention_candidates(batch integer DEFAULT 100) RETURNS TABLE(scope text,tenant_id uuid,membership_id uuid,cutoff timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected integer;
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid retention batch'; END IF;
  RETURN QUERY SELECT 'tenant'::text,t.id,NULL::uuid,clock_timestamp() FROM public.tenants t
    WHERE t.closed_at IS NOT NULL AND NOT public.loynara_retention_blocked(t.id,NULL)
      AND EXISTS(SELECT 1 FROM public.tenant_retention_classifications c WHERE c.tenant_id=t.id)
      AND NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=t.id AND m.closed_at IS NULL)
      AND (t.closed_at<=clock_timestamp()-interval '7 days' OR NOT EXISTS(SELECT 1 FROM public.wallet_passes w WHERE w.tenant_id=t.id AND w.status<>'revoked'))
    ORDER BY t.closed_at,t.id LIMIT batch;
  GET DIAGNOSTICS selected=ROW_COUNT;
  RETURN QUERY SELECT 'member'::text,m.tenant_id,m.id,clock_timestamp() FROM public.memberships m JOIN public.tenants t ON t.id=m.tenant_id
    WHERE (t.closed_at IS NULL OR (public.loynara_retention_blocked(t.id,NULL) AND EXISTS(SELECT 1 FROM public.tenant_retention_classifications c WHERE c.tenant_id=t.id)))
      AND m.closed_at IS NOT NULL AND NOT public.loynara_retention_blocked(m.tenant_id,m.id)
      AND (m.closed_at<=clock_timestamp()-interval '7 days' OR NOT EXISTS(SELECT 1 FROM public.wallet_passes w WHERE w.tenant_id=m.tenant_id AND w.membership_id=m.id AND w.status<>'revoked'))
    ORDER BY m.closed_at,m.id LIMIT batch-selected;
END $$;
CREATE FUNCTION public.loynara_purge_member(m uuid,cutoff timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM public.memberships WHERE id=m;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.loynara_prepare_erasure('member',t,m,cutoff) THEN RETURN false; END IF;
  RETURN public.loynara_erase_member_graph(t,m);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.loynara_prune_closed_held(batch integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject record; jobs uuid[]; devices text[]; incomplete boolean; receipt uuid; n integer:=0;
BEGIN
  FOR subject IN SELECT m.id,m.tenant_id,m.deletion_receipt_id FROM public.memberships m
    WHERE m.closed_at IS NOT NULL AND m.retention_pruned_at IS NULL AND (public.loynara_retention_blocked(m.tenant_id,m.id)
      OR EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=m.tenant_id AND t.closed_at IS NOT NULL AND (public.loynara_retention_blocked(t.id,NULL) OR NOT EXISTS(SELECT 1 FROM public.tenant_retention_classifications c WHERE c.tenant_id=t.id))))
      AND (m.closed_at<=clock_timestamp()-interval '7 days' OR NOT EXISTS(SELECT 1 FROM public.wallet_passes w WHERE w.membership_id=m.id AND w.status<>'revoked'))
    ORDER BY m.closed_at,m.id LIMIT batch FOR UPDATE OF m SKIP LOCKED LOOP
    SELECT EXISTS(SELECT 1 FROM public.wallet_passes WHERE membership_id=subject.id AND status<>'revoked') INTO incomplete;
    SELECT coalesce(array_agg(j.id),ARRAY[]::uuid[]) INTO jobs FROM public.outbox_jobs j
      WHERE (j.tenant_id=subject.tenant_id AND (j.payload->>'membershipId'=subject.id::text
        OR j.payload->>'tapRequestId' IN(SELECT id::text FROM public.tap_requests WHERE membership_id=subject.id)
        OR j.id IN(SELECT a.outbox_job_id FROM public.campaign_attempts a JOIN public.campaign_recipients c ON c.id=a.recipient_id WHERE c.membership_id=subject.id)))
        OR (j.kind='email.recover' AND j.payload->>'membershipId'=subject.id::text);
    SELECT coalesce(array_agg(device_library_identifier),ARRAY[]::text[]) INTO devices FROM public.apple_registrations WHERE membership_id=subject.id;
    PERFORM 1 FROM public.apple_devices WHERE device_library_identifier=ANY(devices) ORDER BY device_library_identifier FOR UPDATE;
    DELETE FROM public.email_provider_events WHERE job_id=ANY(jobs);
    DELETE FROM public.email_deliveries WHERE job_id=ANY(jobs);
    DELETE FROM public.campaign_attempts WHERE recipient_id IN(SELECT id FROM public.campaign_recipients WHERE membership_id=subject.id);
    DELETE FROM public.campaign_recipients WHERE membership_id=subject.id;
    DELETE FROM public.automation_runs WHERE membership_id=subject.id;
    DELETE FROM public.referrals WHERE referrer_membership_id=subject.id OR referred_membership_id=subject.id;
    DELETE FROM public.referral_codes WHERE membership_id=subject.id;
    DELETE FROM public.offline_award_events WHERE membership_id=subject.id;
    DELETE FROM public.offline_award_leases WHERE membership_id=subject.id;
    DELETE FROM public.tap_requests WHERE membership_id=subject.id;
    DELETE FROM public.contact_verification_challenges WHERE membership_id=subject.id;
    DELETE FROM public.customer_export_challenges WHERE membership_id=subject.id;
    DELETE FROM public.membership_contacts WHERE membership_id=subject.id;
    IF NOT public.loynara_retention_category_held(subject.tenant_id,subject.id,'consent') THEN DELETE FROM public.consent_events WHERE membership_id=subject.id; END IF;
    IF NOT public.loynara_retention_category_held(subject.tenant_id,subject.id,'security') THEN DELETE FROM public.card_security_events WHERE membership_id=subject.id; END IF;
    DELETE FROM public.apple_registrations WHERE membership_id=subject.id;
    DELETE FROM public.apple_devices d WHERE d.device_library_identifier=ANY(devices) AND NOT EXISTS(SELECT 1 FROM public.apple_registrations r WHERE r.device_library_identifier=d.device_library_identifier);
    DELETE FROM public.wallet_passes WHERE membership_id=subject.id;
    DELETE FROM public.outbox_jobs WHERE id=ANY(jobs);
    DELETE FROM public.inactivity_reviews WHERE membership_id=subject.id;
    IF public.loynara_retention_blocked(subject.tenant_id,subject.id) AND NOT public.loynara_retention_financial_held(subject.tenant_id,subject.id)
      AND NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=subject.tenant_id AND t.closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_retention_classifications c WHERE c.tenant_id=t.id)) THEN
      DELETE FROM public.purchase_awards WHERE ledger_entry_id IN(SELECT id FROM public.ledger_entries WHERE membership_id=subject.id);
      DELETE FROM public.redemptions WHERE membership_id=subject.id;
      DELETE FROM public.ledger_entries WHERE membership_id=subject.id;
      UPDATE public.memberships SET balance=0 WHERE id=subject.id;
    END IF;
    receipt:=subject.deletion_receipt_id;
    IF receipt IS NULL THEN INSERT INTO public.deletion_receipts(scope) VALUES('member') RETURNING id INTO receipt; END IF;
    UPDATE public.deletion_receipts SET remote_outcome=CASE WHEN incomplete OR remote_outcome='incomplete' THEN 'incomplete' ELSE 'complete' END,
      exception=CASE WHEN incomplete OR remote_outcome='incomplete' THEN 'remote_revocation_incomplete' ELSE 'legal_hold' END WHERE id=receipt;
    IF incomplete THEN UPDATE public.deletion_receipts SET remote_outcome='incomplete',exception='remote_revocation_incomplete' WHERE id IN(SELECT deletion_receipt_id FROM public.tenants WHERE id=subject.tenant_id); END IF;
    UPDATE public.memberships SET deletion_receipt_id=receipt,retention_pruned_at=clock_timestamp() WHERE id=subject.id;
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;
CREATE FUNCTION public.loynara_prune_closed_tenants(batch integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject record; u text; jobs uuid[]; n integer:=0;
BEGIN
  FOR subject IN SELECT t.id FROM public.tenants t WHERE t.closed_at<=clock_timestamp()-interval '7 days' AND t.retention_pruned_at IS NULL
    AND (public.loynara_retention_blocked(t.id,NULL) OR NOT EXISTS(SELECT 1 FROM public.tenant_retention_classifications c WHERE c.tenant_id=t.id))
    AND NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=t.id AND (m.closed_at IS NULL OR m.retention_pruned_at IS NULL))
    ORDER BY t.closed_at,t.id LIMIT batch FOR UPDATE OF t SKIP LOCKED LOOP
    -- Save only subjects actually referenced by this tenant before removing those references.
    INSERT INTO public.tenant_retention_auth_subjects(tenant_id,user_id)
      SELECT subject.id,user_id FROM (
        SELECT user_id FROM public.staff_roles WHERE tenant_id=subject.id
        UNION SELECT actor_user_id FROM public.ledger_entries WHERE tenant_id=subject.id
        UNION SELECT invited_by_user_id FROM public.staff_invites WHERE tenant_id=subject.id
        UNION SELECT actor_user_id FROM public.staff_audit_events WHERE tenant_id=subject.id
        UNION SELECT subject_user_id FROM public.staff_audit_events WHERE tenant_id=subject.id
      ) refs WHERE user_id IS NOT NULL ON CONFLICT DO NOTHING;
    SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO jobs FROM public.outbox_jobs WHERE tenant_id=subject.id OR (kind='email.recover' AND payload->>'erasureTenantId'=subject.id::text);
    DELETE FROM public.email_provider_events WHERE job_id=ANY(jobs);
    DELETE FROM public.email_deliveries WHERE job_id=ANY(jobs);
    DELETE FROM public.campaign_attempts WHERE tenant_id=subject.id;
    DELETE FROM public.campaign_recipients WHERE tenant_id=subject.id;
    DELETE FROM public.automation_runs WHERE tenant_id=subject.id;
    DELETE FROM public.outbox_jobs WHERE id=ANY(jobs);
    DELETE FROM public.campaigns WHERE tenant_id=subject.id;
    DELETE FROM public.automation_rules WHERE tenant_id=subject.id;
    DELETE FROM public.referrals WHERE tenant_id=subject.id;
    DELETE FROM public.referral_codes WHERE tenant_id=subject.id;
    DELETE FROM public.referral_settings WHERE tenant_id=subject.id;
    DELETE FROM public.tap_requests WHERE tenant_id=subject.id;
    DELETE FROM public.secure_tags WHERE tenant_id=subject.id;
    DELETE FROM public.staff_push_subscriptions WHERE tenant_id=subject.id;
    DELETE FROM public.staff_invites WHERE tenant_id=subject.id;
    DELETE FROM public.staff_roles WHERE tenant_id=subject.id;
    IF NOT public.loynara_retention_category_held(subject.id,NULL,'security') THEN DELETE FROM public.staff_audit_events WHERE tenant_id=subject.id; END IF;
    DELETE FROM public.campaign_daily_usage WHERE tenant_id=subject.id;
    -- These billing rows are explicitly synthetic fixtures; statutory archives are external and separately classified.
    DELETE FROM public.billing_invoices WHERE tenant_id=subject.id;
    DELETE FROM public.billing_handoffs WHERE tenant_id=subject.id;
    DELETE FROM public.billing_webhook_events WHERE tenant_id=subject.id;
    DELETE FROM public.billing_location_plans WHERE tenant_id=subject.id;
    DELETE FROM public.subscriptions WHERE tenant_id=subject.id;
    UPDATE public.locations SET contact_email=NULL,logo_data=NULL,latitude=NULL,longitude=NULL WHERE tenant_id=subject.id;
    FOR u IN SELECT a.user_id FROM public.tenant_retention_auth_subjects a JOIN public."user" usr ON usr.id=a.user_id WHERE a.tenant_id=subject.id ORDER BY a.user_id FOR UPDATE OF usr LOOP
      IF NOT EXISTS(SELECT 1 FROM public.staff_roles WHERE user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.staff_invites WHERE invited_by_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.ledger_entries WHERE actor_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.staff_audit_events WHERE (actor_user_id=u OR subject_user_id=u) AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.card_security_events WHERE actor_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.campaigns WHERE created_by_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.automation_rules WHERE created_by_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.offline_award_events WHERE actor_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.offline_award_leases WHERE actor_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.referrals WHERE reviewed_by_user_id=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.outbox_jobs WHERE payload->>'actorUserId'=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.inactivity_reviews WHERE reviewed_by=u AND tenant_id<>subject.id)
        AND NOT EXISTS(SELECT 1 FROM public.tenant_retention_auth_subjects WHERE user_id=u AND tenant_id<>subject.id) THEN
        DELETE FROM public."session" WHERE "userId"=u;
        DELETE FROM public."account" WHERE "userId"=u;
        DELETE FROM public."verification" WHERE identifier LIKE 'reset-password:%' AND value=u;
        UPDATE public."user" SET name='Closed account',email='erased-'||gen_random_uuid()::text||'@invalid.example',image=NULL,"emailVerified"=false,"updatedAt"=clock_timestamp() WHERE id=u;
        IF NOT EXISTS(SELECT 1 FROM public.ledger_entries WHERE actor_user_id=u)
          AND NOT EXISTS(SELECT 1 FROM public.staff_audit_events WHERE actor_user_id=u OR subject_user_id=u)
          AND NOT EXISTS(SELECT 1 FROM public.card_security_events WHERE actor_user_id=u) THEN DELETE FROM public."user" WHERE id=u; END IF;
      END IF;
    END LOOP;
    UPDATE public.tenants SET retention_pruned_at=clock_timestamp() WHERE id=subject.id;
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;
CREATE FUNCTION public.loynara_prune_expired(batch integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record; n integer; counts jsonb:='{}'; jobs uuid[];
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid retention batch'; END IF;
  -- Serializes hold creation/release with all retention decisions. No session GUC grants authority.
  PERFORM pg_catalog.pg_advisory_xact_lock(701427,27);
  counts:=counts||jsonb_build_object('closed_held_subjects',public.loynara_prune_closed_held(batch));
  counts:=counts||jsonb_build_object('closed_held_tenants',public.loynara_prune_closed_tenants(batch));
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO jobs FROM (
    SELECT j.id FROM public.outbox_jobs j WHERE j.status IN ('complete','suppressed') AND j.terminal_at<=clock_timestamp()-interval '30 days'
      AND NOT EXISTS(SELECT 1 FROM public.campaign_attempts a JOIN public.campaign_recipients c ON c.id=a.recipient_id WHERE a.outbox_job_id=j.id AND c.status='queued')
      AND NOT EXISTS(SELECT 1 FROM public.automation_runs a WHERE a.id::text=j.payload->>'runId' AND a.status='queued')
    ORDER BY j.terminal_at,j.id LIMIT batch FOR UPDATE OF j SKIP LOCKED
  ) q;
  DELETE FROM public.email_provider_events WHERE job_id=ANY(jobs);
  DELETE FROM public.email_deliveries WHERE job_id=ANY(jobs);
  DELETE FROM public.campaign_attempts WHERE outbox_job_id=ANY(jobs);
  DELETE FROM public.outbox_jobs WHERE id=ANY(jobs);
  GET DIAGNOSTICS n=ROW_COUNT; counts:=counts||jsonb_build_object('outbox_jobs',n);
  -- Static, reviewed predicates only. Each table is bounded separately; no active financial history is pruned.
  FOR r IN SELECT * FROM (VALUES
    ('customer_export_challenges','(coalesce(x.consumed_at,x.expires_at)<=clock_timestamp()-interval ''24 hours'')'),
    ('contact_verification_challenges','(coalesce(x.consumed_at,x.expires_at)<=clock_timestamp()-interval ''24 hours'')'),
    ('card_recovery_challenges','coalesce(x.consumed_at,x.expires_at)<=clock_timestamp()-interval ''24 hours'''),
    ('campaign_recipients','x.status IN (''complete'',''suppressed'') AND x.terminal_at<=clock_timestamp()-interval ''30 days'' AND NOT EXISTS(SELECT 1 FROM public.campaign_attempts a WHERE a.recipient_id=x.id)'),
    ('automation_runs','x.status IN (''complete'',''suppressed'') AND x.terminal_at<=clock_timestamp()-interval ''30 days'' AND NOT EXISTS(SELECT 1 FROM public.outbox_jobs j WHERE j.payload->>''runId''=x.id::text)'),
    ('email_provider_events','x.job_id IS NULL AND x.created_at<=clock_timestamp()-interval ''30 days'''),
    ('offline_award_events','x.processed_at<=clock_timestamp()-interval ''90 days'''),
    ('offline_award_leases','x.expires_at<=clock_timestamp()-interval ''24 hours'' AND NOT EXISTS(SELECT 1 FROM public.offline_award_events e WHERE e.lease_id=x.id)'),
    ('tap_requests','(x.created_at<=clock_timestamp()-interval ''90 days'' OR (x.status IN (''pending_staff'',''expired'',''cancelled'',''cooldown'') AND x.expires_at<=clock_timestamp()-interval ''24 hours'')) AND NOT EXISTS(SELECT 1 FROM public.outbox_jobs j WHERE j.payload->>''tapRequestId''=x.id::text)'),
    ('card_security_events','x.created_at<=clock_timestamp()-interval ''90 days'' AND NOT public.loynara_retention_category_held(x.tenant_id,x.membership_id,''security'')'),
    ('staff_audit_events','(x.created_at<=clock_timestamp()-interval ''90 days'' OR EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=x.tenant_id AND t.closed_at<=clock_timestamp()-interval ''7 days'')) AND NOT public.loynara_retention_category_held(x.tenant_id,NULL,''security'')'),
    ('referrals','x.created_at<=clock_timestamp()-interval ''90 days'''),
    ('referral_codes','x.created_at<=clock_timestamp()-interval ''90 days'' AND NOT EXISTS(SELECT 1 FROM public.referrals f WHERE f.code_id=x.id)'),
    ('apple_devices','x.updated_at<=clock_timestamp()-interval ''24 hours'' AND NOT EXISTS(SELECT 1 FROM public.apple_registrations a WHERE a.device_library_identifier=x.device_library_identifier)'),
    ('staff_invites','least(x.accepted_at,x.revoked_at,x.expires_at)<=clock_timestamp()-interval ''30 days'''),
    ('session','x."expiresAt"<=clock_timestamp()-interval ''24 hours'''),
    ('verification','x."expiresAt"<=clock_timestamp()-interval ''24 hours'''),
    ('campaign_daily_usage','x.day<(clock_timestamp() AT TIME ZONE ''UTC'')::date-90'),
    ('rate_limits','x.reset_at<=clock_timestamp()-interval ''24 hours'''),
    ('demo_requests','x.created_at<=clock_timestamp()-interval ''90 days'''),
    ('email_suppressions','x.created_at<=clock_timestamp()-interval ''3 years'''),
    ('deletion_receipts','x.completed_at<=clock_timestamp()-interval ''30 days'' AND NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.deletion_receipt_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.deletion_receipt_id=x.id)')
  ) AS approved(table_name,predicate) LOOP
    EXECUTE format('DELETE FROM public.%I target WHERE target.ctid IN (SELECT x.ctid FROM public.%I x WHERE %s ORDER BY x.ctid LIMIT $1 FOR UPDATE OF x SKIP LOCKED)',r.table_name,r.table_name,r.predicate) USING batch;
    GET DIAGNOSTICS n=ROW_COUNT; counts:=counts||jsonb_build_object(r.table_name,n);
  END LOOP;
  RETURN counts;
END $$;
--> statement-breakpoint
-- ACLs are repeated in the trusted restore provisioning script because --no-owner/--no-acl discards them.
GRANT USAGE ON SCHEMA public TO loynara_purge_owner,loynara_maintenance,loynara_runtime,loynara_restore;
GRANT SELECT,DELETE ON public.inactivity_reviews TO loynara_purge_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inactivity_reviews TO loynara_runtime;
GRANT SELECT,DELETE,UPDATE ON public.tenants,public.locations,public.staff_roles,public.staff_invites,public.staff_audit_events,public.programs,public.program_rule_versions,public.rewards,public.reward_versions,public.memberships,public.membership_contacts,public.contact_verification_challenges,public.customer_export_challenges,public.card_recovery_challenges,public.card_security_events,public.consent_events,public.ledger_entries,public.secure_tags,public.tap_requests,public.staff_push_subscriptions,public.offline_award_leases,public.offline_award_events,public.purchase_awards,public.redemptions,public.outbox_jobs,public.email_deliveries,public.email_provider_events,public.email_suppressions,public.campaigns,public.campaign_recipients,public.campaign_attempts,public.campaign_daily_usage,public.automation_rules,public.automation_runs,public.wallet_passes,public.apple_devices,public.apple_registrations,public.referral_settings,public.referral_codes,public.referrals,public.subscriptions,public.billing_location_plans,public.billing_handoffs,public.billing_invoices,public.billing_webhook_events,public.demo_requests,public.rate_limits,public."user",public."session",public."account",public."verification",public.retention_holds,public.tenant_retention_classifications,public.tenant_retention_auth_subjects,public.deletion_receipts TO loynara_purge_owner;
GRANT UPDATE ON public.memberships,public.tenants TO loynara_purge_owner;
GRANT INSERT ON public.outbox_jobs,public.consent_events,public.tenant_retention_auth_subjects TO loynara_purge_owner;
GRANT INSERT,UPDATE ON public.retention_holds,public.tenant_retention_classifications,public.deletion_receipts TO loynara_purge_owner;
GRANT SELECT,INSERT,UPDATE ON public.deletion_receipts,public.tenants,public.memberships TO loynara_runtime;
REVOKE DELETE,TRUNCATE ON public.tenants,public.memberships FROM PUBLIC,loynara_runtime;
REVOKE ALL ON public.retention_holds,public.tenant_retention_classifications,public.tenant_retention_auth_subjects FROM PUBLIC,loynara_maintenance,loynara_runtime;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
    'loynara_retention_blocked','loynara_retention_category_held','loynara_retention_financial_held','loynara_prune_closed_held','loynara_prune_closed_tenants','loynara_retention_exceptions','loynara_retention_health','loynara_set_retention_hold','loynara_release_retention_hold','loynara_classify_tenant_retention','loynara_prepare_erasure','loynara_erase_member_graph','loynara_erase_tenant_graph','loynara_purge_member','loynara_purge_tenant','loynara_replay_closure','loynara_replay_erasure','loynara_retention_candidates','loynara_prune_expired') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO loynara_purge_owner',f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,loynara_maintenance,loynara_runtime,loynara_restore',f.signature);
    IF f.proname IN ('loynara_retention_exceptions','loynara_retention_health') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO loynara_runtime',f.signature);
    ELSIF f.proname IN ('loynara_replay_closure','loynara_replay_erasure') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO loynara_restore',f.signature);
    ELSIF f.proname NOT IN ('loynara_retention_blocked','loynara_retention_category_held','loynara_retention_financial_held','loynara_prune_closed_held','loynara_prune_closed_tenants','loynara_erase_member_graph','loynara_erase_tenant_graph') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO loynara_maintenance',f.signature); END IF;
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM loynara_maintenance,loynara_restore;
REVOKE CREATE ON SCHEMA public FROM loynara_purge_owner,loynara_maintenance,loynara_runtime,loynara_restore;
