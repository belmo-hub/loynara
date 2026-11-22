import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionUser, enforcePeerLimit, enforceRateLimit, maySetUpShop, assertPlateOperator } = vi.hoisted(() => ({ sessionUser: vi.fn(), enforcePeerLimit: vi.fn(), enforceRateLimit: vi.fn(), maySetUpShop: vi.fn(), assertPlateOperator: vi.fn() }));
vi.mock("@/lib/http", () => ({
  sessionUser,
  requireSameOrigin: (request: Request) => { if (request.headers.get("origin") !== new URL(request.url).origin) throw Object.assign(new Error("origin"), { code: "INVALID_ORIGIN" }); },
  jsonBody: async (request: Request) => request.json(),
  respondError: (cause: { code?: string }) => Response.json({ code: cause.code }, { status: cause.code === "UNAUTHENTICATED" ? 401 : cause.code === "INVALID_ORIGIN" || cause.code === "FORBIDDEN" ? 403 : cause.code === "RATE_LIMIT" ? 429 : 400 }),
}));
vi.mock("@/lib/product", () => ({ maySetUpShop }));
vi.mock("@/lib/plates", () => ({ assertPlateOperator }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ enforcePeerLimit, enforceRateLimit }));

import { POST as search } from "./route";
import { POST as locate } from "../place-location/route";

