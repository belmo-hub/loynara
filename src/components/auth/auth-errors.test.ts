import { describe, expect, it } from "vitest";
import { ClientApiError } from "@/components/client-api";
import { CONNECTION_LOST, inviteAcceptMessage, signUpMessage } from "./auth-errors";

const english = /registration|invitation|invalid|enabled|sign in|already/i;

describe("sign-up messages", () => {
  it("never repeat the library's text", () => {
    for (const error of [
      { status: 403, message: "Registration is not enabled" },
      { status: 422, code: "USER_ALREADY_EXISTS", message: "User already exists" },
      { status: 400, code: "PASSWORD_TOO_SHORT", message: "Password too short" },
      { status: 400, message: "Invalid email" },
      { status: 500, message: "Internal Server Error" },
      { status: 429, message: "Too many requests" },
    ]) for (const via of ["register", "invite"] as const) expect(signUpMessage(error, via)).not.toMatch(english);
  });

  it("tell an invited person whose invitation stopped working to ask for a new one", () => {
    expect(signUpMessage({ status: 403, message: "Registration is not enabled" }, "invite")).toContain("neue Einladung");
    expect(signUpMessage({ status: 403, message: "Registration is not enabled" }, "register")).toContain("Registrierung ist noch nicht freigeschaltet");
  });

  it("send someone who already has an account to the sign-in", () => {
    expect(signUpMessage({ status: 422, code: "USER_ALREADY_EXISTS" }, "invite")).toContain("Melde dich an");
  });
});

describe("invitation acceptance messages", () => {
  it.each([
    ["INVALID_INVITE", 400, "neue Einladung"],
    ["INVITE_USED", 409, "schon angenommen"],
    ["UNAUTHENTICATED", 401, "Melde dich zuerst an"],
    ["INVITE_EMAIL_MISMATCH", 403, "anderen Adresse"],
    ["ALREADY_ASSIGNED", 409, "gehört schon zu einem Geschäft"],
  ])("%s says what to do", (code, status, text) => {
    const message = inviteAcceptMessage(new ClientApiError(status, "Invitation is invalid or expired", code));
    expect(message).toContain(text);
    expect(message).not.toMatch(english);
  });

  it("treat a lost connection as a lost connection", () => {
    expect(inviteAcceptMessage(new ClientApiError(0, "Keine Verbindung."))).toBe(CONNECTION_LOST);
    expect(inviteAcceptMessage(new TypeError("Failed to fetch"))).toBe(CONNECTION_LOST);
  });
});
