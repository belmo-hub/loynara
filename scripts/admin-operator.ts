import "dotenv/config";
import { parseArgs } from "node:util";
import { userInfo } from "node:os";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { assertOperatorTarget, normalizeIdentity, OperatorRefusal, type OperatorEnv } from "./operator-identity";
import type { AdminRole } from "../src/lib/admin/capabilities";
export function parseAdminArgs(args: string[], env: OperatorEnv) {
  const [command, ...rest] = args;
  if (!["grant", "revoke", "list", "reset-2fa"].includes(command ?? "")) throw new OperatorRefusal("COMMAND_INVALID");
  const { values } = parseArgs({ args: rest, options: { target: { type: "string" }, email: { type: "string" }, role: { type: "string" } }, strict: true });
  const target = assertOperatorTarget(values.target, env);
  const email = command === "list" ? undefined : normalizeIdentity({ email: values.email, name: "Console admin" }).email;
  if ((command === "grant" || command === "revoke") && !["founder", "support", "sales"].includes(values.role ?? "")) throw new OperatorRefusal("ROLE_INVALID");
  return { command, target, email, role: values.role as AdminRole | undefined };
}
export function assertAdminConfirmation(expected: string, actual: string | undefined): void {
  if (actual !== expected) throw new OperatorRefusal("CONFIRMATION_REQUIRED");
}
export function formatAdminOperatorError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "INVALID_REQUEST") return error.message;
  return `ADMIN_OPERATOR_REFUSED ${error instanceof OperatorRefusal ? error.code : "FAILED_DETAILS_WITHHELD"}`;
}
async function main() {
  const args = parseAdminArgs(process.argv.slice(2), process.env);
  if (args.command !== "list") {
    const expected = `${args.command.toUpperCase()}${args.role ? ` ${args.role}` : ""} ${args.email}`;
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { assertAdminConfirmation(expected, await prompt.question(`Zur Bestätigung eingeben: ${expected}\n> `)); }
    finally { prompt.close(); }
  }
  const { grantAdminRole, revokeAdminRole, listAdmins, resetAdminSecondFactor } = await import("../src/lib/admin/admins");
  const operator = `operator_cli:${userInfo().username}`;
  if (args.command === "list") console.log(JSON.stringify(await listAdmins(), null, 2));
  else if (args.command === "grant") console.log(await grantAdminRole({ email: args.email!, role: args.role!, operator }));
  else if (args.command === "revoke") console.log(await revokeAdminRole({ email: args.email!, role: args.role!, operator }));
  else {
    const target = (await listAdmins()).find(admin => admin.email.toLowerCase() === args.email);
    if (!target) throw new OperatorRefusal("ADMIN_NOT_FOUND");
    await resetAdminSecondFactor({ targetUserId: target.userId, by: { actor: "operator_cli", operator } });
    console.log("Zweiter Faktor zurückgesetzt; alle Sitzungen beendet.");
  }
}
if (["admin-operator.ts", "admin-operator.js"].includes(basename(process.argv[1] ?? ""))) {
  main().then(() => process.exit(0)).catch(error => {
    console.error(formatAdminOperatorError(error));
    process.exit(1);
  });
}
