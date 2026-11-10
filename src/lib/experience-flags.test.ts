import { describe, expect, it } from "vitest";
import { EXPERIENCE_FLAGS, experienceFlag } from "./experience-flags";
import { productionConfigIssues } from "../../scripts/config-check";

describe("customer-experience flags", () => {
  it.each(EXPERIENCE_FLAGS)("%s is off unless exactly true", name => {
    expect(experienceFlag(name, {})).toBe(false);
    for (const value of ["false", "TRUE", "1", "yes", " true"]) expect(experienceFlag(name, { [name]: value })).toBe(false);
    expect(experienceFlag(name, { [name]: "true" })).toBe(true);
  });
  it.each(EXPERIENCE_FLAGS)("production refuses %s with any value other than true or false", name => {
    const issue = `${name} must be exactly true or false`;
    expect(productionConfigIssues({ NODE_ENV: "production", [name]: "yes" })).toContain(issue);
    for (const value of ["true", "false", undefined]) expect(productionConfigIssues({ NODE_ENV: "production", [name]: value })).not.toContain(issue);
  });
  it("production and the demo refuse the Startbonus switch without the first-page switch, and accept every other pairing", () => {
    const issue = "HEAD_START_ENABLED requires FIRST_TAP_HOOK_ENABLED=true";
    const issues = (flags: Record<string, string>) => productionConfigIssues({ NODE_ENV: "production", ...flags });
    expect(issues({ HEAD_START_ENABLED: "true" })).toContain(issue);
    expect(issues({ HEAD_START_ENABLED: "true", FIRST_TAP_HOOK_ENABLED: "false" })).toContain(issue);
    expect(issues({ HEAD_START_ENABLED: "true", FIRST_TAP_HOOK_ENABLED: "true" })).not.toContain(issue);
    expect(issues({ FIRST_TAP_HOOK_ENABLED: "true" })).not.toContain(issue);
    expect(issues({ FIRST_TAP_HOOK_ENABLED: "true", HEAD_START_ENABLED: "false" })).not.toContain(issue);
    expect(issues({})).not.toContain(issue);
    // The demo environment runs the same gate.
    expect(issues({ DEMO_ENVIRONMENT: "true", HEAD_START_ENABLED: "true" })).toContain(issue);
    expect(issues({ DEMO_ENVIRONMENT: "true", HEAD_START_ENABLED: "true", FIRST_TAP_HOOK_ENABLED: "true" })).not.toContain(issue);
    // Outside production nothing is refused: local work may switch either.
    expect(productionConfigIssues({ NODE_ENV: "development", HEAD_START_ENABLED: "true" })).not.toContain(issue);
  });
});
