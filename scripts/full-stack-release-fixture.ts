import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pool } from "../src/db";
import { auth } from "../src/lib/auth";
import { acceptStaffInvite, createStaffInvite } from "../src/lib/staff";

type Identity = { id: string; email: string; password: string };
type Merchant = { tenantId: string; locationId: string; programSlug: string; programId: string };
type Fixture = { owners: Identity[]; cashier: Identity; merchants?: Merchant[] };
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (url.hostname !== "localhost" || url.port !== "55433" || !/^\/looplocal_rehearsal_[a-f0-9]{12}$/.test(url.pathname) || process.env.NODE_ENV === "production") throw new Error("Owned disposable rehearsal required");
  if ((await pool.query("SHOW data_directory")).rows[0].data_directory !== "/private/tmp/loynara-goal-133-pg") throw new Error("Owned PostgreSQL required");
  const file = process.env.REHEARSAL_FIXTURE!;
  if (!file.startsWith("/tmp/loy-110-")) throw new Error("Private rehearsal fixture required");
  if (process.argv[2] === "identities") {
    const identity = async (name: string): Promise<Identity> => {
      const email = `${randomUUID()}@example.test`, password = `synthetic-rehearsal-${randomUUID()}`;
      const { user } = await auth.api.signUpEmail({ body: { name, email, password } });
      return { id: user.id, email, password };
    };
    const f: Fixture = { owners: [await identity("Rehearsal owner"), await identity("Isolation owner")], cashier: await identity("Rehearsal cashier") };
    writeFileSync(file, JSON.stringify(f), { mode: 0o600 });
  } else if (process.argv[2] === "onboard") {
    const f = JSON.parse(readFileSync(file, "utf8")) as Fixture;
    f.merchants = [];
    for (const [i, owner] of f.owners.entries()) {
      const signIn = await fetch("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ email: owner.email, password: owner.password }) });
      if (signIn.status !== 200) throw new Error(`Real sign-in failed ${signIn.status}`);
      const cookie = signIn.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
      const onboard = await fetch("http://localhost:3000/api/merchant/onboard", { method: "POST", headers: { origin: "http://localhost:3000", cookie, "content-type": "application/json" }, body: JSON.stringify({ businessName: `Rehearsal merchant ${i}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `Rehearsal programme ${i}`, programType: "stamp", earningMode: "manual", rulesText: "Synthetic local rehearsal", rewardTitle: "Selected rehearsal reward", rewardCost: 3 }) });
      if (onboard.status !== 201) throw new Error(`Real onboarding failed ${onboard.status}`);
      f.merchants.push(await onboard.json() as Merchant);
    }
    const invite = await createStaffInvite({ actorUserId: f.owners[0].id, locationId: f.merchants[0].locationId, email: f.cashier.email, role: "cashier" });
    await acceptStaffInvite({ userId: f.cashier.id, token: invite.token });
    writeFileSync(file, JSON.stringify(f), { mode: 0o600 });
  } else throw new Error("Expected identities or onboard");
  console.log("Synthetic identities / real HTTP onboarding / staff lifecycle PASS; private credentials omitted");
}
main().then(() => pool.end()).then(() => process.exit(0)).catch(() => { console.error("Local rehearsal fixture failed; details withheld"); process.exit(1); });
