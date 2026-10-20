import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { checkoutCustomerExportConnection } from "./customer-export-connection";
import { z } from "zod";
import { pool } from "@/db";
import { DomainError } from "./loyalty";
import { validCardToken } from "./card-lifecycle";
import { exportBinding, exportProofHash, exportProofToken } from "./customer-export-token";
import { emailTransportMode, sendTransactional } from "./transactional-email";
import { syntheticAddress, type LocalSender } from "./email";

export type ExportAuthority = { tenantId: string; membershipId: string; credentialHash: string; emailHash?: string };
const invalid = () => new DomainError("INVALID_CHALLENGE", "Export proof is invalid or expired; request a new link from your current card");
export const exportAssistance = "Ask the merchant's privacy contact shown on your card or participation notice for an assisted personal-data request. Do not send your private card link. An unverified address is not proof of ownership.";

export async function exportDatabaseClient(signal?:AbortSignal):Promise<PoolClient> {
  try{return await checkoutCustomerExportConnection(pool,signal);}
  catch{throw new DomainError("EXPORT_BUSY","Export database is unavailable or interrupted; retry or use assisted access");}
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>,signal?:AbortSignal): Promise<T> {
  const client = await exportDatabaseClient(signal);
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if(!signal?.aborted){try { await client.query("ROLLBACK"); } catch { discard = true; }}else discard=true;
    throw error;
  } finally { client.release(discard); }
}

// A joined contact read can retain its old statement snapshot while waiting
// for the member lock. Read contacts again only after ownership is locked.
async function lockedExportMember(client: PoolClient, where: string, values: unknown[]) {
  const { rows: [member] } = await client.query(`SELECT m.id,m.tenant_id,m.card_token,m.closed_at FROM memberships m WHERE ${where} FOR UPDATE OF m`, values);
  if (!member) return undefined;
  const { rows: [contact] } = await client.query("SELECT email,email_verified FROM membership_contacts WHERE tenant_id=$1 AND membership_id=$2", [member.tenant_id, member.id]);
  return { ...member, email: contact?.email, email_verified: contact?.email_verified };
}

export async function requestCustomerExportProof(cardToken: string): Promise<{ mode: "bearer" | "email"; status: "ready" | "queued" }> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return transaction(async client => {
    const member = await lockedExportMember(client, "m.card_token=$1 AND m.closed_at IS NULL", [cardToken]);
    if (!member) throw new DomainError("NOT_FOUND", "Card not found");
    if (!member.email) return { mode: "bearer", status: "ready" };
    if (!member.email_verified) throw new DomainError("EXPORT_ASSISTANCE_REQUIRED", exportAssistance);
    const mode = emailTransportMode();
    if (mode === "disabled" || (mode === "mailpit" && !syntheticAddress(member.email))) throw new DomainError("EXPORT_ASSISTANCE_REQUIRED", exportAssistance);
    const id = randomUUID();
    await client.query("DELETE FROM customer_export_challenges WHERE tenant_id=$1 AND membership_id=$2", [member.tenant_id, member.id]);
    await client.query(`INSERT INTO customer_export_challenges (id,tenant_id,membership_id,token_hash,email_hash,credential_hash,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`, [id, member.tenant_id, member.id, exportProofHash(exportProofToken(id)), exportBinding("email", member.email), exportBinding("card", cardToken)]);
    await client.query("INSERT INTO outbox_jobs (tenant_id,kind,payload) VALUES ($1,'email.export-proof',$2)", [member.tenant_id, { membershipId: member.id, challengeId: id }]);
    return { mode: "email", status: "queued" };
  });
}

