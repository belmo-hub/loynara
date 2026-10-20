import { DomainError } from "./loyalty";
import { validCardToken, retentionPolicyVersion } from "./card-lifecycle";
import { consumeCustomerExportProof, exportAssistance, exportDatabaseClient } from "./customer-export-proof";
import { exportBinding } from "./customer-export-token";
import { recipientHash } from "./transactional-email";
import { stageCustomerExport } from "./customer-export-stage";

// Every query projects an explicit allowlist and is scoped by the same snapshot's tenant/card.
const categories: Array<[string, string]> = [
  ["programContext", `SELECT t.id AS merchant_id,t.name AS merchant_name,t.currency,t.locale,l.id AS location_id,l.name AS location_name,l.city,l.country,l.timezone,l.contact_email AS merchant_contact,p.id AS program_id,p.name,p.type,p.status,p.rules_text,p.earning_mode,p.points_per_euro AS points_per_currency_unit,p.effective_at,p.created_at
    FROM own o JOIN programs p ON p.tenant_id=o.tenant_id AND p.id=o.program_id JOIN tenants t ON t.id=o.tenant_id JOIN locations l ON l.tenant_id=o.tenant_id AND l.id=p.location_id`],
  ["ruleVersions", `SELECT r.id,r.version,r.name,r.type,r.rules_text,r.earning_mode,r.points_per_currency_unit,r.effective_at,r.created_at FROM own o JOIN program_rule_versions r ON r.tenant_id=o.tenant_id AND r.program_id=o.program_id ORDER BY r.version,r.id`],
  ["rewardVersions", `SELECT v.id,v.reward_id,v.version,v.title,v.cost,v.terms_text,v.created_at FROM own o JOIN rewards r ON r.tenant_id=o.tenant_id AND r.program_id=o.program_id JOIN reward_versions v ON v.tenant_id=o.tenant_id AND v.reward_id=r.id ORDER BY v.reward_id,v.version`],
  ["ledger", `SELECT e.id,e.location_id,e.delta,e.kind,e.source,e.reason,e.reversal_of_id,e.device_at,e.created_at FROM own o JOIN ledger_entries e ON e.tenant_id=o.tenant_id AND e.membership_id=o.membership_id ORDER BY e.created_at,e.id`],
  ["redemptions", `SELECT r.id,r.ledger_entry_id,r.reward_version_id,r.reward_title,r.cost,r.created_at FROM own o JOIN redemptions r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id ORDER BY r.created_at,r.id`],
  ["purchaseAwards", `SELECT p.ledger_entry_id,p.rule_version_id,p.amount_minor,p.currency,p.applied_rate,p.points_awarded,p.rounding,p.created_at FROM own o JOIN ledger_entries e ON e.tenant_id=o.tenant_id AND e.membership_id=o.membership_id JOIN purchase_awards p ON p.tenant_id=o.tenant_id AND p.ledger_entry_id=e.id ORDER BY p.created_at,p.ledger_entry_id`],
  ["contacts", `SELECT c.email,c.email_verified,c.created_at FROM own o JOIN membership_contacts c ON c.tenant_id=o.tenant_id AND c.membership_id=o.membership_id`],
  ["consentEvents", `SELECT c.id,c.channel,c.purpose,c.granted,c.notice_version,c.source,c.created_at FROM own o JOIN consent_events c ON c.tenant_id=o.tenant_id AND c.membership_id=o.membership_id ORDER BY c.created_at,c.id`],
  ["securityEvents", `SELECT s.id,s.action,s.reason,s.verification_method,s.created_at FROM own o JOIN card_security_events s ON s.tenant_id=o.tenant_id AND s.membership_id=o.membership_id ORDER BY s.created_at,s.id`],
  ["contactVerificationEvents", `SELECT c.id,c.created_at,c.expires_at,c.consumed_at FROM own o JOIN contact_verification_challenges c ON c.tenant_id=o.tenant_id AND c.membership_id=o.membership_id ORDER BY c.created_at,c.id`],
  ["exportProofEvents", `SELECT c.id,c.created_at,c.expires_at,c.consumed_at FROM own o JOIN customer_export_challenges c ON c.tenant_id=o.tenant_id AND c.membership_id=o.membership_id ORDER BY c.created_at,c.id`],
  ["nfcOutcomes", `SELECT r.id,r.location_id,r.counter,r.status,r.ledger_entry_id,r.expires_at,r.created_at FROM own o JOIN tap_requests r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id ORDER BY r.created_at,r.id`],
  ["offlineLeases", `SELECT l.id,l.location_id,l.created_at,l.expires_at FROM own o JOIN offline_award_leases l ON l.tenant_id=o.tenant_id AND l.membership_id=o.membership_id ORDER BY l.created_at,l.id`],
  ["offlineOutcomes", `SELECT e.id,e.lease_id,e.location_id,jsonb_strip_nulls(jsonb_build_object('quantity',e.award_payload->'quantity','purchaseAmountMinor',e.award_payload->'purchaseAmountMinor','ruleVersionId',e.award_payload->'ruleVersionId')) AS award_payload,e.event_at,e.status,e.reason,e.ledger_entry_id,e.processed_at FROM own o JOIN offline_award_events e ON e.tenant_id=o.tenant_id AND e.membership_id=o.membership_id ORDER BY e.processed_at,e.id`],
  ["referralCodes", `SELECT r.id,r.created_at FROM own o JOIN referral_codes r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id ORDER BY r.created_at,r.id`],
  ["referrals", `SELECT r.id,CASE WHEN r.referrer_membership_id=o.membership_id THEN 'referrer' ELSE 'referred' END AS role,
    CASE WHEN r.referrer_membership_id=o.membership_id THEN r.referrer_bonus ELSE r.referred_bonus END AS own_bonus,r.status,r.review_reason,r.reviewed_at,r.qualified_at,r.reversed_at,r.created_at,
    CASE WHEN r.referrer_membership_id=o.membership_id THEN r.referrer_bonus_entry_id ELSE r.referred_bonus_entry_id END AS own_bonus_entry_id
    FROM own o JOIN referrals r ON r.tenant_id=o.tenant_id AND (r.referrer_membership_id=o.membership_id OR r.referred_membership_id=o.membership_id) ORDER BY r.created_at,r.id`],
  ["campaignParticipation", `SELECT r.id,r.campaign_id,c.title,c.subject,c.body,r.status,r.suppress_reason,r.sent_at,r.created_at,r.terminal_at FROM own o JOIN campaign_recipients r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id JOIN campaigns c ON c.tenant_id=o.tenant_id AND c.id=r.campaign_id ORDER BY r.created_at,r.id`],
  ["campaignAttempts", `SELECT a.id,a.recipient_id,a.outbox_job_id,a.attempt,a.status,a.reason,a.created_at FROM own o JOIN campaign_recipients r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id JOIN campaign_attempts a ON a.tenant_id=o.tenant_id AND a.recipient_id=r.id ORDER BY a.created_at,a.id`],
  ["automationParticipation", `SELECT r.id,r.rule_id,r.rule_revision,a.trigger_kind,a.channel,a.subject,a.body,r.source_entry_id,r.status,r.reason,r.attempts,r.sent_at,r.created_at,r.terminal_at FROM own o JOIN automation_runs r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id JOIN automation_rules a ON a.tenant_id=o.tenant_id AND a.id=r.rule_id ORDER BY r.created_at,r.id`],
  ["outboxOutcomes", `SELECT j.id,j.kind,j.status,j.attempts,j.next_attempt_at,j.created_at,j.terminal_at FROM own_jobs j ORDER BY j.created_at,j.id`],
  ["emailDeliveries", `SELECT d.job_id,d.provider,d.provider_message_id,d.status,d.retry_at,d.updated_at FROM own_jobs j JOIN email_deliveries d ON d.job_id=j.id ORDER BY d.updated_at,d.job_id`],
  ["emailProviderEvents", `SELECT e.id,e.job_id,e.event,e.created_at FROM own_jobs j JOIN email_provider_events e ON e.job_id=j.id ORDER BY e.created_at,e.id`],
  ["emailSuppression", `SELECT s.reason,s.created_at FROM own o JOIN email_suppressions s ON s.recipient_hash=o.recipient_hash WHERE o.contact_proof`],
  ["walletPasses", `SELECT w.id,w.provider,w.provider_object_id,w.status,w.revoked_at,w.revoke_reason,w.synced_at,w.created_at,w.updated_at FROM own o JOIN wallet_passes w ON w.tenant_id=o.tenant_id AND w.membership_id=o.membership_id ORDER BY w.created_at,w.id`],
  ["walletRegistrations", `SELECT r.pass_type_identifier,r.serial_number,r.created_at FROM own o JOIN apple_registrations r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id ORDER BY r.created_at,r.serial_number`],
  ["inactivityReviews", `SELECT r.flagged_at,r.reviewed_at FROM own o JOIN inactivity_reviews r ON r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id`],
  ["retentionExceptions", `SELECT h.categories,h.legal_basis,h.created_at,h.review_at FROM own o CROSS JOIN LATERAL public.loynara_retention_exceptions(o.tenant_id,o.membership_id) h ORDER BY h.created_at`],
];

