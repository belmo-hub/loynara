export function validHeartbeatUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "heartbeat.uptimerobot.com"
      && !url.username && !url.password && !url.search && !url.hash && /^\/m[A-Za-z0-9-]+$/.test(url.pathname);
  } catch { return false; }
}

export async function sendWorkerHeartbeat(value: string | undefined, request: typeof fetch = fetch): Promise<void> {
  if (!value) return;
  if (!validHeartbeatUrl(value)) throw new Error("Invalid worker heartbeat configuration");
  try {
    const response = await request(value, { method: "GET", signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) console.error("Worker heartbeat rejected by monitor");
  } catch {
    console.error("Worker heartbeat could not reach monitor");
  }
}
