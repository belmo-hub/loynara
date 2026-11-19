import { describe, expect, it } from "vitest";
import { inviteReturnPath, withInviteReturn } from "./invite-return";

const token = "AbC-123_xyzAbC-123_xyzAbC-123_xyzAbC-123_x";

describe("inviteReturnPath", () => {
  it("accepts an invitation path", () => {
    expect(inviteReturnPath(`/invite/${token}`)).toBe(`/invite/${token}`);
  });

  it.each([
    null, undefined, 42, ["/invite/abc"], "", "/", "/merchant", "/merchant/program", "/invite/", "/invite",
    "https://evil.example/invite/abc", "http:/invite/abc", "javascript:alert(1)", "//evil.example/invite/abc",
    "/\\evil.example", "\\\\evil.example/invite/abc", "/invite/abc/../../merchant", "/invite/abc/extra",
    "/invite/abc?x=1", "/invite/abc#x", "/invite/%2F%2Fevil.example", "/invite/abc\n", " /invite/abc", "/Invite/abc",
    "/invite//evil.example", `/invite/${"a".repeat(129)}`,
  ])("refuses %j", (value) => {
    expect(inviteReturnPath(value)).toBeNull();
  });
});

describe("withInviteReturn", () => {
  it("carries the invitation as next, and adds nothing without one", () => {
    expect(withInviteReturn("/register", `/invite/${token}`)).toBe(`/register?next=%2Finvite%2F${token}`);
    expect(new URLSearchParams(withInviteReturn("/login", `/invite/${token}`).split("?")[1]).get("next")).toBe(`/invite/${token}`);
    expect(withInviteReturn("/login", null)).toBe("/login");
  });
});
