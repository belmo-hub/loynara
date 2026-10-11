import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: "", mode: "disabled", role: "owner", overrides: [] as unknown[], campaigns: [] as Record<string, unknown>[] }));
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => state.overrides.length ? [state.overrides.shift(), () => {}] : react.useState(initial) };
});
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("./owner-context", () => ({ useDirtyGuard: () => {}, useOwner: () => ({ me: { role: state.role, businessName: "Synthetic Café", locationName: "Berlin", programSlug: "synthetic", programType: "stamp", hiddenSurfaces: [] }, locations: [], announce: () => {} }) }));
vi.mock("./use-load", () => ({ useLoad: (url: string) => [{ state: "ok", data: url.startsWith("/api/merchant/campaigns") ? { deliveryMode: state.mode, campaigns: state.campaigns } : { rewards: [{ id: "version", rewardId: "75e35319-6a75-4377-bb91-a6c5ce1bcd00", title: "Coffee", cost: 8 }] } }, () => {}] }));

import { CampaignsView } from "./campaigns-view";
import MerchantAudiencesPage from "@/app/merchant/audiences/page";

beforeEach(() => { state.query = ""; state.mode = "disabled"; state.role = "owner"; state.overrides = []; state.campaigns = []; });
function audience(kind: string, withinDays = "60", rewardId = "75e35319-6a75-4377-bb91-a6c5ce1bcd00") {
  state.overrides = [kind, withinDays, "60", "3", "2", rewardId, { total: 3, asOf: "2030-01-01T00:00:00Z" }, false, ""];
  return renderToStaticMarkup(createElement(MerchantAudiencesPage));
}

describe("audience to campaign preserves the previewed definition", () => {
  it("carries the recent activity threshold in the link", () => { expect(audience("recently_active")).toContain("goal=quiet&amp;withinDays=60"); });
  it("carries the selected reward in the link", () => { expect(audience("close_to_reward")).toContain("rewardId=75e35319-6a75-4377-bb91-a6c5ce1bcd00"); });
  it("does not offer managers campaign access", () => { state.role = "manager"; expect(audience("recently_active")).not.toContain("/merchant/campaigns"); });
  it("prefills the recent threshold from the URL", () => {
    state.query = "goal=quiet&withinDays=60";
    expect(renderToStaticMarkup(createElement(CampaignsView))).toMatch(/id="c-within"[^>]*value="60"/);
  });
  it("prefills the selected reward from the URL", () => {
    state.query = "goal=near-reward&maxRemaining=2&rewardId=75e35319-6a75-4377-bb91-a6c5ce1bcd00";
    expect(renderToStaticMarkup(createElement(CampaignsView))).toContain('value="75e35319-6a75-4377-bb91-a6c5ce1bcd00" selected=""');
  });
});

describe("disabled delivery has no paused campaign scheduler", () => {
  it.each(["disabled", "mailpit"])("paused campaign controls follow delivery mode %s", mode => {
    state.mode = mode;
    state.campaigns = [{ id: "campaign", title: "Synthetic", subject: "Subject", status: "paused", audienceCount: 0, queuedCount: 0, scheduledAt: null }];
    const html = renderToStaticMarkup(createElement(CampaignsView));
    expect(html.includes('type="datetime-local"')).toBe(mode !== "disabled");
    expect(html.includes("Erneut planen")).toBe(mode !== "disabled");
  });
});

function builderMarkup(patch: Record<string, unknown>, step = 0) {
  const editor = { title: "Synthetic draft", subject: "Synthetic subject", body: "Synthetic body", kind: "inactive", withinDays: 30, daysSinceLast: 30, minCheckouts: 2, maxRemaining: 2, rewardId: "", ...patch };
  state.overrides = [{ goal: null, options: {} }, { step, editor, editingId: null, savedId: null, goal: null }, true, { state: "idle" }, null, false, false, "", "", {}, null];
  return renderToStaticMarkup(createElement(CampaignsView));
}
function buttonMarkup(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
}
describe("campaign builder rejects invalid audience thresholds before API calls", () => {
  it.each([
    { kind: "inactive", daysSinceLast: 0 },
    { kind: "inactive", daysSinceLast: 3651 },
    { kind: "new", withinDays: 1.5 },
    { kind: "recently_active", withinDays: 0 },
    { kind: "frequent_visitors", minCheckouts: 10001 },
    { kind: "frequent_visitors", minCheckouts: 0 },
    { kind: "close_to_reward", maxRemaining: 100001 },
    { kind: "close_to_reward", maxRemaining: 1.5 },
  ])("blocks navigation and saving for %j", patch => {
    expect(buttonMarkup(builderMarkup(patch), "Weiter")).toContain('disabled=""');
    expect(buttonMarkup(builderMarkup(patch, 2), "Entwurf speichern")).toContain('disabled=""');
    expect(builderMarkup(patch)).toContain('role="alert"');
  });
  it.each([
    { kind: "all", withinDays: 0, daysSinceLast: 0, maxRemaining: 0 },
    { kind: "inactive", daysSinceLast: 3650 },
    { kind: "new", withinDays: 1 },
    { kind: "recently_active", withinDays: 3650 },
    { kind: "frequent_visitors", minCheckouts: 10000 },
    { kind: "close_to_reward", maxRemaining: 100000 },
  ])("allows valid selected audiences and ignores inactive fields: %j", patch => {
    expect(buttonMarkup(builderMarkup(patch), "Weiter")).not.toContain('disabled=""');
    expect(buttonMarkup(builderMarkup(patch, 2), "Entwurf speichern")).not.toContain('disabled=""');
  });
});
