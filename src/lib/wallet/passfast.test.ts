import { describe, expect, it, vi } from "vitest";
import { PassFastClient, passFastConfig, passFastObjectId, passFastStatus, passFastData, passFastSerial } from "./passfast";
import { syntheticPassFastArchive } from "./test-support";
const serial = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const env = { PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: id, PASSFAST_TEMPLATE_ID: serial };
const config = () => passFastConfig(env);
const pass = (platform = "google", status = "active") => ({ id, serial_number: serial, wallet_type: platform, status, google_save_url: "https://pay.google.com/gp/v/save/synthetic" });
const json = (value: unknown, status = 200) => Response.json(value, { status });

describe("PassFast managed transport, fake responses only", () => {
  it("keeps mapping opaque and separate from membership credentials", () => {
    expect(passFastObjectId(serial)).toBe(`passfast:${serial}`);
    expect(passFastSerial(`passfast:${serial}`)).toBe(serial);
    expect(() => passFastSerial("native-object")).toThrow();
  });
  it.each([undefined, "false", "TRUE"])("stays off for flag %s", flag => {
    expect(passFastStatus({ ...env, PASSFAST_ENABLED: flag }).ready).toBe(false);
  });
  it.each(["PASSFAST_API_KEY", "PASSFAST_APP_ID", "PASSFAST_TEMPLATE_ID"])("refuses missing %s", name => {
    expect(passFastStatus({ ...env, [name]: "" }).ready).toBe(false);
  });
  it("requires a server secret, never a publishable key", () => {
    expect(passFastStatus({ ...env, PASSFAST_API_KEY: "pk_live_synthetic" }).ready).toBe(false);
    expect(passFastStatus(env).ready).toBe(true);
  });
  it("generates Google with stable serial, get_or_create and app isolation", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ save_url: "https://pay.google.com/gp/v/save/synthetic" }, 201));
    await new PassFastClient(config(), fetch).generate(serial, "google", { balance: 2 });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.passfa.st/functions/v1/generate-pass");
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${env.PASSFAST_API_KEY}`, "X-App-Id": id });
    expect(JSON.parse(options.body)).toEqual({ template_id: serial, serial_number: serial, external_id: serial, wallet_type: "google", data: { balance: 2 }, get_or_create: true });
    expect(options.redirect).toBe("error");
  });
  it.each([200, 201])("accepts new or duplicate Apple generation (%s)", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([80,75,3,4,0]), { status, headers: { "content-type": "application/vnd.apple.pkpass", "X-Pass-Id": id } }));
    await expect(new PassFastClient(config(), fetch).generate(serial, "apple", {})).resolves.toBeUndefined();
  });
  it("selects Google explicitly for serial lookup and ignores provider balances", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...pass(), dynamic_data: { balance: 999 } }));
    const result = await new PassFastClient(config(), fetch).get(serial, "google");
    expect(fetch.mock.calls[0][0]).toContain(`/${serial}?wallet_type=google`);
    expect(result).toEqual({ id, status: "active", saveUrl: "https://pay.google.com/gp/v/save/synthetic" });
  });
  it.each(["wrong-serial", "wrong-platform", "wrong-app", "malformed"])("rejects %s lookup", async fault => {
    const value: Record<string, unknown> = pass();
    if (fault === "wrong-serial") value.serial_number = id;
    if (fault === "wrong-platform") value.wallet_type = "apple";
    if (fault === "wrong-app") value.app_id = serial;
    if (fault === "malformed") delete value.status;
    await expect(new PassFastClient(config(), vi.fn().mockResolvedValue(json(value))).get(serial, "google")).rejects.toThrow();
  });
  it("updates only the selected platform and requests a push", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id, status: "active" }));
    await new PassFastClient(config(), fetch).update(serial, "google", { balance: 3 });
    expect(fetch.mock.calls[0][0]).toContain("wallet_type=google");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ data: { balance: 3 }, push_update: true });
  });
  it("voids and verifies invalidation instead of accepting a warning as success", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ status: "invalidated", pkpass_rebuilt: true })).mockResolvedValueOnce(json(pass("apple", "invalidated")));
    await expect(new PassFastClient(config(), fetch).void(serial, "apple")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toContain("/void?wallet_type=apple");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });
  it("recovers lost void response from the invalidated pass", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: "already_voided" }, 409)).mockResolvedValueOnce(json(pass("google", "invalidated")));
    await expect(new PassFastClient(config(), fetch).void(serial, "google")).resolves.toBeUndefined();
  });
  it.each(["active", "expired"])("does not call %s proof a completed revocation", async status => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ status: "invalidated" })).mockResolvedValueOnce(json(pass("google", status)));
    await expect(new PassFastClient(config(), fetch).void(serial, "google")).rejects.toThrow();
  });
  it("does not silently lose an uncertain creation behind a 404 void", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: "missing" }, 404));
    await expect(new PassFastClient(config(), fetch).void(serial, "apple")).rejects.toThrow();
  });
  it("keeps failed Apple rebuild visible for retry", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ status: "invalidated", pkpass_rebuilt: false, warning: "private provider detail" }));
    await expect(new PassFastClient(config(), fetch).void(serial, "apple")).rejects.toThrow("PassFast operation failed");
  });
  it.each(["http://pay.google.com/gp/v/save/x", "https://evil.example/gp/v/save/x", "https://pay.google.com.evil.example/gp/v/save/x"])("rejects unsafe save URL %s", async save_url => {
    await expect(new PassFastClient(config(), vi.fn().mockResolvedValue(json({ save_url }, 201))).generate(serial, "google", {})).rejects.toThrow();
  });
  it("does not echo provider error bodies or credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: env.PASSFAST_API_KEY }, 503));
    await expect(new PassFastClient(config(), fetch).update(serial, "google", {})).rejects.toThrow("PassFast operation failed");
  });
  it("uses a bounded timeout and blocks credential-bearing redirects", async () => {
    const fetch = vi.fn().mockImplementation(async (_url, options) => { expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(AbortSignal); throw new DOMException("Timed out", "TimeoutError"); });
    await expect(new PassFastClient(config(), fetch).get(serial, "apple")).rejects.toThrow();
  });
  it("rejects HTML or malformed provider pass downloads", async () => {
    await expect(new PassFastClient(config(), vi.fn().mockResolvedValue(new Response("bad", { headers: { "content-type": "text/html" } }))).download(serial)).rejects.toThrow();
  });
  it("retains ambiguous Apple 409 instead of claiming a failed archive rebuild was repaired", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: "already_voided" }, 409));
    await expect(new PassFastClient(config(), fetch).void(serial,"apple")).rejects.toThrow();
  });
  it.each([false,true])("reconciles a lost Apple void acknowledgement against the actual voided archive (deflated=%s)", async compressed => {
    const bytes=syntheticPassFastArchive({serialNumber:serial,voided:true,barcodes:[]},compressed);
    const fetch=vi.fn().mockResolvedValueOnce(json({error:"already_voided"},409))
      .mockResolvedValueOnce(json(pass("apple","invalidated")))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes),{headers:{"content-type":"application/vnd.apple.pkpass"}}));
    await expect(new PassFastClient(config(),fetch).void(serial,"apple")).resolves.toBeUndefined();
    expect(fetch.mock.calls[2][0]).toContain("/download?wallet_type=apple");
  });
  it.each([{serialNumber:serial,voided:false},{serialNumber:id,voided:true},{serialNumber:serial,voided:true,barcode:{message:"sc_old"}},{serialNumber:serial,voided:true,barcodes:[{message:"sc_old"}]}])("refuses stale or cross-pass Apple rebuild proof %j",async value=>{
    const bytes=syntheticPassFastArchive(value);
    const fetch=vi.fn().mockResolvedValueOnce(json({status:"invalidated",pkpass_rebuilt:false}))
      .mockResolvedValueOnce(json(pass("apple","invalidated")))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes),{headers:{"content-type":"application/vnd.apple.pkpass"}}));
    await expect(new PassFastClient(config(),fetch).void(serial,"apple")).rejects.toThrow();
  });
  it("does not decompress an unbounded Apple rebuild proof",async()=>{
    const bytes=syntheticPassFastArchive({serialNumber:serial,voided:true,padding:"x".repeat(70000)},true);
    const fetch=vi.fn().mockResolvedValueOnce(json({error:"already_voided"},409))
      .mockResolvedValueOnce(json(pass("apple","invalidated")))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes),{headers:{"content-type":"application/vnd.apple.pkpass"}}));
    await expect(new PassFastClient(config(),fetch).void(serial,"apple")).rejects.toThrow();
  });
  it("keeps existing-platform revocation possible when new issuance is disabled for that platform", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({status:"invalidated"})).mockResolvedValueOnce(json(pass("google","invalidated")));
    const client = new PassFastClient({...config(),platforms:["apple"]},fetch);
    await expect(client.generate(serial,"google",{})).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.void(serial,"google")).resolves.toBeUndefined();
  });
  it("bounds provider JSON responses", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...pass(), privatePadding: "x".repeat(70000) }));
    await expect(new PassFastClient(config(),fetch).get(serial,"google")).rejects.toThrow();
  });
  it("sends only required pseudonymous display/scan fields", () => {
    const data = passFastData({ tenantId: "private-tenant", membershipId: "private-member", programId: "private-program", merchantName: "Café", programName: "Coffee", locationName: "Mitte", brandColor: "#214739", country: "DE", locale: "de", programType: "stamp", balance: 2, scanCode: "sc_synthetic", cardLocator: "K-ABCDEF", reward: { title: "Coffee", cost: 5 } });
    expect(data).toMatchObject({ scanCode: "sc_synthetic", cardLocator: "K-ABCDEF", balance: 2, rewardReady: "" });
    expect(Object.keys(data)).not.toContain("tenantId");
    expect(JSON.stringify(data)).not.toContain("private-");
  });
});
