import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { validCardToken } from "./card-lifecycle";
import { cardQrSrc } from "./card-qr";
import { enforcePeerLimit, enforceRateLimit } from "./rate-limit";

/**
 * Web audit finding 1, option C (CTO, 22 Nov): the server names the card's QR, its largest element, in the first HTML
 * (a high-priority preload), so the image loads while the page's script and its read still run. Only the scan code is read, which the card read
 * itself exposes; balance, rewards, moment and Wallet stay with that read, which stays authoritative. Its own limits,
 * as strict as the card read's. Any refusal or failure, and an unknown, closed or reissued link, give null: the page
 * then renders exactly as before.
 */
export async function firstPaintQr(token: string, request: Request): Promise<string | null> {
  try {
    if (!validCardToken(token)) return null;
    await enforcePeerLimit(request, "card_shell_peer", 240, 15 * 60);
    await enforceRateLimit({ scope: "card_shell_token", identity: token, max: 90, windowSeconds: 15 * 60 });
    const [row] = await db.select({ scanCode: memberships.scanCode }).from(memberships)
      .where(and(eq(memberships.cardToken, token), isNull(memberships.closedAt))).limit(1);
    return row ? cardQrSrc(row.scanCode) : null;
  } catch { return null; }
}
