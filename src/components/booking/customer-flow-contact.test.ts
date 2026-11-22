import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { forgetContact } from "./customer-flow";

// Legal, 22 Nov (§ 25 TDDDG): the booking page stores no name or phone on the device; the browser's autofill does that.
// This replaces ENG-201 F-2's tests on the per-card key, which no longer exists.
const token = "card_SyntheticPrivateLinkToken0123456789ab";
const storage = (seed: Record<string, string> = {}) => {
  const items = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    get length() { return items.size; }, key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key),
  });
  return items;
};
afterEach(() => { vi.unstubAllGlobals(); });

it("forgets what older versions saved, under every key they used, and leaves the rest", () => {
  const items = storage({ loynara_booking_contact: "{}", "loynara_booking_contact:K-7QX2MA": "{\"name\":\"Mia\"}", [`loynara_booking_contact:${token}`]: "{\"name\":\"Mia\"}", "loynara_wallet_step:K-7QX2MA": "shown" });
  forgetContact(token, "K-7QX2MA");
  expect([...items.keys()]).toEqual(["loynara_wallet_step:K-7QX2MA"]);
});

it("does nothing where storage is blocked", () => {
  vi.stubGlobal("localStorage", { removeItem: () => { throw new Error("blocked"); } });
  expect(() => forgetContact(token, "K-7QX2MA")).not.toThrow();
});

it("the booking page never reads or writes device storage, and leaves name and phone to the browser's autofill", () => {
  const source = readFileSync("src/components/booking/customer-flow.tsx", "utf8");
  expect(source).not.toMatch(/localStorage\.(setItem|getItem)|sessionStorage|indexedDB|document\.cookie/);
  expect(source).toContain('autoComplete="name"');
  expect(source).toContain('autoComplete="tel"');
});
