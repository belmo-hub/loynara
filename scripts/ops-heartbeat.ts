export function validHeartbeatUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const supportedPath = (url.hostname === "heartbeat.uptimerobot.com" && /^\/m[A-Za-z0-9-]+$/.test(url.pathname))
      || (url.hostname === "hc-ping.com" && /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname));
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && !url.search && !url.hash && supportedPath;
  } catch { return false; }
}

export async function sendWorkerHeartbeat(value: string | undefined, request: typeof fetch = fetch, signal?: AbortSignal): Promise<boolean> {
  if (!value) return false;
  if (!validHeartbeatUrl(value)) throw new Error("Invalid worker heartbeat configuration");
  try {
    const response = await request(value, { method: "GET", signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]), redirect: "error" });
    if (!response.ok) console.error("Worker heartbeat rejected by monitor");
    return response.ok;
  } catch {
    console.error("Worker heartbeat could not reach monitor");
    return false;
  }
}
