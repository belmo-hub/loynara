import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupHref, visibleGroups, visibleItems } from "./nav";

const ALL = ["billing", "campaigns", "automations", "walletPreviews", "cardLogo", "nfc"] as const;
const FULL = ["billing", "campaigns", "automations", "audiences", "walletPreviews", "cardLogo", "nfc"] as const;
// Abrechnung is a row of the „Mehr“ page (more/page.test.ts); Kampagnen and Automationen are rows of the Aktionen list (actions-list.test.ts): none is a navigation entry.
const HIDDEN_HREFS = ["/merchant/billing", "/merchant/campaigns", "/merchant/automations"];
const DRAFT_HREFS = ["/merchant/audiences"];

describe("navigation with pilot-withheld surfaces", () => {
  it("owner: no entry for billing, campaigns or automations; audiences are present and the group keeps its name while owner messages are offered", () => {
    const groups = visibleGroups("owner", ALL);
    expect(groups.map(group => group.label)).toEqual(["Übersicht", "Treueprogramm", "Kunden", "Aktionen", "Einstellungen"]);
    const hrefs = groups.flatMap(group => visibleItems(group, "owner", ALL).map(item => item.href));
    for (const hidden of HIDDEN_HREFS) expect(hrefs).not.toContain(hidden);
    expect(hrefs).toEqual(expect.arrayContaining(DRAFT_HREFS));
    expect(visibleGroups("owner", FULL).length).toBe(5);
    expect(hrefs).toEqual(expect.arrayContaining(["/merchant", "/merchant/program", "/merchant/customers", "/merchant/actions", "/merchant/more"]));
  });
  it("with every sending surface withheld the area keeps its name and its list (ENG-122d: Ergebnisse and Beratung are rows there)", () => {
    const hidden = [...ALL, "walletMessages"] as const;
    const actions = visibleGroups("owner", hidden).find(group => group.id === "actions")!;
    expect(actions.label).toBe("Aktionen");
    expect(visibleItems(actions, "owner", hidden).map(item => item.href)).toEqual(["/merchant/actions"]);
  });
  it("every visible entry leads to an existing page (no dead navigation), for owner and manager", () => {
    for (const role of ["owner", "manager"] as const) {
      for (const group of visibleGroups(role, ALL)) {
        expect(existsSync(`src/app${groupHref(group, role, ALL)}/page.tsx`), `${role} ${group.id}`).toBe(true);
        for (const item of visibleItems(group, role, ALL)) expect(existsSync(`src/app${item.href === "/merchant" ? "/merchant" : item.href}/page.tsx`), `${role} ${item.href}`).toBe(true);
      }
    }
  });
  it("manager keeps overview, programme and customers (with audience counts) only", () => {
    const groups = visibleGroups("manager", ALL);
    expect(groups.map(group => group.id)).toEqual(["overview", "program", "customers"]);
    // Audience counts are pseudonymous and location-scoped for managers on the server; no campaign access.
    expect(visibleItems(groups[2], "manager", ALL).map(item => item.href)).toEqual(["/merchant/customers", "/merchant/audiences"]);
  });
  it("without hidden surfaces nothing changes (development, preview, device test)", () => {
    expect(visibleGroups("owner").map(group => group.label)).toEqual(["Übersicht", "Treueprogramm", "Kunden", "Aktionen", "Einstellungen"]);
    const hrefs = visibleGroups("owner").flatMap(group => visibleItems(group, "owner").map(item => item.href));
    // Billing, campaigns and automations live on the „Mehr“ page and the Aktionen list, so the navigation is the same either way.
    expect(hrefs).toEqual(["/merchant", "/merchant/program", "/merchant/customers", "/merchant/audiences", "/merchant/actions", "/merchant/more"]);
  });
});
