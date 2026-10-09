import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships } from "@/db/schema";
import { closeCard } from "@/lib/card-lifecycle";
import { reissueCardByStaff } from "@/lib/card-reissue";
import { createMerchant, getCard } from "@/lib/product";
import { returningCardCookieName } from "@/lib/returning-card";
import { tapCookieName, tapCookieHeader } from "@/lib/secure-tap";
import { readCustomerSession } from "@/lib/customer-session";
import { GET as readCard } from "../card/[token]/route";
import { POST as bindCard } from "../card/[token]/tap-session/route";
import { GET as existing } from "./existing/route";
import { GET as openCard } from "./open/route";
import { POST as enrollRoute } from "./route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const base = "http://localhost:3000";
const originalBaseUrl = process.env.PUBLIC_BASE_URL;

/** A minimal cookie jar: what a browser would send back to paths under /api/enroll. */
class Jar {
  private cookies = new Map<string, { value: string; path: string }>();
  take(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";").map(part => part.trim());
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      const path = attributes.find(item => item.toLowerCase().startsWith("path="))?.slice(5) ?? "/";
      const expired = attributes.some(item => item.toLowerCase() === "max-age=0");
      if (expired) this.cookies.delete(`${path}|${name}`); else this.cookies.set(`${path}|${name}`, { value, path });
    }
    return response;
  }
  set(name: string, value: string, path = "/api") { this.cookies.set(`${path}|${name}`, { value, path }); }
  header(requestPath: string) {
    return [...this.cookies.entries()].filter(([, cookie]) => requestPath === cookie.path || requestPath.startsWith(`${cookie.path}/`))
      .map(([key, cookie]) => `${key.split("|")[1]}=${cookie.value}`).join("; ");
  }
  value(name: string, path = "/api") { return this.cookies.get(`${path}|${name}`)?.value; }
}

