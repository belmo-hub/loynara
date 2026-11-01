import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * Shows a programme's cancellation, enters one that came by e-mail, keeps or moves its end, withdraws it on the shop's wish, or
 * ends it now (private Railway console, like operator-plate). Every change applies to the whole business (one contract);
 * ending unlinks its plates. ENG-167 (Legal, 1 Nov): a cancellation binds from the moment it reached us.
 *   npx tsx scripts/operator-programme.ts status   --program-id <id> --target loynara-production --actor-user-id <operator user id>
 *   npx tsx scripts/operator-programme.ts request  --program-id <id> --received-at 2026-11-12T09:30+01:00 --target ... --actor-user-id ...   # e-mailed cancellation: the time the e-mail ARRIVED
 *   npx tsx scripts/operator-programme.ts schedule --program-id <id> --end-date 2026-11-27 --target ... --actor-user-id ...   # keep the date, or a later one with --consent
 *   npx tsx scripts/operator-programme.ts withdraw --program-id <id> --target ... --actor-user-id ...                         # on the shop's wish
 *   npx tsx scripts/operator-programme.ts end      --program-id <id> --target ... --actor-user-id ...                         # ends NOW, final
 *   ... --execute                                                                                                             # after reading the dry run
 * request refuses an arrival time whose end has already passed unless --accept-past-end (after speaking with the shop).
 * schedule never moves a requested end earlier; a later end needs --consent (the shop agreed in text form; keep its message
 * with the contract record). The actor must be on PLATE_OPERATOR_USER_IDS. Refusals print one reason code.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, "actor-user-id": { type: "string" }, "program-id": { type: "string" }, "end-date": { type: "string" }, "received-at": { type: "string" }, consent: { type: "boolean" }, "accept-past-end": { type: "boolean" }, execute: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  if (rest.length || !["status", "schedule", "end", "request", "withdraw"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_MUST_BE_STATUS_SCHEDULE_REQUEST_WITHDRAW_OR_END");
  if (!values["program-id"]) throw new OperatorRefusal("PROGRAM_ID_REQUIRED");
  if ((command === "schedule") !== Boolean(values["end-date"])) throw new OperatorRefusal(command === "schedule" ? "END_DATE_REQUIRED" : "END_DATE_ONLY_FOR_SCHEDULE");
  if ((command === "request") !== Boolean(values["received-at"])) throw new OperatorRefusal(command === "request" ? "RECEIVED_AT_REQUIRED" : "RECEIVED_AT_ONLY_FOR_REQUEST");
  if (values.consent && command !== "schedule") throw new OperatorRefusal("CONSENT_ONLY_FOR_SCHEDULE");
  if (values["accept-past-end"] && command !== "request") throw new OperatorRefusal("ACCEPT_PAST_END_ONLY_FOR_REQUEST");
  assertOperatorTarget(values.target, process.env);
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new OperatorRefusal("ACTOR_REQUIRED");
  const { operatorProgramme } = await import("../src/lib/programme-end");
  const outcome = await operatorProgramme({ actorUserId, env: process.env, programId: values["program-id"], command: command as "status" | "schedule" | "end" | "request" | "withdraw", endDate: values["end-date"], receivedAt: values["received-at"], consent: values.consent === true, acceptPastEnd: values["accept-past-end"] === true, execute: values.execute === true });
  console.log(`PROGRAMME ${JSON.stringify({ at: new Date().toISOString(), command, actorUserId, ...outcome })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`PROGRAMME_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
