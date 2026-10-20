import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendApplePassNotifications } from "./apple-push";
import { ServiceBudgetError } from "../service-budget";
import type { AppleSigningConfig } from "./apple";

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), connect: vi.fn(), reserve: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("node:http2", () => ({ connect: mocks.connect }));
vi.mock("../service-budget", () => ({
  reserveExternalServiceCall: mocks.reserve,
  ServiceBudgetError: class extends Error { constructor() { super("Optional service temporarily unavailable"); } },
}));

const config: AppleSigningConfig = {
  certPath: "/synthetic/cert.pem", keyPath: "/synthetic/key.pem", wwdrPath: "/synthetic/wwdr.pem",
  passTypeId: "pass.test.synthetic", teamId: "ABCDE12345", authSecret: "synthetic-only-secret-long-enough",
  webServiceUrl: "https://wallet.example.test/api/apple",
};
const devices = [{ deviceId: "device-one", pushToken: "a".repeat(64) }, { deviceId: "device-two", pushToken: "b".repeat(64) }];
type Reply = { status: number; chunks?: string[]; error?: string; hang?: boolean };
function transport(replies: Reply[], connectionError?: string) {
  const sent: Array<{ headers: Record<string, string>; body?: string }> = [];
  const closedRequests: boolean[] = [];
  const session = Object.assign(new EventEmitter(), {
    setTimeout: vi.fn(), close: vi.fn(), destroy: vi.fn(),
    request(headers: Record<string, string>) {
      const index = sent.length;
      const reply = replies[index];
      sent.push({ headers });
      const request = Object.assign(new EventEmitter(), {
        setEncoding: vi.fn(), close: () => { closedRequests[index] = true; },
        end(body: string) {
          sent[index].body = body;
          queueMicrotask(() => {
            if (reply.hang) return;
            if (reply.error) { request.emit("error", new Error(reply.error)); return; }
            request.emit("response", { ":status": reply.status });
            for (const chunk of reply.chunks ?? []) {
              if (closedRequests[index]) return;
              request.emit("data", chunk);
            }
            if (!closedRequests[index]) request.emit("end");
          });
        },
      });
      return request;
    },
  });
  mocks.connect.mockImplementation(() => {
    queueMicrotask(() => session.emit(connectionError ? "error" : "connect", ...(connectionError ? [new Error(connectionError)] : [])));
    return session;
  });
  return { sent, session, closedRequests };
}

beforeEach(() => { mocks.readFile.mockResolvedValue(Buffer.from("synthetic")); mocks.reserve.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it("refuses an exhausted Wallet budget before reading credentials or opening an APNs connection", async () => {
  const api = transport([{ status: 200 }]);
  mocks.reserve.mockRejectedValue(new ServiceBudgetError());
  await expect(sendApplePassNotifications([devices[0]], config)).rejects.toThrow("Optional service temporarily unavailable");
  expect(mocks.readFile).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(api.sent).toEqual([]);
});

it("charges each device and stops before sending a second notification after exhaustion", async () => {
  const api = transport([{ status: 200 }, { status: 200 }]);
  mocks.reserve.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ServiceBudgetError());
  await expect(sendApplePassNotifications(devices, config)).rejects.toThrow("Optional service temporarily unavailable");
  expect(api.sent).toHaveLength(1);
  expect(api.sent[0]).toMatchObject({ headers: { ":path": `/3/device/${devices[0].pushToken}` }, body: "{}" });
  expect(api.session.close).toHaveBeenCalledOnce();
});

it("preserves invalid-device cleanup and sends only one budgeted empty notification per device", async () => {
  const api = transport([{ status: 200 }, { status: 410, chunks: ['{"reason":"Unregistered"}'] }]);
  expect(await sendApplePassNotifications(devices, config)).toEqual(["device-two"]);
  expect(mocks.reserve.mock.calls).toEqual([["wallet"], ["wallet"]]);
  expect(api.sent.map(call => call.body)).toEqual(["{}", "{}"]);
  expect(api.session.close).toHaveBeenCalledOnce();
});

it("rejects an invalid token before spending allowance or opening a connection", async () => {
  transport([{ status: 200 }]);
  await expect(sendApplePassNotifications([{ deviceId: "invalid", pushToken: "invalid" }], config)).rejects.toThrow();
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});

it.each(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"])("recognizes the allowlisted 400 reason %s without exposing provider text", async reason => {
  transport([{ status: 400, chunks: [JSON.stringify({ reason })] }]);
  expect(await sendApplePassNotifications([devices[0]], config)).toEqual(["device-one"]);
});

it("withholds an unknown APNs response reason from its rejection", async () => {
  transport([{ status: 500, chunks: ['{"reason":"synthetic-secret-provider-text"}'] }]);
  await expect(sendApplePassNotifications([devices[0]], config)).rejects.toThrow(/^APNs pass update failed$/);
});

it.each([
  { label: "one large chunk", chunks: ["x".repeat(5000)] },
  { label: "many small chunks", chunks: Array.from({ length: 10 }, () => "x".repeat(500)) },
])("refuses an oversized aggregate response without buffering it indefinitely ($label)", async ({ chunks }) => {
  const api = transport([{ status: 200, chunks }]);
  await expect(sendApplePassNotifications([devices[0]], config)).rejects.toThrow(/^APNs pass update failed$/);
  expect(api.closedRequests).toEqual([true]);
  expect(api.session.close).toHaveBeenCalledOnce();
});

it.each(["connection", "request"])("withholds raw %s errors and closes the session", async kind => {
  const api = transport([{ status: 0, error: kind === "request" ? "synthetic-secret-request" : undefined }], kind === "connection" ? "synthetic-secret-connection" : undefined);
  await expect(sendApplePassNotifications([devices[0]], config)).rejects.toThrow(/^APNs pass update failed$/);
  expect(api.session.close).toHaveBeenCalledOnce();
});

it("bounds a response that never ends and closes the request without exposing transport details", async () => {
  vi.useFakeTimers();
  const api = transport([{ status: 200, hang: true }]);
  const pending = expect(sendApplePassNotifications([devices[0]], config)).rejects.toThrow(/^APNs pass update failed$/);
  await vi.advanceTimersByTimeAsync(15_000);
  await pending;
  expect(api.closedRequests).toEqual([true]);
  expect(api.session.close).toHaveBeenCalledOnce();
});

it("does nothing for an empty device set", async () => {
  expect(await sendApplePassNotifications([], config)).toEqual([]);
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});
