import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({
  me: { userId: "owner", role: "owner", locationId: "location", locationName: "Berlin", publicBaseUrl: "http://localhost:3000" },
  locations: [{ id: "location", name: "Berlin" }],
}), useDirtyGuard: () => {}, }));

import StaffPage from "./page";

describe("team permission explanation", () => {
  it("distinguishes manager read access to rules and rewards from owner-only changes", () => {
    const html = renderToStaticMarkup(createElement(StaffPage));
    const rows = html.match(/<tr>.*?<\/tr>/g) ?? [];
    const readRow = rows.find(row => row.includes("Sammelregeln und Prämien ansehen"));
    const editRow = rows.find(row => row.includes("Programm und Prämien ändern"));
    expect(readRow).toBeDefined();
    expect(editRow).toBeDefined();
    const permissions = (row: string | undefined) => [...(row ?? "").matchAll(/aria-label="(erlaubt|nicht erlaubt)"/g)].map(match => match[1]);
    expect(permissions(readRow)).toEqual(["nicht erlaubt", "erlaubt", "erlaubt"]);
    expect(permissions(editRow)).toEqual(["nicht erlaubt", "nicht erlaubt", "erlaubt"]);
  });
});
