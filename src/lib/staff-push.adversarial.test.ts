import { describe, expect, it, vi } from "vitest";

// Pure checks only: no database. The pool is replaced so importing the module does not open a connection.
vi.mock("@/db", () => ({ db: {}, pool: {} }));

import { pushCapability, validPushEndpoint } from "./staff-push";

/*
 * Adversarial review of a7a7c12 (agent 6). Run (no database needed):
 *   npx vitest run src/lib/staff-push.adversarial.test.ts
 *
 * The first test is a reproduction (currently FAILS): the allow-list checks the host only, so the server will POST to any
 * path on a browser push host. The remaining tests document the checks that hold (SOUND).
 */
describe("push endpoint allow-list", () => {
  it("only accepts a real push subscription path on a browser push host (reproduction: host-only check accepts a bare host)", () => {
    expect(validPushEndpoint("https://fcm.googleapis.com/")).toBe(false);
    expect(validPushEndpoint("https://web.push.apple.com/")).toBe(false);
  });

  it("accepts the real endpoint shapes of Chrome, Safari and Firefox", () => {
    expect(validPushEndpoint("https://fcm.googleapis.com/fcm/send/abc:APA91b")).toBe(true);
    expect(validPushEndpoint("https://web.push.apple.com/QGq8abc")).toBe(true);
    expect(validPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB")).toBe(true);
  });

  it("rejects look-alike hosts, trailing-dot hosts, credentials, non-443 ports and non-HTTPS schemes (sound)", () => {
    for (const bad of [
      "https://fcm.googleapis.com./fcm/send/x",
      "https://fcm.googleapis.com.evil.test/fcm/send/x",
      "https://evil-fcm.googleapis.com.test/fcm/send/x",
      "https://web.push.apple.com.evil.test/x",
      "https://fcm.googleapis.com@evil.test/fcm/send/x",
      "https://evil.test\\@fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/fcm/send/x",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://[::1]/fcm/send/x",
      "https://localhost/fcm/send/x",
      "https://169.254.169.254/latest/meta-data",
      "https://notify.windows.com/x",
      "ftp://fcm.googleapis.com/fcm/send/x",
    ]) {
      expect(validPushEndpoint(bad), bad).toBe(false);
    }
  });

  it("refuses to offer push when the VAPID configuration is incomplete (sound)", () => {
    expect(pushCapability({})).toEqual({ available: false });
    expect(pushCapability({ VAPID_PUBLIC_KEY: "A".repeat(87), VAPID_PRIVATE_KEY: "B".repeat(43), VAPID_SUBJECT: "ops@example.test" })).toEqual({ available: false });
  });
});
