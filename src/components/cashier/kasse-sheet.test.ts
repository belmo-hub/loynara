import { afterEach, describe, expect, it, vi } from "vitest";
import { warmKasse } from "./kasse-sheet";

describe("warming the Kasse for the sheet (ENG-256)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a hidden tab sends no prefetch", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const prefetch = vi.fn();
    warmKasse(prefetch);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("a tab in view prefetches the Kasse", () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    const prefetch = vi.fn();
    warmKasse(prefetch);
    expect(prefetch).toHaveBeenCalledWith("/cashier");
  });
});
