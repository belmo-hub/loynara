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
});
