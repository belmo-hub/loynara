import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { memberships } from "@/db/schema";
import { getMerchantExport } from "./export";
import { award } from "./loyalty";
import { addStaff, nfcFixture } from "./nfc-test-db";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

it("exports membership balances and ledger from one snapshot while a cashier award commits", async () => {
  const first = await nfcFixture(); const foreign = await nfcFixture();
  const cashier = await addStaff(first.tenant.id, first.location.id, "cashier");
  const [another] = await db.insert(memberships).values({ tenantId: first.tenant.id, programId: first.program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}` }).returning();
  for (const [f, quantity] of [[first, 2], [foreign, 7]] as const) await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
  let readReady!: () => void; const read = new Promise<void>(resolve => { readReady = resolve; });
  let release!: () => void; const resume = new Promise<void>(resolve => { release = resolve; });
  const original = Client.prototype.query;
  let observed = false; let holdLedger = true;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0]; const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    // Only the actual owner export's tenant-only bounded ledger read. Award
    // idempotency reads have different predicates and must remain operational.
    if (holdLedger && text?.includes('from "ledger_entries"') && text.endsWith("limit $2")) {
      if (typeof args.at(-1) === "function") { void resume.then(() => Reflect.apply(original, this, args)); return; }
      return resume.then(() => Reflect.apply(original, this, args));
    }
    const target = !observed && text?.includes('from "memberships"') && text.includes('"balance"') && !text.includes('"card_token"');
    if (!target) return Reflect.apply(original, this, args);
    observed = true;
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (...results: unknown[]) => { if (!results[0]) readReady(); Reflect.apply(callback, undefined, results); };
      return Reflect.apply(original, this, args);
    }
    return (Reflect.apply(original, this, args) as Promise<unknown>).then(rows => { readReady(); return rows; });
  }) as typeof original);
  let pending: ReturnType<typeof getMerchantExport> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    pending = getMerchantExport(first.userId);
    await Promise.race([read, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Actual export membership read not reached")), 2000); })]);
    await expect(award({ userId: cashier, locationId: first.location.id, membershipId: first.member.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() })).resolves.toMatchObject({ balance: 5 });
    holdLedger = false; release();
    const exported = await pending;
    expect(exported).toMatchObject({ formatVersion: 4, scope: "owner-business-data-without-card-or-contact-credentials" });
    expect(exported.memberships.map(row => row.id)).toEqual(expect.arrayContaining([first.member.id, another.id]));
    for (const member of exported.memberships) expect(member.balance).toBe(exported.ledger.filter(row => row.membershipId === member.id).reduce((sum, row) => sum + row.delta, 0));
    expect(exported.memberships.find(row => row.id === first.member.id)?.balance).toBe(2);
    const serialized = JSON.stringify(exported);
    for (const excluded of [first.member.cardToken, first.member.scanCode, foreign.member.id, foreign.tenant.id]) expect(serialized).not.toContain(excluded);
    const fresh = await getMerchantExport(first.userId);
    expect(fresh.memberships.find(row => row.id === first.member.id)?.balance).toBe(5);
    expect(fresh.ledger.filter(row => row.membershipId === first.member.id).reduce((sum, row) => sum + row.delta, 0)).toBe(5);
    expect((await getMerchantExport(foreign.userId)).memberships[0].balance).toBe(7);
    await expect(getMerchantExport(cashier)).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    if (timeout) clearTimeout(timeout);
    holdLedger = false; release();
    await Promise.allSettled([pending]);
    spy.mockRestore();
  }
});

it("rolls back a real query failure and releases a clean reusable export connection", async () => {
  const f = await nfcFixture();
  const original = Client.prototype.query;
  const captured: { client?: Client } = {};
  let rollbackObserved = false;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0]; const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (!captured.client && text?.includes('from "ledger_entries"') && text.endsWith("limit $2")) {
      captured.client = this;
      return Reflect.apply(original, this, ["select 1 / 0"]);
    }
    if (this === captured.client && text === "rollback") rollbackObserved = true;
    return Reflect.apply(original, this, args);
  }) as typeof original);
  try {
    await expect(getMerchantExport(f.userId)).rejects.toMatchObject({ cause: { code: "22012" } });
    expect(rollbackObserved).toBe(true);
    const client = await pool.connect();
    try {
      expect(client).toBe(captured.client);
      const clean = await client.query("show transaction_read_only");
      expect(clean.rows[0].transaction_read_only).toBe("off");
      await expect(client.query("select 1 as healthy")).resolves.toMatchObject({ rows: [{ healthy: 1 }] });
    } finally { client.release(); }
    expect((await getMerchantExport(f.userId)).tenant.id).toBe(f.tenant.id);
    await expect(getMerchantExport(randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally { spy.mockRestore(); }
});

it("preserves the 50,000 membership boundary and rejects larger exports without leaking transaction state", async () => {
  const f = await nfcFixture();
  // Synthetic rows only, preserving the existing fixture's card and ledger.
  await pool.query(`insert into memberships (tenant_id, program_id, scan_code, card_token)
    select $1, $2, 'sc_limit_' || n, 'card_limit_' || n from generate_series(1, 49999) n`, [f.tenant.id, f.program.id]);
  const boundary = await getMerchantExport(f.userId);
  expect(boundary.formatVersion).toBe(4);
  expect(boundary.memberships).toHaveLength(50_000);
  await pool.query(`insert into memberships (tenant_id, program_id, scan_code, card_token) values ($1, $2, 'sc_limit_over', 'card_limit_over')`, [f.tenant.id, f.program.id]);
  await expect(getMerchantExport(f.userId)).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE" });
  const other = await nfcFixture();
  expect((await getMerchantExport(other.userId)).memberships).toHaveLength(1);
}, 15000);
