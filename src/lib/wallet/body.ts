import { DomainError } from "@/lib/loyalty";
import { WalletOperationTimeout } from "./database";

/** Small same-origin Wallet bodies have the same wall-clock deadline as DB work; cancel stalled uploads. */
export async function walletJsonBody(request: Request, deadline: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DomainError("INVALID_CONTENT_TYPE", "Expected JSON");
  if (Number(request.headers.get("content-length")) > 1000) throw new DomainError("TOO_LARGE", "Request too large");
  if (deadline <= Date.now()) throw new WalletOperationTimeout();
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_JSON", "Invalid JSON");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new WalletOperationTimeout()); }, deadline - Date.now()); });
  const parse = (async () => {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const {done,value} = await reader.read(); if(done) break;
      size += value.byteLength;
      if(size > 1000) { void reader.cancel().catch(() => {}); throw new DomainError("TOO_LARGE", "Request too large"); }
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks,size))) as unknown; }
    catch { throw new DomainError("INVALID_JSON", "Invalid JSON"); }
  })();
  try { return await Promise.race([parse,timeout]); }
  finally { if(timer) clearTimeout(timer); reader.releaseLock(); }
}
