import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupHref, groupLabel, visibleGroups, visibleItems } from "./nav";

const ALL = ["billing", "campaigns", "automations", "audiences", "walletPreviews", "cardLogo", "nfc"] as const;
const HIDDEN_HREFS = ["/merchant/billing", "/merchant/campaigns", "/merchant/automations", "/merchant/audiences"];

describe("navigation with pilot-withheld surfaces", () => {
  it("owner: no entry for billing, campaigns, automations or audiences, and the reports group is relabelled", () => {
    const groups = visibleGroups("owner", ALL);
    expect(groups.map(group => groupLabel(group, ALL))).toEqual(["Übersicht", "Treueprogramm", "Kunden", "Auswertung", "Einstellungen"]);
    const hrefs = groups.flatMap(group => visibleItems(group, "owner", ALL).map(item => item.href));
    for (const hidden of HIDDEN_HREFS) expect(hrefs).not.toContain(hidden);
    expect(hrefs).toEqual(expect.arrayContaining(["/merchant", "/merchant/program", "/merchant/customers", "/merchant/analytics", "/merchant/adviser", "/merchant/settings", "/merchant/staff"]));
  });
  it("every visible entry leads to an existing page (no dead navigation), for owner and manager", () => {
    for (const role of ["owner", "manager"] as const) {
      for (const group of visibleGroups(role, ALL)) {
        expect(existsSync(`src/app${groupHref(group, role, ALL)}/page.tsx`), `${role} ${group.id}`).toBe(true);
        for (const item of visibleItems(group, role, ALL)) expect(existsSync(`src/app${item.href === "/merchant" ? "/merchant" : item.href}/page.tsx`), `${role} ${item.href}`).toBe(true);
      }
    }
  });
  it("manager keeps overview, programme and customers only", () => {
    const groups = visibleGroups("manager", ALL);
    expect(groups.map(group => group.id)).toEqual(["overview", "program", "customers"]);
    expect(visibleItems(groups[2], "manager", ALL).map(item => item.href)).toEqual(["/merchant/customers"]);
  });
  it("without hidden surfaces nothing changes (development, preview, device test)", () => {
    expect(visibleGroups("owner").map(group => groupLabel(group))).toEqual(["Übersicht", "Treueprogramm", "Kunden", "Aktionen", "Einstellungen"]);
    const hrefs = visibleGroups("owner").flatMap(group => visibleItems(group, "owner").map(item => item.href));
    for (const hidden of HIDDEN_HREFS) expect(hrefs).toContain(hidden);
  });
});
