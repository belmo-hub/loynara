import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";

const state = vi.hoisted(() => ({ me: null as MeResponse | null }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: state.me, locations: [] }) }));

import { Overview } from "./overview";
import { germanDate } from "./owner-ui";

function renderActivity(activity: NonNullable<MeResponse["activity"]>) {
  state.me = {
    userId: "owner", tenantId: "tenant", locationId: "location", role: "owner",
    businessName: "Test Café", locationName: "Berlin", publicBaseUrl: "http://localhost:3000",
    programSlug: "test-cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 5,
    stats: { members: 1, awards: 1, redemptions: 0 }, activity,
  };
  const html = renderToStaticMarkup(createElement(Overview));
  return html.match(/<time(?: [^>]*)?>.*?<\/time>/g) ?? [];
}

describe("Overview activity date contract", () => {
  it.each(["1.10.2026, 18:14:46", "13.10.2026, 18:14:46"])(
    "renders the server's German display text %s without locale reparsing",
    occurredAt => {
      expect(renderActivity([{ id: "entry", kind: "award", occurredAt, amount: 1 }]))
        .toEqual([`<time>${occurredAt}</time>`]);
    },
  );

  it("keeps the merchant's displayed date/time even when its raw timestamp is on the previous UTC day", () => {
    expect(renderActivity([{
      id: "entry", kind: "award", occurredAt: "2.10.2026, 00:14:46", createdAt: "2026-10-01T22:14:46.000Z",
    }])).toEqual(['<time dateTime="2026-10-01T22:14:46.000Z">2.10.2026, 00:14:46</time>']);
  });

  it("formats a raw timestamp when no display text is supplied", () => {
    expect(renderActivity([{ id: "entry", kind: "award", createdAt: "2026-10-13T18:14:46" }]))
      .toEqual(['<time dateTime="2026-10-13T18:14:46">13.10., 18:14</time>']);
  });
});

describe("germanDate raw timestamp fallback", () => {
  it.each([
    ["2026-10-01T18:14:46", "01.10., 18:14"],
    ["2026-10-13T18:14:46", "13.10., 18:14"],
  ])("formats %s", (timestamp, expected) => {
    expect(germanDate(timestamp, true)).toBe(expected);
  });
});

describe("Overview programme call to action follows the role", () => {
  const render = (role: "owner" | "manager" | "cashier") => {
    state.me = {
      userId: "u", tenantId: "tenant", locationId: "location", role,
      businessName: "Test Café", locationName: "Berlin", publicBaseUrl: "http://localhost:3000",
      programSlug: "test-cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 5,
      stats: { members: 1, awards: 1, redemptions: 0 }, activity: [],
    };
    return renderToStaticMarkup(createElement(Overview));
  };
  it("offers the owner an edit action", () => {
    const html = render("owner");
    expect(html).toContain("Programm bearbeiten");
    expect(html).not.toContain("Programm ansehen");
  });
  it("does not promise a manager an edit action on the read-only programme page", () => {
    const html = render("manager");
    expect(html).not.toContain("Programm bearbeiten");
    expect(html).toContain("Programm ansehen");
  });
});
