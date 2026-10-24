import { createHash, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { walletText } from "./content";
import type { WalletPassData, WalletProvider, WalletStatus } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PASSFAST_BASE = "https://api.passfa.st/functions/v1";
const PREFIX = "passfast:";
export type PassFastConfig = { apiKey: string; appId: string; templateId: string; platforms: WalletProvider[]; tenantId?: string; locationId?: string };
export class PassFastError extends Error {
  constructor(readonly status?: number) { super("PassFast operation failed"); this.name = "PassFastError"; }
}

export function passFastObjectId(id: string): string {
  if (!UUID.test(id)) throw new PassFastError();
  return PREFIX + id;
}
export function isPassFastObjectId(value: unknown): value is string { return typeof value === "string" && value.startsWith(PREFIX); }
export function passFastSerial(value: string): string {
  if (!isPassFastObjectId(value)) throw new PassFastError();
  const parts = value.slice(PREFIX.length).split(":");
  if (!UUID.test(parts[0]) || parts.length > 2 || (parts.length === 2 && !/^[0-9a-f]{64}$/.test(parts[1]))) throw new PassFastError();
  return parts[0];
}
/** Freeze the issuing scope in the existing opaque identity while preserving the provider's original serial. */
export function bindPassFastObjectId(id: string, config: PassFastConfig): string {
  const scope = [config.tenantId, config.locationId, config.appId, config.templateId];
  if (!scope.every(value => typeof value === "string" && UUID.test(value))) throw new PassFastError();
  const binding = createHash("sha256").update("loynara-passfast-binding-v1\0").update(scope.map(value => value!.toLowerCase()).join("\0")).digest("hex");
  return `${passFastObjectId(id)}:${binding}`;
}
/** Legacy unbound projections and operator remaps cannot authorize archive access or remote sync. */
export function assertPassFastBinding(objectId: string, config: PassFastConfig): void {
  const expected = bindPassFastObjectId(passFastSerial(objectId), config);
  const actualBytes = Buffer.from(objectId), expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) throw new PassFastError();
}

/** Operator-only allowlist: exact tenant/location scopes, distinct templates and no global fallback. */
export function tenantTemplates(raw: string | undefined): Map<string, { tenantId: string; locationId: string; templateId: string }> {
  try {
    if (!raw || raw.length > 65536) throw new PassFastError();
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || !values.length || values.length > 500) throw new PassFastError();
    const bindings = new Map<string, { tenantId: string; locationId: string; templateId: string }>(), templates = new Set<string>();
    for (const value of values) {
      const row = record(value);
      if (Object.keys(row).sort().join(",") !== "locationId,templateId,tenantId"
        || typeof row.tenantId !== "string" || !UUID.test(row.tenantId)
        || typeof row.locationId !== "string" || !UUID.test(row.locationId)
        || typeof row.templateId !== "string" || !UUID.test(row.templateId)) throw new PassFastError();
      const tenantId = row.tenantId.toLowerCase(), locationId = row.locationId.toLowerCase(), templateId = row.templateId.toLowerCase();
      const scope = `${tenantId}/${locationId}`;
      if (bindings.has(scope) || templates.has(templateId)) throw new PassFastError();
      bindings.set(scope, { tenantId, locationId, templateId }); templates.add(templateId);
    }
    return bindings;
  } catch { throw new PassFastError(); }
}
export function passFastConfig(env: Record<string, string | undefined> = process.env, tenantId?: string, locationId?: string): PassFastConfig {
  const bindings = tenantTemplates(env.PASSFAST_TENANT_TEMPLATES);
  const apiKey = env.PASSFAST_API_KEY ?? "", appId = env.PASSFAST_APP_ID ?? "";
  // Only startup validation may inspect one binding without a scope. A partial scope is always invalid.
  const unscoped = tenantId === undefined && locationId === undefined;
  const binding = unscoped ? bindings.values().next().value : tenantId && locationId ? bindings.get(`${tenantId.toLowerCase()}/${locationId.toLowerCase()}`) : undefined;
  const types = env.PASSFAST_WALLET_TYPES ?? "both";
  if (env.PASSFAST_ENABLED !== "true" || !/^sk_live_[A-Za-z0-9_-]{24,}$/.test(apiKey) || /replace|placeholder|changeme/i.test(apiKey)
    || !UUID.test(appId) || !binding || !["apple", "google", "both"].includes(types)
    || apiKey === env.BETTER_AUTH_SECRET || apiKey === env.PROMOTIONAL_UNSUBSCRIBE_SECRET
    || (env.NODE_ENV === "production" && (env.WALLET_PRODUCTION_APPROVED !== "true" || /^sk_live_(synthetic|fixture|test_|example)/i.test(apiKey)))) throw new PassFastError();
  return { apiKey, appId, ...binding, platforms: types === "both" ? ["apple", "google"] : [types as WalletProvider] };
}
export function passFastStatus(env: Record<string, string | undefined> = process.env, tenantId?: string, locationId?: string): WalletStatus {
  const enabled = env.PASSFAST_ENABLED === "true";
  if (!enabled) return { enabled: false, ready: false, reason: "PassFast is disabled" };
  try { passFastConfig(env, tenantId, locationId); return { enabled, ready: true, reason: null }; }
  catch { return { enabled, ready: false, reason: "PassFast requires valid server key, app, published location template, wallet types and production approval" }; }
}

