import { mkdtemp, open, rm, chmod, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DomainError } from "./loyalty";

let activeExports = 0;
/** Private request staging only: no durable artifact or second download URL. */
export async function stageCustomerExport(produce: (append: (text: string) => Promise<void>, signal: AbortSignal) => Promise<void>, signal?: AbortSignal, options: { root?: string; maxBytes?: number; deadlineMs?: number } = {}) {
  if (activeExports >= 2) throw new DomainError("EXPORT_BUSY", "Export capacity is busy; retry shortly or use the assisted request route");
  const deadlineMs=options.deadlineMs??120_000;
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>120_000)throw new Error("Invalid export deadline");
  activeExports += 1;
  let dir: string | undefined, file: Awaited<ReturnType<typeof open>> | undefined, disposed = false, size = 0;
  let producerDone=true, resourcesDone=false, released=false;
  const releaseSlot=()=>{if(producerDone&&resourcesDone&&!released){released=true;activeExports--;}};
  const production=new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, cleanup:Promise<void>|undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined, rejectInterrupted:((error:Error)=>void)|undefined;
  const dispose = ():Promise<void> => {
    if(cleanup)return cleanup;
    disposed = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
    cleanup=(async()=>{
      try { await file?.close(); } finally { try { if (dir) await rm(dir, { recursive: true }); } finally { resourcesDone=true;releaseSlot(); } }
    })();
    return cleanup;
  };
  const abort = () => {
    const error=new Error("Export interrupted");
    production.abort(error);rejectInterrupted?.(error);
    try { controller?.error(error); } catch { /* Already finished. */ }
    void dispose().catch(() => undefined);
  };
  try {
    dir = await mkdtemp(path.join(options.root ?? tmpdir(), "loynara-private-export-"));
    await chmod(dir, 0o700);
    file = await open(path.join(dir, "data.json"), "wx+", 0o600);
    // Linux/macOS retain the descriptor after unlink; abrupt exit releases storage.
    await unlink(path.join(dir, "data.json"));
    await rmdir(dir); dir = undefined;
    const interrupted=new Promise<never>((_resolve,reject)=>{rejectInterrupted=reject;});
    // Attach immediately, including for an already-aborted caller before race setup.
    void interrupted.catch(()=>undefined);
    timer = setTimeout(abort, deadlineMs); timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    if(signal?.aborted){abort();throw new Error("Export interrupted");}
    const append = async (text: string) => {
      if (disposed || production.signal.aborted) throw new Error("Export interrupted");
      const bytes = Buffer.from(text, "utf8");
      if (size + bytes.length > (options.maxBytes ?? 128 * 1024 * 1024)) throw new DomainError("EXPORT_ASSISTANCE_REQUIRED", "Export exceeds the automatic size budget; request a complete assisted export from the merchant's privacy contact");
      await file!.writeFile(bytes); size += bytes.length;
    };
    producerDone=false;
    const produced=Promise.resolve().then(()=>produce(append,production.signal)).finally(()=>{producerDone=true;releaseSlot();});
    await Promise.race([produced,interrupted]);
    if (disposed || production.signal.aborted) throw new Error("Export interrupted");
    await file.sync();
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      async pull(value) {
        try {
          if (disposed) { value.error(new Error("Export transfer interrupted")); return; }
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, size - offset)));
          const result = await file!.read(buffer, 0, buffer.length, offset);
          if (!result.bytesRead) { if (offset !== size) throw new Error("Incomplete export"); value.close(); await dispose(); return; }
          offset += result.bytesRead;
          value.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, result.bytesRead));
        } catch { try { value.error(new Error("Export transfer interrupted")); } finally { await dispose().catch(() => undefined); } }
      },
      cancel: dispose,
    });
    return { stream, size, dispose };
  } catch (error) { production.abort();await dispose(); throw error; }
}
