import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerCard, type CustomerCardProps } from "./customer-card";

const base: CustomerCardProps = { businessName: "Synthetic Café", locationName: "Kassel", programType: "stamps", balance: 1, rewards: [{ id: "r1", title: "Kaffee", cost: 5 }] };

describe("card news", () => {
  it("renders the owner's text as plain, escaped text", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, news: `<img src=x onerror="alert(1)"> & <b>neu</b>` }));
    expect(out).toContain("Neuigkeiten");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;b&gt;neu&lt;/b&gt;");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<b>neu");
  });
  it("shows no news panel when there is none", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("customer-news-title");
  });
});