const TOKEN = "3f2b8c1e-5a7d-4e9f-8b6a-1c2d3e4f5a6b";
const call = (route: typeof search, path: string, body: unknown, origin = "http://localhost:3000") =>
  route(new Request(`http://localhost:3000/api/merchant/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
const google = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser.mockResolvedValue({ id: "synthetic-owner", email: "owner@example.test" });
  maySetUpShop.mockResolvedValue(true);
  assertPlateOperator.mockRejectedValue(Object.assign(new Error("not the operator"), { code: "FORBIDDEN" }));
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "synthetic-test-key");
  vi.stubGlobal("fetch", google);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("place search route", () => {
  it("sends Google only the text and session token, restricted to Germany in German, and returns at most five suggestions", async () => {
    const prediction = (n: number) => ({ placePrediction: { placeId: `place_${n}`, structuredFormat: { mainText: { text: `Café ${n}` }, secondaryText: { text: "Kassel" } } } });
    google.mockResolvedValueOnce(Response.json({ suggestions: [1, 2, 3, 4, 5, 6].map(prediction) }));
    const response = await call(search, "place-search", { text: " Café am Platz ", sessionToken: TOKEN });
    expect(response.status).toBe(200);
    expect((await response.json()).suggestions).toEqual([1, 2, 3, 4, 5].map(n => ({ id: `place_${n}`, main: `Café ${n}`, secondary: "Kassel" })));
    const [url, init] = google.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(JSON.parse(String(init?.body))).toEqual({ input: "Café am Platz", sessionToken: TOKEN, includedRegionCodes: ["de"], regionCode: "de", languageCode: "de" });
    // Exactly these headers: no cookie, no forwarded IP, nothing about the owner (Legal § 4.2).
    expect(init?.headers).toEqual({ "Content-Type": "application/json", "X-Goog-Api-Key": "synthetic-test-key", "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat" });
    expect(JSON.stringify(init)).not.toMatch(/synthetic-owner|owner@example/);
    expect(enforcePeerLimit).toHaveBeenCalledWith(expect.any(Request), "place_search_peer", 240, 900);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: "place_search_user", identity: "synthetic-owner" }));
  });

  it("refuses another origin, a missing session and a spent rate limit before Google is asked", async () => {
    expect((await call(search, "place-search", { text: "Café", sessionToken: TOKEN }, "https://evil.example")).status).toBe(403);
    sessionUser.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    expect((await call(search, "place-search", { text: "Café", sessionToken: TOKEN })).status).toBe(401);
    enforceRateLimit.mockRejectedValueOnce({ code: "RATE_LIMIT" });
    expect((await call(search, "place-search", { text: "Café", sessionToken: TOKEN })).status).toBe(429);
    expect((await call(search, "place-search", { text: "Café", sessionToken: "x" })).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });

  it("is only for an account that may set up a shop now (review F-1)", async () => {
    maySetUpShop.mockResolvedValue(false);
    expect((await call(search, "place-search", { text: "Café", sessionToken: TOKEN })).status).toBe(403);
    expect((await call(locate, "place-location", { placeId: "place_1", sessionToken: TOKEN })).status).toBe(403);
    expect(maySetUpShop).toHaveBeenCalledWith("synthetic-owner");
    expect(google).not.toHaveBeenCalled();
    // The operator sets a shop's point in the console through the same routes (ENG-331).
    assertPlateOperator.mockResolvedValue(undefined);
    google.mockResolvedValueOnce(Response.json({ suggestions: [] })).mockResolvedValueOnce(Response.json({ location: { latitude: 51.3, longitude: 9.4 } }));
    expect((await call(search, "place-search", { text: "Café", sessionToken: TOKEN })).status).toBe(200);
    expect((await call(locate, "place-location", { placeId: "place_1", sessionToken: TOKEN })).status).toBe(200);
    expect(assertPlateOperator).toHaveBeenCalledWith({}, "synthetic-owner", process.env);
  });

  it("is not offered without the key, and a Google failure is a calm 502", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    expect((await call(search, "place-search", { text: "Café", sessionToken: TOKEN })).status).toBe(404);
    expect((await call(locate, "place-location", { placeId: "place_1", sessionToken: TOKEN })).status).toBe(404);
    expect(google).not.toHaveBeenCalled();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "synthetic-test-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const timeout = vi.spyOn(AbortSignal, "timeout");
    google.mockResolvedValueOnce(new Response("quota", { status: 429 })).mockRejectedValueOnce(new Error("offline"));
    expect((await call(search, "place-search", { text: "Café am Platz", sessionToken: TOKEN })).status).toBe(502);
    expect((await call(locate, "place-location", { placeId: "place_1", sessionToken: TOKEN })).status).toBe(502);
    expect(timeout.mock.calls).toEqual([[5_000], [5_000]]);
    // The status only: never the text, the place or the user.
    expect(warn.mock.calls).toEqual([["Google Places answered 429"], ["Google Places unreachable"]]);
    warn.mockRestore(); timeout.mockRestore();
  });
});

describe("place location route", () => {
  it("asks Place Details for the location field only and returns latitude and longitude", async () => {
    google.mockResolvedValueOnce(Response.json({ location: { latitude: 51.3127, longitude: 9.4797 } }));
    const response = await call(locate, "place-location", { placeId: "ChIJ_synthetic-1", sessionToken: TOKEN });
    expect(await response.json()).toEqual({ latitude: 51.3127, longitude: 9.4797 });
    const [url, init] = google.mock.calls[0];
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJ_synthetic-1?sessionToken=${TOKEN}`);
    expect(init?.headers).toEqual({ "X-Goog-Api-Key": "synthetic-test-key", "X-Goog-FieldMask": "location" });
    expect(enforcePeerLimit).toHaveBeenCalledWith(expect.any(Request), "place_location_peer", 60, 900);
    expect(enforceRateLimit).toHaveBeenCalledWith({ scope: "place_location_user", identity: "synthetic-owner", max: 30, windowSeconds: 900 });
  });

  it("refuses a place id that could leave the path and an answer without a usable point", async () => {
    expect((await call(locate, "place-location", { placeId: "../places:autocomplete", sessionToken: TOKEN })).status).toBe(400);
    expect((await call(locate, "place-location", { placeId: "a", sessionToken: TOKEN }, "https://evil.example")).status).toBe(403);
    expect(google).not.toHaveBeenCalled();
    google.mockResolvedValueOnce(Response.json({ location: { latitude: 91, longitude: 0 } }));
    expect((await call(locate, "place-location", { placeId: "a", sessionToken: TOKEN })).status).toBe(502);
  });
});
