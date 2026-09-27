import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, locations, memberships, programRuleVersions, programs, rewardVersions, rewards, staffRoles, tenants } from "@/db/schema";
import { activateSecureTag, confirmTapRequest, pendingTapRequests, processSecureTap, provisionSecureTag, setTapPolicy, replaceSecureTag, revokeSecureTag, type TapKeyProvider } from "./secure-tap";
import { verifySdm } from "./secure-tap-crypto";
import { GET as tapGet, POST as tapPost } from "@/app/api/tap/[ref]/route";
import { tapCookieHeader } from "./secure-tap";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
const zero = Buffer.alloc(16);
const keys: TapKeyProvider = { async getKeys(ref) { if (ref !== "synthetic-vector") throw Error("missing key"); return { metaReadKey: zero, fileReadKey: zero }; } };
const vector = { encrypted: "EF963FF7828658A599F3041510671E88", mac: "94EED9EE65337086" };
function syntheticSdm(uidHex: string, counter: number) {
  const uid = Buffer.from(uidHex, "hex");
  const ctr = Buffer.from([counter & 255, (counter >>> 8) & 255, (counter >>> 16) & 255]);
  const picc = Buffer.concat([Buffer.from([0xc7]), uid, ctr, Buffer.alloc(5)]);
  const cipher = createCipheriv("aes-128-ecb", zero, null); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(picc), cipher.final()]).toString("hex");
  const opensslCmac = (key: Buffer, data: Buffer) => Buffer.from(execFileSync("openssl", ["mac", "-macopt", "cipher:aes-128-cbc", "-macopt", `hexkey:${key.toString("hex")}`, "CMAC"], { input: data }).toString().trim(), "hex");
  const session = opensslCmac(zero, Buffer.concat([Buffer.from("3cc300010080", "hex"), uid, ctr]));
  const full = opensslCmac(session, Buffer.alloc(0));
  return { encrypted, mac: Buffer.from(Array.from({ length: 8 }, (_, index) => full[index * 2 + 1])).toString("hex") };
}

async function fixture(type: "stamp" | "points" = "stamp") {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic owner", `${userId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Tap Test Café", slug: `tap-${userId}` }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Kassel", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role: "owner" });
  const [program] = await db.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `tap-${userId}`, name: "Tap Card", type, earningMode: type === "points" ? "purchase" : "manual", rulesText: "One stamp for a qualifying tap" }).returning();
  await db.insert(programRuleVersions).values({ tenantId: tenant.id, programId: program.id, version: 1, name: program.name, type, earningMode: program.earningMode, rulesText: program.rulesText, pointsPerCurrencyUnit: 1 });
  const [reward] = await db.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
  await db.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: "Coffee", cost: 8 });
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  return { userId, tenant, location, program, member };
}

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function configured() {
  const f = await fixture();
  await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "automatic_fixed", cooldownSeconds: 60 });
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: "04de5f1eacc040", keyRef: "synthetic-vector", configVersion: 1 });
  await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
  return { ...f, tag };
}

