import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { activityDay } from "@/components/card-client";
import { SwitchedOn } from "@/components/card-wallet-messages";
import { dayLabel } from "@/components/owner/card-screen";
import { germanDate, zoneDay } from "./german-date";

// Design's time-zone rule (22 Nov): every shop date, time and day boundary is the shop's, whatever the phone's zone. The
// same strings at Berlin 23:30 and 00:30 (22/23 Nov), rendered on a device set to UTC, New York and Berlin itself.
const lateEvening = "2026-11-22T22:30:00Z"; // 23:30 on Sunday 22 Nov in Berlin
const afterMidnight = new Date("2026-11-22T23:30:00Z"); // 00:30 on Monday 23 Nov in Berlin
const initial = process.env.TZ;
afterAll(() => { process.env.TZ = initial; });

describe.each(["UTC", "America/New_York", "Europe/Berlin"])("on a device set to %s", zone => {
  it("reads every day and time on the shop's clock", () => {
    process.env.TZ = zone;
    expect(new Date(afterMidnight).getTimezoneOffset()).toBe({ UTC: 0, "America/New_York": 300, "Europe/Berlin": -60 }[zone]);
    expect(zoneDay(afterMidnight)).toBe("2026-11-23");
    expect(dayLabel(lateEvening, afterMidnight)).toBe("Gestern");
    expect(dayLabel(afterMidnight.toISOString(), afterMidnight)).toBe("Heute");
    expect(activityDay(lateEvening, "de-DE", afterMidnight)).toBe("Gestern");
    expect(activityDay(afterMidnight.toISOString(), "de-DE", afterMidnight, "Europe/Berlin")).toBe("Heute");
    expect(germanDate(lateEvening, "feed")).toBe("22.11., 23:30");
    expect(renderToStaticMarkup(createElement(SwitchedOn, { shop: "Café", givenAt: lateEvening, busy: false, onSwitchOff: () => {}, timeZone: "Europe/Berlin" }))).toContain("Erlaubt am 22. Nov., 23:30");
  });
});
