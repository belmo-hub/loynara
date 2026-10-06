import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { POST as appleRegistration } from "@/app/api/apple/v1/devices/[deviceId]/registrations/[passTypeId]/[serial]/route";
import { GET as appleList } from "@/app/api/apple/v1/devices/[deviceId]/registrations/[passTypeId]/route";
import { POST as appleLog } from "@/app/api/apple/v1/log/route";
import { GET as applePass } from "@/app/api/apple/v1/passes/[passTypeId]/[serial]/route";
import { GET as appleDownload } from "@/app/api/wallet/apple/download/[ticket]/route";
import { POST as appleIssue } from "@/app/api/wallet/apple/route";
import { POST as googleIssue } from "@/app/api/wallet/google/route";
import { GET as walletStatus } from "@/app/api/wallet/status/route";
import { reissueCardByStaff } from "@/lib/card-reissue";
import { createMerchant, enroll } from "@/lib/product";
import { applePassToken } from "./apple";
import { ownerWalletReadiness } from "./readiness";
import { appleFixture, fakeGoogleApi, googleFixture, withEnv } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const origin = "http://localhost:3000";
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE'); });
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await pool.query("TRUNCATE TABLE apple_devices, rate_limits CASCADE"); await pool.end(); });

async function createMember() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Wallet route fixture", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Route Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
  return { owner, merchant, member: await enroll({ slug: merchant.programSlug, acceptedTerms: true }) };
}
const post = (url: string, body: unknown, headers: Record<string, string> = { origin }) => new Request(`${origin}${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const forbiddenWords = ["APPLE_", "GOOGLE_", "OpenSSL", "openssl", "zip", "Zertifikat", "certificate", ".pem", "service-account", "Konfiguration", "issuer"];

function passJsonFrom(bytes: ArrayBuffer, dir: string) {
  const file = join(dir, `${randomUUID()}.pkpass`);
  writeFileSync(file, Buffer.from(bytes));
  return JSON.parse(execFileSync("unzip", ["-p", file, "pass.json"], { encoding: "utf8" }));
}

describe("public Wallet status and issuance errors leak no diagnostics", () => {
  it("returns only availability, also for a broken configuration", async () => {
    await withEnv({ APPLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "123", APPLE_PASS_TYPE_ID: "pass.x.y" }, async () => {
      const response = await walletStatus();
      expect(await response.json()).toEqual({ apple: "unavailable", google: "unavailable" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { member } = await createMember();
      for (const issue of [appleIssue, googleIssue]) {
        const refused = await issue(post("/api/wallet/x", { token: member.cardToken }));
        expect(refused.status).toBe(503);
        const text = await refused.text();
        expect(JSON.parse(text)).toMatchObject({ code: "WALLET_UNAVAILABLE" });
        for (const word of forbiddenWords) expect(text).not.toContain(word);
      }
    });
  });
});

describe("Apple issuance: bearer in the body, short-lived ticket in the URL", () => {
  it("issues a ticketed download whose URL carries no card credential, and caps its use", async () => {
    const apple = appleFixture();
    try {
      await withEnv({ ...apple.env, PUBLIC_BASE_URL: origin }, async () => {
        const { member } = await createMember();
        expect((await appleIssue(post("/api/wallet/apple", { token: member.cardToken }, {}))).status).toBe(403); // no Origin
        expect((await appleIssue(post("/api/wallet/apple", { token: "card_unknown_unknown_unknown_unknown_x" }))).status).toBe(404);
        const issued = await appleIssue(post("/api/wallet/apple", { token: member.cardToken }));
        expect(issued.status).toBe(200);
        const { url } = await issued.json() as { url: string };
        expect(url).toMatch(/^\/api\/wallet\/apple\/download\/[A-Za-z0-9_.-]+$/);
        for (const secret of [member.cardToken, member.scanCode, member.id]) expect(url).not.toContain(secret);
        const ticket = url.split("/").pop()!;
        const download = await appleDownload(new Request(`${origin}${url}`), params({ ticket }));
        expect(download.status).toBe(200);
        expect(download.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
        expect(download.headers.get("cache-control")).toBe("no-store");
        expect(download.headers.get("referrer-policy")).toBe("no-referrer");
        const pass = passJsonFrom(await download.arrayBuffer(), apple.dir);
        expect(pass).toMatchObject({ organizationName: "Route Café", barcodes: [{ message: member.scanCode }], storeCard: { headerFields: [{ value: "0 / 5" }] } });
        expect(pass.serialNumber).not.toBe(member.id);
        // Re-issuing for the same card returns the same serial (Wallet replaces, not duplicates, the pass).
        const again = await (await appleIssue(post("/api/wallet/apple", { token: member.cardToken }))).json() as { url: string };
        const againPass = passJsonFrom(await (await appleDownload(new Request(`${origin}${again.url}`), params({ ticket: again.url.split("/").pop()! }))).arrayBuffer(), apple.dir);
        expect(againPass.serialNumber).toBe(pass.serialNumber);
        // Use cap and tamper protection.
        expect((await appleDownload(new Request(`${origin}${url}`), params({ ticket }))).status).toBe(200);
        expect((await appleDownload(new Request(`${origin}${url}`), params({ ticket }))).status).toBe(429);
        expect((await appleDownload(new Request(`${origin}/x`), params({ ticket: `${ticket.slice(0, -2)}AA` }))).status).toBe(404);
      });
    } finally { apple.cleanup(); }
  });

  it("an unused ticket dies with a staff reissue, and the old pass can then only fetch a voided version", async () => {
    const apple = appleFixture();
    try {
      await withEnv({ ...apple.env, PUBLIC_BASE_URL: origin }, async () => {
        const { owner, merchant, member } = await createMember();
        const { url } = await (await appleIssue(post("/api/wallet/apple", { token: member.cardToken }))).json() as { url: string };
        const ticket = url.split("/").pop()!;
        const first = passJsonFrom(await (await appleDownload(new Request(`${origin}${url}`), params({ ticket }))).arrayBuffer(), apple.dir);
        const unused = (await (await appleIssue(post("/api/wallet/apple", { token: member.cardToken }))).json() as { url: string }).url;
        await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: member.id, reason: "Neues Handy, Link gezeigt", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
        expect((await appleDownload(new Request(`${origin}${unused}`), params({ ticket: unused.split("/").pop()! }))).status).toBe(404);
        expect((await appleIssue(post("/api/wallet/apple", { token: member.cardToken }))).status).toBe(404);
        // The installed pass asks Loynara for its latest version with its own token: it receives the voided pass.
        const serial = first.serialNumber as string;
        const fetched = await applePass(new Request(`${origin}/api/apple/v1/passes/${apple.config.passTypeId}/${serial}`, { headers: { authorization: `ApplePass ${first.authenticationToken}` } }), params({ passTypeId: apple.config.passTypeId, serial }));
        expect(fetched.status).toBe(200);
        const voided = passJsonFrom(await fetched.arrayBuffer(), apple.dir);
        expect(voided.voided).toBe(true);
        expect(voided.barcodes).toBeUndefined();
        expect(JSON.stringify(voided)).not.toMatch(/sc_[A-Za-z0-9_-]{20,}/);
      });
    } finally { apple.cleanup(); }
  });
});

describe("Apple web-service routes", () => {
  it("answer with bare status codes, authenticate per pass and rate limit per device", async () => {
    const apple = appleFixture();
    try {
      await withEnv({ ...apple.env, PUBLIC_BASE_URL: origin }, async () => {
        const { member } = await createMember();
        const { url } = await (await appleIssue(post("/api/wallet/apple", { token: member.cardToken }))).json() as { url: string };
        const pass = passJsonFrom(await (await appleDownload(new Request(`${origin}${url}`), params({ ticket: url.split("/").pop()! }))).arrayBuffer(), apple.dir);
        const serial = pass.serialNumber as string;
        const register = (authorization: string, deviceId = "device-1") => appleRegistration(new Request(`${origin}/api/apple/v1/devices/${deviceId}/registrations/${apple.config.passTypeId}/${serial}`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ pushToken: "a".repeat(64) }) }), params({ deviceId, passTypeId: apple.config.passTypeId, serial }));
        const wrong = await register(`ApplePass ${applePassToken(randomUUID(), apple.config)}`);
        expect(wrong.status).toBe(401);
        expect(await wrong.text()).toBe("");
        expect((await register(`ApplePass ${pass.authenticationToken}`)).status).toBe(201);
        expect((await register(`ApplePass ${pass.authenticationToken}`)).status).toBe(200);
        const listed = await appleList(new Request(`${origin}/api/apple/v1/devices/device-1/registrations/${apple.config.passTypeId}`), params({ deviceId: "device-1", passTypeId: apple.config.passTypeId }));
        expect(await listed.json()).toMatchObject({ serialNumbers: [serial] });
        expect((await appleList(new Request(`${origin}/x`), params({ deviceId: "device-1", passTypeId: "pass.other.loop" }))).status).toBe(404);
        const unauthorisedPass = await applePass(new Request(`${origin}/x`, { headers: { authorization: "ApplePass nope-nope-nope-nope" } }), params({ passTypeId: apple.config.passTypeId, serial }));
        expect(unauthorisedPass.status).toBe(401);
        // Per-device limit: a flood from one device library is cut off without blocking others.
        let last = 0;
        for (let i = 0; i < 60; i++) last = (await register(`ApplePass ${pass.authenticationToken}`, "noisy-device")).status;
        expect(last).toBe(200); // the 60th call is still served
        expect((await register(`ApplePass ${pass.authenticationToken}`, "noisy-device")).status).toBe(429);
        expect((await register(`ApplePass ${pass.authenticationToken}`, "quiet-device")).status).toBe(201);
      });
    } finally { apple.cleanup(); }
  });

  it("refuse service while Apple Wallet is unavailable, and keep the log endpoint inert and limited", async () => {
    const serial = randomUUID();
    expect((await applePass(new Request(`${origin}/x`), params({ passTypeId: "pass.local.loop", serial }))).status).toBe(503);
    const log = () => appleLog(new Request(`${origin}/api/apple/v1/log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logs: ["device said something"] }) }));
    for (let i = 0; i < 30; i++) expect((await log()).status).toBe(200);
    expect((await log()).status).toBe(429);
  });
});

