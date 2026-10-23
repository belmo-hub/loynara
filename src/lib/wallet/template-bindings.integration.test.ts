import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { walletTemplateBindingEvents, walletTemplateBindings } from "@/db/schema";
import { POST as templateRoute } from "@/app/api/operator/wallet-template/route";
import { auth } from "@/lib/auth";
import { operatorOverview } from "@/lib/operator";
import { createMerchant, enroll } from "@/lib/product";
import { issueWalletPass } from "./issue";
import { walletCardEligibility } from "./eligibility";
import { passFastObjectId } from "./passfast";
import { syncPassFastPass } from "./passfast-lifecycle";
import { importEnvWalletTemplates, passFastEnv, setWalletTemplate } from "./template-bindings";
import { syntheticPassFastArchive } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
const origin = "http://localhost:3000";
const APP = "11111111-1111-4111-8111-111111111111";
const T1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", T2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", T3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return (error as { code?: string }).code ?? "OTHER"; } return "NONE"; };

let operator: string, a: Awaited<ReturnType<typeof shop>>, b: Awaited<ReturnType<typeof shop>>;
let generated: string[], remote: Map<string, Record<string, unknown>>;
async function shop(name: string) {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Coffee", programType: "stamp", rulesText: "One per purchase", rewardTitle: "Coffee", rewardCost: 5 });
  return { owner, ...merchant, member: await enroll({ slug: merchant.programSlug, acceptedTerms: true }) };
}
const envWith = (bindings: Array<{ tenantId: string; locationId: string; templateId: string }> | undefined) => ({ ...process.env, PASSFAST_TENANT_TEMPLATES: bindings && JSON.stringify(bindings) });
const set = (target: typeof a, templateId: string, execute = true, actorUserId = operator, env = process.env as Record<string, string | undefined>) =>
  setWalletTemplate({ actorUserId, env, tenantId: target.tenantId, locationId: target.locationId, templateId, execute });
/** PassFast stand-in: generate, get and PATCH only. Records the template every generate used; no real network. */
async function fake(input: string | URL | Request, options?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin !== "https://api.passfa.st") throw new Error("Real network forbidden");
  const body = options?.body ? JSON.parse(String(options.body)) as Record<string, string> : null;
  if (url.pathname.endsWith("/generate-pass")) {
    generated.push(body!.template_id);
    remote.set(body!.serial_number, { app_id: APP, template_id: body!.template_id, external_id: body!.serial_number, id: randomUUID(), serial_number: body!.serial_number, wallet_type: "apple", status: "active" });
    return new Response(new Uint8Array(syntheticPassFastArchive({ serialNumber: body!.serial_number })), { headers: { "Content-Type": "application/vnd.apple.pkpass" } });
  }
  const row = remote.get(url.pathname.split("/")[5]);
  return row ? Response.json(row) : Response.json({ error: "missing" }, { status: 404 });
}

beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE');
  operator = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [operator, "Synthetic operator", `${operator}@example.test`]);
  a = await shop("Synthetic café A"); b = await shop("Synthetic café B");
  generated = []; remote = new Map();
  for (const [key, value] of Object.entries({ PASSFAST_ENABLED: "true", PASSFAST_WALLET_TYPES: "apple", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: APP,
    PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId: a.tenantId, locationId: a.locationId, templateId: T1 }]), PLATE_OPERATOR_USER_IDS: operator, PUBLIC_BASE_URL: origin, PUBLIC_REGISTRATION_ENABLED: "true" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(fake));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await pool.end(); });

