import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { db, pool } from "@/db";
import { getCustomerExport } from "./export";
import { award } from "./loyalty";
import { consentEvents } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { nfcFixture } from "./nfc-test-db";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe("customer export database snapshot", () => {
  it("exports balance and ledger from one committed snapshot when earning completes between reads", async () => {
    const f = await nfcFixture();
    const read = signal(); const resume = signal();
    const original = Client.prototype.query;
    let paused = false;
    // Pause after the actual PostgreSQL card SELECT returns, never replace its
    // rows. Both pool and transaction clients use this same driver boundary.
    const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
      const config = args[0];
      const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
      const target = !paused && text?.startsWith("select") && text.includes('from "memberships"') && text.includes('"card_token"') && text.includes('"closed_at"');
      if (!target) return Reflect.apply(original, this, args);
      paused = true;
      // pg-pool invokes Client.query with a callback, whereas a transaction
      // client uses the Promise form. Preserve each real driver contract.
      const callback = args.at(-1);
      if (typeof callback === "function") {
        args[args.length - 1] = (...results: unknown[]) => {
          if (results[0]) { Reflect.apply(callback, undefined, results); return; }
          read.resolve();
          void resume.promise.then(() => { Reflect.apply(callback, undefined, results); });
        };
        return Reflect.apply(original, this, args);
      }
      const result = Reflect.apply(original, this, args);
      return (result as Promise<unknown>).then(async rows => { read.resolve(); await resume.promise; return rows; });
    }) as typeof original);
    let pending: ReturnType<typeof getCustomerExport> | undefined;
    let gateTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      pending = getCustomerExport(f.member.cardToken);
      await Promise.race([read.promise, new Promise<never>((_, reject) => { gateTimeout = setTimeout(() => reject(new Error("Real card read gate not reached")), 2000); })]);
      await expect(award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() })).resolves.toMatchObject({ balance: 2 });
      resume.resolve();
      const exported = await pending;
      expect(exported.membership.balance).toBe(exported.ledger.reduce((balance, entry) => balance + entry.delta, 0));
      // A fresh request sees the later committed award; neither response mixes
      // the old membership balance with the new ledger.
      const fresh = await getCustomerExport(f.member.cardToken);
      expect(fresh.membership.balance).toBe(2); expect(fresh.ledger).toHaveLength(1);
      expect(JSON.stringify(exported)).not.toContain(f.member.cardToken);
      expect(JSON.stringify(exported)).not.toContain(f.member.scanCode);
    } finally {
      if (gateTimeout) clearTimeout(gateTimeout);
      resume.resolve();
      try { await pending; } finally { spy.mockRestore(); }
    }
  });
  it("keeps tenant activity isolated and rejects unknown or retired bearers without changing another card", async () => {
    const first = await nfcFixture(); const other = await nfcFixture();
    for (const [f, quantity] of [[first, 2], [other, 5]] as const) {
      await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
      await db.insert(consentEvents).values({ tenantId: f.tenant.id, membershipId: f.member.id, channel: "email", purpose: "marketing", granted: true, noticeVersion: "synthetic", source: f.member.id.replaceAll("-", "") });
    }
    const exported = await getCustomerExport(first.member.cardToken);
    expect(exported.membership.balance).toBe(2);
    expect(exported.ledger.map(entry => entry.delta)).toEqual([2]);
    expect(exported.consentEvents.map(event => event.source)).toEqual([first.member.id.replaceAll("-", "")]);
    expect(JSON.stringify(exported)).not.toContain(other.member.id);
    expect(JSON.stringify(exported)).not.toContain(first.member.cardToken);
    await expect(getCustomerExport(first.member.scanCode)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCustomerExport(`card_${"x".repeat(40)}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await closeCard(first.member.cardToken);
    await expect(getCustomerExport(first.member.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const untouched = await getCustomerExport(other.member.cardToken);
    expect(untouched.membership.balance).toBe(5);
    expect(untouched.ledger.map(entry => entry.delta)).toEqual([5]);
  });
});
