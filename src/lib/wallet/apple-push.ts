import { readFile } from "node:fs/promises";
import { connect, type IncomingHttpHeaders } from "node:http2";
import type { AppleSigningConfig } from "./apple";

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
  const session = connect("https://api.push.apple.com", { cert: await readFile(config.certPath), key: await readFile(config.keyPath), minVersion: "TLSv1.2" });
  session.setTimeout(15_000, () => session.destroy(new Error("APNs timeout")));
  try {
    await new Promise<void>((resolve, reject) => {
      session.once("connect", resolve);
      session.once("error", reject);
    });
    const invalid: string[] = [];
    for (const device of devices) {
      const { headers, body } = apnsPassUpdateRequest(config.passTypeId, device.pushToken);
      const response = await new Promise<{ status: number; reason: string | null }>((resolve, reject) => {
        const request = session.request(headers);
        let responseHeaders: IncomingHttpHeaders = {};
        let text = "";
        request.on("response", (value) => { responseHeaders = value; });
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { text += chunk.slice(0, 1000); });
        request.on("end", () => {
          let reason: string | null = null;
          try { reason = JSON.parse(text).reason ?? null; } catch { /* APNs success has an empty body. */ }
          resolve({ status: Number(responseHeaders[":status"] ?? 0), reason });
        });
        request.on("error", reject);
        request.end(body);
      });
      if (response.status === 200) continue;
      if (response.status === 410 || (response.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(response.reason ?? ""))) {
        invalid.push(device.deviceId);
        continue;
      }
      throw new Error(`APNs pass update rejected (${response.status}, ${response.reason ?? "unknown"})`);
    }
    return invalid;
  } finally {
    session.close();
  }
}