describe("Google issuance (provider stubbed in-process)", () => {
  it("prepares the object first and returns a Save link that references it without the scan code", async () => {
    const google = googleFixture();
    try {
      await withEnv({ ...google.env, PUBLIC_BASE_URL: origin }, async () => {
        const api = fakeGoogleApi();
        vi.stubGlobal("fetch", api.fetcher);
        const { member } = await createMember();
        const response = await googleIssue(post("/api/wallet/google", { token: member.cardToken }));
        expect(response.status).toBe(200);
        const { url } = await response.json() as { url: string };
        expect(url.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
        const claims = JSON.parse(Buffer.from(url.split("/save/")[1].split(".")[1], "base64url").toString());
        expect(claims.origins).toEqual([origin]);
        expect(Object.keys(claims.payload.loyaltyObjects[0]).sort()).toEqual(["classId", "id"]);
        for (const secret of [member.cardToken, member.scanCode]) expect(url).not.toContain(secret);
        const [object] = [...api.objects.values()];
        expect(object).toMatchObject({ state: "ACTIVE", barcode: { value: member.scanCode } });
        vi.stubGlobal("fetch", fakeGoogleApi({ failWith: 500 }).fetcher);
        const failed = await googleIssue(post("/api/wallet/google", { token: member.cardToken }));
        expect(failed.status).toBe(502);
        const text = await failed.text();
        expect(JSON.parse(text)).toMatchObject({ code: "WALLET_PROVIDER_ERROR" });
        for (const word of forbiddenWords) expect(text).not.toContain(word);
      });
    } finally { google.cleanup(); }
  });
});

describe("owner Wallet readiness", () => {
  it("speaks in product states only and is owner-scoped", async () => {
    const { owner, merchant } = await createMember();
    const readiness = await withEnv({ APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: "pass.x.y" }, () => ownerWalletReadiness({ actorUserId: owner, programSlug: merchant.programSlug }));
    expect(readiness).toEqual({ apple: "not_set_up", google: "not_set_up", logo: "missing", googleLogo: "fallback", ink: "light", passes: { apple: 0, google: 0 }, delayedUpdates: 0 });
    for (const word of forbiddenWords) expect(JSON.stringify(readiness)).not.toContain(word);
    const stranger = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [stranger, "Other", `${stranger}@example.test`]);
    await expect(ownerWalletReadiness({ actorUserId: stranger, programSlug: merchant.programSlug })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
