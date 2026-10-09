import { describe, expect, it } from "vitest";
import { googleObject, googleObjectId, googleSaveUrl, GoogleWalletClient } from "./google";
import { fakeGoogleApi, googleFixture } from "./test-support";
import type { WalletPassData } from "./types";

const issuerId = "3388000000023201754";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const locationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const programId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const serial = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const binding = { tenantId, locationId, programId, classId: `${issuerId}.loynara_demo`, issuanceEnabled: true, testAccountsApproved: true };
const config = { issuerId, logoUrl: "https://assets.example.test/approved.png", binding, publishingStatus: "demo" as const };
const pass: WalletPassData = { tenantId, locationId, programId, membershipId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", merchantName: "Loynara Demo", programName: "Synthetische Testkarte", locationName: "Teststandort", brandColor: "#1F4A3A", country: "DE", locale: "de", programType: "stamp", balance: 1, scanCode: "sc_synthetic-only-not-authorization", cardLocator: "K-AAAAAA", reward: { title: "Testprämie", cost: 3 } };

describe("bound Google Direct projection", () => {
  it("accepts Google's observed legacy review aliases and ignores image kind metadata, while submitting changed branding under review", async () => {
    const fixture = googleFixture();
    try {
      const api = fakeGoogleApi();
      const transport: typeof fetch = async (input, init) => {
        if (init?.method === "PATCH" && String(input).includes("/loyaltyClass/") && JSON.parse(String(init.body)).reviewStatus !== "UNDER_REVIEW") return new Response(null, { status: 400 });
        return api.fetcher(input, init);
      };
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: fixture.privateKey }, transport);
      await client.upsertClass(pass, config);
      const current = api.classes.get(binding.classId)!;
      const logo = current.programLogo as { sourceUri: object; contentDescription: { defaultValue: object } };
      api.classes.set(binding.classId, { ...current, reviewStatus: "approved", multipleDevicesAndHoldersAllowedStatus: "oneUserAllDevices", programLogo: { kind: "walletobjects#image", sourceUri: logo.sourceUri, contentDescription: { kind: "walletobjects#localizedString", defaultValue: { kind: "walletobjects#translatedString", ...logo.contentDescription.defaultValue } } } });
      const before = api.calls.length;
      await client.upsertClass(pass, { ...config, publishingStatus: "published" });
      expect(api.calls.slice(before).map(call => call.method)).toEqual(["GET"]);
      await client.upsertClass({ ...pass, merchantName: "Approved changed synthetic name" }, config);
      expect(api.calls.at(-1)?.body).toMatchObject({ issuerName: "Approved changed synthetic name", reviewStatus: "UNDER_REVIEW" });
      api.classes.set(binding.classId, { ...api.classes.get(binding.classId), reviewStatus: "rejected" });
      await expect(client.upsertClass(pass, config)).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });
  it("uses the approved class and freezes tenant/location/class into a stable per-generation object identity", () => {
    expect(googleObject(pass, serial, config).classId).toBe(`${issuerId}.loynara_demo`);
    const objectId = googleObjectId(serial, config);
    expect(objectId).toBe(googleObjectId(serial, config));
    expect(objectId).not.toBe(googleObjectId(serial, { ...config, binding: { ...binding, classId: `${issuerId}.another_class` } }));
    expect(objectId).not.toBe(googleObjectId(serial, { ...config, binding: { ...binding, locationId: "ffffffff-ffff-4fff-8fff-ffffffffffff" } }));
    expect(objectId).not.toContain(pass.scanCode);
  });

  it("rejects another merchant/program before requesting OAuth or writing any object", async () => {
    const fixture = googleFixture();
    try {
      const api = fakeGoogleApi();
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: fixture.privateKey }, api.fetcher);
      await expect(client.upsert({ ...pass, tenantId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, serial, config)).rejects.toThrow();
      expect(api.calls).toHaveLength(0);
      await expect(client.upsert({ ...pass, programId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, serial, config)).rejects.toThrow();
      expect(api.calls).toHaveLength(0);
    } finally { fixture.cleanup(); }
  });

  it("patches one existing object through +1, correction and redemption without creating another pass", async () => {
    const fixture = googleFixture();
    try {
      const api = fakeGoogleApi();
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: fixture.privateKey }, api.fetcher);
      const first = await client.upsert(pass, serial, config);
      expect(first.classId).toBe(binding.classId);
      await client.upsert({ ...pass, balance: 2 }, serial, config);
      expect(api.objects.get(first.id)?.loyaltyPoints).toMatchObject({ balance: { string: "2 / 3" } });
      await client.upsert(pass, serial, config);
      expect(api.objects.get(first.id)?.loyaltyPoints).toMatchObject({ balance: { string: "1 / 3" } });
      await client.upsert({ ...pass, balance: 3 }, serial, config);
      expect(api.objects.get(first.id)?.textModulesData).toEqual(expect.arrayContaining([expect.objectContaining({ header: "Prämie bereit" })]));
      await client.upsert({ ...pass, balance: 0 }, serial, config);
      expect(api.objects.size).toBe(1);
      expect(api.objects.get(first.id)?.loyaltyPoints).toMatchObject({ balance: { string: "0 / 3" } });
      expect(api.calls.filter(call => call.method === "PUT")).toHaveLength(0);
    } finally { fixture.cleanup(); }
  });

  it("refuses class/object identity conflicts and does not sign a foreign save link", async () => {
    const fixture = googleFixture();
    try {
      const api = fakeGoogleApi();
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: fixture.privateKey }, api.fetcher);
      const result = await client.upsert(pass, serial, config);
      api.objects.set(result.id, { ...api.objects.get(result.id), classId: `${issuerId}.foreign` });
      await expect(client.upsert({ ...pass, balance: 9 }, serial, config)).rejects.toThrow();
      expect(api.objects.get(result.id)?.loyaltyPoints).toMatchObject({ balance: { string: "1 / 3" } });
      expect(() => googleSaveUrl({ id: "3388000000023094673.managed", classId: binding.classId }, { clientEmail: "issuer@example.test", privateKey: fixture.privateKey }, [], undefined, config)).toThrow();
    } finally { fixture.cleanup(); }
  });
});
