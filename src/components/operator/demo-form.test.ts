import { describe, expect, it } from "vitest";
import { SHOP_TEMPLATES } from "@/lib/shop-templates";
import { COST_PROBLEM, costProblem, demoForm, initialDemoForm, type DemoForm } from "./demo-form";

const filled = (): DemoForm => [
  { type: "template", id: "pizzeria" } as const,
  { type: "edit", patch: { name: "Pizzeria Roma", reward: "Pizza gratis", cost: "120", colour: "#C99A2E" } } as const,
  { type: "logo", logoData: "data:image/png;base64,AAAA" } as const,
].reduce(demoForm, initialDemoForm());

describe("Demo-Modus form", () => {
  it("starts empty on the first template", () => {
    expect(initialDemoForm()).toMatchObject({ templateId: SHOP_TEMPLATES[0].id, name: "", reward: SHOP_TEMPLATES[0].rewardTitle, cost: String(SHOP_TEMPLATES[0].cost), colour: SHOP_TEMPLATES[0].colours[0], key: null, sending: false });
    expect(initialDemoForm().logoData).toBeUndefined();
  });

  it("resets the whole form after a successful start, so a second tap stops at the empty name", () => {
    const sent = demoForm(filled(), { type: "send", key: "k1" });
    expect(sent).toMatchObject({ key: "k1", sending: true });
    expect(demoForm(sent, { type: "started" })).toEqual(initialDemoForm());
  });

  it("keeps the key for a retry after a failure, and an edit outside a send drops it", () => {
    const failed = demoForm(demoForm(filled(), { type: "send", key: "k1" }), { type: "failed" });
    expect(failed).toMatchObject({ key: "k1", sending: false, name: "Pizzeria Roma" });
    expect(demoForm(failed, { type: "edit", patch: { name: "Roma" } }).key).toBeNull();
    // While the start is on its way, an edit keeps the key, so the retry cannot make a second shop.
    expect(demoForm(demoForm(filled(), { type: "send", key: "k2" }), { type: "edit", patch: { name: "x" } }).key).toBe("k2");
  });

  it("a type switch takes the template's colour, reward and cost", () => {
    const t = SHOP_TEMPLATES.find(template => template.id === "nails")!;
    expect(demoForm(filled(), { type: "template", id: "nails" })).toMatchObject({ colour: t.colours[0], reward: t.rewardTitle, cost: String(t.cost), name: "Pizzeria Roma" });
  });

  it("checks the cost on the client with the server's limit, written 100.000", () => {
    expect(COST_PROBLEM).toBe("Gib eine ganze Zahl von 1 bis 100.000 ein.");
    for (const cost of ["", " ", "0", "-1", "1.5", "acht", "100001"]) expect(costProblem(cost), cost).toBe(COST_PROBLEM);
    for (const cost of ["1", "8", " 12 ", "100000"]) expect(costProblem(cost), cost).toBe("");
  });
});
