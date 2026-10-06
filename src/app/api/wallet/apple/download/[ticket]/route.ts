import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships, walletPasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { applePassArchive, applePassJson, appleSigningConfig } from "@/lib/wallet/apple";
import { walletAvailability } from "@/lib/wallet/capability";
import { credentialHash, walletCardSnapshot } from "@/lib/wallet/data";
import { noStore, walletDownloadFailure, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { activeApplePass } from "@/lib/wallet/issue";
import { readDownloadTicket, TICKET_TTL_SECONDS } from "@/lib/wallet/ticket";

/**
 * Step 2: Safari navigates here and receives the signed pass. The ticket is short-lived and use-capped, and the pass
 * must still be unrevoked and belong to the card's current credential, so a ticket issued before a reissue or closure
 * yields nothing.
 */
export async function GET(request: Request, context: { params: Promise<{ ticket: string }> }) {
  if (walletAvailability().apple !== "available") return walletDownloadFailure(request, walletUnavailable());
  try {
    await enforcePeerLimit(request, "wallet_apple_download_peer", 60, 15 * 60);
    const { ticket } = await context.params;
    const parsed = readDownloadTicket(ticket);
    if (!parsed) throw new DomainError("NOT_FOUND", "Download link expired");
    // Two uses: some browsers request a download twice (preflight/resume); a leaked ticket is worthless after that.
    await enforceRateLimit({ scope: "wallet_apple_ticket_use", identity: ticket, max: 2, windowSeconds: TICKET_TTL_SECONDS + 60 });
    const row = await activeApplePass(parsed.passId);
    if (!row) throw new DomainError("NOT_FOUND", "Download link expired");
    const snapshot = await walletCardSnapshot(row.membershipId);
    if (!snapshot.open || snapshot.credentialHash !== row.credentialHash) throw new DomainError("NOT_FOUND", "Download link expired");
    const config = appleSigningConfig();
    const bytes = await applePassArchive(applePassJson(snapshot.pass, row.id, config), snapshot.pass, config);
    // Signing may outlast a staff reissue or closure. Recheck under the same membership lock as those operations,
    // after signing, before releasing any archive. Already downloaded/registered rows remain valid without a status change.
    await db.transaction(async tx => {
      const [current] = await tx.select({ scanCode: memberships.scanCode, closedAt: memberships.closedAt })
        .from(memberships).where(eq(memberships.id, row.membershipId)).for("update");
      if (!current || current.closedAt || credentialHash(current.scanCode) !== row.credentialHash) throw new DomainError("NOT_FOUND", "Download link expired");
      const [active] = await tx.select({ id: walletPasses.id }).from(walletPasses)
        .where(and(eq(walletPasses.id, row.id), eq(walletPasses.credentialHash, row.credentialHash!), isNull(walletPasses.revokedAt)));
      if (!active) throw new DomainError("NOT_FOUND", "Download link expired");
      await tx.update(walletPasses).set({ status: "downloaded" }).where(and(eq(walletPasses.id, row.id), eq(walletPasses.status, "pending")));
    });
    const filename = `${snapshot.pass.merchantName.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "karte"}.pkpass`;
    return new Response(new Uint8Array(bytes), { headers: { ...noStore, "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": `attachment; filename="${filename}"`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return walletDownloadFailure(request, walletIssueError(error)); }
}
