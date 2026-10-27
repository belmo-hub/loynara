import { describe, expect, it } from "vitest";
import { sameEntry } from "./owner-context";

describe("the leave guard on browser Back and Forward", () => {
  const here = { pathname: "/merchant/program/rewards/new", search: "" };
  it("lets a step of the same page through (same path and query)", () => {
    expect(sameEntry("http://localhost:3000/merchant/program/rewards/new", here)).toBe(true);
  });
  it("asks before leaving for another path", () => {
    expect(sameEntry("http://localhost:3000/merchant/program", here)).toBe(false);
  });
  it("asks for the same path with another query", () => {
    expect(sameEntry("http://localhost:3000/merchant/customers?q=Anna", { pathname: "/merchant/customers", search: "?q=Ben" })).toBe(false);
  });
});
