import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * ENG-166 (DS-05, Legal): a restored backup can bring back a shop erased after the backup was taken. Before the restore,
 * save the live erasure list; after it, and before the service is released, re-apply every erasure in both lists.
 *   npx tsx scripts/reapply-erasures.ts export --target loynara-production > erasures.json     # live database, before restoring
 *   npx tsx scripts/reapply-erasures.ts apply --file erasures.json --target loynara-production  # restored database, before release (local for a restored copy)
 * `apply` without --file re-applies the restored database's own records. It is idempotent; it prints one line per shop it changed.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, file: { type: "string" } } });
  const [command, ...rest] = positionals;
  if (rest.length || !["export", "apply"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_MUST_BE_EXPORT_OR_APPLY");
  if (command === "export" && values.file) throw new OperatorRefusal("FILE_ONLY_FOR_APPLY");
  assertOperatorTarget(values.target, process.env, { allowOpenRegistration: true });
  const { db } = await import("../src/db");
  const { shopErasures } = await import("../src/db/schema");
  if (command === "export") {
    console.log(JSON.stringify(await db.select().from(shopErasures)));
    process.exit(0);
  }
  const { reapplyErasures } = await import("../src/lib/shop-erasure");
  const exported = values.file ? JSON.parse(readFileSync(values.file, "utf8")) : [];
  if (!Array.isArray(exported)) throw new OperatorRefusal("FILE_MUST_HOLD_AN_ERASURE_LIST");
  const applied = await reapplyErasures(exported);
  for (const shop of applied) console.log(`ERASURE_REAPPLIED ${JSON.stringify(shop)}`);
  console.log(`ERASURES_CHECKED ${JSON.stringify({ at: new Date().toISOString(), reapplied: applied.length })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`ERASURE_REAPPLY_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
