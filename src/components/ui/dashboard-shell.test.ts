import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardShell, type NavGroup } from "./dashboard-shell";

const icon = h("svg", { "aria-hidden": "true" });
const groups: NavGroup[] = [
  { id: "overview", label: "Überblick", items: [{ id: "home", href: "/merchant", label: "Übersicht", icon }] },
  { id: "customers", label: "Kunden", items: [{ id: "cards", href: "/merchant/customers", label: "Kundenkarten", icon }] },
  { id: "ops", label: "Betrieb", items: [{ id: "staff", href: "/merchant/staff", label: "Team", icon, current: true }] },
];
const Guarded = ({ href, children, ...rest }: { href: string; children?: ReactNode }) => h("a", { href, "data-guarded": "true", ...rest }, children);
const render = () => renderToStaticMarkup(h(DashboardShell, { groups, tabIds: ["home", "cards"], brandHref: "/merchant", location: h("span", null, "Kassel Mitte"), user: h("span", null, "Demo Inhaber"), primaryAction: h("a", { href: "/cashier" }, "Kasse öffnen"), compactAction: h("a", { href: "/cashier" }, "Kasse"), LinkComponent: Guarded }, h("h1", null, "Team")));

describe("DashboardShell", () => {
  const out = render();
  it("offers a skip link to the main region", () => {
    expect(out).toMatch(/<a href="#inhalt"[^>]*>Zum Inhalt springen<\/a>/);
    expect(out).toMatch(/<main id="inhalt"[^>]*tabindex="-1"/);
  });
  it("routes every link through the supplied link component (unsaved-edit guard)", () => {
    expect(out).not.toMatch(/<a href="\/merchant[^"]*"(?![^>]*data-guarded)/);
  });
  it("marks the current page in the sidebar", () => {
    expect(out).toMatch(/aria-current="page"[^>]*>[\s\S]*?Team/);
  });
  it("shows the chosen tabs plus a Mehr button that opens a dialog", () => {
    expect(out).toMatch(/<nav[^>]*aria-label="Bereiche"/);
    expect(out).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*>[\s\S]*?Mehr/);
  });
  it("highlights Mehr when the current page is not a tab", () => {
    expect(out).toMatch(/<button[^>]*data-current="true"[^>]*aria-haspopup="dialog"|<button[^>]*aria-haspopup="dialog"[^>]*data-current="true"/);
  });
});
