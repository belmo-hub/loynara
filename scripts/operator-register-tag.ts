import "dotenv/config";
import { parseArgs } from "node:util";
import { assertOperatorTarget, OperatorRefusal } from "./operator-identity";
import { RegistrationRefusal, registerTag } from "./nfc-register";
import { nfcCapability } from "../src/lib/nfc-keys";
import { NfcOperatorRefusal } from "../src/lib/nfc-provision/production";

/**
 * Registers a physically provisioned tag on the production deployment (private Railway console, like the identity tools).
 *   NFC_TAG_BUNDLE="$(cat <bundle>.registration.json)" npx tsx scripts/operator-register-tag.ts \
 *     --target loynara-production --actor-user-id <owner user id>            # dry run (default)
 *   ... --execute                                                           # after reading the dry-run output
 * The bundle carries no secrets. Refusals print one reason code.
 */
async function main() {
  const { values } = parseArgs({ options: { target: { type: "string" }, "actor-user-id": { type: "string" }, execute: { type: "boolean" } }, strict: true });
  const actorUserId = values["actor-user-id"] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorUserId)) throw new RegistrationRefusal("ACTOR_REQUIRED");
  const { defaultTapKeyProvider } = await import("../src/lib/secure-tap");
  const audit = await registerTag({
    bundleText: process.env.NFC_TAG_BUNDLE, actorUserId, execute: values.execute === true, env: process.env, provider: defaultTapKeyProvider(),
    guard: () => {
      assertOperatorTarget(values.target, process.env);
      if (!nfcCapability().available) throw new RegistrationRefusal("NFC_NOT_ENABLED_ON_THIS_DEPLOYMENT");
    },
  });
  console.log(`NFC_TAG_REGISTRATION ${JSON.stringify(audit)}`);
  process.exit(0);
}

main().catch(error => {
  const code = error instanceof RegistrationRefusal || error instanceof OperatorRefusal || error instanceof NfcOperatorRefusal ? error.code : "FAILED_DETAILS_WITHHELD";
  console.error(`NFC_TAG_REGISTRATION_REFUSED ${code}`);
  process.exit(1);
});
