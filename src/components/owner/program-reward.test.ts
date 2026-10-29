import { describe, expect, it } from "vitest";
import { rewardBody } from "./program-reward";

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
