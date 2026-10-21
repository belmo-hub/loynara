import { describe, expect, it } from "vitest";
import { passFastData, passFastVoidPayload } from "./passfast";
import type { WalletPassData } from "./types";

// ENG-043: with WALLET_MESSAGES_ENABLED off, generate, refresh and void send exactly the earlier contract, byte for byte
// (key order included), so templates without a `message` field are never sent the new key.
const pass: WalletPassData = {
  tenantId: "synthetic-tenant", membershipId: "synthetic-member", programId: "synthetic-program", merchantName: "Café", programName: "Kaffee",
  locationName: "Mitte", brandColor: "#214739", country: "DE", locale: "de", programType: "stamp", balance: 10, scanCode: "sc_synthetic",
  cardLocator: "K-ABCDEF", reward: { title: "Kaffee gratis", cost: 10 }, message: "Heute ruhig: doppelte Punkte bis 17 Uhr",
};
const earlierData = '{"merchantName":"Café","programName":"Kaffee","locationName":"Mitte","locale":"de","programType":"stamp","balance":10,"cardLocator":"K-ABCDEF","scanCode":"sc_synthetic","rewardTitle":"Kaffee gratis","rewardCost":10,"rewardReady":"Prämie bereit"}';
const earlierVoid = '{"merchantName":"Café","programName":"Kaffee","locationName":"Mitte","locale":"de","programType":"stamp","scanCode":"","cardLocator":"","balance":0,"rewardTitle":"","rewardCost":0,"rewardReady":""}';

describe("PassFast payloads and the WALLET_MESSAGES_ENABLED switch", () => {
  it.each([{}, { WALLET_MESSAGES_ENABLED: "false" }, { WALLET_MESSAGES_ENABLED: "TRUE" }, { WALLET_MESSAGES_ENABLED: "" }])("off (%o): generate/refresh and void are the earlier contract exactly", env => {
    expect(JSON.stringify(passFastData(pass, env))).toBe(earlierData);
    expect(JSON.stringify(passFastVoidPayload(pass, env))).toBe(earlierVoid);
  });
  it("on: the message is added at the end, and a void clears it", () => {
    const env = { WALLET_MESSAGES_ENABLED: "true" };
    expect(JSON.stringify(passFastData(pass, env))).toBe(earlierData.slice(0, -1) + ',"message":"Heute ruhig: doppelte Punkte bis 17 Uhr"}');
    expect(JSON.stringify(passFastData({ ...pass, message: undefined }, env))).toBe(earlierData.slice(0, -1) + ',"message":""}');
    expect(JSON.stringify(passFastVoidPayload(pass, env))).toBe(earlierVoid.slice(0, -1) + ',"message":""}');
  });
});
