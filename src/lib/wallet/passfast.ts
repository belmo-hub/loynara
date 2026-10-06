import { inflateRawSync } from "node:zlib";
import type { WalletPassData, WalletProvider, WalletStatus } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE = "https://api.passfa.st/functions/v1";
const PREFIX = "passfast:";
export type PassFastConfig = { apiKey: string; appId: string; templateId: string; platforms: WalletProvider[] };
export class PassFastError extends Error {
  constructor(readonly status?: number) { super("PassFast operation failed"); this.name = "PassFastError"; }
}

export function passFastObjectId(id: string): string {
  if (!UUID.test(id)) throw new PassFastError();
  return PREFIX + id;
}
export function isPassFastObjectId(value: unknown): value is string { return typeof value === "string" && value.startsWith(PREFIX); }
export function passFastSerial(value: string): string {
  if (!isPassFastObjectId(value) || !UUID.test(value.slice(PREFIX.length))) throw new PassFastError();
  return value.slice(PREFIX.length);
}

export function passFastConfig(env: Record<string, string | undefined> = process.env): PassFastConfig {
  const apiKey = env.PASSFAST_API_KEY ?? "", appId = env.PASSFAST_APP_ID ?? "", templateId = env.PASSFAST_TEMPLATE_ID ?? "";
  const types = env.PASSFAST_WALLET_TYPES ?? "both";
  if (env.PASSFAST_ENABLED !== "true" || !/^sk_live_[A-Za-z0-9_-]{24,}$/.test(apiKey) || /replace|placeholder|changeme/i.test(apiKey)
    || !UUID.test(appId) || !UUID.test(templateId) || !["apple", "google", "both"].includes(types)
    || apiKey === env.BETTER_AUTH_SECRET || apiKey === env.PROMOTIONAL_UNSUBSCRIBE_SECRET
    || (env.NODE_ENV === "production" && (env.WALLET_PRODUCTION_APPROVED !== "true" || /^sk_live_(synthetic|fixture|test_|example)/i.test(apiKey)))) throw new PassFastError();
  return { apiKey, appId, templateId, platforms: types === "both" ? ["apple", "google"] : [types as WalletProvider] };
}
export function passFastStatus(env: Record<string, string | undefined> = process.env): WalletStatus {
  const enabled = env.PASSFAST_ENABLED === "true";
  if (!enabled) return { enabled: false, ready: false, reason: "PassFast is disabled" };
  try { passFastConfig(env); return { enabled, ready: true, reason: null }; }
  catch { return { enabled, ready: false, reason: "PassFast requires valid server key, app, published template, wallet types and production approval" }; }
}

/** Exact approved-template data contract; never includes bearer, contact, tenant/member IDs, ledger or referral history. */
export function passFastData(pass: WalletPassData): Record<string, string | number | boolean> {
  return { merchantName: pass.merchantName, programName: pass.programName, locationName: pass.locationName,
    locale: pass.locale, programType: pass.programType, balance: pass.balance, cardLocator: pass.cardLocator,
    scanCode: pass.scanCode, rewardTitle: pass.reward?.title ?? "", rewardCost: pass.reward?.cost ?? 0,
    rewardReady: Boolean(pass.reward && pass.balance >= pass.reward.cost) };
}
export const passFastVoidData = { scanCode: "", cardLocator: "", balance: 0, rewardTitle: "", rewardCost: 0, rewardReady: false } as const;

type RemotePass = { id: string; status: "active" | "invalidated" | "expired"; saveUrl?: string };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PassFastError();
  return value as Record<string, unknown>;
};
function saveUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 16384) throw new PassFastError();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "pay.google.com" || !url.pathname.startsWith("/gp/v/save/") || url.username || url.password || url.hash) throw new PassFastError();
    return value;
  } catch { throw new PassFastError(); }
}

/** Bounded in-memory pass.json inspection for ambiguous Apple void acknowledgement; no filesystem or signing tools.
 * Provider TLS/authentication supplies provenance. This checks archive content, not CMS/real-device acceptance.
 */
function voidedAppleArchive(bytes: Buffer, serial: string): boolean {
  try {
    let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
      if(bytes.readUInt32LE(i)===0x06054b50 && i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
    }
    if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0) return false;
    const count=bytes.readUInt16LE(end+10), offset=bytes.readUInt32LE(end+16), size=bytes.readUInt32LE(end+12);
    if(!count || count>128 || bytes.readUInt16LE(end+8)!==count || offset+size!==end) return false;
    let pos=offset, pass: Record<string,unknown>|undefined;
    for(let i=0;i<count;i++) {
      if(pos+46>end || bytes.readUInt32LE(pos)!==0x02014b50) return false;
      const flags=bytes.readUInt16LE(pos+8), method=bytes.readUInt16LE(pos+10), packed=bytes.readUInt32LE(pos+20), plain=bytes.readUInt32LE(pos+24);
      const length=bytes.readUInt16LE(pos+28), next=pos+46+length+bytes.readUInt16LE(pos+30)+bytes.readUInt16LE(pos+32);
      if(next>end) return false;
      if(bytes.toString("utf8",pos+46,pos+46+length)==="pass.json") {
        if(pass || flags&1 || ![0,8].includes(method) || plain>65536 || packed>5*1024*1024) return false;
        const local=bytes.readUInt32LE(pos+42);
        if(local+30>offset || bytes.readUInt32LE(local)!==0x04034b50 || bytes.readUInt16LE(local+6)!==flags || bytes.readUInt16LE(local+8)!==method) return false;
        const nameLength=bytes.readUInt16LE(local+26), start=local+30+nameLength+bytes.readUInt16LE(local+28);
        if(start+packed>offset || bytes.toString("utf8",local+30,local+30+nameLength)!=="pass.json") return false;
        const content=method===0?bytes.subarray(start,start+packed):inflateRawSync(bytes.subarray(start,start+packed),{maxOutputLength:65536});
        if(content.length!==plain) return false;
        let crc=0xffffffff;
        for(const byte of content){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
        if(((crc^0xffffffff)>>>0)!==bytes.readUInt32LE(pos+16)) return false;
        pass=record(JSON.parse(content.toString("utf8")));
      }
      pos=next;
    }
    if(pos!==end || !pass || pass.serialNumber!==serial || pass.voided!==true) return false;
    if(pass.barcode!==undefined && record(pass.barcode).message!=="") return false;
    if(pass.barcodes!==undefined && (!Array.isArray(pass.barcodes) || pass.barcodes.some(value=>record(value).message!==""))) return false;
    return true;
  } catch { return false; }
}

