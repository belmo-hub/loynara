import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * Links a plate to a shop, moves it, unlinks it, or revokes an unlinked one (private Railway console, like operator-register-tag);
 * revoke-tag retires a shop's live non-plate tag by id.
 *   npx tsx scripts/operator-plate.ts status --plate P-007 --target loynara-production --actor-user-id <operator user id>
 *   npx tsx scripts/operator-plate.ts link   --plate P-007 --program-id <programme id> --target ... --actor-user-id ...   # dry run
 *   npx tsx scripts/operator-plate.ts unlink --plate P-007 --target ... --actor-user-id ...                              # dry run
 *   npx tsx scripts/operator-plate.ts revoke --plate P-007 --target ... --actor-user-id ...                              # dry run; unlinked plates only, final
 *   npx tsx scripts/operator-plate.ts revoke-tag --tag-id <secure tag id> --target ... --actor-user-id <owner user id>  # dry run; final
 *   ... --execute                                                                                                        # after reading the dry run
 * The actor must be on PLATE_OPERATOR_USER_IDS; for revoke-tag, an active owner of the tag's shop. Link on a linked plate is a relink. Refusals print one reason code.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, "actor-user-id": { type: "string" }, plate: { type: "string" }, "tag-id": { type: "string" }, "program-id": { type: "string" }, execute: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  if (rest.length || !["status", "link", "unlink", "revoke", "revoke-tag"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_MUST_BE_STATUS_LINK_UNLINK_REVOKE_OR_REVOKE_TAG");
  if ((command === "link") !== Boolean(values["program-id"])) throw new OperatorRefusal(command === "link" ? "PROGRAM_ID_REQUIRED" : "PROGRAM_ID_ONLY_FOR_LINK");
  if ((command === "revoke-tag") !== Boolean(values["tag-id"])) throw new OperatorRefusal(command === "revoke-tag" ? "TAG_ID_REQUIRED" : "TAG_ID_ONLY_FOR_REVOKE_TAG");
  assertOperatorTarget(values.target, process.env, { allowOpenRegistration: true });
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new OperatorRefusal("ACTOR_REQUIRED");
  if (command === "revoke-tag") {
    const { retireSecureTag } = await import("../src/lib/secure-tap");
    console.log(`PLATE ${JSON.stringify({ at: new Date().toISOString(), command, ...await retireSecureTag({ actorUserId, tagId: values["tag-id"]!, execute: values.execute === true }) })}`);
    process.exit(0);
  }
  const plates = await import("../src/lib/plates");
  const input = { actorUserId, env: process.env, plateLabel: values.plate ?? "" };
  const outcome = command === "status" ? await plates.plateStatus(input)
    : command === "revoke" ? await plates.revokeUnlinkedPlate({ ...input, execute: values.execute === true })
    : await plates.setPlateLink({ ...input, programId: command === "link" ? values["program-id"]! : null, execute: values.execute === true });
  console.log(`PLATE ${JSON.stringify({ at: new Date().toISOString(), command, ...outcome })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`PLATE_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
