import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionTable } from "@/components/owner/staff-data";

describe("team permission explanation", () => {
  it("distinguishes manager read access to rules and rewards from owner-only changes", () => {
    const html = renderToStaticMarkup(createElement(PermissionTable));
    const rows = html.match(/<tr>.*?<\/tr>/g) ?? [];
    const readRow = rows.find(row => row.includes("Programm ansehen"));
    const editRow = rows.find(row => row.includes("Programm und Prämien ändern"));
    expect(readRow).toBeDefined();
    expect(editRow).toBeDefined();
    const permissions = (row: string | undefined) => [...(row ?? "").matchAll(/aria-label="(erlaubt|nicht erlaubt)"/g)].map(match => match[1]);
    expect(permissions(readRow)).toEqual(["nicht erlaubt", "erlaubt", "erlaubt"]);
    expect(permissions(editRow)).toEqual(["nicht erlaubt", "nicht erlaubt", "erlaubt"]);
  });
});
