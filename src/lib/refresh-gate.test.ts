import { describe, expect, it } from "vitest";
import { AUTO_REFRESH_BUDGET, createRefreshGate, nextAutoRefresh } from "./refresh-gate";

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

describe("automatic card re-reads while the card is visible", () => {
  it("reads every 5 s right after the card is shown, then slower, and stops after ten minutes", () => {
    expect(nextAutoRefresh(0, 0, 0)).toBe(5_000);
    expect(nextAutoRefresh(59_000, 0, 0)).toBe(5_000);
    expect(nextAutoRefresh(60_000, 0, 0)).toBe(15_000);
    expect(nextAutoRefresh(180_000, 0, 0)).toBe(60_000);
    expect(nextAutoRefresh(600_000, 0, 0)).toBeNull();
  });

  it("backs off after failed reads, never waiting more than a minute", () => {
    expect(nextAutoRefresh(0, 1, 0)).toBe(10_000);
    expect(nextAutoRefresh(0, 2, 0)).toBe(20_000);
    expect(nextAutoRefresh(0, 5, 0)).toBe(60_000);
  });

  it("stops when the page has used its budget, which stays well inside the server's card-read limits", () => {
    expect(nextAutoRefresh(0, 0, AUTO_REFRESH_BUDGET)).toBeNull();
    let shownFor = 0, reads = 0;
    for (let delay = nextAutoRefresh(0, 0, 0); delay !== null; delay = nextAutoRefresh(shownFor, 0, reads)) { shownFor += delay; reads++; }
    expect(reads).toBeLessThanOrEqual(AUTO_REFRESH_BUDGET);
    // GET /api/card/[token] allows 90 reads per card in 15 minutes: two thirds stay free for page loads, the refresh button and a second tab.
    expect(AUTO_REFRESH_BUDGET * 3).toBeLessThanOrEqual(90);
  });
});
