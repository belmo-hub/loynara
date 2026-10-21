import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * One-time copy of PASSFAST_TENANT_TEMPLATES into the database (private Railway console, like operator-plate), web service:
 *   npx tsx scripts/operator-wallet-templates.ts import --target loynara-production --actor-user-id <operator user id>   # dry run
 *   ... --execute                                                                                                       # after reading the dry run
 * Never overwrites a location already set on /operator. Per binding: import, unchanged, table_differs, template_in_use or
 * unknown_location. The actor must be on PLATE_OPERATOR_USER_IDS.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, "actor-user-id": { type: "string" }, execute: { type: "boolean" } } });
  if (positionals.join(" ") !== "import") throw new OperatorRefusal("COMMAND_MUST_BE_IMPORT");
  assertOperatorTarget(values.target, process.env);
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new OperatorRefusal("ACTOR_REQUIRED");
  const { importEnvWalletTemplates } = await import("../src/lib/wallet/template-bindings");
  const results = await importEnvWalletTemplates({ actorUserId, env: process.env, execute: values.execute === true });
  console.log(`WALLET_TEMPLATES ${JSON.stringify({ at: new Date().toISOString(), execute: values.execute === true, results })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`WALLET_TEMPLATES_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
