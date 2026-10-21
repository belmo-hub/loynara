import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * Shows, reschedules or ends a programme (private Railway console, like operator-plate). Ending unlinks its plates.
 *   npx tsx scripts/operator-programme.ts status   --program-id <id> --target loynara-production --actor-user-id <operator user id>
 *   npx tsx scripts/operator-programme.ts schedule --program-id <id> --end-date 2026-11-15 --target ... --actor-user-id ...   # dry run
 *   npx tsx scripts/operator-programme.ts end      --program-id <id> --target ... --actor-user-id ...                         # dry run; ends NOW, final
 *   ... --execute                                                                                                             # after reading the dry run
 * The actor must be on PLATE_OPERATOR_USER_IDS. Refusals print one reason code.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, "actor-user-id": { type: "string" }, "program-id": { type: "string" }, "end-date": { type: "string" }, execute: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  if (rest.length || !["status", "schedule", "end"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_MUST_BE_STATUS_SCHEDULE_OR_END");
  if (!values["program-id"]) throw new OperatorRefusal("PROGRAM_ID_REQUIRED");
  if ((command === "schedule") !== Boolean(values["end-date"])) throw new OperatorRefusal(command === "schedule" ? "END_DATE_REQUIRED" : "END_DATE_ONLY_FOR_SCHEDULE");
  assertOperatorTarget(values.target, process.env);
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new OperatorRefusal("ACTOR_REQUIRED");
  const { operatorProgramme } = await import("../src/lib/programme-end");
  const outcome = await operatorProgramme({ actorUserId, env: process.env, programId: values["program-id"], command: command as "status" | "schedule" | "end", endDate: values["end-date"], execute: values.execute === true });
  console.log(`PROGRAMME ${JSON.stringify({ at: new Date().toISOString(), command, actorUserId, ...outcome })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`PROGRAMME_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
