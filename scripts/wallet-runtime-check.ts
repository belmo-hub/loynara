/**
 * Proves that THIS runtime (a built image, not a developer Mac) can produce a signed Apple Wallet pass: OpenSSL and zip
 * are present, the archive is built by the application code, its manifest matches every file, and the detached CMS
 * signature verifies. It uses a throwaway self-signed certificate created in a temporary directory and deleted again;
 * it never reads configured credentials, contacts Apple or Google, or touches a database.
 *
 *   docker run --rm --entrypoint npx <image> tsx scripts/wallet-runtime-check.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { applePassArchive, applePassJson } from "../src/lib/wallet/apple";
import type { WalletPassData } from "../src/lib/wallet/types";

const dir = mkdtempSync(join(tmpdir(), "loynara-wallet-check-"));
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  console.log(`openssl: ${run("openssl", ["version"]).trim()}`);
  console.log(`zip: ${run("zip", ["-v"]).match(/Zip \d[^\n]*/)?.[0] ?? "unknown"}`);
  // Same shape as production: a pass certificate issued by a separate intermediate (Apple's WWDR in production). A leaf
  // reused as its own intermediate is rejected by the OpenSSL 3.0 in this image ("certificate already present").
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca-key.pem", "-out", "ca.pem", "-days", "1", "-subj", "/CN=Loynara runtime check CA (not Apple WWDR)"]);
  run("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.csr", "-subj", "/CN=Loynara runtime check pass (not an Apple certificate)"]);
  run("openssl", ["x509", "-req", "-in", "cert.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-out", "cert.pem", "-days", "1"]);
  const config = { passTypeId: "pass.check.runtime", teamId: "ABCDE12345", webServiceUrl: "https://runtime-check.invalid/api/apple", authSecret: "r".repeat(40), certPath: join(dir, "cert.pem"), keyPath: join(dir, "key.pem"), wwdrPath: join(dir, "ca.pem") };
  const pass: WalletPassData = {
    tenantId: "00000000-0000-4000-8000-000000000001", programId: "00000000-0000-4000-8000-000000000002", membershipId: "00000000-0000-4000-8000-000000000003",
    merchantName: "Runtime Check", programName: "Prüfkarte", locationName: "Image", brandColor: "#1F4A3A", country: "DE", locale: "de",
    programType: "stamp", balance: 7, scanCode: "sc_runtime_check", cardLocator: "K-AAAAAA", reward: { title: "Kaffee", cost: 10 },
  };
  const serial = "00000000-0000-4000-8000-000000000004";
  const archive = await applePassArchive(applePassJson(pass, serial, config), pass, config);
  writeFileSync(join(dir, "check.pkpass"), archive);
  const listing = run("zip", ["-sf", "check.pkpass"]);
  for (const name of ["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png"]) if (!listing.includes(name)) throw new Error(`Archive lacks ${name}`);
  // The image has no unzip; read the entries back with a minimal reader instead.
  const entries = readZipEntries(archive);
  const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as Record<string, string>;
  for (const [name, hash] of Object.entries(manifest)) {
    if (createHash("sha1").update(entries.get(name)!).digest("hex") !== hash) throw new Error(`Manifest hash mismatch for ${name}`);
  }
  writeFileSync(join(dir, "manifest.json"), entries.get("manifest.json")!);
  writeFileSync(join(dir, "signature"), entries.get("signature")!);
  // Full chain verification against the stand-in intermediate, as Wallet does against Apple's WWDR.
  run("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", "signature", "-content", "manifest.json", "-CAfile", "ca.pem", "-purpose", "any", "-out", "/dev/null"]);
  const json = JSON.parse(entries.get("pass.json")!.toString("utf8"));
  if (json.serialNumber !== serial || json.barcodes?.[0]?.message !== pass.scanCode || json.sharingProhibited !== true) throw new Error("Unexpected pass.json");
  console.log(`Wallet runtime check passed: ${archive.length} byte pass, ${Object.keys(manifest).length} files, signature verified.`);
}

/** Minimal reader for the stored/deflated entries `zip` writes; enough to check this archive without unzip. */
function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const flags = zip.readUInt16LE(offset + 6);
    if (flags & 0x08) throw new Error("Streaming zip entries are not expected");
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const data = zip.subarray(start, start + compressed);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    offset = start + compressed;
  }
  return entries;
}

main().then(() => rmSync(dir, { recursive: true, force: true }), (error) => {
  rmSync(dir, { recursive: true, force: true });
  console.error(`Wallet runtime check FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
