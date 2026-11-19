// The only page sign-in or sign-up may return to: an invitation, as a same-origin path. Anything else (a URL, "//host",
// a backslash, an encoded character, any other path) is refused, so the parameter cannot become an open redirect.
const invitePath = /^\/invite\/[A-Za-z0-9_-]{1,128}$/;

export function inviteReturnPath(value: unknown): string | null {
  return typeof value === "string" && invitePath.test(value) ? value : null;
}

/** The sign-in or sign-up link that brings the visitor back to this invitation afterwards. */
export function withInviteReturn(page: "/login" | "/register", next: string | null) {
  return next ? `${page}?next=${encodeURIComponent(next)}` : page;
}