/** A successful one-use consumption authorizes only this current credential and verified contact. */
export async function consumeCustomerExportProof(proof: string,signal?:AbortSignal): Promise<ExportAuthority> {
  let hash: string;
  try { hash = exportProofHash(proof); } catch { throw invalid(); }
  return transaction(async client => {
    const { rows: [candidate] } = await client.query("SELECT tenant_id,membership_id,id FROM customer_export_challenges WHERE token_hash=$1", [hash]);
    if (!candidate) throw invalid();
    const member = await lockedExportMember(client, "m.tenant_id=$1 AND m.id=$2", [candidate.tenant_id, candidate.membership_id]);
    const { rows: [challenge] } = await client.query("SELECT *,expires_at>clock_timestamp() AS fresh FROM customer_export_challenges WHERE id=$1 FOR UPDATE", [candidate.id]);
    if (!member || member.closed_at || !member.email || !member.email_verified || !challenge?.fresh || challenge.consumed_at
      || exportBinding("email", member.email) !== challenge.email_hash || exportBinding("card", member.card_token) !== challenge.credential_hash) throw invalid();
    await client.query("UPDATE customer_export_challenges SET consumed_at=clock_timestamp() WHERE id=$1", [challenge.id]);
    return { tenantId: candidate.tenant_id, membershipId: candidate.membership_id, credentialHash: challenge.credential_hash, emailHash: challenge.email_hash };
  },signal);
}

/** Worker entry point. No address or token is stored in the outbox; ambiguous sends stay blocked. */
export async function deliverCustomerExportProof(job: { id: string; tenantId: string; payload: Record<string, unknown> }, send?: LocalSender): Promise<{ status: "complete" | "suppressed" | "blocked"; reason?: string }> {
  const payload = z.object({ membershipId: z.uuid(), challengeId: z.uuid() }).strict().safeParse(job.payload);
  if (!payload.success) return { status: "blocked", reason: "Invalid export proof job payload" };
  const mode = emailTransportMode();
  if (mode === "disabled") return { status: "blocked", reason: "Export proof delivery unavailable" };
  return transaction(async client => {
    const member = await lockedExportMember(client, "m.tenant_id=$1 AND m.id=$2", [job.tenantId, payload.data.membershipId]);
    const { rows: [challenge] } = await client.query("SELECT *,expires_at>clock_timestamp() AS fresh FROM customer_export_challenges WHERE id=$1 AND tenant_id=$2 AND membership_id=$3 FOR UPDATE", [payload.data.challengeId, job.tenantId, payload.data.membershipId]);
    const finish = async (status: "complete" | "suppressed", reason?: string) => {
      await client.query("UPDATE outbox_jobs SET payload=$1 WHERE id=$2 AND tenant_id=$3 AND kind='email.export-proof'", [{ membershipId: payload.data.membershipId }, job.id, job.tenantId]);
      return { status, reason };
    };
    if (!member || member.closed_at || !member.email || !member.email_verified || !challenge?.fresh || challenge.consumed_at
      || challenge.email_hash !== exportBinding("email", member.email) || challenge.credential_hash !== exportBinding("card", member.card_token)) return finish("suppressed", "Export proof no longer available");
    if (mode === "mailpit" && !syntheticAddress(member.email)) return finish("suppressed", "Recipient is not synthetic");
    const token = exportProofToken(challenge.id);
    if (exportProofHash(token) !== challenge.token_hash) return finish("suppressed", "Export proof no longer available");
    const link = new URL("/personal-data-export", process.env.PUBLIC_BASE_URL);
    link.hash = new URLSearchParams({ proof: token }).toString();
    const message = { to: member.email, jobId: job.id, subject: "Loynara: persönlicher Datenexport", body: `Du hast einen persönlichen Datenexport angefordert. Öffne den einmaligen Link nur auf deinem eigenen Gerät:\n${link}\n\nDer Link gilt zehn Minuten. Er erlaubt den Download der Daten genau dieser Karte. Falls du das nicht angefordert hast, ignoriere die Nachricht. Werbung wird dadurch nicht aktiviert.` };
    if (send) await send(message);
    else { const result = await sendTransactional(message); if (result.status !== "complete") return result; }
    return finish("complete");
  });
}
