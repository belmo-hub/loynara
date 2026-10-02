import "dotenv/config";
import { parseArgs } from "node:util";
import { OperatorRefusal, assertOperatorTarget, loadTransportKey, normalizeIdentity, provisionIdentity, type AuthContextLike } from "./operator-identity";

/**
 * Usage (see docs/pilot-operator-identity-runbook.md):
 *   OPERATOR_TRANSPORT_PUBLIC_KEY="$(cat transport-public.pem)" \
 *     npx tsx scripts/operator-provision-identity.ts --target loynara-production --email owner@example.com --name "Owner Name"
 *
 * There is deliberately no password option and no password output.
 */
async function main() {
  const { values } = parseArgs({ options: { target: { type: "string" }, email: { type: "string" }, name: { type: "string" } }, strict: true });
  // Every refusal happens before the auth module (and its database pool) is loaded.
  assertOperatorTarget(values.target, process.env);
  const identity = normalizeIdentity({ email: values.email, name: values.name });
  const transportKey = loadTransportKey(process.env.OPERATOR_TRANSPORT_PUBLIC_KEY);

  const { auth } = await import("../src/lib/auth");
  const { runWithTransaction } = await import("@better-auth/core/context");
  const ctx = await auth.$context;
  const result = await provisionIdentity({ ctx: ctx as unknown as AuthContextLike, inTransaction: <T>(fn: () => Promise<T>) => runWithTransaction(ctx.adapter, fn) as unknown as Promise<T>, identity, transportKey });

  console.log(`OPERATOR_IDENTITY_AUDIT ${JSON.stringify(result.audit)}`);
  if (result.status === "created") console.log(`OPERATOR_CREDENTIAL_ENVELOPE ${result.envelope}`);
  else console.log("OPERATOR_IDENTITY_EXISTING no credential issued and nothing changed");
  process.exit(0);
}

main().catch(error => {
  // Never print error details: they can carry connection strings or request data.
  console.error(`OPERATOR_IDENTITY_REFUSED ${error instanceof OperatorRefusal ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
