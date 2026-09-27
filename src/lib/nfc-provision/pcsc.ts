import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import path from "node:path";
import type { ApduTransport } from "./ntag";

type BridgeReply = { ready?: boolean; ok?: boolean; result?: unknown; error?: string };

export class PcscBridge implements ApduTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private pending: Array<{ resolve: (value: BridgeReply) => void; reject: (error: Error) => void }> = [];
  private reader?: string;
  private ready: Promise<void>;
  constructor(script = path.join(process.cwd(), "scripts/nfc-pcsc-bridge.py")) {
    this.child = spawn("python3", [script], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout });
    this.ready = new Promise((resolve, reject) => {
      const onReady = (line: string) => {
        try {
          const reply = JSON.parse(line) as BridgeReply;
          if (reply.ready) resolve(); else reject(new Error(reply.error ?? "PC/SC bridge failed"));
        } catch { reject(new Error("Invalid PC/SC bridge response")); }
        this.lines.off("line", onReady);
        this.lines.on("line", this.onLine);
      };
      this.lines.on("line", onReady);
      this.child.once("error", () => reject(new Error("PC/SC bridge unavailable")));
    });
    this.child.once("exit", () => {
      for (const item of this.pending.splice(0)) item.reject(new Error("PC/SC bridge stopped"));
    });
    // Never forward stderr: it could contain OS details or a future library's APDU trace.
    this.child.stderr.resume();
  }
  private onLine = (line: string) => {
    const item = this.pending.shift();
    if (!item) return;
    try { item.resolve(JSON.parse(line) as BridgeReply); }
    catch { item.reject(new Error("Invalid PC/SC bridge response")); }
  };
  private async request(operation: string, fields: Record<string, string> = {}): Promise<unknown> {
    await this.ready;
    const reply = await new Promise<BridgeReply>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(JSON.stringify({ operation, ...fields }) + "\n", error => {
        if (error) reject(new Error("PC/SC bridge write failed"));
      });
    });
    if (!reply.ok) throw new Error(reply.error ?? "PC/SC operation failed");
    return reply.result;
  }
  async readers(): Promise<string[]> { return this.request("readers") as Promise<string[]>; }
  async connect(reader: string): Promise<{ protocol: string; atr: string }> {
    const result = await this.request("connect", { reader }) as { protocol: string; atr: string };
    this.reader = reader;
    return result;
  }
  async transmit(apdu: Buffer): Promise<Buffer> {
    const result = await this.request("transmit", { apdu: apdu.toString("hex") }) as string;
    return Buffer.from(result, "hex");
  }
  async reconnect(): Promise<void> {
    if (!this.reader) throw new Error("No selected reader");
    await this.connect(this.reader);
  }
  async close(): Promise<void> {
    try { await this.request("disconnect"); } catch { /* bridge may already be gone */ }
    this.lines.close();
    this.child.kill();
  }
}