describe("secure tap ledger boundary", () => {
  it("uses the bounded HTTP tap route and an HttpOnly membership binding without accepting a cross-origin POST", async () => {
    const f = await configured();
    const directory = await mkdtemp(join(tmpdir(), "loynara-sdm-"));
    const path = join(directory, "keys.json");
    await writeFile(path, JSON.stringify({ "synthetic-vector": { metaReadKey: zero.toString("hex"), fileReadKey: zero.toString("hex") } }), { mode: 0o600 });
    const previous = process.env.TAP_SYNTHETIC_KEY_FILE;
    process.env.TAP_SYNTHETIC_KEY_FILE = path;
    try {
      const origin = new URL(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").origin;
      const url = `${origin}/api/tap/${f.tag.publicRef}?e=${vector.encrypted}&c=${vector.mac}`;
      const cookie = tapCookieHeader(f.program.id, f.member.cardToken, origin).split(";")[0];
      const context = { params: Promise.resolve({ ref: f.tag.publicRef }) };
      expect((await tapGet(new Request(url), context)).status).toBe(200);
      expect((await tapPost(new Request(url, { method: "POST", headers: { origin: "https://evil.example", cookie } }), context)).status).toBe(403);
      expect((await tapPost(new Request(url, { method: "POST", headers: { origin } }), context)).status).toBe(200);
      const response = await tapPost(new Request(url, { method: "POST", headers: { origin, cookie } }), context);
      expect((await response.json()).state).toBe("awarded");
      expect((await (await tapPost(new Request(url, { method: "POST", headers: { origin, cookie } }), context)).json()).state).toBe("already_processed");
      expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id)))).toHaveLength(1);
    } finally { if (previous === undefined) delete process.env.TAP_SYNTHETIC_KEY_FILE; else process.env.TAP_SYNTHETIC_KEY_FILE = previous; await rm(directory, { recursive: true, force: true }); }
  });
  it("uses the official vector for exactly one authoritative fixed stamp across concurrent handlers and retries", async () => {
    expect(verifySdm(vector, { metaReadKey: zero, fileReadKey: zero }).counter).toBe(61);
    const f = await configured();
    const input = { tagRef: f.tag.publicRef, fields: vector, cardToken: f.member.cardToken, keyProvider: keys, now: new Date("2026-09-27T10:00:00Z") };
    const results = await Promise.all([processSecureTap(input), processSecureTap(input)]);
    expect(results.map(r => r.state).sort()).toEqual(["already_processed", "awarded"]);
    expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).map(r => r.delta)).toEqual([1]);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(1);
    expect((await processSecureTap(input)).state).toBe("already_processed");
  });
  it("rejects invalid MAC, missing card, closed card, wrong tenant and points programme", async () => {
    const f = await configured();
    const base = { tagRef: f.tag.publicRef, fields: vector, keyProvider: keys, now: new Date("2026-09-27T10:00:00Z") };
    await expect(processSecureTap({ ...base, tagRef: "abcdefghijklmnopqrstuvwx", cardToken: f.member.cardToken })).rejects.toBeTruthy();
    await expect(processSecureTap({ ...base, fields: { ...vector, mac: "94EED9EE65337087" }, cardToken: f.member.cardToken })).rejects.toBeTruthy();
    expect((await processSecureTap({ ...base })).state).toBe("needs_enrollment");
    const other = await fixture();
    expect((await processSecureTap({ ...base, cardToken: other.member.cardToken })).state).toBe("needs_enrollment");
    await db.update(memberships).set({ closedAt: new Date() }).where(eq(memberships.id, f.member.id));
    expect((await processSecureTap({ ...base, cardToken: f.member.cardToken })).state).toBe("needs_enrollment");
    const points = await fixture("points");
    await expect(setTapPolicy({ actorUserId: points.userId, programId: points.program.id, mode: "automatic_fixed", cooldownSeconds: 60 })).rejects.toBeTruthy();
  });
  it("keeps policy and provisioning owner-only and rejects revoked staff or another location at confirmation", async () => {
    const f = await fixture();
    const staffId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [staffId, "Synthetic cashier", `${staffId}@example.test`]);
    await db.insert(staffRoles).values({ tenantId: f.tenant.id, locationId: f.location.id, userId: staffId, role: "cashier" });
    await expect(setTapPolicy({ actorUserId: staffId, programId: f.program.id, mode: "automatic_fixed", cooldownSeconds: 60 })).rejects.toBeTruthy();
    await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "staff_confirmed", cooldownSeconds: 60 });
    await expect(provisionSecureTag({ actorUserId: staffId, programId: f.program.id, uid: "04de5f1eacc040", keyRef: "synthetic-vector", configVersion: 1 })).rejects.toBeTruthy();
    const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: "04de5f1eacc040", keyRef: "synthetic-vector", configVersion: 1 });
    await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
    const pending = await processSecureTap({ tagRef: tag.publicRef, fields: vector, cardToken: f.member.cardToken, keyProvider: keys, now: new Date("2026-09-27T10:00:00Z") });
    const other = await fixture();
    await expect(confirmTapRequest({ userId: staffId, locationId: other.location.id, requestId: pending.requestId!, now: new Date("2026-09-27T10:00:05Z") })).rejects.toBeTruthy();
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, staffId));
    await expect(confirmTapRequest({ userId: staffId, locationId: f.location.id, requestId: pending.requestId!, now: new Date("2026-09-27T10:00:05Z") })).rejects.toBeTruthy();
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).toHaveLength(0);
  });
  it("revokes/replaces a tag without changing an existing membership balance", async () => {
    const f = await configured();
    await processSecureTap({ tagRef: f.tag.publicRef, fields: vector, cardToken: f.member.cardToken, keyProvider: keys, now: new Date("2026-09-27T10:00:00Z") });
    const replacement = await replaceSecureTag({ actorUserId: f.userId, tagId: f.tag.id, uid: "04de5f1eacc041", keyRef: "replacement-key", configVersion: 2 });
    await expect(processSecureTap({ tagRef: f.tag.publicRef, fields: vector, cardToken: f.member.cardToken, keyProvider: keys, now: new Date("2026-09-27T10:02:00Z") })).rejects.toBeTruthy();
    expect(replacement.publicRef).not.toBe(f.tag.publicRef);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(1);
  });
  it("enforces cooldown on a higher counter, then accepts the next one after controlled time advances", async () => {
    const f = await configured();
    const base = { tagRef: f.tag.publicRef, cardToken: f.member.cardToken, keyProvider: keys };
    expect((await processSecureTap({ ...base, fields: vector, now: new Date("2026-09-27T10:00:00Z") })).state).toBe("awarded");
    expect((await processSecureTap({ ...base, fields: syntheticSdm("04de5f1eacc040", 62), now: new Date("2026-09-27T10:00:30Z") })).state).toBe("cooldown");
    expect((await processSecureTap({ ...base, fields: syntheticSdm("04de5f1eacc040", 63), now: new Date("2026-09-27T10:01:01Z") })).state).toBe("awarded");
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id));
    expect(entries.map(entry => entry.delta)).toEqual([1, 1]);
  });
  it("creates one staff request without balance change, then confirms through the staff ledger path", async () => {
    const f = await fixture();
    await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "staff_confirmed", cooldownSeconds: 60 });
    const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: "04de5f1eacc040", keyRef: "synthetic-vector", configVersion: 1 });
    await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
    const input = { tagRef: tag.publicRef, fields: vector, cardToken: f.member.cardToken, keyProvider: keys, now: new Date("2026-09-27T10:00:00Z") };
    const pending = await processSecureTap(input);
    expect(pending.state).toBe("pending_staff");
    expect((await processSecureTap(input)).state).toBe("pending_staff");
    expect((await processSecureTap({ ...input, fields: syntheticSdm("04de5f1eacc040", 62), now: new Date("2026-09-27T10:00:10Z") })).state).toBe("pending_staff");
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
    expect((await pendingTapRequests({ userId: f.userId, locationId: f.location.id, now: new Date("2026-09-27T10:01:00Z") })).map(row => row.id)).toContain(pending.requestId);
    const confirmed = await confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId!, now: new Date("2026-09-27T10:01:00Z") });
    expect(confirmed.state).toBe("confirmed");
    expect((await confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId!, now: new Date("2026-09-27T10:01:01Z") })).state).toBe("already_processed");
    expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).map(row => row.delta)).toEqual([1]);
    await revokeSecureTag({ actorUserId: f.userId, tagId: tag.id });
    await expect(processSecureTap({ ...input, fields: syntheticSdm("04de5f1eacc040", 62) })).rejects.toBeTruthy();
  });
});
