import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ auth: {} }));
beforeEach(() => {
  vi.resetModules();
  Reflect.deleteProperty(globalThis, Symbol.for("loynara.invalid-ingress.next-signal-at"));
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, Symbol.for("loynara.invalid-ingress.next-signal-at"));
});
it("returns generic retryable ingress failure without changing ordinary domain errors", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { respondError } = await import("./http");
  const { InvalidIngressError } = await import("./rate-limit");
  const { DomainError } = await import("./loyalty");
  const error = new InvalidIngressError();
  error.message = "sensitive diagnostic must not reach client";
  const response = respondError(error);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "Service unavailable" });
  const ordinary = respondError(new DomainError("INVALID_JSON", "Invalid JSON"));
  expect(ordinary.status).toBe(400);
  expect(await ordinary.json()).toEqual({ code: "INVALID_JSON", error: "Invalid JSON" });
});
it("bounds the constant operational signal to one per minute per process", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { InvalidIngressError } = await import("./rate-limit");
  for (let i = 0; i < 32; i++) new InvalidIngressError();
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenLastCalledWith('{"event":"invalid_ingress"}');
  vi.resetModules();
  const reloaded = await import("./rate-limit");
  new reloaded.InvalidIngressError();
  expect(log).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(60_999);
  new InvalidIngressError();
  expect(log).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(61_000);
  new InvalidIngressError();
  expect(log).toHaveBeenCalledTimes(2);
  expect(log.mock.calls.flat()).toEqual(['{"event":"invalid_ingress"}', '{"event":"invalid_ingress"}']);
});
