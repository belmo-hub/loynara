import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { createMerchant, enroll } from "@/lib/product";
import { issueWalletPass } from "./issue";
import { pruneRevokedAppleRegistrations } from "./refresh";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Prune fixture", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Prune Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  const pass = await issueWalletPass(member.cardToken, "apple", id => id);
  return { merchant, member, pass };
}

async function registrations(count: number, state: "registered" | "revocation_pending" | "revoked", syncedAge: number | null = null) {
  const { merchant, member, pass } = await fixture();
  await pool.query("UPDATE wallet_passes SET revoked_at = CASE WHEN $2::varchar(24) = 'registered' THEN NULL ELSE now() - interval '30 days' END, revoke_reason = CASE WHEN $2::varchar(24) = 'registered' THEN NULL ELSE 'closed' END, status = $2::varchar(24), synced_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(days => $3::int) END WHERE id = $1", [pass.id, state, syncedAge]);
  const prefix = randomUUID();
  await pool.query("INSERT INTO apple_devices (device_library_identifier, push_token) SELECT $1 || '_' || n, repeat('a',64) FROM generate_series(1,$2::int) n", [prefix, count]);
  await pool.query("INSERT INTO apple_registrations (device_library_identifier, tenant_id, membership_id, pass_type_identifier, serial_number) SELECT $1 || '_' || n, $3::uuid, $4::uuid, 'pass.local.loop', $5::text FROM generate_series(1,$2::int) n", [prefix, count, merchant.tenantId, member.id, pass.id]);
  return { pass, prefix };
}

const counts = async () => pool.query<{ registrations: number; devices: number }>("SELECT (SELECT count(*)::int FROM apple_registrations) AS registrations, (SELECT count(*)::int FROM apple_devices) AS devices").then(result => result.rows[0]);

describe("Apple registration retention after completed revocation", () => {
  it("preserves an active registration even when its last synchronization was long ago", async () => {
    await registrations(1, "registered", 30);
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 1, devices: 1 });
  });

  it("keeps registrations when a thirty-day provider outage has left revocation undelivered", async () => {
    await registrations(1, "revocation_pending");
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 1, devices: 1 });
  });

  it("starts the seven-day retention period from successful synchronization", async () => {
    await registrations(1, "revoked", 1);
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 1, devices: 1 });
  });

  it("prunes at most one thousand registrations and orphan devices per run, safely and idempotently", async () => {
    await registrations(1005, "revoked", 8);
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 5, devices: 5 });
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 0, devices: 0 });
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 0, devices: 0 });
  });

  it("also bounds orphan cleanup and preserves every still-registered device", async () => {
    await registrations(1, "revocation_pending");
    await pool.query("INSERT INTO apple_devices (device_library_identifier, push_token) SELECT 'orphan_' || n, repeat('b',64) FROM generate_series(1,1005) n");
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 1, devices: 6 });
    await pruneRevokedAppleRegistrations(pool);
    expect(await counts()).toEqual({ registrations: 1, devices: 1 });
  });
});
