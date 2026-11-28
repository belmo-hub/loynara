import { expect, it } from "vitest";
import { GET } from "./route";

const call = (token: string) => GET(new Request("http://localhost:3000/manifest"), { params: Promise.resolve({ token }) });

it("serves a standalone manifest per card, uncached, and 404 for anything that is not a card token", async () => {
  const token = `card_${"a".repeat(40)}`;
  const response = await call(token);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/manifest+json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ lang: "de", display: "standalone", start_url: `/card/${token}`, scope: `/card/${token}`, icons: [{ sizes: "192x192" }, { sizes: "512x512" }] });
  expect((await call("not-a-token")).status).toBe(404);
});
