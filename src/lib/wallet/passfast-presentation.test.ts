import { describe, expect, it } from "vitest";
import { walletProgress } from "./content";
import { passFastData } from "./passfast";
import type { WalletPassData } from "./types";

describe("PassFast reward presentation preserves loyalty state", () => {
  it.each([
    { locale: "de", balance: 5, reward: { title: "Coffee", cost: 5 }, ready: true, text: "Prämie bereit" },
    { locale: "fr", balance: 6, reward: { title: "Coffee", cost: 5 }, ready: true, text: "Récompense disponible" },
    { locale: "de", balance: 4, reward: { title: "Coffee", cost: 5 }, ready: false, text: "" },
    { locale: "fr", balance: 4, reward: { title: "Coffee", cost: 5 }, ready: false, text: "" },
    { locale: "de", balance: 10, reward: undefined, ready: false, text: "" },
    { locale: "fr", balance: 10, reward: undefined, ready: false, text: "" },
  ] as const)("projects $locale balance=$balance ready=$ready as customer text", ({ locale, balance, reward, ready, text }) => {
    const pass: WalletPassData = {
      tenantId: "private-tenant", membershipId: "private-member", programId: "private-program",
      merchantName: "Café", programName: "Coffee", locationName: "Mitte", brandColor: "#214739",
      country: "DE", locale, programType: "stamp", balance, scanCode: "sc_synthetic",
      cardLocator: "K-ABCDEF", ...(reward ? { reward } : {}),
    };
    const before = structuredClone(pass);
    expect(passFastData(pass)).toEqual({
      merchantName: "Café", programName: "Coffee", locationName: "Mitte", locale,
      programType: "stamp", balance, scanCode: "sc_synthetic", cardLocator: "K-ABCDEF",
      rewardTitle: reward ? "Coffee" : "", rewardCost: reward ? 5 : 0, rewardReady: text,
    });
    expect(typeof passFastData(pass).rewardReady).toBe("string");
    expect(walletProgress(pass).ready).toBe(ready);
    expect(typeof walletProgress(pass).ready).toBe("boolean");
    expect(pass).toEqual(before);
  });
});