/** Complete staged export: all category reads occur in exactly one readonly repeatable-read transaction. */
export async function prepareCustomerPersonalExport(input: { cardToken?: string; proof?: string }, signal?: AbortSignal) {
  if (Boolean(input.cardToken) === Boolean(input.proof)) throw new DomainError("INVALID_EXPORT", "Provide one current card credential or one fresh export proof");
  if (input.cardToken && !validCardToken(input.cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return stageCustomerExport(async (append,exportSignal) => {
    const authority = input.proof ? await consumeCustomerExportProof(input.proof,exportSignal) : undefined;
    const client = await exportDatabaseClient(exportSignal); let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      const { rows: [member] } = await client.query(`SELECT m.id,m.tenant_id,m.program_id,m.card_locator,m.card_token,m.balance,m.created_at,m.last_customer_activity_at,c.email,c.email_verified,transaction_timestamp() AS exported_at
        FROM memberships m LEFT JOIN membership_contacts c ON c.tenant_id=m.tenant_id AND c.membership_id=m.id
        WHERE m.closed_at IS NULL AND (($3::text IS NOT NULL AND m.card_token=$3) OR (m.tenant_id=$1::uuid AND m.id=$2::uuid))`, [authority?.tenantId ?? null, authority?.membershipId ?? null, input.cardToken ?? null]);
      if (!member) throw new DomainError("NOT_FOUND", "Card not found");
      if (authority && (authority.credentialHash !== exportBinding("card", member.card_token) || !member.email || !member.email_verified || authority.emailHash !== exportBinding("email", member.email))) throw new DomainError("INVALID_CHALLENGE", "Export proof no longer matches this card");
      if (member.email && (!member.email_verified || !authority)) throw new DomainError("EXPORT_ASSISTANCE_REQUIRED", member.email_verified ? "Request and open a fresh export link sent to the stored verified address" : exportAssistance);
      const metadata = {
        formatVersion: 2, scope: "complete-own-card-personal-data", exportedAt: member.exported_at,
        authorization: authority ? "fresh-verified-email" : "current-private-card-credential",
        membership: { id: member.id, cardLocator: `K-${member.card_locator}`, balance: member.balance, createdAt: member.created_at, lastCustomerActivityAt: member.last_customer_activity_at },
        processing: {
          purposes: ["loyalty earning and redemption", "requested recovery and data rights", "security and service delivery", "marketing only with separate valid consent"],
          recipientCategories: ["merchant controller and authorized service operator", "hosting and encrypted recovery backup processors", "configured email and Wallet providers where used"],
          retentionPolicyVersion, retention: { activeCard: "while relationship is active, subject to inactivity review", closure: "complete card graph within 24 hours after revocation work; at most 7 days absent specific hold", providerHistory: "terminal 30 days; failed/blocked 90 days", securityHistory: "90 days", suppression: "minimal suppression hash 3 years", encryptedBackups: "14 days; a final backup may survive until 21 days after closure", erasureManifest: "30 days and until older backups expire", logs: "7 days" },
          requestRoute: "/datenschutz and the merchant privacy contact in programContext; assisted identity assessment available if credentials are lost or address is unverified",
          withheld: ["card/scan/session/recovery/challenge credentials and hashes", "push endpoints, device secrets and signing keys", "referral counterparties and staff identifiers", "historic verification target addresses without current ownership proof; request assisted assessment", "unattributable shared-address recovery requests; use assisted access for that separate scope"],
          completeness: "All retained attributable records in this snapshot; no row truncation. Older lawfully removed records are not reconstructed from backups.",
        },
      };
      const header = JSON.stringify(metadata);
      await append(header.slice(0, -1));
      const values = [member.tenant_id, member.id, member.program_id, member.email ? recipientHash(member.email) : null, Boolean(authority)];
      for (const [name, sql] of categories) {
        if (exportSignal.aborted) throw new Error("Export interrupted");
        await append(`,${JSON.stringify(name)}:[`);
        await client.query(`DECLARE export_rows NO SCROLL CURSOR FOR WITH own AS (SELECT $1::uuid AS tenant_id,$2::uuid AS membership_id,$3::uuid AS program_id,$4::text AS recipient_hash,$5::boolean AS contact_proof), own_jobs AS (
            SELECT j.* FROM own o JOIN outbox_jobs j ON j.tenant_id=o.tenant_id WHERE (
              j.payload->>'membershipId'=o.membership_id::text
              OR j.payload->>'tapRequestId' IN (SELECT id::text FROM tap_requests WHERE tenant_id=o.tenant_id AND membership_id=o.membership_id)
              OR j.payload->>'recipientId' IN (SELECT id::text FROM campaign_recipients WHERE tenant_id=o.tenant_id AND membership_id=o.membership_id)
              OR j.payload->>'runId' IN (SELECT id::text FROM automation_runs WHERE tenant_id=o.tenant_id AND membership_id=o.membership_id)
              OR j.id IN (SELECT a.outbox_job_id FROM campaign_attempts a JOIN campaign_recipients r ON r.tenant_id=a.tenant_id AND r.id=a.recipient_id WHERE r.tenant_id=o.tenant_id AND r.membership_id=o.membership_id)
            ))
          SELECT CASE WHEN octet_length(row_to_json(record)::text)<=262144 THEN row_to_json(record)::text ELSE NULL END AS row FROM (${sql}) record`, values);
        let first = true;
        while (true) {
          const page = await client.query<{ row: string | null }>("FETCH FORWARD 128 FROM export_rows");
          for (const row of page.rows) {
            if (row.row === null) throw new DomainError("EXPORT_ASSISTANCE_REQUIRED", "A record exceeds the automatic export budget; request a complete assisted export");
            await append(`${first ? "" : ","}${row.row}`); first = false;
          }
          if (page.rows.length < 128) break;
        }
        await client.query("CLOSE export_rows");
        await append("]");
      }
      await append("}");
      await client.query("COMMIT");
    } catch (error) {
      if(!exportSignal.aborted){try { await client.query("ROLLBACK"); } catch { discard = true; }}else discard=true;
      throw error;
    } finally { client.release(discard); }
  }, signal);
}
