import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog } from "./dialog";
import { Segmented, TabNav } from "./tabs";
import { Sheet } from "./sheet";
import { Table, TableScroll } from "./table";
import { ToastProvider } from "./toast";

const html = renderToStaticMarkup;

describe("Segmented", () => {
  it("is a labelled group of pressed-state buttons", () => {
    const out = html(h(Segmented, { label: "Zeitraum", value: "30", onChange: () => {}, options: [{ value: "30", label: "30 Tage" }, { value: "90", label: "90 Tage" }] }));
    expect(out).toMatch(/role="group"[^>]*aria-label="Zeitraum"|aria-label="Zeitraum"[^>]*role="group"/);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out.match(/type="button"/g)).toHaveLength(2);
  });
});

describe("TabNav", () => {
  it("marks the current page link", () => {
    const out = html(h(TabNav, { label: "Kunden", items: [{ href: "/merchant/customers", label: "Kundenkarten", current: true }, { href: "/merchant/audiences", label: "Zielgruppen" }] }));
    expect(out).toContain('<nav aria-label="Kunden"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });
});

describe("Table", () => {
  it("wraps a semantic table in a container that is only a tab stop once it overflows", () => {
    const out = html(h(TableScroll, { label: "Letzte Vorgänge" }, h(Table, { caption: "Letzte Vorgänge" }, h("tbody", null))));
    expect(out).toMatch(/<div class="[^"]*"><table/);
    expect(out).not.toContain("tabindex");
    expect(out).toContain("<caption");
  });
  it("can stack rows into cards on phones", () => {
    expect(html(h(Table, { caption: "x", stack: true }, h("tbody", null)))).toContain('data-stack="true"');
  });
});

describe("Dialog and Sheet", () => {
  it("renders a closed native dialog wired to its title and description", () => {
    const out = html(h(Dialog, { open: false, onClose: () => {}, title: "Prämie einlösen?", description: "Gratiskaffee für K-H3G3E2." }));
    expect(out).toMatch(/^<dialog/);
    expect(out).not.toMatch(/<dialog[^>]* open/);
    expect(out).toMatch(/aria-labelledby="([^"]+)"[\s\S]*<h2 id="\1"/);
    expect(out).toContain("aria-describedby");
  });
  it("renders a sheet with its side", () => {
    const out = html(h(Sheet, { open: false, onClose: () => {}, title: "Plus", side: "bottom", closeLabel: "Fermer" }));
    expect(out).toContain('data-side="bottom"');
    expect(out).toContain('aria-label="Fermer"');
  });
});

describe("ToastProvider", () => {
  it("renders a polite live region for announcements", () => {
    const out = html(h(ToastProvider, { closeLabel: "Fermer" }, h("main", null)));
    expect(out).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
  });
});
