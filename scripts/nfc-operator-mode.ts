import { assertProvenance } from "../src/lib/nfc-provision/provenance";

export type OperatorOptions = Record<string, string>;
export type OperatorMode = "read_only" | "offline_dry_run" | "execute";

const COMMANDS = new Set(["reader-check", "tag-inspect", "provision", "resume", "tag-status", "tag-revoke"]);
const FLAGS = new Set(["execute", "dry-run", "unlinked"]);
const OPTIONS = new Set(["reader", "env-file", "program-id", "actor-user-id", "tag-id", "target", "tenant-id", "location-id", "cooldown-seconds", "execute", "dry-run", "unlinked", "plate", "provenance-ref", "transport-keys-file", "prepared-custody-file", "age-identity-file", "approved-plan-fingerprint"]);

export function parseOperatorOptions(args: string[]): OperatorOptions {
  const values: OperatorOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i]?.startsWith("--")) throw new Error("Options must be --name value pairs");
    const name = args[i].slice(2);
    if (!OPTIONS.has(name) || Object.hasOwn(values, name)) throw new Error("Unknown or duplicate operator option");
    if (FLAGS.has(name)) { values[name] = "true"; continue; }
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Options must be --name value pairs");
    values[name] = args[++i];
  }
  return values;
}

/** Non-secret reference to externally reviewed provenance evidence, never a key or an assumed seller state. */
export function requireProvenanceRef(value: string | undefined): string {
  if (!value?.trim()) throw new Error("PROVENANCE_REQUIRED: --provenance-ref must identify reviewed provenance evidence");
  try { assertProvenance(value); }
  catch { throw new Error("PROVENANCE_INVALID: use a non-secret reviewed evidence identifier"); }
  return value;
}

/** Resolve before envfile loading, database imports, key generation, or bridge creation. */
export function operatorMode(command: string | undefined, values: OperatorOptions): OperatorMode {
  if (!command || !COMMANDS.has(command)) throw new Error("Use reader-check, tag-inspect, provision, resume, tag-status, or tag-revoke");
  if (values.execute && values["dry-run"]) throw new Error("CONFLICTING_EXECUTION_FLAGS: --execute and --dry-run cannot be combined");
  if (command === "reader-check" || command === "tag-inspect" || command === "tag-status") {
    if (values.execute || values["dry-run"]) throw new Error("Execution flags are only supported for provision, resume, and tag-revoke");
    return "read_only";
  }
  if (values.execute !== "true") return "offline_dry_run";
  requireProvenanceRef(values["provenance-ref"]);
  if ((command === "provision" || command === "resume") && values.target === "preview") {
    if (!values["prepared-custody-file"]) throw new Error("PREPARED_CUSTODY_REQUIRED");
    if (!values["age-identity-file"]) throw new Error("AGE_IDENTITY_REQUIRED");
    if (!/^[a-f0-9]{64}$/.test(values["approved-plan-fingerprint"] ?? "")) throw new Error("PLAN_APPROVAL_REQUIRED");
    return "execute";
  }
  if (command !== "tag-revoke" && !values["transport-keys-file"]?.trim()) throw new Error("TRANSPORT_KEYS_REQUIRED: --transport-keys-file must identify explicit current credentials in custody");
  return "execute";
}

export function offlineOperatorPlan(command: string, target: string): string[] {
  return [
    `OFFLINE DRY RUN: ${command} for ${target}; nothing was changed.`,
    "Chip state: not observed. No reader, authentication, tag write, envfile, key material, or database was accessed.",
    command === "resume" ? "Plan: review the exact acknowledged state and binding; verify configured SDM before recovery; never probe alternate keys. Unknown key state requires quarantine." : command === "tag-revoke" ? "Plan: verify owner and tag mapping, then revoke only after typed confirmation." : "Plan: review provenance and prior chip evidence; verify UID and binding; confirm; establish supplied current credential; save/derive keys; reserve reference; write NDEF; change each key and settings with durable intent evidence; verify readback and activate.",
    "Execution requires --execute and --provenance-ref <reviewed-evidence-id>, explicit transport-key custody via --transport-keys-file for provision/resume, the approved environment, and typed confirmation. A provenance reference does not prove a chip's state.",
  ];
}
