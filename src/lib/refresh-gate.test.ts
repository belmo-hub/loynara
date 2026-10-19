import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_REFRESH_BUDGET, type CardRead, type CardReadOutcome, createAutoRefresh, createRefreshGate, nextAutoRefresh } from "./refresh-gate";

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
  it("reads every 5 s right after the card is shown, then every 20 s, and nothing after three minutes", () => {
    expect(nextAutoRefresh(0, 0, 0)).toBe(5_000);
    expect(nextAutoRefresh(29_000, 0, 0)).toBe(5_000);
    expect(nextAutoRefresh(30_000, 0, 0)).toBe(20_000);
    expect(nextAutoRefresh(160_000, 0, 0)).toBe(20_000);
    expect(nextAutoRefresh(170_000, 0, 0)).toBeNull();
  });

  it("backs off after failed reads, never waiting more than a minute", () => {
    expect(nextAutoRefresh(0, 1, 0)).toBe(10_000);
    expect(nextAutoRefresh(0, 2, 0)).toBe(20_000);
    expect(nextAutoRefresh(60_000, 1, 0)).toBe(40_000);
    expect(nextAutoRefresh(0, 5, 0)).toBe(60_000);
  });

  it("stops when the page has used its budget, which stays well inside the server's card-read limits", () => {
    expect(nextAutoRefresh(0, 0, AUTO_REFRESH_BUDGET)).toBeNull();
    let shownFor = 0, reads = 0;
    for (let delay = nextAutoRefresh(0, 0, 0); delay !== null; delay = nextAutoRefresh(shownFor, 0, reads)) { shownFor += delay; reads++; }
    expect(reads).toBe(13);
    expect(reads).toBeLessThanOrEqual(AUTO_REFRESH_BUDGET);
    // GET /api/card/[token] allows 90 reads per card in 15 minutes: two thirds stay free for page loads, the refresh button and a second tab.
    expect(AUTO_REFRESH_BUDGET * 3).toBeLessThanOrEqual(90);
    // Per network (one shop Wi-Fi shares one address) timed re-reads have their own 210 in 15 minutes: 15 guests with a
    // full budget fit.
    expect(15 * AUTO_REFRESH_BUDGET).toBeLessThanOrEqual(210);
    // The other 240 per network are left to page loads, returns and focus reads, the button and the tap-page read: 15
    // guests with a page load, a tap-page read and ten returns or button presses each use 180.
    expect(15 * (1 + 1 + 10)).toBeLessThanOrEqual(240);
  });
});

describe("the open card's automatic re-read window", () => {
  afterEach(() => { vi.useRealTimers(); });
  function openCard(outcomes: Record<number, CardReadOutcome> = {}) {
    vi.useFakeTimers({ now: 0 });
    let visible = true;
    const reads: [seconds: number, read: CardRead][] = [];
    const auto = createAutoRefresh(async read => { reads.push([Date.now() / 1000, read]); return outcomes[Date.now()] ?? "ok"; }, () => visible);
    return { auto, reads, setVisible(value: boolean) { visible = value; auto.visibility(); } };
  }

  it("ends the window once a re-read shows the stamp", async () => {
    const { auto, reads } = openCard({ 15_000: "grew" });
    auto.loaded();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reads).toEqual([[5, "timed"], [10, "timed"], [15, "timed"]]);
  });

  it("reads once on focus without restarting the 5 s tier", async () => {
    const { auto, reads } = openCard();
    auto.loaded();
    await vi.advanceTimersByTimeAsync(40_000); // 5 s reads up to 30 s, the next one due at 50 s
    auto.focus();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads.slice(5)).toEqual([[30, "timed"], [40, "return"], [60, "timed"]]);
  });

  it("keeps one budget across returns until the first reads are 15 minutes old", async () => {
    const { auto, reads, setVisible } = openCard();
    auto.loaded();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(reads).toHaveLength(13); // the whole first window, which ends after three minutes
    setVisible(false);
    await vi.advanceTimersByTimeAsync(60_000);
    setVisible(true); // a real return reads at once and restarts the window, but the budget of 14 is now used
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(reads.slice(13)).toEqual([[300, "return"]]);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(7 * 60_000);
    setVisible(true); // at 16 minutes the reads of the first minute have left the budget
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads.slice(14)).toEqual([[960, "return"], [965, "timed"], [970, "timed"]]);
  });
});