export const PASSFAST_REQUEST_MS = 45000;
// Shared provider budget across platforms; the supervised worker separately bounds DB/startup/cleanup overhead.
export const PASSFAST_OPERATION_MS = 240000;
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new PassFastError();
  let abort!: () => void;
  const failure = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new PassFastError());
    signal.addEventListener("abort", abort, {once:true});
  });
  try { return await Promise.race([work, failure]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Exact approved-template data contract; never includes bearer, contact, tenant/member IDs, ledger or referral history. */
export type PassFastData = {
  merchantName: string; programName: string; locationName: string; locale: string; programType: string;
  balance: string; cardLocator: string; scanCode: string; rewardTitle: string; rewardCost: string; rewardReady: string;
  /** Owner message (ENG-043): Back of Pass, lock-screen notification `%@`. The last message sent to this card, resent unchanged on every refresh so a refresh never clears it or raises a banner. */
  message?: string;
};
/**
 * The `message` key exists only while WALLET_MESSAGES_ENABLED is "true", which requires every template bound in
 * PASSFAST_TENANT_TEMPLATES to have the field. Off, every payload is exactly the earlier contract.
 */
export const withPassFastMessage = (message: string, env: Record<string, string | undefined> = process.env) => env.WALLET_MESSAGES_ENABLED === "true" ? { message } : {};
export function passFastData(pass: WalletPassData, env: Record<string, string | undefined> = process.env): PassFastData {
  const rewardReady = Boolean(pass.reward && pass.balance >= pass.reward.cost);
  return { merchantName: pass.merchantName, programName: pass.programName, locationName: pass.locationName,
    locale: pass.locale, programType: pass.programType, balance: String(pass.balance), cardLocator: pass.cardLocator,
    scanCode: pass.scanCode, rewardTitle: pass.reward?.title ?? "", rewardCost: String(pass.reward?.cost ?? 0),
    rewardReady: rewardReady ? walletText(pass.locale).rewardReady : "", ...withPassFastMessage(pass.message ?? "", env) };
}
// Templates published since Oct 2026 type every data field as a string; v2 accepts both.
export const passFastVoidData = { scanCode: "", cardLocator: "", balance: "0", rewardTitle: "", rewardCost: "0", rewardReady: "" } as const satisfies Partial<PassFastData>;
/** What a retired pass is updated to before it is voided. */
export function passFastVoidPayload(brand: Pick<WalletPassData, "merchantName" | "programName" | "locationName" | "locale"> & { programType?: string }, env: Record<string, string | undefined> = process.env) {
  return { merchantName: brand.merchantName, programName: brand.programName, locationName: brand.locationName, locale: brand.locale,
    programType: brand.programType ?? "stamp", ...passFastVoidData, ...withPassFastMessage("", env) };
}

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
  constructor(readonly config: PassFastConfig, private readonly fetcher: typeof fetch = fetch, private readonly deadline = Date.now() + PASSFAST_OPERATION_MS) {}
  private path(serial: string, platform: WalletProvider, suffix = "") {
    if (!UUID.test(serial) || !["apple", "google"].includes(platform) || !this.config.platforms.includes(platform)) throw new PassFastError();
    return `/manage-passes/serial/${serial}${suffix}?wallet_type=${platform}`;
  }
  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    const remaining = Math.min(PASSFAST_REQUEST_MS, this.deadline - Date.now());
    if (remaining <= 0) throw new PassFastError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    timer.unref();
    try {
      const response = await abortable(this.fetcher(PASSFAST_BASE + path, { method, redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "X-App-Id": this.config.appId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), controller.signal);
      // The same timeout covers headers AND the entire bounded body, including a stalled stream.
      const max = response.headers.get("content-type")?.includes("application/vnd.apple.pkpass") ? 5 * 1024 * 1024 : 65536;
      const bytes = await this.bytes(response, max, controller.signal);
      return new Response(response.status === 204 || response.status === 304 ? null : new Uint8Array(bytes), { status: response.status, headers: response.headers });
    } catch { throw new PassFastError(); }
    finally { clearTimeout(timer); }
  }
  private async bytes(response: Response, max: number, signal?: AbortSignal): Promise<Buffer> {
    if (!response.body) throw new PassFastError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await (signal ? abortable(reader.read(), signal) : reader.read());
        if (done) break;
        size += value.length;
        if (size > max) throw new PassFastError();
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch {
      void reader.cancel().catch(() => {});
      throw new PassFastError();
    } finally { reader.releaseLock(); }
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
      || value.app_id !== this.config.appId || value.template_id !== this.config.templateId || value.external_id !== serial) throw new PassFastError();
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
