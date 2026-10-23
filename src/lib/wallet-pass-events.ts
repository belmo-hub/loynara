import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { DomainError } from "./loyalty";
import { surfaceHidden } from "./pilot-surfaces";

// PassFast event webhook (ENG-043). Only device.registered / device.unregistered are kept, and of those only the event
// type, our pass row and the provider's timestamp: no device id, no other payload field is read into storage.

export const PASSFAST_EVENT_MAX_AGE_MS = 10 * 60_000;
const KEPT = ["device.registered", "device.unregistered"];
const payload = z.object({ event: z.string().max(40), serial_number: z.uuid(), timestamp: z.union([z.string().max(40), z.number()]) });

/** HMAC-SHA256 (hex) of the raw body, compared in constant time. */
export function validPassFastSignature(raw: string, signature: string | null, secret: string) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(raw).digest(), Buffer.from(signature, "hex"));
}

/** ISO text, epoch seconds or epoch milliseconds. */
function eventTime(value: string | number): Date | null {
  const at = typeof value === "number" ? new Date(value < 1e11 ? value * 1000 : value) : /^\d+$/.test(value) ? eventTime(Number(value)) : new Date(value);
  return !at || Number.isNaN(at.getTime()) ? null : at;
}

/** The route exists only with a 16+ character secret and the surface shown; checked before the body is read. */
export function passFastEventsAvailable(env: Record<string, string | undefined> = process.env) {
  return (env.PASSFAST_WEBHOOK_SECRET ?? "").length >= 16 && !surfaceHidden("walletMessages", env);
}

/** Throws a DomainError for everything the sender should not retry as-is; an unknown pass or an uninteresting event is acknowledged. */
export async function recordPassFastEvent(raw: string, signature: string | null, now = new Date(), env: Record<string, string | undefined> = process.env) {
  const secret = env.PASSFAST_WEBHOOK_SECRET ?? "";
  // Absent secret or withheld surface: the route does not exist.
  if (!passFastEventsAvailable(env)) throw new DomainError("NOT_FOUND", "Not found");
  if (!validPassFastSignature(raw, signature, secret)) throw new DomainError("UNAUTHENTICATED", "Invalid signature");
  let parsed: z.infer<typeof payload>;
  try { parsed = payload.parse(JSON.parse(raw)); } catch { throw new DomainError("INVALID_EVENT", "Invalid event"); }
  const at = eventTime(parsed.timestamp);
  if (!at || Math.abs(now.getTime() - at.getTime()) > PASSFAST_EVENT_MAX_AGE_MS) throw new DomainError("INVALID_EVENT", "Stale event");
  if (!KEPT.includes(parsed.event)) return { recorded: false };
  const inserted = await db.execute(sql`
    INSERT INTO wallet_pass_events (pass_id, tenant_id, event, event_at)
    SELECT p.id, p.tenant_id, ${parsed.event}, ${at}::timestamptz FROM wallet_passes p
    -- One serial is shared by a card's Apple and Google rows (issue.ts), so match the Apple row by the serial in its object id.
    WHERE p.provider = 'apple' AND (p.provider_object_id = ${"passfast:" + parsed.serial_number} OR p.provider_object_id LIKE ${"passfast:" + parsed.serial_number + ":%"})
    ORDER BY (p.revoked_at IS NULL) DESC, p.created_at DESC LIMIT 1
    ON CONFLICT ON CONSTRAINT wallet_pass_event_once_uq DO NOTHING RETURNING id`);
  return { recorded: inserted.rows.length === 1 };
}
