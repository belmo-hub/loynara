import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, single-purpose download ticket for an Apple pass. The customer's bearer card link travels only in a POST
 * body; the URL that Safari navigates to (and that may land in history, proxy logs or a Referer) carries this ticket
 * instead. It names one issued pass (a random serial, not a credential), expires after two minutes, and the download
 * route additionally caps its use count and re-checks that the pass still belongs to the card's current credential.
 */
export const TICKET_TTL_SECONDS = 120;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ticketKey(env: Record<string, string | undefined>): Buffer {
  const secret = env.BETTER_AUTH_SECRET ?? (env.NODE_ENV === "test" ? "synthetic-test-wallet-ticket-key" : "");
  if (secret.length < 16) throw new Error("BETTER_AUTH_SECRET is required for Wallet download tickets");
  return createHmac("sha256", secret).update("loynara-wallet-download-ticket-v1").digest();
}

function sign(body: string, env: Record<string, string | undefined>) {
  return createHmac("sha256", ticketKey(env)).update(`apple-pass-download:${body}`).digest("base64url");
}

export function createDownloadTicket(passId: string, now = Date.now(), env: Record<string, string | undefined> = process.env): string {
  if (!uuid.test(passId)) throw new Error("Invalid pass id");
  // A nonce makes every ticket distinct, so each issuance has its own use budget.
  const body = `${passId}.${Math.floor(now / 1000) + TICKET_TTL_SECONDS}.${randomBytes(9).toString("base64url")}`;
  return `${Buffer.from(body).toString("base64url")}.${sign(body, env)}`;
}

export function readDownloadTicket(ticket: string, now = Date.now(), env: Record<string, string | undefined> = process.env): { passId: string } | null {
  if (!/^[A-Za-z0-9_-]{20,120}\.[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  const [encoded, signature] = ticket.split(".");
  const body = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(sign(body, env));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const match = /^([0-9a-f-]{36})\.(\d{10})\.[A-Za-z0-9_-]{12}$/i.exec(body);
  if (!match || !uuid.test(match[1])) return null;
  const expires = Number(match[2]);
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now || expires * 1000 > now + (TICKET_TTL_SECONDS + 5) * 1000) return null;
  return { passId: match[1] };
}
