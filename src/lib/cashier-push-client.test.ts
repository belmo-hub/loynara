import { describe, expect, it } from "vitest";
import {
  base64UrlToUint8Array,
  hasPushFeatures,
  isIosDevice,
  isStandaloneLaunch,
  isTapRefreshMessage,
  resolvePushState,
  sameApplicationServerKey,
  type PushEnvironment,
} from "@/lib/cashier-push-client";

const base: PushEnvironment = {
  featuresAvailable: true,
  ios: false,
  standalone: false,
  serverAvailable: true,
  permission: "granted",
  subscribed: false,
};

describe("base64UrlToUint8Array", () => {
  it("decodes url-safe alphabet without padding", () => {
    expect(Array.from(base64UrlToUint8Array("-_-_"))).toEqual([251, 255, 191]);
  });

  it("restores missing padding", () => {
    expect(Array.from(base64UrlToUint8Array("AQI"))).toEqual([1, 2]);
  });

  it("rejects empty, padded or standard-alphabet input", () => {
    expect(() => base64UrlToUint8Array("")).toThrow();
    expect(() => base64UrlToUint8Array("AQI=")).toThrow();
    expect(() => base64UrlToUint8Array("+/+/")).toThrow();
  });
});

describe("isIosDevice", () => {
  it("detects iPhone and iPad user agents", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", 0)).toBe(true);
  });

  it("detects iPadOS desktop-mode user agents by touch points", () => {
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
  });

  it("does not flag Android or desktop Macs", () => {
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
  });
});

describe("isStandaloneLaunch", () => {
  it("uses iOS navigator.standalone or display-mode standalone", () => {
    expect(isStandaloneLaunch({ navigatorStandalone: true, displayModeStandalone: false })).toBe(true);
    expect(isStandaloneLaunch({ navigatorStandalone: undefined, displayModeStandalone: true })).toBe(true);
    expect(isStandaloneLaunch({ navigatorStandalone: false, displayModeStandalone: false })).toBe(false);
  });
});

describe("hasPushFeatures", () => {
  const all = { serviceWorker: true, pushManager: true, notification: true, secureContext: true };

  it("requires every capability", () => {
    expect(hasPushFeatures(all)).toBe(true);
    expect(hasPushFeatures({ ...all, serviceWorker: false })).toBe(false);
    expect(hasPushFeatures({ ...all, pushManager: false })).toBe(false);
    expect(hasPushFeatures({ ...all, notification: false })).toBe(false);
    expect(hasPushFeatures({ ...all, secureContext: false })).toBe(false);
  });
});

describe("resolvePushState", () => {
  it("asks iOS Safari outside the home screen to install first", () => {
    expect(resolvePushState({ ...base, ios: true, standalone: false, featuresAvailable: false })).toBe("needs_install");
  });

  it("is unsupported without push features, also when installed on iOS without them", () => {
    expect(resolvePushState({ ...base, featuresAvailable: false })).toBe("unsupported");
    expect(resolvePushState({ ...base, ios: true, standalone: true, featuresAvailable: false })).toBe("unsupported");
  });

  it("reports unavailable when the server has no VAPID keys, regardless of permission", () => {
    expect(resolvePushState({ ...base, serverAvailable: false })).toBe("unavailable");
    expect(resolvePushState({ ...base, serverAvailable: false, permission: "denied" })).toBe("unavailable");
  });

  it("reports blocked when permission is denied", () => {
    expect(resolvePushState({ ...base, permission: "denied" })).toBe("blocked");
  });

  it("reports on only with a subscription and granted permission", () => {
    expect(resolvePushState({ ...base, subscribed: true })).toBe("on");
    expect(resolvePushState({ ...base, subscribed: true, permission: "default" })).toBe("off");
    expect(resolvePushState({ ...base, subscribed: false })).toBe("off");
    expect(resolvePushState({ ...base, subscribed: false, permission: "default" })).toBe("off");
  });
});

describe("sameApplicationServerKey", () => {
  it("compares the subscription key bytes exactly", () => {
    const key = new Uint8Array([1, 2, 3]).buffer;
    expect(sameApplicationServerKey(key, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(sameApplicationServerKey(key, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(sameApplicationServerKey(key, new Uint8Array([1, 2]))).toBe(false);
  });

  it("treats a missing key as a mismatch", () => {
    expect(sameApplicationServerKey(null, new Uint8Array([1]))).toBe(false);
    expect(sameApplicationServerKey(undefined, new Uint8Array([1]))).toBe(false);
  });
});

describe("isTapRefreshMessage", () => {
  it("accepts only the refresh message type", () => {
    expect(isTapRefreshMessage({ type: "loynara:tap-refresh" })).toBe(true);
    expect(isTapRefreshMessage({ type: "loynara:clear-tap-notifications" })).toBe(false);
    expect(isTapRefreshMessage({ type: 42 })).toBe(false);
    expect(isTapRefreshMessage("loynara:tap-refresh")).toBe(false);
    expect(isTapRefreshMessage(null)).toBe(false);
    expect(isTapRefreshMessage(undefined)).toBe(false);
  });
});
