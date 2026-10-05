import { afterEach, expect, it, vi } from "vitest";
import { apiJson, ClientApiError } from "./client-api";

afterEach(() => vi.unstubAllGlobals());

it("shows a German retry message for a rate-limited read without losing its status or code", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Too many requests. Please try again later.", code: "RATE_LIMIT" }, { status: 429 })));
  const error = await apiJson("/api/merchant/locations").catch(error => error);
  expect(error).toBeInstanceOf(ClientApiError);
  expect(error).toMatchObject({ status: 429, code: "RATE_LIMIT", message: "Zu viele Anfragen. Bitte warte kurz und versuche es erneut." });
});

it("preserves the server's useful explanation for other errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Keine aktive Karte gefunden.", code: "NOT_FOUND" }, { status: 404 })));
  await expect(apiJson("/api/cashier/lookup")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Keine aktive Karte gefunden." });
});