/** Official API reference: /generate-pass and /manage-passes/serial/{serial}, with explicit wallet_type on every operation.
 * No alternate credential destination, redirects, provider logs, browser-side secret or invented idempotency header.
 */
export class PassFastClient {
  constructor(readonly config: PassFastConfig, private readonly fetcher: typeof fetch = fetch) {}
  private path(serial: string, platform: WalletProvider, suffix = "") {
    if (!UUID.test(serial) || !["apple", "google"].includes(platform)) throw new PassFastError();
    return `/manage-passes/serial/${serial}${suffix}?wallet_type=${platform}`;
  }
  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    try {
      return await this.fetcher(BASE + path, { method, redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "X-App-Id": this.config.appId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new PassFastError(); }
  }
  private async bytes(response: Response, max: number): Promise<Buffer> {
    if (!response.body) throw new PassFastError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) { await reader.cancel(); throw new PassFastError(); }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch { throw new PassFastError(); }
  }
  private async json(response: Response): Promise<Record<string, unknown>> {
    if (!response.headers.get("content-type")?.includes("application/json")) throw new PassFastError();
    try { return record(JSON.parse((await this.bytes(response, 65536)).toString("utf8"))); }
    catch { throw new PassFastError(); }
  }
  private async archive(response: Response): Promise<Buffer> {
    if (!response.headers.get("content-type")?.includes("application/vnd.apple.pkpass")) throw new PassFastError();
    const bytes = await this.bytes(response, 5 * 1024 * 1024);
    if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw new PassFastError();
    return bytes;
  }
  async get(serial: string, platform: WalletProvider): Promise<RemotePass | null> {
    const response = await this.request(this.path(serial, platform));
    if (response.status === 404) return null;
    if (!response.ok) throw new PassFastError(response.status);
    const value = await this.json(response);
    if (typeof value.id !== "string" || !UUID.test(value.id) || value.serial_number !== serial || value.wallet_type !== platform
      || !["active", "invalidated", "expired"].includes(String(value.status))
      || (value.app_id !== undefined && value.app_id !== this.config.appId)) throw new PassFastError();
    return { id: value.id, status: value.status as RemotePass["status"],
      ...(platform === "google" && value.status === "active" ? { saveUrl: saveUrl(value.google_save_url) } : {}) };
  }
  async generate(serial: string, platform: WalletProvider, data: Record<string, unknown>): Promise<void> {
    if (!this.config.platforms.includes(platform)) throw new PassFastError();
    this.path(serial, platform);
    const response = await this.request("/generate-pass", "POST", { template_id: this.config.templateId, serial_number: serial,
      external_id: serial, wallet_type: platform, data, get_or_create: true });
    if (![200, 201].includes(response.status)) throw new PassFastError(response.status);
    if (platform === "apple") await this.archive(response);
    else saveUrl((await this.json(response)).save_url);
  }
  async update(serial: string, platform: WalletProvider, data: Record<string, unknown>): Promise<void> {
    const response = await this.request(this.path(serial, platform), "PATCH", { data, push_update: true });
    if (!response.ok) throw new PassFastError(response.status);
    const value = await this.json(response);
    if (value.status !== "active" || typeof value.id !== "string" || !UUID.test(value.id) || (value.wallet_type !== undefined && value.wallet_type !== platform)) throw new PassFastError();
  }
  async void(serial: string, platform: WalletProvider): Promise<void> {
    const response = await this.request(this.path(serial, platform, "/void"), "POST");
    if (response.status !== 200 && response.status !== 409) throw new PassFastError(response.status);
    let rebuilt = false;
    if (response.status === 200) {
      const value = await this.json(response);
      if (value.status !== "invalidated") throw new PassFastError();
      rebuilt = value.pkpass_rebuilt === true;
    }
    const current = await this.get(serial, platform);
    if (current?.status !== "invalidated") throw new PassFastError();
    if (platform === "apple" && !rebuilt && !voidedAppleArchive(await this.download(serial), serial)) {
      // Missing/stale proof remains pending for bounded retry/operator attention. Never regenerate a retired serial.
      throw new PassFastError();
    }
  }
  async download(serial: string): Promise<Buffer> {
    const response = await this.request(this.path(serial, "apple", "/download"));
    if (!response.ok) throw new PassFastError(response.status);
    return this.archive(response);
  }
}
