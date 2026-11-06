import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { GET as appleDownload } from "@/app/api/wallet/apple/download/[ticket]/route";
import { POST as appleIssue } from "@/app/api/wallet/apple/route";
import { POST as walletStatus } from "@/app/api/wallet/status/route";
import { createMerchant, enroll } from "@/lib/product";
import { appleFixture, withEnv } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const origin = "http://localhost:3000";
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE'); });
afterAll(async () => { await pool.end(); });

async function memberFixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Native switch fixture", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Switch Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
  return { merchant, member: await enroll({ slug: merchant.programSlug, acceptedTerms: true }) };
}
const post = (url: string, token: string) => new Request(`${origin}${url}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ token }) });
const passFast = (tenantId: string, locationId: string) => ({ PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111",
  PASSFAST_WALLET_TYPES: "apple", PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId, locationId, templateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }]) });
const rows = async (membershipId: string) => (await pool.query("SELECT id, provider_object_id, status, revoked_at, revoke_reason FROM wallet_passes WHERE membership_id = $1 ORDER BY created_at", [membershipId])).rows;

describe("switching Apple Wallet from PassFast to native issuance", () => {
  it("prompts a PassFast holder, issues the re-added pass natively and hands the old pass to PassFast to void", async () => {
    const { merchant, member } = await memberFixture();
    const managed = passFast(merchant.tenantId, merchant.locationId);
    // Before the switch: PassFast issues the Apple pass and the customer downloads it.
    await withEnv({ ...managed, PUBLIC_BASE_URL: origin, APPLE_WALLET_ENABLED: "false" }, async () => {
      expect((await appleIssue(post("/api/wallet/apple", member.cardToken))).status).toBe(202);
    });
    const [old] = await rows(member.id);
    expect(old.provider_object_id).toMatch(/^passfast:/);
    await pool.query("UPDATE wallet_passes SET status = 'downloaded' WHERE id = $1", [old.id]);
    await pool.query("UPDATE outbox_jobs SET status = 'complete' WHERE kind = 'wallet.refresh'");

    const apple = appleFixture();
    const dir = mkdtempSync(join(tmpdir(), "loynara-native-switch-"));
    try {
      await withEnv({ ...managed, ...apple.env, PUBLIC_BASE_URL: origin }, async () => {
        expect(await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).toMatchObject({ apple: "available", appleReAdd: true });

        const issued = await appleIssue(post("/api/wallet/apple", member.cardToken));
        expect(issued.status).toBe(200);
        const { url } = await issued.json();
        const [superseded, fresh] = await rows(member.id);
        expect(superseded).toMatchObject({ id: old.id, revoke_reason: "superseded", status: "revocation_pending" });
        expect(fresh).toMatchObject({ provider_object_id: fresh.id, revoked_at: null });
        // The worker pushes the voided pass through PassFast, which still serves the passes it issued.
        expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind = 'wallet.refresh' AND status = 'pending' AND payload ->> 'membershipId' = $1", [member.id])).rows[0].n).toBe(1);
        expect(await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).toMatchObject({ apple: "available", appleReAdd: false });
        // Rollback: with native Apple off again, a PassFast holder is never sent round in a re-add loop.
        await pool.query("UPDATE wallet_passes SET revoked_at = now(), revoke_reason = 'superseded', status = 'revoked' WHERE id = $1", [fresh.id]);
        await pool.query("UPDATE wallet_passes SET revoked_at = NULL, revoke_reason = NULL, status = 'downloaded' WHERE id = $1", [old.id]);
        await withEnv({ APPLE_WALLET_ENABLED: "false" }, async () => {
          expect(await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).toMatchObject({ apple: "available", appleReAdd: false });
        });
        await pool.query("UPDATE wallet_passes SET revoked_at = now(), revoke_reason = 'superseded', status = 'revocation_pending' WHERE id = $1", [old.id]);
        await pool.query("UPDATE wallet_passes SET revoked_at = NULL, revoke_reason = NULL, status = 'pending' WHERE id = $1", [fresh.id]);

        const ticket = url.split("/").at(-1);
        const download = await appleDownload(new Request(`${origin}${url}`), { params: Promise.resolve({ ticket }) });
        expect(download.status).toBe(200);
        const file = join(dir, "pass.pkpass");
        writeFileSync(file, Buffer.from(await download.arrayBuffer()));
        expect(JSON.parse(execFileSync("unzip", ["-p", file, "pass.json"], { encoding: "utf8" }))).toMatchObject({ passTypeIdentifier: apple.config.passTypeId, serialNumber: fresh.id });
        // A downloaded native pass is never mistaken for one from the previous provider.
        expect((await rows(member.id)).find(row => row.id === fresh.id)).toMatchObject({ status: "downloaded" });
        expect(await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).toMatchObject({ appleReAdd: false });
      });
    } finally { apple.cleanup(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("issues natively for a shop without a PassFast template, and never prompts a native holder", async () => {
    const { member } = await memberFixture();
    const other = passFast(randomUUID(), randomUUID());
    const apple = appleFixture();
    try {
      await withEnv({ ...other, ...apple.env, PUBLIC_BASE_URL: origin }, async () => {
        expect(await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).toMatchObject({ apple: "available", appleReAdd: false });
        expect((await appleIssue(post("/api/wallet/apple", member.cardToken))).status).toBe(200);
        const [only] = await rows(member.id);
        expect(only.provider_object_id).toBe(only.id);
        expect(await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).toMatchObject({ appleReAdd: false });
      });
    } finally { apple.cleanup(); }
  });
});

describe("Apple Wallet saved on a device (ENG-130 08)", () => {
  it("reports appleSaved only once a device registered the card's live pass", async () => {
    const { merchant, member } = await memberFixture();
    const apple = appleFixture();
    const saved = async () => (await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).appleSaved;
    try {
      await withEnv({ ...apple.env, PUBLIC_BASE_URL: origin }, async () => {
        expect(await saved()).toBe(false);
        expect((await appleIssue(post("/api/wallet/apple", member.cardToken))).status).toBe(200);
        // Issued and downloaded, but Apple's sheet was cancelled: nothing registered.
        expect(await saved()).toBe(false);
        const [pass] = await rows(member.id);
        // ENG-172: issued is not handed out; only the download proves Safari followed the link to Apple's sheet.
        const downloaded = async () => (await (await walletStatus(post("/api/wallet/status", member.cardToken))).json()).appleDownloaded;
        expect(await downloaded()).toBe(false);
        await pool.query("UPDATE wallet_passes SET status = 'downloaded' WHERE id = $1", [pass.id]);
        expect(await downloaded()).toBe(true);
        expect(await saved()).toBe(false);
        await pool.query("INSERT INTO apple_devices (device_library_identifier, push_token) VALUES ('device-eng-130', $1)", ["a".repeat(64)]);
        await pool.query("INSERT INTO apple_registrations (device_library_identifier, tenant_id, membership_id, pass_type_identifier, serial_number) VALUES ('device-eng-130', $1, $2, $3, $4)", [merchant.tenantId, member.id, apple.config.passTypeId, pass.id]);
        expect(await saved()).toBe(true);
        await pool.query("UPDATE wallet_passes SET revoked_at = now(), revoke_reason = 'superseded', status = 'revoked' WHERE id = $1", [pass.id]);
        expect(await saved()).toBe(false);
      });
    } finally { apple.cleanup(); }
  });
});
