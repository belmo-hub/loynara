import { afterEach, expect, it, vi } from "vitest";
import { contactKey, readContact } from "./customer-flow";

// ENG-201 F-2: the booking prefill is keyed by the card number, so the card page's ENG-214 move of token-named entries
// neither loses it nor finds the private link in device storage.
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

it("reads the prefill under the card number", () => {
  storage({ [contactKey("K-7QX2MA")]: JSON.stringify({ name: "Mia", phone: "0170" }) });
  expect(contactKey("K-7QX2MA")).toBe("loynara_booking_contact:K-7QX2MA");
  expect(readContact(token, "K-7QX2MA")).toEqual({ name: "Mia", phone: "0170" });
});

it("moves a token-named prefill to the card number and leaves no key holding the private link", () => {
  const items = storage({ [`loynara_booking_contact:${token}`]: JSON.stringify({ name: "Mia", phone: "" }), loynara_booking_contact: "{\"name\":\"Someone else\"}" });
  expect(readContact(token, "K-7QX2MA")).toEqual({ name: "Mia", phone: "" });
  expect([...items.keys()]).toEqual(["loynara_booking_contact:K-7QX2MA"]);
});

it("an empty or blocked storage gives an empty form", () => {
  storage();
  expect(readContact(token, "K-7QX2MA")).toEqual({ name: "", phone: "" });
  vi.stubGlobal("localStorage", { get length(): number { throw new Error("blocked"); }, getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
  expect(readContact(token, "K-7QX2MA")).toEqual({ name: "", phone: "" });
});