function request(jar: Jar, path: string, init: { method?: string; body?: object; headers?: Record<string, string> } = {}) {
  const url = new URL(path, base);
  const cookie = jar.header(url.pathname);
  return new Request(url, {
    method: init.method ?? "GET",
    headers: { origin: base, ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

const join = (jar: Jar, slug: string, extra: object = {}) => enrollRoute(request(jar, "/api/enroll", { method: "POST", body: { slug, acceptedTerms: true, ...extra } })).then(response => jar.take(response));
const check = (jar: Jar, slug: string) => existing(request(jar, `/api/enroll/existing?slug=${encodeURIComponent(slug)}`)).then(response => jar.take(response));
const open = (jar: Jar, slug: string) => openCard(request(jar, `/api/enroll/open?slug=${encodeURIComponent(slug)}`)).then(response => jar.take(response));
const read = (jar: Jar, token: string, fetchSite?: string) => readCard(request(jar, `/api/enroll/card/${token}`, { headers: fetchSite ? { "sec-fetch-site": fetchSite } : {} }), { params: Promise.resolve({ token }) }).then(response => jar.take(response));
const bind = (jar: Jar, token: string) => bindCard(request(jar, `/api/tap/card/${token}/session`, { method: "POST" }), { params: Promise.resolve({ token }) }).then(response => jar.take(response));

async function owner() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
const shop = async (name = "Synthetic Return Café") => {
  const userId = await owner();
  const merchant = await createMerchant({ userId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro Besuch.", rewardTitle: "Kaffee gratis", rewardCost: 5 });
  return { ...merchant, ownerId: userId };
};
const cardCount = async (programId: string) => (await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.programId, programId))).length;

afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = base;
  await pool.query('TRUNCATE TABLE tenants, "user", rate_limits CASCADE');
});
afterAll(async () => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = originalBaseUrl;
  await pool.end();
});

describe("returning customer on the join page", () => {
  it("card GET then binding preserves a tap-only session lifetime and shared-device protection", async () => {
    const started = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(started);
    const merchant = await shop();
    const { cardToken } = await (await join(new Jar(), merchant.programSlug)).json() as { cardToken: string };
    const jar = new Jar();
    const signed = tapCookieHeader(merchant.programId, cardToken, base, true).split(";")[0].split("=")[1];
    jar.set(tapCookieName(merchant.programId), signed, "/api/tap");
    clock.mockReturnValue(started + 60 * 86400_000);
    const readWithoutBinding = await read(jar, cardToken, "same-origin");
    expect(readWithoutBinding.headers.getSetCookie()).toEqual([]);
    expect((await bind(jar, cardToken)).status).toBe(200);
    expect(readCustomerSession(jar.value(returningCardCookieName(merchant.programId)), merchant.programId)).toMatchObject({ shared:true,issued:Math.floor(started / 1000) });
    clock.mockReturnValue(started + 95 * 86400_000);
    expect(await (await check(jar, merchant.programSlug)).json()).toEqual({ existing:false, stale:true });
  });

  it("does not renew a valid session on repeated card binding and repairs a missing cookie within its original lifetime", async () => {
    const started = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(started);
    const merchant = await shop();
    const jar = new Jar();
    const { cardToken } = await (await join(jar, merchant.programSlug)).json() as { cardToken: string };
    const original = jar.value(returningCardCookieName(merchant.programId))!;
    clock.mockReturnValue(started + 60 * 86400_000);
    const rebound = await bind(jar, cardToken);
    expect(rebound.status).toBe(200);
    expect(rebound.headers.getSetCookie()).toEqual([]);
    expect(jar.value(returningCardCookieName(merchant.programId))).toBe(original);
    const repair = new Jar();
    repair.set(returningCardCookieName(merchant.programId), original);
    const repaired = await bind(repair, cardToken);
    expect(repaired.status).toBe(200);
    expect(repaired.headers.getSetCookie().filter(h => !h.includes("Max-Age=0"))).toHaveLength(2);
    expect(repaired.headers.getSetCookie().filter(h => !h.includes("Max-Age=0")).every(h => h.includes("Max-Age=2592000"))).toBe(true);
    clock.mockReturnValue(started + 95 * 86400_000);
    expect(await (await check(repair, merchant.programSlug)).json()).toEqual({ existing:false, stale:true });
  });

  it("upgrades a legacy /api/enroll cookie through saved-link binding without ambiguous cookies or duplicate membership", async () => {
    const merchant = await shop();
    const { cardToken } = await (await join(new Jar(), merchant.programSlug)).json() as { cardToken: string };
    const jar = new Jar();
    jar.set(returningCardCookieName(merchant.programId), cardToken, "/api/enroll");
    expect((await bind(jar, cardToken)).status).toBe(200);
    expect(jar.value(returningCardCookieName(merchant.programId), "/api/enroll")).toBeUndefined();
    expect(await (await check(jar, merchant.programSlug)).json()).toMatchObject({ existing: true });
    expect((await join(jar, merchant.programSlug)).status).toBe(409);
    expect(await cardCount(merchant.programId)).toBe(1);
  });
  it("ambiguous same-name cookies are stale rather than an invitation to enroll again", async () => {
    const merchant = await shop();
    const jar = new Jar();
    await join(jar, merchant.programSlug);
    const cookie = jar.header("/api/enroll");
    const response = await existing(request(jar, `/api/enroll/existing?slug=${merchant.programSlug}`, { headers: { cookie: `${cookie}; ${cookie}` } }));
    expect(await response.json()).toEqual({ existing: false, stale: true });
  });
  it.each([true, false])("preserves legacy identity before opening a different private card (tap cookie present: %s)", async (hasTapCookie) => {
    const merchant = await shop();
    const first = await (await join(new Jar(), merchant.programSlug)).json() as { cardToken: string };
    const second = await (await join(new Jar(), merchant.programSlug)).json() as { cardToken: string };
    const jar = new Jar();
    jar.set(returningCardCookieName(merchant.programId), first.cardToken, "/api/enroll");
    if (hasTapCookie) jar.set(`loynara_member_${merchant.programId.replaceAll("-", "")}`, first.cardToken, "/api/tap");
    await read(jar, second.cardToken, "same-origin");
    expect((await open(jar, merchant.programSlug)).headers.get("location")).toContain(first.cardToken);
    expect((await bind(jar, second.cardToken)).status).toBe(409);
  });
  it("does not silently switch NFC identity when another person's private card is opened", async () => {
    const merchant = await shop();
    const jar = new Jar();
    const first = await (await join(jar, merchant.programSlug)).json() as { cardToken: string };
    const second = await (await join(new Jar(), merchant.programSlug)).json() as { cardToken: string };
    await read(jar, second.cardToken, "same-origin");
    expect((await open(jar, merchant.programSlug)).headers.get("location")).toContain(first.cardToken);
    const attempted = await bind(jar, second.cardToken);
    expect(attempted.status).toBe(409);
    expect(await attempted.json()).toMatchObject({ code: "ACCOUNT_SWITCH_REQUIRED" });
  });

  it("creates the first card, then offers it again instead of silently creating a second one", async () => {
    const merchant = await shop();
    const jar = new Jar();
    expect(await (await check(jar, merchant.programSlug)).json()).toEqual({ existing: false, stale: false });

    const first = await join(jar, merchant.programSlug);
    expect(first.status).toBe(201);
    const { cardToken } = await first.json() as { cardToken: string };
    const remembered = first.headers.getSetCookie().find(header => header.startsWith(`${returningCardCookieName(merchant.programId)}=`));
    expect(remembered).toBeDefined();
    expect(remembered).toContain("Path=/api");
    expect(remembered).toContain("HttpOnly");
    expect(remembered).toContain("SameSite=Lax");

    // Scanning the counter QR again: the existing card is recognised; only its number is disclosed.
    const again = await check(jar, merchant.programSlug);
    const body = await again.text();
    expect(JSON.parse(body)).toEqual({ existing: true, cardLocator: (await getCard(cardToken)).cardLocator });
    expect(body).not.toContain("card_");
    expect(body).not.toContain("sc_");
    expect(again.headers.get("cache-control")).toBe("no-store");

    // Pressing "create" anyway (stale page, double submit, failed check) is refused by the server.
    const duplicate = await join(jar, merchant.programSlug);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "CARD_EXISTS" });
    expect(await cardCount(merchant.programId)).toBe(1);

    // "Meine Karte öffnen" is a server redirect to the remembered, re-validated card.
    const opened = await open(jar, merchant.programSlug);
    expect(opened.status).toBe(303);
    expect(opened.headers.get("location")).toBe(`/card/${encodeURIComponent(cardToken)}`);
    expect(opened.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("creates another card only on a deliberate request, and then remembers the newest card", async () => {
    const merchant = await shop();
    const jar = new Jar();
    const first = await (await join(jar, merchant.programSlug)).json() as { cardToken: string };
    const invalid = await join(jar, merchant.programSlug, { additionalCard: "yes" });
    expect(invalid.status).toBe(400);
    expect(await cardCount(merchant.programId)).toBe(1);

    const second = await join(jar, merchant.programSlug, { additionalCard: true });
    expect(second.status).toBe(201);
    const { cardToken } = await second.json() as { cardToken: string };
    expect(cardToken).not.toBe(first.cardToken);
    expect(await cardCount(merchant.programId)).toBe(2);
    expect(readCustomerSession(jar.value(returningCardCookieName(merchant.programId)), merchant.programId)?.token).toBe(cardToken);
    expect((await open(jar, merchant.programSlug)).headers.get("location")).toBe(`/card/${encodeURIComponent(cardToken)}`);
  });

  it("does not offer a closed card and requires explicit recovery or new-card selection", async () => {
    const merchant = await shop();
    const jar = new Jar();
    const { cardToken } = await (await join(jar, merchant.programSlug)).json() as { cardToken: string };
    await closeCard(cardToken);

    const after = await check(jar, merchant.programSlug);
    expect(await after.json()).toEqual({ existing: false, stale: true });
    expect(after.headers.getSetCookie()).toEqual([]);
    expect(jar.value(returningCardCookieName(merchant.programId))).toBeDefined();
    expect((await open(jar, merchant.programSlug)).headers.get("location")).toBe(`/join/${encodeURIComponent(merchant.programSlug)}`);
    expect((await join(jar, merchant.programSlug)).status).toBe(400);
    expect(await cardCount(merchant.programId)).toBe(1);
  });

  it("treats a reissued (rotated) link as stale and recognises the card again once the new link is opened", async () => {
    const merchant = await shop();
    const jar = new Jar();
    const { cardToken } = await (await join(jar, merchant.programSlug)).json() as { cardToken: string };
    const [member] = await db.select().from(memberships).where(eq(memberships.cardToken, cardToken));
    const reissued = await reissueCardByStaff({ actorUserId: merchant.ownerId, locationId: merchant.locationId, membershipId: member.id, reason: "Neues Handy, Kartennummer genannt", verificationMethod: "other_check", entitlementConfirmed: true, idempotencyKey: randomUUID() });

    const stale = await check(jar, merchant.programSlug);
    expect(await stale.json()).toEqual({ existing: false, stale: true });
    const blocked = await open(jar, merchant.programSlug);
    expect(blocked.headers.get("location")).toBe(`/join/${encodeURIComponent(merchant.programSlug)}`);
    expect(blocked.headers.get("location")).not.toContain(cardToken);

    // Opening the new link on this phone binds it again; the card number is unchanged.
    expect((await bind(jar, reissued.cardToken)).status).toBe(200);
    expect(await (await check(jar, merchant.programSlug)).json()).toEqual({ existing: true, cardLocator: `K-${member.cardLocator}` });
    expect((await open(jar, merchant.programSlug)).headers.get("location")).toBe(`/card/${encodeURIComponent(reissued.cardToken)}`);
  });

  it("keeps programmes apart: one programme's card is never offered for another", async () => {
    const coffee = await shop("Synthetic Coffee");
    const barber = await shop("Synthetic Barber");
    const jar = new Jar();
    const { cardToken } = await (await join(jar, coffee.programSlug)).json() as { cardToken: string };
    expect(await (await check(jar, barber.programSlug)).json()).toEqual({ existing: false, stale: false });
    expect((await join(jar, barber.programSlug)).status).toBe(201);

    // Both programmes are remembered independently on the same device.
    expect(await (await check(jar, coffee.programSlug)).json()).toMatchObject({ existing: true });
    expect(await (await check(jar, barber.programSlug)).json()).toMatchObject({ existing: true });

    // A coffee card placed under the barber programme's cookie name is not accepted there.
    const forged = new Jar();
    forged.set(returningCardCookieName(barber.programId), cardToken);
    expect(await (await check(forged, barber.programSlug)).json()).toEqual({ existing: false, stale: true });
    expect((await open(forged, barber.programSlug)).headers.get("location")).toBe(`/join/${encodeURIComponent(barber.programSlug)}`);
    expect((await join(forged, barber.programSlug)).status).toBe(400);
  });

  it("survives corrupted or unknown remembered values and unknown programmes", async () => {
    const merchant = await shop();
    const name = returningCardCookieName(merchant.programId);
    for (const value of ["", "garbage", "card_short", `card_${"x".repeat(40)}`, "sc_abcdefghijklmnopqrstuvwx", "%00%3B"]) {
      const jar = new Jar();
      jar.set(name, value);
      const response = await check(jar, merchant.programSlug);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ existing: false, stale: true });
    }
    const jar = new Jar();
    jar.set(name, "garbage");
    expect((await join(jar, merchant.programSlug)).status).toBe(400);
    expect((await join(jar, merchant.programSlug, { additionalCard: true })).status).toBe(201);
    expect(await (await check(jar, merchant.programSlug)).json()).toMatchObject({ existing: true });

    expect(await (await check(new Jar(), "does-not-exist")).json()).toEqual({ existing: false, stale: false });
    expect((await open(new Jar(), "does-not-exist")).headers.get("location")).toBe("/");
    expect(await (await check(new Jar(), "")).json()).toEqual({ existing: false, stale: false });
  });

  it("remembers a card that was created before this release once its link is opened", async () => {
    const merchant = await shop();
    const creator = new Jar();
    const { cardToken } = await (await join(creator, merchant.programSlug)).json() as { cardToken: string };
    const otherBrowser = new Jar();
    expect(await (await check(otherBrowser, merchant.programSlug)).json()).toEqual({ existing: false, stale: false });
    const bound = await bind(otherBrowser, cardToken);
    expect(bound.status).toBe(200);
    expect(bound.headers.getSetCookie().some(header => header.startsWith(`${returningCardCookieName(merchant.programId)}=`) && header.includes("Path=/api") && header.includes("HttpOnly"))).toBe(true);
    expect(bound.headers.getSetCookie().some(header => header.includes("Path=/api/tap"))).toBe(true);
    expect(await (await check(otherBrowser, merchant.programSlug)).json()).toMatchObject({ existing: true });
  });

  it("refuses every concurrent repeat once the browser holds the card", async () => {
    const merchant = await shop();
    const jar = new Jar();
    expect((await join(jar, merchant.programSlug)).status).toBe(201);
    const repeats = await Promise.all(Array.from({ length: 5 }, () => enrollRoute(request(jar, "/api/enroll", { method: "POST", body: { slug: merchant.programSlug, acceptedTerms: true } }))));
    expect(repeats.map(response => response.status)).toEqual([409, 409, 409, 409, 409]);
    expect(await cardCount(merchant.programId)).toBe(1);
  });

  it("remembers a card through same-origin binding, while reads never bootstrap signed sessions", async () => {
    const merchant = await shop();
    const { cardToken } = await (await join(new Jar(), merchant.programSlug)).json() as { cardToken: string };

    const page = new Jar();
    const own = await read(page, cardToken, "same-origin");
    expect(own.status).toBe(200);
    const body = await own.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("programId");
    expect(own.headers.getSetCookie()).toEqual([]);
    expect(await (await check(page, merchant.programSlug)).json()).toEqual({ existing: false, stale: false });
    expect((await bind(page, cardToken)).status).toBe(200);
    expect(await (await check(page, merchant.programSlug)).json()).toMatchObject({ existing: true });

    for (const site of ["cross-site", "none", undefined]) {
      const elsewhere = new Jar();
      const response = await read(elsewhere, cardToken, site);
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await (await check(elsewhere, merchant.programSlug)).json()).toEqual({ existing: false, stale: false });
    }
  });
});
