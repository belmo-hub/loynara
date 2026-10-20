import { readFile } from "node:fs/promises";
import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from "node:http2";
import type { AppleSigningConfig } from "./apple";
import { reserveExternalServiceCall, ServiceBudgetError } from "../service-budget";

export function apnsPassUpdateRequest(passTypeId: string, pushToken: string) {
  if (!/^[a-f0-9]{32,300}$/i.test(pushToken)) throw new Error("Invalid APNs push token");
  return {
    headers: { ":method": "POST", ":path": `/3/device/${pushToken}`, "apns-topic": passTypeId, "apns-push-type": "background", "apns-priority": "5", "apns-expiration": "0" },
    body: "{}",
  };
}

type Device = { deviceId: string; pushToken: string };

export async function sendApplePassNotifications(devices: Device[], config: AppleSigningConfig): Promise<string[]> {
  if (!devices.length) return [];
  const firstRequest = apnsPassUpdateRequest(config.passTypeId, devices[0].pushToken);
  // Reserve the first notification before reading credentials or opening TLS.
  await reserveExternalServiceCall("wallet");
  let session: ClientHttp2Session | undefined;
  try {
    const active = connect("https://api.push.apple.com", { cert: await readFile(config.certPath), key: await readFile(config.keyPath), minVersion: "TLSv1.2" });
    session = active;
    active.on("error", () => undefined);
    active.setTimeout(15_000, () => active.destroy(new Error("APNs timeout")));
    await new Promise<void>((resolve, reject) => {
      active.once("connect", resolve);
      active.once("error", reject);
    });
    const invalid: string[] = [];
    for (const [index, device] of devices.entries()) {
      const { headers, body } = index === 0 ? firstRequest : apnsPassUpdateRequest(config.passTypeId, device.pushToken);
      if (index !== 0) await reserveExternalServiceCall("wallet");
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const response = await new Promise<{ status: number; reason: string | null }>((resolve, reject) => {
        const request = active.request(headers);
        let responseHeaders: IncomingHttpHeaders = {};
        let text = "";
        let bytes = 0, ended = false;
        deadline = setTimeout(() => { request.close(); reject(new Error("APNs response timeout")); }, 15_000);
        request.on("response", (value) => { responseHeaders = value; });
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk, "utf8");
          if (bytes > 4096) { request.close(); reject(new Error("APNs response exceeded limit")); return; }
          text += chunk;
        });
        request.on("end", () => {
          ended = true;
          let reason: string | null = null;
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed.reason === "string") reason = parsed.reason;
          } catch { /* APNs success has an empty body. */ }
          resolve({ status: Number(responseHeaders[":status"] ?? 0), reason });
        });
        request.on("error", reject);
        request.once("close", () => { if (!ended) reject(new Error("APNs response interrupted")); });
        request.end(body);
      }).finally(() => clearTimeout(deadline));
      if (response.status === 200) continue;
      if (response.status === 410 || (response.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(response.reason ?? ""))) {
        invalid.push(device.deviceId);
        continue;
      }
      throw new Error("APNs pass update failed");
    }
    return invalid;
  } catch (error) {
    if (error instanceof ServiceBudgetError) throw error;
    throw new Error("APNs pass update failed");
  } finally {
    session?.close();
  }
}
