import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, plateLinkEvents, secureTags, tapRequests } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster } from "./nfc-keys";
import { sdmFor, tapUrl } from "./nfc-test-support";
import { nfcFixture } from "./nfc-test-db";
import { buildRegistrationBundle } from "./nfc-provision/production";
import { plateJoinPath, plateStatus, setPlateLink } from "./plates";
import { confirmTapRequest, processSecureTap, settleUnlinkedTap } from "./secure-tap";
import { registerTag } from "../../scripts/nfc-register";
import { GET as tapGet, POST as tapPost } from "@/app/api/tap/[ref]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const ORIGIN = "https://app.example-pilot.test";
const keyProvider = new DerivedTapKeyProvider(VERIFY);
const UID = "04de5f1eacc041";
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return (error as { code?: string }).code ?? "OTHER"; } return "NONE"; };

let operator: string;
let env: Record<string, string | undefined>;
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", secure_tags, plate_link_events CASCADE');
  operator = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [operator, "Synthetic operator", `${operator}@example.test`]);
  env = { PUBLIC_BASE_URL: `${ORIGIN}/`, PLATE_OPERATOR_USER_IDS: ` other-id , ${operator}` };
});
afterAll(async () => { await pool.end(); });

/** Registers an unlinked plate through the real registration path and returns a tap for any counter. */
async function plate(label = "P-007") {
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid: UID });
  const bundle = buildRegistrationBundle({ plateLabel: label, origin: ORIGIN, uid: UID, publicRef, keyRef, sampleUrl: tapUrl(ORIGIN, publicRef, sdmFor({ uid: UID, counter: 3, keys })), firstCounter: 2, secondCounter: 3 });
  const register = (actorUserId: string, execute: boolean) => registerTag({ bundleText: JSON.stringify(bundle), actorUserId, execute, env, provider: keyProvider, guard: () => undefined });
  return { bundle, register, tap: (counter: number) => ({ tagRef: publicRef, fields: sdmFor({ uid: UID, counter, keys }), keyProvider }) };
}
const link = (label: string, programId: string | null, actorUserId = operator, execute = true) => setPlateLink({ actorUserId, env, plateLabel: label, programId, execute });

