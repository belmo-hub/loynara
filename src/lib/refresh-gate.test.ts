import { describe, expect, it } from "vitest";
import { createRefreshGate } from "./refresh-gate";

describe("card refresh gate", () => {
  it("lets one refresh through for a burst of focus, visibility and pageshow events", () => {
    let time = 100_000;
    const gate = createRefreshGate(5_000, () => time);
    expect(gate.tryStart()).toBe(true);
    expect(gate.tryStart()).toBe(false);
    expect(gate.tryStart()).toBe(false);
    gate.finish();
    time += 1_000;
    expect(gate.tryStart()).toBe(false);
    time += 4_000;
    expect(gate.tryStart()).toBe(true);
  });

  it("never runs two refreshes at once, even after the interval", () => {
    let time = 0;
    const gate = createRefreshGate(5_000, () => time);
    expect(gate.tryStart()).toBe(true);
    time += 60_000;
    expect(gate.tryStart()).toBe(false);
    gate.finish();
    expect(gate.tryStart()).toBe(true);
  });

  it("does not repeat the initial page load when the window gains focus right after it", () => {
    let time = 50_000;
    const gate = createRefreshGate(5_000, () => time);
    gate.markLoaded();
    time += 300;
    expect(gate.tryStart()).toBe(false);
    time += 5_000;
    expect(gate.tryStart()).toBe(true);
  });

  it("caps sustained app switching at one request per interval", () => {
    let time = 0;
    const gate = createRefreshGate(5_000, () => time);
    let started = 0;
    for (let event = 0; event < 900; event++) { // 15 minutes of an event every second
      if (gate.tryStart()) { started++; gate.finish(); }
      time += 1_000;
    }
    expect(started).toBe(180);
  });
});