describe("Apple Wallet template bindings on /operator (ENG-046)", () => {
  it("serves only the allowlisted operator: a 404 for anyone else, a dry run that writes nothing, then one audit row", async () => {
    const email = `${randomUUID()}@example.test`, password = "Synthetic-Operator-093-Only!";
    const signed = await auth.api.signUpEmail({ body: { name: "Synthetic operator", email, password } });
    const login = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
    const cookie = login.headers.getSetCookie().map(x => x.split(";")[0]).join("; ");
    const post = (body: unknown, headers: Record<string, string> = { Origin: origin, cookie }) => templateRoute(new Request(origin + "/api/operator/wallet-template", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
    const body = { tenantId: b.tenantId, locationId: b.locationId, templateId: T2, execute: false };
    expect((await post(body)).status).toBe(404); // signed in, but not on the list
    expect(await code(() => set(b, T2, true, a.owner))).toBe("FORBIDDEN");
    expect(await code(() => set(b, T2, true, operator, { ...process.env, PLATE_OPERATOR_USER_IDS: undefined }))).toBe("FORBIDDEN");
    vi.stubEnv("PLATE_OPERATOR_USER_IDS", signed.user.id);
    expect((await post(body, { Origin: origin })).status).toBe(404); // no session
    const dry = await post(body);
    expect(dry.status).toBe(200);
    expect(await dry.json()).toMatchObject({ result: "would_set", from: null, to: T2, ready: true, merchant: "Synthetic café B" });
    expect(await db.select().from(walletTemplateBindings)).toEqual([]);
    expect(await (await post({ ...body, execute: true })).json()).toMatchObject({ result: "set" });
    expect(await db.select().from(walletTemplateBindings)).toMatchObject([{ tenantId: b.tenantId, locationId: b.locationId, templateId: T2, createdByUserId: signed.user.id }]);
    expect(await db.select().from(walletTemplateBindingEvents)).toMatchObject([{ action: "set", oldTemplateId: null, newTemplateId: T2, actorUserId: signed.user.id }]);
    expect((await post({ ...body, templateId: "not-a-template" })).status).toBe(400);
    await expect(pool.query("DELETE FROM wallet_template_binding_events")).rejects.toThrow(/append-only/);
  });

  it("keeps one template per location and never shares a template across locations, table or env", async () => {
    expect(await code(() => set(b, T1))).toBe("TEMPLATE_IN_USE"); // env gives T1 to A
    expect(await set(b, T2)).toMatchObject({ result: "set" });
    expect(await code(() => set(a, T2))).toBe("TEMPLATE_IN_USE"); // table gives T2 to B
    expect(await set(b, T3)).toMatchObject({ result: "change", from: T2, fromSource: "table", to: T3 });
    expect(await set(b, T3.toUpperCase())).toMatchObject({ result: "unchanged" });
    expect(await set(a, T2)).toMatchObject({ result: "change", from: T1, fromSource: "env" }); // T2 is free again
    expect(await db.select().from(walletTemplateBindings)).toHaveLength(2);
    expect((await db.select().from(walletTemplateBindingEvents)).map(e => [e.action, e.oldTemplateId, e.newTemplateId])).toEqual(expect.arrayContaining([["set", null, T2], ["change", T2, T3], ["change", T1, T2]]));
    await expect(pool.query("INSERT INTO wallet_template_bindings (tenant_id,location_id,template_id,created_by_user_id,changed_by_user_id) VALUES ($1,$2,$3,'x','x')", [a.tenantId, a.locationId, T1])).rejects.toThrow(/duplicate key/);
    expect(await code(() => setWalletTemplate({ actorUserId: operator, env: process.env, tenantId: a.tenantId, locationId: b.locationId, templateId: randomUUID(), execute: false }))).toBe("NOT_FOUND"); // other tenant's location
  });

  it("has no fallback: a location with neither a table nor an env binding gets no Apple Wallet, even while another location is bound", async () => {
    expect((await walletCardEligibility(a.member.cardToken)).availability.apple).toBe("available");
    expect((await walletCardEligibility(b.member.cardToken)).availability.apple).toBe("unavailable");
    expect(await passFastEnv(b.tenantId, b.locationId)).toBe(process.env);
    await expect(issueWalletPass(b.member.cardToken, "apple", passFastObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await set(b, T2);
    expect((await walletCardEligibility(b.member.cardToken)).availability.apple).toBe("available");
    // The table binding works without any env binding, and still needs every other PassFast check.
    vi.stubEnv("PASSFAST_TENANT_TEMPLATES", undefined);
    expect((await walletCardEligibility(b.member.cardToken)).availability.apple).toBe("available");
    expect((await walletCardEligibility(a.member.cardToken)).availability.apple).toBe("unavailable");
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("PASSFAST_API_KEY", "sk_live_" + "abcdef0123456789".repeat(4)); // production refuses a "synthetic" key
    expect((await walletCardEligibility(b.member.cardToken)).availability.apple).toBe("unavailable"); // no WALLET_PRODUCTION_APPROVED
    vi.stubEnv("WALLET_PRODUCTION_APPROVED", "true");
    expect((await walletCardEligibility(b.member.cardToken)).availability.apple).toBe("available");
    vi.stubEnv("PASSFAST_ENABLED", "false");
    expect((await walletCardEligibility(b.member.cardToken)).availability.apple).toBe("unavailable");
  });

  it("imports the env bindings once, never over a table row, and the table wins afterwards", async () => {
    await set(b, T2);
    vi.stubEnv("PASSFAST_TENANT_TEMPLATES", JSON.stringify([{ tenantId: a.tenantId, locationId: a.locationId, templateId: T1 }, { tenantId: b.tenantId, locationId: b.locationId, templateId: T3 }, { tenantId: randomUUID(), locationId: randomUUID(), templateId: randomUUID() }]));
    expect(await code(() => importEnvWalletTemplates({ actorUserId: a.owner, env: process.env, execute: true }))).toBe("FORBIDDEN");
    expect(await code(() => importEnvWalletTemplates({ actorUserId: operator, env: envWith(undefined), execute: true }))).toBe("ENV_BINDINGS_INVALID");
    expect((await importEnvWalletTemplates({ actorUserId: operator, env: process.env, execute: false })).map(r => r.result)).toEqual(["would_import", "table_differs", "unknown_location"]);
    expect(await db.select().from(walletTemplateBindings)).toHaveLength(1);
    expect((await importEnvWalletTemplates({ actorUserId: operator, env: process.env, execute: true })).map(r => r.result)).toEqual(["import", "table_differs", "unknown_location"]);
    expect((await importEnvWalletTemplates({ actorUserId: operator, env: process.env, execute: true })).map(r => r.result)).toEqual(["unchanged", "table_differs", "unknown_location"]);
    expect((await db.select().from(walletTemplateBindingEvents)).map(e => e.action).sort()).toEqual(["import", "set"]);
    // Table wins for B (T2, not the env's T3); A is now in the table and survives the env variable going away.
    expect(JSON.parse((await passFastEnv(b.tenantId, b.locationId)).PASSFAST_TENANT_TEMPLATES!)).toEqual([{ tenantId: b.tenantId, locationId: b.locationId, templateId: T2 }]);
    vi.stubEnv("PASSFAST_TENANT_TEMPLATES", undefined);
    expect((await walletCardEligibility(a.member.cardToken)).availability.apple).toBe("available");
    const overview = await operatorOverview(operator);
    expect(overview.rows.map(r => [r.tenant, r.walletTemplate])).toEqual(expect.arrayContaining([["Synthetic café A", { templateId: T1, source: "table" }], ["Synthetic café B", { templateId: T2, source: "table" }]]));
  });

  it("refreshes a pass with the table binding, and a changed binding stops updates to passes of the old template", async () => {
    await set(b, T2);
    const pass = await issueWalletPass(b.member.cardToken, "apple", passFastObjectId);
    await syncPassFastPass(pass.id);
    expect(generated).toEqual([T2]);
    expect(await set(b, T3)).toMatchObject({ result: "change", from: T2, to: T3 });
    const before = (await pool.query("SELECT to_jsonb(p) AS pass FROM wallet_passes p WHERE id=$1", [pass.id])).rows[0].pass;
    await expect(syncPassFastPass(pass.id)).rejects.toThrow("PassFast operation failed");
    expect((await pool.query("SELECT to_jsonb(p) AS pass FROM wallet_passes p WHERE id=$1", [pass.id])).rows[0].pass).toEqual(before);
    expect(generated).toEqual([T2]);
  });
});
