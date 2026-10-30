import { describe, expect, it } from "vitest";
import { rewardBody } from "./program-reward";
import { archivedDay } from "./program-rewards";

describe("what a reward's screens post (ENG-100, S1a's schema)", () => {
  it("sends worse: true only for „Schlechter“", () => {
    expect(rewardBody.rename("cafe", "r1", "Kaffee 0,2 l", "worse")).toEqual({ programSlug: "cafe", action: "rename", rewardId: "r1", title: "Kaffee 0,2 l", worse: true });
    expect(rewardBody.rename("cafe", "r1", "Großer Kaffee", "better")).toEqual({ programSlug: "cafe", action: "rename", rewardId: "r1", title: "Großer Kaffee", worse: false });
  });
  it("names each action", () => {
    expect(rewardBody.price("cafe", "r1", 12)).toEqual({ programSlug: "cafe", action: "price", rewardId: "r1", cost: 12 });
    expect(rewardBody.archive("cafe", "r1")).toEqual({ programSlug: "cafe", action: "archive", rewardId: "r1" });
    expect(rewardBody.takeBack("cafe", "r1")).toEqual({ programSlug: "cafe", action: "takeBack", rewardId: "r1" });
  });
});

describe("the day an archive took effect (Marketing FINAL)", () => {
  it("adds the year only when it isn't this one", () => {
    const today = new Date("2026-10-29T12:00:00Z");
    expect(archivedDay("2026-11-24", today)).toBe("24.\u00a0November");
    expect(archivedDay("2025-03-03", today)).toBe("3.\u00a0März 2025");
  });
});