describe("plates v1", () => {
  it("registers an unlinked plate only for the operator, dry run first, and never twice under one label", async () => {
    const f = await nfcFixture();
    const p = await plate();
    expect(await code(() => p.register(f.userId, true))).toBe("FORBIDDEN");
    expect(await p.register(operator, false)).toMatchObject({ status: "would_register", plateLabel: "P-007" });
    expect(await db.select().from(secureTags)).toHaveLength(0);
    expect(await p.register(operator, true)).toMatchObject({ status: "registered" });
    expect(await p.register(operator, true)).toMatchObject({ status: "already_registered" });
    const [row] = await db.select().from(secureTags);
    expect(row).toMatchObject({ status: "unlinked", plateLabel: "P-007", tenantId: null, locationId: null, programId: null, lastCounter: 3 });
    expect(await code(() => (async () => { const other = await plate("P-007"); await other.register(operator, true); })())).toBe("PLATE_LABEL_ALREADY_USED");
  });

  it("lets only the allowlisted operator link: not a shop owner, not an unknown id, not anyone when the list is absent", async () => {
    const f = await nfcFixture();
    await (await plate()).register(operator, true);
    expect(await code(() => link("P-007", f.program.id, f.userId))).toBe("FORBIDDEN");
    expect(await code(() => link("P-007", f.program.id, "other-id"))).toBe("FORBIDDEN"); // listed, but no such user
    expect(await code(() => setPlateLink({ actorUserId: operator, env: {}, plateLabel: "P-007", programId: f.program.id, execute: true }))).toBe("FORBIDDEN");
    expect(await code(() => plateStatus({ actorUserId: f.userId, env, plateLabel: "P-007" }))).toBe("FORBIDDEN");
    expect((await db.select().from(secureTags))[0].status).toBe("unlinked");
    expect(await db.select().from(plateLinkEvents)).toHaveLength(0);
    expect(await link("p-007", f.program.id, operator, false)).toMatchObject({ result: "would_link", to: { programId: f.program.id } });
    expect((await db.select().from(secureTags))[0].status).toBe("unlinked");
    expect(await link("p-007", f.program.id)).toMatchObject({ result: "link", from: null, to: { tenantId: f.tenant.id, merchant: "Tap Test Café" } });
    expect(await link("P-007", f.program.id)).toMatchObject({ result: "unchanged" });
  });

  it("links only to a programme with staff confirmation on", async () => {
    const off = await nfcFixture({ tapMode: "disabled" });
    await (await plate()).register(operator, true);
    expect(await code(() => link("P-007", off.program.id))).toBe("STAFF_CONFIRMATION_REQUIRED");
    expect(await code(() => link("P-007", randomUUID()))).toBe("NOT_FOUND");
    expect(await code(async () => link("P-999", (await nfcFixture()).program.id))).toBe("NOT_FOUND");
  });

  it("a tap on an unlinked plate verifies the chip and moves its counter, but awards nothing and opens no request", async () => {
    const f = await nfcFixture();
    const p = await plate();
    await p.register(operator, true);
    expect(await settleUnlinkedTap(p.tap(4))).toBe(true);
    expect(await settleUnlinkedTap(p.tap(4))).toBe(true); // a reload shows the same page
    expect((await db.select().from(secureTags))[0].lastCounter).toBe(4);
    expect(await code(() => settleUnlinkedTap({ ...p.tap(5), fields: { ...p.tap(5).fields, mac: "0000000000000000" } }))).toBe("INVALID_TAP");
    expect(await code(() => processSecureTap({ ...p.tap(6), cardToken: f.member.cardToken }))).toBe("NOT_FOUND");
    expect(await db.select().from(tapRequests)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("the tap route answers an unlinked plate with its own code for the friendly page, on GET and POST", async () => {
    await nfcFixture();
    const p = await plate();
    await p.register(operator, true);
    const saved = { provider: process.env.NFC_KEY_PROVIDER, master: process.env.NFC_VERIFY_MASTER_KEY };
    process.env.NFC_KEY_PROVIDER = "derived_v1"; process.env.NFC_VERIFY_MASTER_KEY = VERIFY.toString("hex");
    try {
      const origin = new URL(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").origin;
      const { tagRef, fields } = p.tap(9);
      const url = `${origin}/api/tap/${tagRef}?e=${fields.encrypted}&c=${fields.mac}`;
      const context = { params: Promise.resolve({ ref: tagRef }) };
      for (const response of [await tapGet(new Request(url), context), await tapPost(new Request(url, { method: "POST", headers: { origin } }), context)]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "PLATE_UNLINKED" });
      }
      expect((await db.select().from(secureTags))[0].lastCounter).toBe(9);
      expect(await db.select().from(tapRequests)).toHaveLength(0);
    } finally {
      for (const [key, value] of [["NFC_KEY_PROVIDER", saved.provider], ["NFC_VERIFY_MASTER_KEY", saved.master]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("relink moves the plate and nothing else: old awards and requests stay with the old shop, every change is audited", async () => {
    const a = await nfcFixture(), b = await nfcFixture();
    const p = await plate();
    await p.register(operator, true);
    await link("P-007", a.program.id);
    const now = new Date("2026-10-23T18:00:00Z");
    const first = await processSecureTap({ ...p.tap(4), cardToken: a.member.cardToken, now });
    expect(first).toMatchObject({ state: "pending_staff", merchantName: "Tap Test Café" });
    await confirmTapRequest({ userId: a.userId, locationId: a.location.id, requestId: first.requestId!, now });
    const waiting = await processSecureTap({ ...p.tap(5), cardToken: a.member.cardToken, now: new Date(now.getTime() + 120_000) });
    expect(waiting.state).toBe("pending_staff");

    expect(await link("P-007", b.program.id)).toMatchObject({ result: "relink", from: { tenantId: a.tenant.id }, to: { tenantId: b.tenant.id } });
    // The old shop's waiting request can no longer be confirmed through the moved plate.
    expect(await code(() => confirmTapRequest({ userId: a.userId, locationId: a.location.id, requestId: waiting.requestId!, now: new Date(now.getTime() + 130_000) }))).toBe("TAP_EXPIRED");
    // The old shop's card does not belong to the new shop.
    expect(await processSecureTap({ ...p.tap(6), cardToken: a.member.cardToken, now: new Date(now.getTime() + 140_000) })).toMatchObject({ state: "needs_enrollment" });
    expect(await processSecureTap({ ...p.tap(7), cardToken: b.member.cardToken, now: new Date(now.getTime() + 150_000) })).toMatchObject({ state: "pending_staff" });

    const awards = await db.select().from(ledgerEntries);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ tenantId: a.tenant.id, membershipId: a.member.id });
    expect((await db.select().from(tapRequests).where(eq(tapRequests.id, first.requestId!)))[0]).toMatchObject({ tenantId: a.tenant.id, status: "confirmed" });

    expect(await link("P-007", null)).toMatchObject({ result: "unlink", from: { tenantId: b.tenant.id }, to: null });
    expect(await settleUnlinkedTap(p.tap(8))).toBe(true);
    const events = await db.select().from(plateLinkEvents).orderBy(plateLinkEvents.createdAt);
    expect(events.map(e => [e.action, e.actorUserId, e.oldTenantId, e.newTenantId])).toEqual([
      ["link", operator, null, a.tenant.id], ["relink", operator, a.tenant.id, b.tenant.id], ["unlink", operator, b.tenant.id, null],
    ]);
    await expect(pool.query("UPDATE plate_link_events SET actor_user_id = 'x'")).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM plate_link_events")).rejects.toThrow(/append-only/);
  });

  it("the plate QR leads to the linked shop's join page, and nowhere while unlinked", async () => {
    const f = await nfcFixture();
    await (await plate()).register(operator, true);
    expect(await plateJoinPath("P-007")).toBeNull();
    await link("P-007", f.program.id);
    expect(await plateJoinPath("p-007")).toBe(`/join/${f.program.slug}`);
    expect(await plateJoinPath("P-008")).toBeNull();
    expect(await plateJoinPath("../join")).toBeNull();
    await link("P-007", null);
    expect(await plateJoinPath("P-007")).toBeNull();
  });
});
