import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { DevelopmentKeys } from "./ntag";

export function assertProvisioningEnvironment(env: Record<string, string | undefined>, origin: string): void {
  if (env.NODE_ENV === "production") throw new Error("NFC operator CLI refuses production mode");
  if (!env.DATABASE_URL) throw new Error("Dedicated local or device-test database required");
  const url = new URL(env.DATABASE_URL);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.search || url.hash || url.pathname !== "/looplocal_device_test" || url.port !== "54331" || url.username !== "looplocal_device" || !/^[0-9a-f]{64}$/.test(env.DEVICE_TEST_DB_PASSWORD ?? "") || url.password !== env.DEVICE_TEST_DB_PASSWORD) {
    throw new Error("NFC provisioning requires the isolated loopback device-test database");
  }
  if (origin !== "https://preview.getloynara.com" || env.PUBLIC_BASE_URL !== origin || env.BETTER_AUTH_URL !== origin || env.DEVICE_TEST_APPROVED_ORIGIN !== origin) throw new Error("Approved HTTPS origin mismatch");
  for (const name of ["PUBLIC_REGISTRATION_ENABLED", "EXTERNAL_EMAIL_ENABLED", "LIVE_BILLING_ENABLED", "APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED"]) {
    if (env[name] !== "false") throw new Error(`${name} must be disabled for NFC development provisioning`);
  }
}

type Entry = { classification: "DEVELOPMENT_ONLY"; uid: string; key0: string; fileReadKey: string; metaReadKey: string; key3: string; key4: string };
export class DevelopmentKeyStore {
  constructor(readonly filename = path.resolve("var/nfc-development-keys.json")) {
    const root = path.resolve("var") + path.sep;
    if (!filename.startsWith(root)) throw new Error("Development key store must remain in ignored var/");
  }
  async save(ref: string, uid: string, keys: DevelopmentKeys): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(ref) || !/^[a-f0-9]{14}$/.test(uid)) throw new Error("Invalid key metadata");
    await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    let entries: Record<string, Entry> = {};
    try {
      const details = await lstat(this.filename);
      if (!details.isFile() || (details.mode & 0o077) !== 0) throw new Error("Development key store is not a restricted regular file");
      entries = JSON.parse(await readFile(this.filename, "utf8")) as Record<string, Entry>;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (entries[ref]) throw new Error("Development key reference already exists");
    const incoming = Object.values(keys).map(key => key.toString("hex"));
    const existing = new Set(Object.values(entries).flatMap(entry => [entry.key0, entry.fileReadKey, entry.metaReadKey, entry.key3, entry.key4]));
    if (new Set(incoming).size !== 5 || incoming.some(value => existing.has(value))) throw new Error("Development key collision or reuse refused");
    entries[ref] = { classification: "DEVELOPMENT_ONLY", uid, key0: keys.key0.toString("hex"), fileReadKey: keys.fileReadKey.toString("hex"), metaReadKey: keys.metaReadKey.toString("hex"), key3: keys.key3.toString("hex"), key4: keys.key4.toString("hex") };
    const temporary = `${this.filename}.${process.pid}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(entries)); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temporary, this.filename); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
}
