import { describe, expect, it } from "vitest";
import type { PublicProgram } from "./client-api";
import { staleJoin } from "./join-client";

describe("a join refused because the shop changed the programme (ENG-100 W58)", () => {
  const shown = { programName: "Alt" } as PublicProgram, fresh = { programName: "Neu" } as PublicProgram;
  it("reloads the rules, clears the consent, marks the rules and says why", () => {
    expect(staleJoin(shown, fresh, "Das Geschäft hat das Programm gerade geändert.")).toEqual({ program: fresh, acceptedTerms: false, stale: true, error: "Das Geschäft hat das Programm gerade geändert." });
  });
  it("keeps the rules shown when the reload fails, and still asks again", () => {
    expect(staleJoin(shown, null, "x")).toMatchObject({ program: shown, acceptedTerms: false, stale: true });
  });
});

describe("the join page applies the whole transition", () => {
  it("sets consent, rules, mark and error from staleJoin on STALE_RULE", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/join-client.tsx", "utf8");
    const branch = source.slice(source.indexOf('cause.code === "STALE_RULE"'), source.indexOf('cause.code === "INVALID_REFERRAL"'));
    expect(branch).toContain("staleJoin(");
    for (const set of ["setProgram(next.program)", "setAcceptedTerms(next.acceptedTerms)", "setStale(next.stale)", "setError(next.error)"]) expect(branch).toContain(set);
  });
});
