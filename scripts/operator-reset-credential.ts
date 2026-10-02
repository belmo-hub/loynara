import "dotenv/config";
import { parseArgs } from "node:util";
import { OperatorRefusal, assertOperatorTarget, loadTransportKey, resetCredential, type ResetContextLike } from "./operator-identity";

/**
 * Operator-assisted password reset for an EXISTING owner or staff identity (see docs/pilot-recovery-runbook.md).
 *   OPERATOR_TRANSPORT_PUBLIC_KEY="$(cat transport-public.pem)" \
 *     npx tsx scripts/operator-reset-credential.ts --target loynara-production --email owner@example.com
 *
 * Same target guards as provisioning. There is deliberately no password option and no password output;
 * the new temporary password is delivered only as an RSA-OAEP sealed envelope. Existing sessions are revoked.
 */
async function main() {
  const { values } = parseArgs({ options: { target: { type: "string" }, email: { type: "string" } }, strict: true });
  assertOperatorTarget(values.target, process.env);
  if (!values.email) throw new OperatorRefusal("EMAIL_INVALID");
  const transportKey = loadTransportKey(process.env.OPERATOR_TRANSPORT_PUBLIC_KEY);

  const { auth } = await import("../src/lib/auth");
  const { runWithTransaction } = await import("@better-auth/core/context");
  const ctx = await auth.$context;
  const result = await resetCredential({ ctx: ctx as unknown as ResetContextLike, inTransaction: <T>(fn: () => Promise<T>) => runWithTransaction(ctx.adapter, fn) as unknown as Promise<T>, email: values.email, transportKey });

  console.log(`OPERATOR_CREDENTIAL_RESET_AUDIT ${JSON.stringify(result.audit)}`);
  console.log(`OPERATOR_CREDENTIAL_ENVELOPE ${result.envelope}`);
  process.exit(0);
}

main().catch(error => {
  // Never print error details: they can carry connection strings or request data.
  console.error(`OPERATOR_CREDENTIAL_RESET_REFUSED ${error instanceof OperatorRefusal ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
