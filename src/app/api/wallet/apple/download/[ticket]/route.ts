import { and, eq, inArray, isNull } from "drizzle-orm";
import { memberships, walletPasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { applePassArchive, applePassJson, appleSigningConfig } from "@/lib/wallet/apple";
import { walletAvailability } from "@/lib/wallet/capability";
import { credentialHash, walletCardSnapshot } from "@/lib/wallet/data";
import { withWalletDatabase, WALLET_DOWNLOAD_MS } from "@/lib/wallet/database";
import { noStore, walletDownloadFailure, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { activeApplePass } from "@/lib/wallet/issue";
import { readDownloadTicket, TICKET_TTL_SECONDS } from "@/lib/wallet/ticket";
import { assertPassFastBinding, isPassFastObjectId, PassFastClient, passFastConfig, passFastSerial } from "@/lib/wallet/passfast";
import { passFastEnv } from "@/lib/wallet/template-bindings";
import { applePreparation, walletDeploymentAvailability } from "@/lib/wallet/preparation";

/** Retrieve an existing archive only. Preparation belongs exclusively to the outbox worker. */
export async function GET(request: Request, context: { params: Promise<{ ticket: string }> }) {
  if (walletDeploymentAvailability().apple !== "available") return walletDownloadFailure(request, walletUnavailable());
  try {
    return await withWalletDatabase(async (database, client, deadline) => {
      await enforcePeerLimit(request, "wallet_apple_download_peer", 60, 15 * 60, client);
      const { ticket } = await context.params;
      const parsed = readDownloadTicket(ticket);
      if (!parsed) throw new DomainError("NOT_FOUND", "Download link expired");
      // Two uses accommodate browser download retries, within the two-minute ticket lifetime.
      await enforceRateLimit({ scope: "wallet_apple_ticket_use", identity: ticket, max: 2, windowSeconds: TICKET_TTL_SECONDS + 60 }, client);
      const row = await activeApplePass(parsed.passId, database);
      if (!row) throw new DomainError("NOT_FOUND", "Download link expired");
      const snapshot = await walletCardSnapshot(row.membershipId, database);
      if (!snapshot.open || snapshot.credentialHash !== row.credentialHash || snapshot.pass.tenantId !== row.tenantId) throw new DomainError("NOT_FOUND", "Download link expired");
      const locationId = snapshot.pass.locationId;
      const env = await passFastEnv(row.tenantId, locationId, database);
      const availability = walletAvailability(env, row.tenantId, locationId);
      if (availability.apple !== "available") return walletDownloadFailure(request, walletUnavailable());
      const managed = isPassFastObjectId(row.providerObjectId);
      let bytes: Buffer;
      if (managed) {
        const config = passFastConfig(env, row.tenantId, locationId);
        assertPassFastBinding(row.providerObjectId, config);
        const prepared = await applePreparation({ tenantId: row.tenantId, locationId: locationId!, programId: snapshot.pass.programId, membershipId: row.membershipId, credentialHash: row.credentialHash!, availability }, database);
        if (prepared.status !== "ready") return walletDownloadFailure(request, walletUnavailable());
        bytes = await new PassFastClient(config, fetch, deadline).download(passFastSerial(row.providerObjectId));
      } else {
        const config = appleSigningConfig();
        bytes = await applePassArchive(applePassJson(snapshot.pass, row.id, config), snapshot.pass, config);
      }
      // A closure, reissue, or mapping change during archive retrieval must never release the old pass.
      await database.transaction(async tx => {
        const [current] = await tx.select({ scanCode: memberships.scanCode, closedAt: memberships.closedAt })
          .from(memberships).where(eq(memberships.id, row.membershipId)).for("update");
        if (!current || current.closedAt || credentialHash(current.scanCode) !== row.credentialHash) throw new DomainError("NOT_FOUND", "Download link expired");
        const [active] = await tx.select({ id: walletPasses.id }).from(walletPasses)
          .where(and(eq(walletPasses.id, row.id), eq(walletPasses.credentialHash, row.credentialHash!), isNull(walletPasses.revokedAt)));
        const fresh = await walletCardSnapshot(row.membershipId, tx);
        if (!active || !fresh.open || fresh.pass.tenantId !== row.tenantId || fresh.pass.locationId !== locationId) throw new DomainError("NOT_FOUND", "Download link expired");
        // Re-read: an operator template change during retrieval must not release a pass bound to the old one.
        const freshEnv = await passFastEnv(row.tenantId, locationId, tx);
        if (walletAvailability(freshEnv, row.tenantId, locationId).apple !== "available") throw new DomainError("NOT_FOUND", "Download link expired");
        if (managed) assertPassFastBinding(row.providerObjectId, passFastConfig(freshEnv, row.tenantId, locationId));
        await tx.update(walletPasses).set({ status: "downloaded" }).where(and(eq(walletPasses.id, row.id), inArray(walletPasses.status, ["pending", "created"])));
      });
      const filename = `${snapshot.pass.merchantName.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "karte"}.pkpass`;
      return new Response(new Uint8Array(bytes), { headers: { ...noStore, "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": `attachment; filename="${filename}"`, "X-Content-Type-Options": "nosniff" } });
    }, WALLET_DOWNLOAD_MS);
  } catch (error) { return walletDownloadFailure(request, walletIssueError(error)); }
}
