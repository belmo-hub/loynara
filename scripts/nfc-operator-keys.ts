import type { DevelopmentKeys } from "../src/lib/nfc-provision/ntag";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Only called after explicit execution/provenance guards. No assumptions or default credentials. */
export async function loadTransportKeyCustody(filename: string): Promise<{ expectedUid: string; currentKeys: DevelopmentKeys }> {
  try {
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096) throw new Error("invalid custody file");
      const value: unknown = JSON.parse(await file.readFile("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid custody data");
      const entry = value as Record<string, unknown>;
      if (typeof entry.uid !== "string" || !/^[a-f0-9]{14}$/.test(entry.uid)) throw new Error("invalid custody UID");
      const slot = (name: string) => {
        const encoded = entry[name];
        if (typeof encoded !== "string" || !/^[a-f0-9]{32}$/i.test(encoded)) throw new Error("invalid custody key");
        return Buffer.from(encoded, "hex");
      };
      return { expectedUid: entry.uid, currentKeys: { key0: slot("key0"), fileReadKey: slot("fileReadKey"), metaReadKey: slot("metaReadKey"), key3: slot("key3"), key4: slot("key4") } };
    } finally { await file.close(); }
  } catch {
    // File paths, JSON, and underlying errors can contain secrets; never forward them.
    throw new Error("TRANSPORT_KEYS_INVALID: explicit UID and all five AES slots in a restricted regular custody file are required");
  }
}
