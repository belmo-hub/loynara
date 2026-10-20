-- Trusted operator-only provisioning after a --no-owner --no-acl restore.
-- Run with psql -v ON_ERROR_STOP=1, before enabling any restored application.
-- Does not grant any LOGIN membership; operators separately bind a dedicated
-- maintenance login and runtime login to their corresponding NOLOGIN groups.
-- Existing unsafe cluster roles fail closed; this never alters or drops them.
BEGIN;
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
-- Maintenance cannot perform arbitrary DML, even after a restore.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM loynara_maintenance,loynara_restore;
REVOKE CREATE ON SCHEMA public FROM loynara_purge_owner,loynara_maintenance,loynara_runtime,loynara_restore;
DO $$
DECLARE expected_count integer;
BEGIN
  SELECT count(*) INTO expected_count FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('loynara_retention_blocked','loynara_retention_category_held','loynara_retention_financial_held','loynara_prune_closed_held','loynara_prune_closed_tenants','loynara_retention_exceptions','loynara_retention_health','loynara_set_retention_hold','loynara_release_retention_hold','loynara_classify_tenant_retention','loynara_prepare_erasure','loynara_erase_member_graph','loynara_erase_tenant_graph','loynara_purge_member','loynara_purge_tenant','loynara_replay_closure','loynara_replay_erasure','loynara_retention_candidates','loynara_prune_expired');
  IF expected_count<>19 OR EXISTS(
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
    WHERE n.nspname='public' AND p.proname LIKE 'loynara_%' AND p.proname NOT IN ('loynara_outbox_terminal_clock','loynara_membership_admission')
      AND (r.rolname<>'loynara_purge_owner' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
        OR (p.proname NOT IN ('loynara_retention_blocked','loynara_retention_category_held','loynara_retention_financial_held') AND NOT p.prosecdef)
        OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
  ) THEN RAISE EXCEPTION 'Retention function authority verification failed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('reject_ledger_mutation','reject_programme_audit_mutation','reject_staff_audit_mutation','reject_card_security_mutation')
      AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])) THEN
    RAISE EXCEPTION 'Append-only trigger authority verification failed';
  END IF;
END $$;
COMMIT;
