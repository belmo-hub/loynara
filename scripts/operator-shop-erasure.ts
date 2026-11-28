import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { DomainError } from "../src/lib/loyalty";

/**
 * ENG-166 (DS-05): lists the shops to erase and the confirmations still to send, shows what erasing one would delete (dry
 * run), erases it, or records that the owner's confirmation went out (private Railway console, like operator-programme).
 * A shop may be erased once all its programmes have ended and its 30-day export window is over, and must be by the end date
 * + 30 days + SHOP_ERASURE_DELAY_DAYS (default 7); its Stripe subscription has to have ended. Erasing is final.
 *   npx tsx scripts/operator-shop-erasure.ts due                                      --target loynara-production --actor-user-id <operator user id>
 *   npx tsx scripts/operator-shop-erasure.ts erase --tenant-id <id> --target ... --actor-user-id ...              # dry run: what would be deleted
 *   npx tsx scripts/operator-shop-erasure.ts erase --tenant-id <id> --target ... --actor-user-id ... --execute    # after reading the dry run
 *   npx tsx scripts/operator-shop-erasure.ts confirmed --tenant-id <id> --target ... --actor-user-id ...          # the text-form confirmation went out
 * The actor must be on PLATE_OPERATOR_USER_IDS. Refusals print one reason code.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { target: { type: "string" }, "actor-user-id": { type: "string" }, "tenant-id": { type: "string" }, execute: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  if (rest.length || !["due", "erase", "confirmed"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_MUST_BE_DUE_ERASE_OR_CONFIRMED");
  if ((command !== "due") !== Boolean(values["tenant-id"])) throw new OperatorRefusal(command === "due" ? "TENANT_ID_NOT_FOR_DUE" : "TENANT_ID_REQUIRED");
  if (command !== "erase" && values.execute) throw new OperatorRefusal("EXECUTE_ONLY_FOR_ERASE");
  assertOperatorTarget(values.target, process.env, { allowOpenRegistration: true });
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new OperatorRefusal("ACTOR_REQUIRED");
  const { dueShopErasures, recordErasureConfirmation, shopErasure } = await import("../src/lib/shop-erasure");
  const tenantId = values["tenant-id"]!;
  const outcome = command === "due" ? await dueShopErasures()
    : command === "confirmed" ? await recordErasureConfirmation({ actorUserId, env: process.env, tenantId })
      : await shopErasure({ actorUserId, env: process.env, tenantId, execute: values.execute === true });
  console.log(`SHOP_ERASURE ${JSON.stringify({ at: new Date().toISOString(), command, actorUserId, ...outcome })}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`SHOP_ERASURE_REFUSED ${error instanceof OperatorRefusal || error instanceof DomainError ? error.code : "FAILED_DETAILS_WITHHELD"}`);
  process.exit(1);
});
