import { describe, expect, it } from "vitest";
import { deviceName, passkeyCancelled, passkeyName } from "./passkey-names";

describe("passkey names (Design, #349 round 2)", () => {
  it("names a passkey by its provider, otherwise by the device it was added on", () => {
    expect(passkeyName("fbfc3007-154e-4ecc-8c0b-6e020557d7bd", "iPhone")).toBe("iCloud-Schlüsselbund");
    expect(passkeyName("EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4", "")).toBe("Google Passwortmanager");
    expect(passkeyName("53414d53-554e-4700-0000-000000000000", "")).toBe("Samsung Pass");
    expect(passkeyName("bada5566-a7aa-401f-bd96-45619a55120d", "")).toBe("1Password");
    expect(passkeyName("00000000-0000-0000-0000-000000000000", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari")).toBe("Android-Handy");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe("Mac");
    expect(deviceName("")).toBe("Passkey");
  });
});

describe("a closed system prompt is silent", () => {
  it("treats the real cancel shape (passthrough with NotAllowedError) as a cancel", () => {
    const real = { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.", cause: { name: "NotAllowedError" } };
    expect(passkeyCancelled(real)).toBe(true);
    // The passkey client keeps only the code and the message.
    expect(passkeyCancelled({ code: real.code, message: real.message })).toBe(true);
    expect(passkeyCancelled({ code: "ERROR_CEREMONY_ABORTED" })).toBe(true);
  });
  it("still reports a real fault", () => {
    expect(passkeyCancelled({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "SecurityError: The operation is insecure." })).toBe(false);
    expect(passkeyCancelled({ code: "ERROR_INVALID_RP_ID", message: "x" })).toBe(false);
    expect(passkeyCancelled({ code: "PASSKEY_NOT_FOUND", message: "Passkey not found" })).toBe(false);
    expect(passkeyCancelled(null)).toBe(false);
  });
});
