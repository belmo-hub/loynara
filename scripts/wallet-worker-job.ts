import { installWalletParentGuard } from "./worker-supervisor";
import type { OutboxJob } from "../src/lib/outbox";

// Establish orphan protection before loading modules that can open database or provider connections.
installWalletParentGuard(Number(process.env.WALLET_JOB_PARENT_PID));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
process.once("message", async (message: OutboxJob) => {
  const membershipId = message?.payload?.membershipId;
  if (!message || message.kind !== "wallet.refresh" || typeof membershipId !== "string" || !uuid.test(membershipId)
    || typeof message.tenantId !== "string" || !uuid.test(message.tenantId)) return process.exit(1);
  try {
    const { refreshWalletForMembership } = await import("../src/lib/wallet/refresh");
    const result = await refreshWalletForMembership(membershipId, { expectedTenantId: message.tenantId });
    process.send?.({ status: result.status });
  } catch {
    // Request details, provider messages and credentials never cross IPC or enter the outbox/log.
    process.send?.({ status: "retry" });
  }
});
