import { installWalletParentGuard, type PassFastCallTiming } from "./worker-supervisor";
import type { OutboxJob } from "../src/lib/outbox";

// Establish orphan protection before loading modules that can open database or provider connections.
installWalletParentGuard(Number(process.env.WALLET_JOB_PARENT_PID));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
process.once("message", async (message: OutboxJob) => {
  // Process start until the job arrives: interpreter, loader and IPC set-up.
  const childStartMs = Math.round(performance.now());
  const membershipId = message?.payload?.membershipId;
  if (!message || message.kind !== "wallet.refresh" || typeof membershipId !== "string" || !uuid.test(membershipId)
    || typeof message.tenantId !== "string" || !uuid.test(message.tenantId)) return process.exit(1);
  const calls: PassFastCallTiming[] = [];
  try {
    const { PASSFAST_BASE } = await import("../src/lib/wallet/passfast");
    // Times PassFast calls only (method, status, ms); the URL, headers and body are never recorded.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const started = performance.now();
      let status = 0;
      try {
        const response = await realFetch(input, init);
        status = response.status;
        return response;
      } finally {
        if (String(input instanceof Request ? input.url : input).startsWith(PASSFAST_BASE)) {
          calls.push({ method: init?.method ?? "GET", status, ms: Math.round(performance.now() - started) });
        }
      }
    };
    const { refreshWalletForMembership } = await import("../src/lib/wallet/refresh");
    const result = await refreshWalletForMembership(membershipId, { expectedTenantId: message.tenantId });
    process.send?.({ status: result.status, timing: { childStartMs, calls } });
  } catch {
    // Request details, provider messages and credentials never cross IPC or enter the outbox/log.
    process.send?.({ status: "retry", timing: { childStartMs, calls } });
  }
});
