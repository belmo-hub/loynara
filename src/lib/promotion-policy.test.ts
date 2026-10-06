import { describe, expect, it } from "vitest";
import { promotionalLimits as limits } from "./promotion-policy";

const promotionalLimits = (vars: Record<string, string>) => limits(vars as unknown as NodeJS.ProcessEnv);

describe("promotionalLimits", () => {
  it("uses the defaults when the variables are missing or empty, as in .env.example", () => {
    expect(promotionalLimits({})).toEqual({ monthly: 100, frequencyHours: 24 });
    expect(promotionalLimits({ PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: " " })).toEqual({ monthly: 100, frequencyHours: 24 });
  });
  it("accepts explicit limits and still rejects unsafe ones", () => {
    expect(promotionalLimits({ PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "250", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "72" })).toEqual({ monthly: 250, frequencyHours: 72 });
    for (const bad of ["0", "-1", "1.5", "abc", "100001"]) expect(() => promotionalLimits({ PROMOTIONAL_MONTHLY_LOCATION_LIMIT: bad })).toThrow("Invalid promotional safety limits");
    expect(() => promotionalLimits({ PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "0" })).toThrow();
  });
});
