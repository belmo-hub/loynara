import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * Links a plate to a shop, moves it, or unlinks it (private Railway console, like operator-register-tag).
 *   npx tsx scripts/operator-plate.ts status --plate P-007 --target loynara-production --actor-user-id <operator user id>
 *   npx tsx scripts/operator-plate.ts link   --plate P-007 --program-id <programme id> --target ... --actor-user-id ...   # dry run
 *   npx tsx scripts/operator-plate.ts unlink --plate P-007 --target ... --actor-user-id ...                              # dry run
 *   ... --execute                                                                                                        # after reading the dry run
 * The actor must be on PLATE_OPERATOR_USER_IDS. Link on a linked plate is a relink. Refusals print one reason code.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, "actor-user-id": { type: "string" }, plate: { type: "string" }, "program-id": { type: "string" }, execute: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  if (rest.length || !["status", "link", "unlink"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_MUST_BE_STATUS_LINK_OR_UNLINK");
  if ((command === "link") !== Boolean(values["program-id"])) throw new OperatorRefusal(command === "link" ? "PROGRAM_ID_REQUIRED" : "PROGRAM_ID_ONLY_FOR_LINK");
  assertOperatorTarget(values.target, process.env);
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new OperatorRefusal("ACTOR_REQUIRED");
  const plates = await import("../src/lib/plates");
  const input = { actorUserId, env: process.env, plateLabel: values.plate ?? "" };
  const outcome = command === "status" ? await plates.plateStatus(input)
    : await plates.setPlateLink({ ...input, programId: command === "link" ? values["program-id"]! : null, execute: values.execute === true });
  console.log(`PLATE ${JSON.stringify({ at: new Date().toISOString(), command, ...outcome })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`PLATE_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
