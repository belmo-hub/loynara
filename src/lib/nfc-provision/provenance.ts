import type { DevelopmentKeys } from "./ntag";

/** External custody reference only: this string does not establish the chip's current credentials. */
export function assertProvenance(ref: string | undefined): asserts ref is string {
  if (!ref || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(ref) || /^(?:[a-f0-9]{32}|[a-f0-9]{64}|factory|default|seller|unknown)$/i.test(ref)) throw new Error("Execution requires an externally reviewed non-secret provenance reference");
}

/** No implicit factory credentials. The operator supplies all current keys from established custody. */
export function assertCurrentKeys(keys: DevelopmentKeys | undefined): asserts keys is DevelopmentKeys {
  if (!keys || ![keys.key0, keys.fileReadKey, keys.metaReadKey, keys.key3, keys.key4].every(key => Buffer.isBuffer(key) && key.length === 16)) throw new Error("Execution requires all five externally established current keys; no default-key probes or fallbacks");
}
