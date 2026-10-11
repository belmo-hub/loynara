import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { createMerchant, enroll } from "./product";
import { createAdditionalLocation, selectionCookieName } from "./locations";
import { acceptStaffInvite, createStaffInvite } from "./staff";
import { GET as me } from "@/app/api/me/route";
import { GET as customers } from "@/app/api/merchant/customers/route";
import { GET as detail } from "@/app/api/merchant/customers/[membershipId]/route";
import { GET as retention } from "@/app/api/merchant/retention/route";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_test") throw new Error("Owned local synthetic database required");
const origin = "http://localhost:3000";
const registration = process.env.PUBLIC_REGISTRATION_ENABLED;
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user" CASCADE'); process.env.PUBLIC_REGISTRATION_ENABLED = "true"; });
afterAll(async () => { if (registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = registration; await pool.end(); });
function request(path: string, cookie = "") { return new Request(origin + path, { headers: { ...(cookie ? { cookie } : {}) } }); }
async function identity() {
  const email = randomUUID() + "@example.test", password = "Synthetic-Location-093-Only!";
  const signed = await auth.api.signUpEmail({ body: { name: "Synthetic location viewer", email, password } });
  const response = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(x => x.split(";")[0]).join("; "); expect(cookie).not.toBe("");
  return { userId: signed.user.id, email, cookie };
}
async function fixture() {
  const owner = await identity(), foreignOwner = await identity(), manager = await identity(), cashier = await identity();
  const input = { city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", locale: "de" as const, currency: "EUR" as const, programType: "stamp" as const, rulesText: "One synthetic confirmed purchase", rewardTitle: "Coffee", rewardCost: 5 };
  const first = await createMerchant({ ...input, userId: owner.userId, businessName: "Synthetic scoped merchant", programName: "First card" });
  const foreign = await createMerchant({ ...input, userId: foreignOwner.userId, businessName: "Synthetic foreign merchant", programName: "Foreign card" });
  const second = await createAdditionalLocation(owner.userId, { name: "Synthetic second location", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: input.rulesText, rewardTitle: "Coffee", rewardCost: 5 });
  for (const [account, role] of [[manager, "manager"], [cashier, "cashier"]] as const) {
    const invitation = await createStaffInvite({ actorUserId: owner.userId, locationId: first.locationId, email: account.email, role });
    await acceptStaffInvite({ userId: account.userId, token: invitation.token });
  }
  const cards = await Promise.all([first, second, foreign].map(x => enroll({ slug: x.programSlug, acceptedTerms: true })));
  return { owner, manager, cashier, first, second, foreign, cards };
}
const member = (id: string, cookie: string) => detail(request(`/api/merchant/customers/${id}`, cookie), { params: Promise.resolve({ membershipId: id }) });

it("real manager sessions cannot widen customer list, detail or retention scope using a sibling-location query or forged selection cookie", async () => {
  const f = await fixture();
  const forged = `${f.manager.cookie}; ${selectionCookieName(f.manager.userId)}=${f.second.locationId}`;
  expect(await (await me(request("/api/me", forged))).json()).toMatchObject({ locationId: f.first.locationId, role: "manager" });
  const list = await customers(request("/api/merchant/customers", forged)); expect(list.status).toBe(200); expect((await list.json()).members.map((x: { id: string }) => x.id)).toEqual([f.cards[0].id]);
  const own = await member(f.cards[0].id, forged); expect(own.status).toBe(200); expect(own.headers.get("Cache-Control")).toBe("no-store");
  const summary = await retention(request("/api/merchant/retention?days=30", forged)); expect(summary.status).toBe(200); expect(await summary.json()).toMatchObject({ locationId: f.first.locationId, openCards: 1, never: 1 });
  for (const [location, card] of [[f.second, f.cards[1]], [f.foreign, f.cards[2]]] as const) {
    const blocked = await customers(request(`/api/merchant/customers?locationId=${location.locationId}`, forged)); expect(blocked.status).toBe(404); expect(JSON.stringify(await blocked.json())).not.toContain(card.id);
    expect((await member(card.id, forged)).status).toBe(404);
    expect((await retention(request(`/api/merchant/retention?locationId=${location.locationId}`, forged))).status).toBe(404);
  }
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs")).rows[0].n).toBe(0);
});

it("owner reports retain authorized sibling visibility while cashier and anonymous report requests remain denied", async () => {
  const f = await fixture();
  const selected = `${f.owner.cookie}; ${selectionCookieName(f.owner.userId)}=${f.second.locationId}`;
  expect(await (await me(request("/api/me", selected))).json()).toMatchObject({ locationId: f.second.locationId, role: "owner" });
  const all = await customers(request("/api/merchant/customers", selected)); expect(all.status).toBe(200); expect((await all.json()).members.map((x: { id: string }) => x.id).sort()).toEqual(f.cards.slice(0, 2).map(x => x.id).sort());
  for (const [location, card] of [[f.first, f.cards[0]], [f.second, f.cards[1]]] as const) {
    const filtered = await customers(request(`/api/merchant/customers?locationId=${location.locationId}`, selected)); expect(filtered.status).toBe(200); expect((await filtered.json()).members.map((x: { id: string }) => x.id)).toEqual([card.id]);
    expect((await member(card.id, selected)).status).toBe(200);
    const report = await retention(request(`/api/merchant/retention?locationId=${location.locationId}`, selected)); expect(report.status).toBe(200); expect(await report.json()).toMatchObject({ locationId: location.locationId, openCards: 1 });
  }
  expect((await member(f.cards[2].id, selected)).status).toBe(404);
  const forgedCashier = `${f.cashier.cookie}; ${selectionCookieName(f.cashier.userId)}=${f.second.locationId}`;
  expect(await (await me(request("/api/me", forgedCashier))).json()).toMatchObject({ locationId: f.first.locationId, role: "cashier" });
  for (const [cookie, status] of [[forgedCashier, 403], ["", 401]] as const) {
    expect((await customers(request("/api/merchant/customers", cookie))).status).toBe(status);
    expect((await member(f.cards[0].id, cookie)).status).toBe(status);
    expect((await retention(request("/api/merchant/retention", cookie))).status).toBe(status);
  }
  expect((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE balance<>0 OR closed_at IS NOT NULL")).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n).toBe(0);
});
