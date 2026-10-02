import { randomUUID } from "node:crypto";
import { db, pool } from "@/db";
import { locations, memberships, programRuleVersions, programs, rewardVersions, rewards, staffRoles, tenants } from "@/db/schema";

/** Synthetic merchant for NFC tests: one owner, one location, one fixed-stamp programme with staff-confirmed taps, one card. */
export async function nfcFixture(options: { tapMode?: "disabled" | "staff_confirmed"; cooldownSeconds?: number } = {}) {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic owner", `${userId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Tap Test Café", slug: `tap-${userId}` }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Kassel", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role: "owner" });
  const [program] = await db.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `tap-${userId}`, name: "Tap Card", type: "stamp", earningMode: "manual", rulesText: "One stamp per visit.", tapMode: options.tapMode ?? "staff_confirmed", tapCooldownSeconds: options.tapMode === "disabled" ? null : (options.cooldownSeconds ?? 60) }).returning();
  await db.insert(programRuleVersions).values({ tenantId: tenant.id, programId: program.id, version: 1, name: program.name, type: "stamp", earningMode: program.earningMode, rulesText: program.rulesText, pointsPerCurrencyUnit: 1 });
  const [reward] = await db.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
  await db.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: "Coffee", cost: 8 });
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}` }).returning();
  return { userId, tenant, location, program, member };
}

export async function addStaff(tenantId: string, locationId: string, role: "cashier" | "manager") {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, `Synthetic ${role}`, `${id}@example.test`]);
  await db.insert(staffRoles).values({ tenantId, locationId, userId: id, role });
  return id;
}
