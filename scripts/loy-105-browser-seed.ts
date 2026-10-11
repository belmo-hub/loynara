import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pool } from "../src/db";
import { auth } from "../src/lib/auth";
import { acceptStaffInvite, createStaffInvite } from "../src/lib/staff";
async function seed() {
  const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (target.hostname !== "localhost" || target.port !== "55433" || target.pathname !== "/looplocal_test" || process.env.NODE_ENV === "production") throw new Error("Owned synthetic cohort database required");
  if ((await pool.query("SHOW data_directory")).rows[0].data_directory !== "/private/tmp/loynara-goal-133-pg") throw new Error("Owned PostgreSQL required");
  const [f] = (await pool.query(`SELECT p.slug,t.name,u.id AS owner_id,u.email AS owner_email FROM programs p JOIN tenants t ON t.id=p.tenant_id JOIN staff_roles r ON r.tenant_id=t.id AND r.role='owner' AND r.active JOIN "user" u ON u.id=r.user_id WHERE t.name='Cohort verified 0'`)).rows;
  if (!f || !(f.owner_email as string).endsWith("@example.test")) throw new Error("Run the ten-merchant cohort first");
  const location = (await pool.query("SELECT location_id FROM programs WHERE slug=$1", [f.slug])).rows[0].location_id;
  const email = `${randomUUID()}@example.test`, password = "synthetic-cohort-local-password-only";
  const cashier = (await auth.api.signUpEmail({ body: { name: "Synthetic cohort browser cashier", email, password } })).user;
  const invite = await createStaffInvite({ actorUserId: f.owner_id, locationId: location, email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.id, token: invite.token });
  writeFileSync("/tmp/loy-105-browser-fixture.json", JSON.stringify({ programSlug: f.slug, cashierEmail: email, cashierPassword: password, ownerEmail: f.owner_email, ownerPassword: password, merchantName: f.name }), { mode: 0o600 });
  console.log("Synthetic browser fixture ready; credentials omitted");
}
void seed().finally(() => pool.end());
