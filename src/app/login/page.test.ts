import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as object | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw Object.assign(new Error("redirect"), { to }); },
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/login",
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
const { default: LoginPage } = await import("./page");

const render = async (query: Record<string, string>) => renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(query) }));
const redirected = (query: Record<string, string>) => LoginPage({ searchParams: Promise.resolve(query) }).then(() => null, (error: { to?: string }) => error.to);
const CONFIRMED = "Deine E-Mail-Adresse ist bestätigt.";

// ENG-341: the confirmation link lands on /login?verified=1 (account-verification.ts).
describe("login after the confirmation link", () => {
  beforeEach(() => { state.session = null; });

  it("says the address is confirmed, as a status, only when the link worked", async () => {
    expect(await render({ verified: "1" })).toMatch(new RegExp(`role="status"><svg[^]*?</svg>${CONFIRMED}</p>`));
    expect(await render({})).not.toContain(CONFIRMED);
    for (const verified of ["yes", "true", "0", ""]) expect(await render({ verified })).not.toContain(CONFIRMED);
    expect(await render({ verified: "1", error: "TOKEN_EXPIRED" })).not.toContain(CONFIRMED);
  });

  it("takes a signed-in owner on to the dashboard, with the link's error for the notice there", async () => {
    state.session = { user: { id: "synthetic" } };
    expect(await redirected({ verified: "1" })).toBe("/merchant");
    expect(await redirected({ verified: "1", error: "TOKEN_EXPIRED" })).toBe("/merchant?error=TOKEN_EXPIRED");
    expect(await redirected({})).toBeNull();
  });
});
