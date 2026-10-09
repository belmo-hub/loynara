import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { walletPasses } from "@/db/schema";

type WalletTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PassRow = typeof walletPasses.$inferSelect;

/**
 * Every Google issuance and refresh takes this same pass-row lock before reading its current state or contacting
 * Google. Reissue/closure update that row too, so their revocation cannot overtake an in-flight object creation.
 * Read/write through tx while locked; taking a membership lock here would invert lifecycle writers' lock order.
 */
export async function withGooglePassLock<T>(passId: string, write: (tx: WalletTransaction, pass: PassRow | null) => Promise<T>, database: Pick<typeof db, "transaction"> = db): Promise<T> {
  return database.transaction(async tx => {
    const [pass] = await tx.select().from(walletPasses).where(and(eq(walletPasses.id, passId), eq(walletPasses.provider, "google"))).for("update");
    return write(tx, pass ?? null);
  });
}
